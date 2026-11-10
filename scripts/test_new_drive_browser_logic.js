import { getDriveServiceAccountAccessToken, verifyRootFolder, listPdfFilesInFolder } from '../googleDriveService.js';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

async function testBrowser(targetFolderId) {
  const root = await verifyRootFolder();
  const accessToken = await getDriveServiceAccountAccessToken();
  const reqFolderId = (targetFolderId && String(targetFolderId).trim()) ? String(targetFolderId).trim() : root.id;

  // 1. Validar e obter metadados da pasta ativa
  let activeFolder = null;
  const breadcrumb = [];

  if (reqFolderId === root.id) {
    activeFolder = { id: root.id, name: 'Google Drive' };
    breadcrumb.push({ id: root.id, name: 'Google Drive' });
  } else {
    // Buscar metadados no Drive API
    const metaUrl = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(reqFolderId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`;
    const metaRes = await fetch(metaUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (metaRes.status === 404) {
      return { ok: false, error: 'A pasta solicitada não foi encontrada no Google Drive.' };
    }
    if (metaRes.status === 403) {
      return { ok: false, error: 'Acesso negado à pasta no Google Drive. Verifique se ela foi compartilhada com a conta de serviço.' };
    }
    if (!metaRes.ok) {
      return { ok: false, error: `Erro ao consultar pasta no Google Drive (${metaRes.status}).` };
    }

    const metaData = await metaRes.json();
    if (metaData.trashed) {
      return { ok: false, error: 'A pasta selecionada está na lixeira do Google Drive.' };
    }
    if (metaData.mimeType !== 'application/vnd.google-apps.folder') {
      return { ok: false, error: 'O item selecionado não é uma pasta do Google Drive.' };
    }

    activeFolder = { id: metaData.id, name: metaData.name };
    breadcrumb.unshift({ id: metaData.id, name: metaData.name });

    // Tracing parents upward
    let currentParents = metaData.parents || [];
    let depth = 0;
    while (currentParents.length > 0 && depth < 10) {
      depth++;
      const pId = currentParents[0];
      if (pId === root.id) {
        breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
        break;
      }
      try {
        const pRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(pId)}?fields=id,name,parents,trashed&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          breadcrumb.unshift({ id: pData.id, name: pData.name });
          currentParents = pData.parents || [];
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    if (breadcrumb[0].id !== root.id) {
      breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
    }
  }

  // 2. Listar subpastas diretas
  const subQuery = `'${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const subUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(subQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const subRes = await fetch(subUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const subData = subRes.ok ? await subRes.json() : { files: [] };
  const rawSubfolders = subData.files || [];

  const basePath = breadcrumb.map((b) => b.name).join(' / ');

  // 3. Listar PDFs diretos
  const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

  // 4. Mapear subpastas com contagem de PDFs
  const subfolders = await Promise.all(
    rawSubfolders.map(async (sf) => {
      let count = 0;
      try {
        const cQuery = `'${sf.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false`;
        const cUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(cQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const cRes = await fetch(cUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cRes.ok) {
          const cData = await cRes.json();
          count = (cData.files || []).length;
        }
      } catch {
        count = 0;
      }

      return {
        id: sf.id,
        name: sf.name,
        path: `${basePath} / ${sf.name}`,
        is_condo_root: false,
        pdf_count: count,
      };
    })
  );

  return {
    ok: true,
    currentFolder: activeFolder,
    breadcrumb,
    subfolders,
    pdfs: currentPdfs,
    totalPdfsInCurrentFolder: currentPdfs.length,
  };
}

async function run() {
  console.log('1. Testing Root (null):');
  const rootRes = await testBrowser(null);
  console.log('Root OK:', rootRes.ok, 'Current:', rootRes.currentFolder.name, 'Subfolders:', rootRes.subfolders.map(s => s.name));

  console.log('\n2. Testing TESTE folder:');
  const testeRes = await testBrowser('1l6nhYiDRD6C3HQUSnqSh6nDGP7kR_jHT');
  console.log('TESTE OK:', testeRes.ok, 'Breadcrumb:', testeRes.breadcrumb.map(b => b.name).join(' -> '), 'Subfolders:', testeRes.subfolders.map(s => s.name));

  console.log('\n3. Testing TESTE 2 folder (outside TESTE hierarchy):');
  const teste2Res = await testBrowser('11m48OBxPf6SjSqUQ2Nn6vn8WatMtfcGp');
  console.log('TESTE 2 OK:', teste2Res.ok, 'Breadcrumb:', teste2Res.breadcrumb.map(b => b.name).join(' -> '), 'Subfolders:', teste2Res.subfolders.map(s => s.name));

  console.log('\n4. Testing SUBPASTA 1:');
  const sub1Res = await testBrowser('13W2G7Pv6k9SPnCu4tSeHLLCJMhiMvSex');
  console.log('SUBPASTA 1 OK:', sub1Res.ok, 'Breadcrumb:', sub1Res.breadcrumb.map(b => b.name).join(' -> '), 'PDFs:', sub1Res.pdfs.map(p => p.name));
}

run();
