import fs from 'fs';

const serviceFiles = ['googleDriveService.ts', 'googleDriveService.js'];

const browserFunctionTs = `
/**
 * Navegação hierárquica e segura pelas pastas do condomínio no Google Drive.
 * Valida autoridade de acesso e constrói o breadcrumb até a pasta solicitada.
 */
export async function getFolderContentsAndBreadcrumb(condoName: string, targetFolderId?: string | null): Promise<{
  ok: boolean;
  currentFolder: { id: string; name: string };
  breadcrumb: Array<{ id: string; name: string }>;
  subfolders: Array<{ id: string; name: string; path: string; is_condo_root: boolean; pdf_count: number }>;
  pdfs: DrivePdfFileItem[];
  totalPdfsInCurrentFolder: number;
  error?: string;
}> {
  const matchResult = await findCondoSubfolder(condoName);
  if (!matchResult.found || !matchResult.folder) {
    return {
      ok: false,
      currentFolder: { id: '', name: '' },
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
      totalPdfsInCurrentFolder: 0,
      error: matchResult.error || \`Pasta do condomínio "\${condoName}" não encontrada no Google Drive central.\`,
    };
  }

  const condoRootFolder = matchResult.folder;
  const accessToken = await getDriveServiceAccountAccessToken();
  const reqFolderId = (targetFolderId && targetFolderId.trim()) ? targetFolderId.trim() : condoRootFolder.id;

  // 1. Validar e construir a cadeia de breadcrumbs até a pasta solicitada
  const breadcrumb: Array<{ id: string; name: string }> = [];
  let currentId: string | null = reqFolderId;
  let currentName = '';
  let isAuthorized = false;
  let depth = 0;

  while (currentId && depth < 12) {
    depth++;
    if (currentId === condoRootFolder.id) {
      breadcrumb.unshift({ id: condoRootFolder.id, name: condoRootFolder.name });
      isAuthorized = true;
      break;
    }

    // Buscar metadados e pai no Drive API
    const metaUrl = \`\${GOOGLE_DRIVE_API_BASE}/files/\${currentId}?fields=id,name,parents,trashed&supportsAllDrives=true\`;
    const metaRes = await fetch(metaUrl, {
      method: 'GET',
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });

    if (!metaRes.ok) {
      break;
    }

    const metaData = await metaRes.json();
    if (metaData.trashed) {
      throw new Error('A pasta solicitada foi movida para a lixeira no Google Drive.');
    }

    breadcrumb.unshift({ id: metaData.id, name: metaData.name });
    if (!currentName) currentName = metaData.name;

    const parents = metaData.parents || [];
    if (parents.length === 0) {
      break;
    }

    currentId = parents[0];
  }

  // Se não alcançou a pasta raiz do condomínio na cadeia de pais, a pasta é externa/não autorizada
  if (!isAuthorized) {
    throw new Error(\`Acesso negado: a pasta solicitada não pertence à raiz autorizada do condomínio "\${condoName}".\`);
  }

  const activeFolder = breadcrumb[breadcrumb.length - 1];

  // 2. Listar subpastas diretas contidas em activeFolder.id
  const subfoldersQuery = \`'\${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false\`;
  const subfoldersUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(subfoldersQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
  
  const subfoldersRes = await fetch(subfoldersUrl, {
    method: 'GET',
    headers: { Authorization: \`Bearer \${accessToken}\` },
  });

  const subfoldersData = subfoldersRes.ok ? await subfoldersRes.json() : { files: [] };
  const rawSubfolders = subfoldersData.files || [];

  // Construtor de caminho legível
  const basePath = breadcrumb.map((b) => b.name).join(' / ');

  // 3. Listar PDFs diretamente contidos em activeFolder.id
  const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

  // 4. Mapear subpastas com contagem de PDFs diretos
  const subfoldersWithCount = await Promise.all(
    rawSubfolders.map(async (f: any) => {
      let count = 0;
      try {
        const countQuery = \`'\${f.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false\`;
        const countUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(countQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
        const countRes = await fetch(countUrl, {
          method: 'GET',
          headers: { Authorization: \`Bearer \${accessToken}\` },
        });
        if (countRes.ok) {
          const cData = await countRes.json();
          count = (cData.files || []).length;
        }
      } catch {
        count = 0;
      }

      return {
        id: f.id,
        name: f.name,
        path: \`\${basePath} / \${f.name}\`,
        is_condo_root: false,
        pdf_count: count,
      };
    })
  );

  return {
    ok: true,
    currentFolder: activeFolder,
    breadcrumb,
    subfolders: subfoldersWithCount,
    pdfs: currentPdfs,
    totalPdfsInCurrentFolder: currentPdfs.length,
  };
}
`;

const browserFunctionJs = `
/**
 * Navegação hierárquica e segura pelas pastas do condomínio no Google Drive.
 */
export async function getFolderContentsAndBreadcrumb(condoName, targetFolderId) {
  const matchResult = await findCondoSubfolder(condoName);
  if (!matchResult.found || !matchResult.folder) {
    return {
      ok: false,
      currentFolder: { id: '', name: '' },
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
      totalPdfsInCurrentFolder: 0,
      error: matchResult.error || \`Pasta do condomínio "\${condoName}" não encontrada no Google Drive central.\`,
    };
  }

  const condoRootFolder = matchResult.folder;
  const accessToken = await getDriveServiceAccountAccessToken();
  const reqFolderId = (targetFolderId && String(targetFolderId).trim()) ? String(targetFolderId).trim() : condoRootFolder.id;

  const breadcrumb = [];
  let currentId = reqFolderId;
  let currentName = '';
  let isAuthorized = false;
  let depth = 0;

  while (currentId && depth < 12) {
    depth++;
    if (currentId === condoRootFolder.id) {
      breadcrumb.unshift({ id: condoRootFolder.id, name: condoRootFolder.name });
      isAuthorized = true;
      break;
    }

    const metaUrl = \`\${GOOGLE_DRIVE_API_BASE}/files/\${currentId}?fields=id,name,parents,trashed&supportsAllDrives=true\`;
    const metaRes = await fetch(metaUrl, {
      method: 'GET',
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });

    if (!metaRes.ok) break;

    const metaData = await metaRes.json();
    if (metaData.trashed) {
      throw new Error('A pasta solicitada foi movida para a lixeira no Google Drive.');
    }

    breadcrumb.unshift({ id: metaData.id, name: metaData.name });
    if (!currentName) currentName = metaData.name;

    const parents = metaData.parents || [];
    if (parents.length === 0) break;

    currentId = parents[0];
  }

  if (!isAuthorized) {
    throw new Error(\`Acesso negado: a pasta solicitada não pertence à raiz autorizada do condomínio "\${condoName}".\`);
  }

  const activeFolder = breadcrumb[breadcrumb.length - 1];

  const subfoldersQuery = \`'\${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false\`;
  const subfoldersUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(subfoldersQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;

  const subfoldersRes = await fetch(subfoldersUrl, {
    method: 'GET',
    headers: { Authorization: \`Bearer \${accessToken}\` },
  });

  const subfoldersData = subfoldersRes.ok ? await subfoldersRes.json() : { files: [] };
  const rawSubfolders = subfoldersData.files || [];

  const basePath = breadcrumb.map((b) => b.name).join(' / ');
  const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

  const subfoldersWithCount = await Promise.all(
    rawSubfolders.map(async (f) => {
      let count = 0;
      try {
        const countQuery = \`'\${f.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false\`;
        const countUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(countQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
        const countRes = await fetch(countUrl, {
          method: 'GET',
          headers: { Authorization: \`Bearer \${accessToken}\` },
        });
        if (countRes.ok) {
          const cData = await countRes.json();
          count = (cData.files || []).length;
        }
      } catch {
        count = 0;
      }

      return {
        id: f.id,
        name: f.name,
        path: \`\${basePath} / \${f.name}\`,
        is_condo_root: false,
        pdf_count: count,
      };
    })
  );

  return {
    ok: true,
    currentFolder: activeFolder,
    breadcrumb,
    subfolders: subfoldersWithCount,
    pdfs: currentPdfs,
    totalPdfsInCurrentFolder: currentPdfs.length,
  };
}
`;

// Append to googleDriveService.ts
let tsCode = fs.readFileSync('googleDriveService.ts', 'utf8');
if (!tsCode.includes('getFolderContentsAndBreadcrumb')) {
  fs.writeFileSync('googleDriveService.ts', tsCode + '\n' + browserFunctionTs, 'utf8');
  console.log('Added getFolderContentsAndBreadcrumb to googleDriveService.ts!');
}

// Append to googleDriveService.js
let jsCode = fs.readFileSync('googleDriveService.js', 'utf8');
if (!jsCode.includes('getFolderContentsAndBreadcrumb')) {
  fs.writeFileSync('googleDriveService.js', jsCode + '\n' + browserFunctionJs, 'utf8');
  console.log('Added getFolderContentsAndBreadcrumb to googleDriveService.js!');
}
