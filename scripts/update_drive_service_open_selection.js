import fs from 'fs';

// ----------------------------------------------------------------------------
// 1. UPDATE googleDriveService.ts
// ----------------------------------------------------------------------------
let tsContent = fs.readFileSync('googleDriveService.ts', 'utf8');

const tsFunc = `/**
 * Valida se uma pasta existe e está acessível no Google Drive pela conta de serviço.
 */
export async function verifyFolderAccessibleInDrive(folderId: string): Promise<{
  accessible: boolean;
  folder?: { id: string; name: string };
  error?: string;
}> {
  if (!folderId || !String(folderId).trim()) {
    return { accessible: false, error: 'Identificador da pasta não informado.' };
  }
  try {
    const accessToken = await getDriveServiceAccountAccessToken();
    const cleanId = String(folderId).trim();
    const url = \`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(cleanId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true\`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });

    if (res.status === 404) {
      return {
        accessible: false,
        error: \`A pasta selecionada (\${cleanId}) não foi encontrada no Google Drive ou não foi compartilhada com a integração.\`,
      };
    }
    if (res.status === 403) {
      const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
      return {
        accessible: false,
        error: \`Acesso negado à pasta no Google Drive (\${res.status}). Compartilhe a pasta com o e-mail: \${email}.\`,
      };
    }
    if (!res.ok) {
      return {
        accessible: false,
        error: \`Erro ao verificar pasta no Google Drive (\${res.status}).\`,
      };
    }

    const data: any = await res.json();
    if (data.trashed) {
      return {
        accessible: false,
        error: \`A pasta "\${data.name}" está na lixeira do Google Drive.\`,
      };
    }
    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      return {
        accessible: false,
        error: \`O item selecionado ("\${data.name}") não é uma pasta do Google Drive.\`,
      };
    }

    return {
      accessible: true,
      folder: { id: data.id, name: data.name },
    };
  } catch (err: any) {
    return {
      accessible: false,
      error: \`Falha ao verificar pasta no Google Drive: \${err?.message || err}\`,
    };
  }
}

/**
 * Navegação livre e hierárquica por QUALQUER pasta acessível no Google Drive.
 * O usuário pode navegar a partir da raiz do Drive, entrar em subpastas e selecionar
 * qualquer pasta acessível independentemente de sua localização ou da pasta TESTE.
 */
export async function getFolderContentsAndBreadcrumb(
  condoName?: string | null,
  targetFolderId?: string | null
): Promise<{
  ok: boolean;
  currentFolder: { id: string; name: string };
  breadcrumb: Array<{ id: string; name: string }>;
  subfolders: Array<{ id: string; name: string; path: string; is_condo_root: boolean; pdf_count: number }>;
  pdfs: DrivePdfFileItem[];
  totalPdfsInCurrentFolder: number;
  error?: string;
}> {
  try {
    const root = await verifyRootFolder();
    const accessToken = await getDriveServiceAccountAccessToken();
    const reqFolderId = (targetFolderId && String(targetFolderId).trim()) ? String(targetFolderId).trim() : root.id;

    let activeFolder: { id: string; name: string };
    const breadcrumb: Array<{ id: string; name: string }> = [];

    if (reqFolderId === root.id) {
      activeFolder = { id: root.id, name: 'Google Drive' };
      breadcrumb.push({ id: root.id, name: 'Google Drive' });
    } else {
      const metaUrl: string = \`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(reqFolderId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true\`;
      const metaRes: Response = await fetch(metaUrl, {
        method: 'GET',
        headers: { Authorization: \`Bearer \${accessToken}\` },
      });

      if (metaRes.status === 404) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta solicitada não foi encontrada no Google Drive ou não foi compartilhada com a integração.',
        };
      }
      if (metaRes.status === 403) {
        const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: \`Acesso negado à pasta solicitada. Certifique-se de compartilhá-la com: \${email}.\`,
        };
      }
      if (!metaRes.ok) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: \`Erro ao consultar pasta no Google Drive (\${metaRes.status}).\`,
        };
      }

      const metaData: any = await metaRes.json();
      if (metaData.trashed) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta selecionada está na lixeira do Google Drive.',
        };
      }
      if (metaData.mimeType !== 'application/vnd.google-apps.folder') {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'O item selecionado não é uma pasta do Google Drive.',
        };
      }

      activeFolder = { id: metaData.id, name: metaData.name };
      breadcrumb.unshift({ id: metaData.id, name: metaData.name });

      // Rastrear pastas ancestrais para construir o breadcrumb
      let currentParents: string[] = metaData.parents || [];
      let depth = 0;
      while (currentParents.length > 0 && depth < 10) {
        depth++;
        const pId = currentParents[0];
        if (pId === root.id) {
          breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
          break;
        }
        try {
          const pRes: Response = await fetch(\`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(pId)}?fields=id,name,parents,trashed&supportsAllDrives=true\`, {
            headers: { Authorization: \`Bearer \${accessToken}\` },
          });
          if (pRes.ok) {
            const pData: any = await pRes.json();
            breadcrumb.unshift({ id: pData.id, name: pData.name });
            currentParents = pData.parents || [];
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      if (breadcrumb.length === 0 || breadcrumb[0].id !== root.id) {
        breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
      }
    }

    // Listar subpastas diretas
    const subQuery = \`'\${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false\`;
    const subUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(subQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
    const subRes = await fetch(subUrl, {
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });
    const subData: any = subRes.ok ? await subRes.json() : { files: [] };
    const rawSubfolders = subData.files || [];

    const basePath = breadcrumb.map((b) => b.name).join(' / ');

    // Listar PDFs diretos na pasta ativa
    const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

    // Mapear contagem de PDFs diretos nas subpastas
    const subfolders = await Promise.all(
      rawSubfolders.map(async (sf: any) => {
        let count = 0;
        try {
          const cQuery = \`'\${sf.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false\`;
          const cUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(cQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
          const cRes = await fetch(cUrl, {
            headers: { Authorization: \`Bearer \${accessToken}\` },
          });
          if (cRes.ok) {
            const cData: any = await cRes.json();
            count = (cData.files || []).length;
          }
        } catch {
          count = 0;
        }

        return {
          id: sf.id,
          name: sf.name,
          path: \`\${basePath} / \${sf.name}\`,
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
  } catch (err: any) {
    return {
      ok: false,
      currentFolder: { id: '', name: '' },
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
      totalPdfsInCurrentFolder: 0,
      error: \`Falha ao navegar no Google Drive: \${err?.message || err}\`,
    };
  }
}
`;

const markerTs = 'export async function getFolderContentsAndBreadcrumb';
const idxTs = tsContent.indexOf(markerTs);
if (idxTs > 0) {
  // Find preceding doc comment
  const docCommentStart = tsContent.lastIndexOf('/**', idxTs);
  tsContent = tsContent.slice(0, docCommentStart) + tsFunc;
  fs.writeFileSync('googleDriveService.ts', tsContent, 'utf8');
  console.log('googleDriveService.ts updated with free folder navigation!');
} else {
  console.warn('Could not find marker in googleDriveService.ts');
}

// ----------------------------------------------------------------------------
// 2. UPDATE googleDriveService.js
// ----------------------------------------------------------------------------
let jsContent = fs.readFileSync('googleDriveService.js', 'utf8');

const jsFunc = `/**
 * Valida se uma pasta existe e está acessível no Google Drive pela conta de serviço.
 */
export async function verifyFolderAccessibleInDrive(folderId) {
  if (!folderId || !String(folderId).trim()) {
    return { accessible: false, error: 'Identificador da pasta não informado.' };
  }
  try {
    const accessToken = await getDriveServiceAccountAccessToken();
    const cleanId = String(folderId).trim();
    const url = \`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(cleanId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true\`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });

    if (res.status === 404) {
      return {
        accessible: false,
        error: \`A pasta selecionada (\${cleanId}) não foi encontrada no Google Drive ou não foi compartilhada com a integração.\`,
      };
    }
    if (res.status === 403) {
      const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
      return {
        accessible: false,
        error: \`Acesso negado à pasta no Google Drive (\${res.status}). Compartilhe a pasta com o e-mail: \${email}.\`,
      };
    }
    if (!res.ok) {
      return {
        accessible: false,
        error: \`Erro ao verificar pasta no Google Drive (\${res.status}).\`,
      };
    }

    const data = await res.json();
    if (data.trashed) {
      return {
        accessible: false,
        error: \`A pasta "\${data.name}" está na lixeira do Google Drive.\`,
      };
    }
    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      return {
        accessible: false,
        error: \`O item selecionado ("\${data.name}") não é uma pasta do Google Drive.\`,
      };
    }

    return {
      accessible: true,
      folder: { id: data.id, name: data.name },
    };
  } catch (err) {
    return {
      accessible: false,
      error: \`Falha ao verificar pasta no Google Drive: \${err?.message || err}\`,
    };
  }
}

/**
 * Navegação livre e hierárquica por QUALQUER pasta acessível no Google Drive.
 */
export async function getFolderContentsAndBreadcrumb(condoName, targetFolderId) {
  try {
    const root = await verifyRootFolder();
    const accessToken = await getDriveServiceAccountAccessToken();
    const reqFolderId = (targetFolderId && String(targetFolderId).trim()) ? String(targetFolderId).trim() : root.id;

    let activeFolder;
    const breadcrumb = [];

    if (reqFolderId === root.id) {
      activeFolder = { id: root.id, name: 'Google Drive' };
      breadcrumb.push({ id: root.id, name: 'Google Drive' });
    } else {
      const metaUrl = \`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(reqFolderId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true\`;
      const metaRes = await fetch(metaUrl, {
        method: 'GET',
        headers: { Authorization: \`Bearer \${accessToken}\` },
      });

      if (metaRes.status === 404) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta solicitada não foi encontrada no Google Drive ou não foi compartilhada com a integração.',
        };
      }
      if (metaRes.status === 403) {
        const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: \`Acesso negado à pasta solicitada. Certifique-se de compartilhá-la com: \${email}.\`,
        };
      }
      if (!metaRes.ok) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: \`Erro ao consultar pasta no Google Drive (\${metaRes.status}).\`,
        };
      }

      const metaData = await metaRes.json();
      if (metaData.trashed) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta selecionada está na lixeira do Google Drive.',
        };
      }
      if (metaData.mimeType !== 'application/vnd.google-apps.folder') {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'O item selecionado não é uma pasta do Google Drive.',
        };
      }

      activeFolder = { id: metaData.id, name: metaData.name };
      breadcrumb.unshift({ id: metaData.id, name: metaData.name });

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
          const pRes = await fetch(\`\${GOOGLE_DRIVE_API_BASE}/files/\${encodeURIComponent(pId)}?fields=id,name,parents,trashed&supportsAllDrives=true\`, {
            headers: { Authorization: \`Bearer \${accessToken}\` },
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

      if (breadcrumb.length === 0 || breadcrumb[0].id !== root.id) {
        breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
      }
    }

    const subQuery = \`'\${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false\`;
    const subUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(subQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
    const subRes = await fetch(subUrl, {
      headers: { Authorization: \`Bearer \${accessToken}\` },
    });
    const subData = subRes.ok ? await subRes.json() : { files: [] };
    const rawSubfolders = subData.files || [];

    const basePath = breadcrumb.map((b) => b.name).join(' / ');
    const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

    const subfolders = await Promise.all(
      rawSubfolders.map(async (sf) => {
        let count = 0;
        try {
          const cQuery = \`'\${sf.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false\`;
          const cUrl = \`\${GOOGLE_DRIVE_API_BASE}/files?q=\${encodeURIComponent(cQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true\`;
          const cRes = await fetch(cUrl, {
            headers: { Authorization: \`Bearer \${accessToken}\` },
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
          path: \`\${basePath} / \${sf.name}\`,
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
  } catch (err) {
    return {
      ok: false,
      currentFolder: { id: '', name: '' },
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
      totalPdfsInCurrentFolder: 0,
      error: \`Falha ao navegar no Google Drive: \${err?.message || err}\`,
    };
  }
}
`;

const markerJs = 'export async function getFolderContentsAndBreadcrumb';
const idxJs = jsContent.indexOf(markerJs);
if (idxJs > 0) {
  const docCommentStartJs = jsContent.lastIndexOf('/**', idxJs);
  jsContent = jsContent.slice(0, docCommentStartJs) + jsFunc;
  fs.writeFileSync('googleDriveService.js', jsContent, 'utf8');
  console.log('googleDriveService.js updated with free folder navigation!');
} else {
  console.warn('Could not find marker in googleDriveService.js');
}
