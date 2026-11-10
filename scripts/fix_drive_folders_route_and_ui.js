import fs from 'fs';

// ----------------------------------------------------------------------------
// 1. UPDATE ROUTE IN server.ts AND server.js
// ----------------------------------------------------------------------------
const newRouteCode = `// 1.1. Listar pastas disponíveis e navegar hierarquicamente pelas pastas do condomínio
app.get('/api/auditoria/condo/:condoId/drive-folders', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = (req as any).condoLead;
  const condoName = leadData?.name;
  try {
    const reqFolderId = req.query.folderId ? String(req.query.folderId) : null;
    const result = await getFolderContentsAndBreadcrumb(condoName, reqFolderId);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error || \`A pasta do condomínio "\${condoName}" não foi localizada no Google Drive central.\`,
        currentFolder: null,
        breadcrumb: [],
        subfolders: [],
        pdfs: [],
      });
    }
    return res.json(result);
  } catch (err: any) {
    console.error('[AUDITORIA_DRIVE_FOLDERS_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Falha ao consultar pastas do Google Drive.',
      currentFolder: null,
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
    });
  }
});`;

['server.ts', 'server.js'].forEach((file) => {
  let content = fs.readFileSync(file, 'utf8');

  const routeStartMarker = "app.get('/api/auditoria/condo/:condoId/drive-folders'";
  const startIdx = content.indexOf(routeStartMarker);
  if (startIdx > 0) {
    const endIdx = content.indexOf('});', startIdx) + 3;
    content = content.slice(0, startIdx) + newRouteCode + content.slice(endIdx);
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Route updated in ${file}!`);
  } else {
    console.warn(`Could not find route marker in ${file}`);
  }
});

// ----------------------------------------------------------------------------
// 2. UPDATE fetchAvailableFolders AND MODAL EMPTY STATE IN AuditoriaModule.tsx
// ----------------------------------------------------------------------------
let audContent = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// Update fetchAvailableFolders
const oldFetch = `  // Buscar pastas e navegar pela hierarquia do Google Drive do condomínio
  const fetchAvailableFolders = useCallback(async (condoId: string, folderId?: string | null) => {
    try {
      setIsLoadingAvailableFolders(true);
      setAvailableFoldersError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const queryUrl = folderId
        ? \`/api/auditoria/condo/\${condoId}/drive-folders?folderId=\${encodeURIComponent(folderId)}\`
        : \`/api/auditoria/condo/\${condoId}/drive-folders\`;

      const res = await fetch(queryUrl, {
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao navegar pelas pastas do condomínio no Google Drive');
      }

      const data = await res.json();
      setAvailableFolders(data.subfolders || []);
      setFolderBreadcrumb(data.breadcrumb || []);
      setCurrentFolderMeta(data.currentFolder || null);
      setCurrentFolderPdfs(data.pdfs || []);
      setNavFolderId(data.currentFolder?.id || null);

      // Por padrão, selecionar a pasta atual para vínculo
      if (data.currentFolder) {
        setSelectedFolderId(data.currentFolder.id);
        setSelectedFolderName(data.currentFolder.name);
      }
    } catch (err: any) {
      setAvailableFoldersError(err.message || 'Erro ao carregar pasta do Google Drive');
    } finally {
      setIsLoadingAvailableFolders(false);
    }
  }, []);`;

const newFetch = `  // Buscar pastas e navegar pela hierarquia do Google Drive do condomínio
  const fetchAvailableFolders = useCallback(async (condoId: string, folderId?: string | null) => {
    try {
      setIsLoadingAvailableFolders(true);
      setAvailableFoldersError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const queryUrl = folderId
        ? \`/api/auditoria/condo/\${condoId}/drive-folders?folderId=\${encodeURIComponent(folderId)}\`
        : \`/api/auditoria/condo/\${condoId}/drive-folders\`;

      const res = await fetch(queryUrl, {
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.details || 'Falha ao navegar pelas pastas do condomínio no Google Drive');
      }

      setAvailableFolders(data.subfolders || []);
      setFolderBreadcrumb(data.breadcrumb || []);
      setCurrentFolderMeta(data.currentFolder || null);
      setCurrentFolderPdfs(data.pdfs || []);
      setNavFolderId(data.currentFolder?.id || null);

      if (data.currentFolder && data.currentFolder.id) {
        setSelectedFolderId(data.currentFolder.id);
        setSelectedFolderName(data.currentFolder.name);
      }
    } catch (err: any) {
      console.warn('[Auditoria] Erro ao carregar pastas:', err);
      setAvailableFoldersError(err.message || 'Erro ao carregar pasta do Google Drive');
      setCurrentFolderMeta(null);
      setAvailableFolders([]);
      setFolderBreadcrumb([]);
      setCurrentFolderPdfs([]);
    } finally {
      setIsLoadingAvailableFolders(false);
    }
  }, []);`;

if (audContent.includes('fetchAvailableFolders')) {
  audContent = audContent.replace(oldFetch, newFetch);
  console.log('fetchAvailableFolders updated in AuditoriaModule.tsx!');
}

// Add fallback empty state if currentFolderMeta is null
const activeBrowserMarker = '{/* 3. Navegador Ativo */}';
const fallbackEmptyState = `
                {/* 3. Estado quando nenhuma pasta foi encontrada */}
                {!isLoadingAvailableFolders && !availableFoldersError && !currentFolderMeta && (
                  <div className="py-10 px-4 text-center space-y-3 bg-slate-800/40 rounded-xl border border-slate-700/60">
                    <svg className="w-10 h-10 text-amber-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-white">Nenhuma pasta localizada no Google Drive</p>
                      <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                        Não encontramos uma pasta com o nome <strong className="text-slate-200">"{selectedCondo.name}"</strong> dentro da pasta raiz autorizada do Google Drive.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchAvailableFolders(selectedCondo.id, null)}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
`;

if (!audContent.includes('Estado quando nenhuma pasta foi encontrada')) {
  audContent = audContent.replace(activeBrowserMarker, fallbackEmptyState + '\n                ' + activeBrowserMarker);
  console.log('Fallback empty state added to AuditoriaModule.tsx modal!');
}

fs.writeFileSync('src/components/AuditoriaModule.tsx', audContent, 'utf8');
