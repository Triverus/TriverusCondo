import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// 1. Add new state hooks for folder navigation & breadcrumbs
const stateTarget = `  // Estados dos vínculos de pasta por fase do Google Drive
  const [folderLinks, setFolderLinks] = useState<Record<string, FolderLink>>({});
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [activeFolderCategory, setActiveFolderCategory] = useState<string>('convencao');
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [isLoadingAvailableFolders, setIsLoadingAvailableFolders] = useState<boolean>(false);
  const [availableFoldersError, setAvailableFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderSearchTerm, setFolderSearchTerm] = useState<string>('');
  const [isLinkingFolder, setIsLinkingFolder] = useState<boolean>(false);
  const [linkingFolderError, setLinkingFolderError] = useState<string | null>(null);`;

const newStateHooks = `  // Estados dos vínculos de pasta e navegador do Google Drive
  const [folderLinks, setFolderLinks] = useState<Record<string, FolderLink>>({});
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [activeFolderCategory, setActiveFolderCategory] = useState<string>('convencao');
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [folderBreadcrumb, setFolderBreadcrumb] = useState<Array<{ id: string; name: string }>>([]);
  const [currentFolderMeta, setCurrentFolderMeta] = useState<{ id: string; name: string } | null>(null);
  const [currentFolderPdfs, setCurrentFolderPdfs] = useState<DrivePdfFile[]>([]);
  const [navFolderId, setNavFolderId] = useState<string | null>(null);
  const [isLoadingAvailableFolders, setIsLoadingAvailableFolders] = useState<boolean>(false);
  const [availableFoldersError, setAvailableFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [folderSearchTerm, setFolderSearchTerm] = useState<string>('');
  const [isLinkingFolder, setIsLinkingFolder] = useState<boolean>(false);
  const [linkingFolderError, setLinkingFolderError] = useState<string | null>(null);`;

if (!content.includes('folderBreadcrumb')) {
  content = content.replace(stateTarget, newStateHooks);
  console.log('Folder state hooks updated with breadcrumb and nav Folder ID!');
}

// 2. Update fetchAvailableFolders to accept folderId parameter
const oldFetchAvailableFolders = `  // Buscar pastas disponíveis no Drive para o condomínio
  const fetchAvailableFolders = useCallback(async (condoId: string) => {
    try {
      setIsLoadingAvailableFolders(true);
      setAvailableFoldersError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(\`/api/auditoria/condo/\${condoId}/drive-folders\`, {
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao buscar pastas do condomínio no Google Drive');
      }

      const data = await res.json();
      setAvailableFolders(data.folders || []);
      if ((data.folders || []).length > 0) {
        setSelectedFolderId(data.folders[0].id);
      }
    } catch (err: any) {
      setAvailableFoldersError(err.message || 'Erro ao carregar pastas do Google Drive');
    } finally {
      setIsLoadingAvailableFolders(false);
    }
  }, []);`;

const newFetchAvailableFolders = `  // Buscar pastas e navegar pela hierarquia do Google Drive do condomínio
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

if (content.includes('fetchAvailableFolders')) {
  content = content.replace(oldFetchAvailableFolders, newFetchAvailableFolders);
  console.log('fetchAvailableFolders updated with folder navigation & breadcrumb!');
}

// 3. Update handleConfirmLinkFolder to send selected folder name
const oldConfirmLinkFolder = `  // Confirmar vínculo de pasta e sincronização automática idempotente dos PDFs
  const handleConfirmLinkFolder = useCallback(async () => {
    if (!currentCondoId || !selectedFolderId) return;
    const folder = availableFolders.find((f) => f.id === selectedFolderId);
    if (!folder) return;`;

const newConfirmLinkFolder = `  // Confirmar vínculo de pasta e sincronização automática idempotente dos PDFs
  const handleConfirmLinkFolder = useCallback(async () => {
    if (!currentCondoId || !selectedFolderId) return;
    const folderName = selectedFolderName || currentFolderMeta?.name || 'Pasta Selecionada';`;

content = content.replace(oldConfirmLinkFolder, newConfirmLinkFolder);
content = content.replace('drive_folder_name: folder.name,', 'drive_folder_name: folderName,');
content = content.replace('setFeedbackMessage(`Pasta "${folder.name}" vinculada com sucesso!', 'setFeedbackMessage(`Pasta "${folderName}" vinculada com sucesso!');

// 4. Update the Folder Modal JSX to render the full Folder Browser
const modalStart = '{/* =========================================================================\n           MODAL DE SELEÇÃO DE PASTA DO GOOGLE DRIVE POR FASE';
const modalEnd = '{/* =========================================================================\n           MODAL DE CONFIRMAÇÃO DE DESVINCULAÇÃO SELETIVA DE PASTA';

const startIdx = content.indexOf(modalStart);
const endIdx = content.indexOf(modalEnd);

const newFolderModalJsx = `{/* =========================================================================
           MODAL NAVEGADOR DE PASTAS DO GOOGLE DRIVE POR FASE
           ========================================================================= */}
        {isFolderModalOpen && selectedCondo && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Topo do Modal */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#FF6600]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <span>Navegador de Pastas do Google Drive</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fase: <span className="text-[#FF6600] font-semibold">{CANONICAL_CATEGORIES.find((c) => c.id === activeFolderCategory)?.name || activeFolderCategory}</span> · Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFolderModalOpen(false)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Fechar modal"
                >
                  ✕
                </button>
              </div>

              {/* Breadcrumb de Navegação entre Pastas */}
              {folderBreadcrumb.length > 0 && (
                <div className="px-5 py-2.5 bg-slate-800/60 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs flex-wrap">
                  <span className="text-slate-500 font-semibold text-[11px] uppercase tracking-wider shrink-0 mr-1">
                    Caminho:
                  </span>
                  {folderBreadcrumb.map((item, idx) => {
                    const isLast = idx === folderBreadcrumb.length - 1;
                    return (
                      <div key={item.id} className="flex items-center gap-1.5 shrink-0">
                        {idx > 0 && <span className="text-slate-600">/</span>}
                        <button
                          type="button"
                          onClick={() => fetchAvailableFolders(selectedCondo.id, item.id)}
                          disabled={isLoadingAvailableFolders}
                          className={\`px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 \${
                            isLast
                              ? 'bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/40 font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                          }\`}
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                          </svg>
                          <span>{item.name}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Corpo do Modal */}
              <div className="p-5 overflow-y-auto space-y-5 flex-1">
                {/* 1. Loading */}
                {isLoadingAvailableFolders && (
                  <div className="py-12 text-center space-y-3">
                    <div className="inline-block animate-spin w-8 h-8 border-2 border-[#FF6600] border-t-transparent rounded-full" />
                    <p className="text-xs text-slate-400 font-medium">
                      Navegando pela estrutura do Google Drive...
                    </p>
                  </div>
                )}

                {/* 2. Erro */}
                {!isLoadingAvailableFolders && availableFoldersError && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>Erro de navegação</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{availableFoldersError}</p>
                    <button
                      type="button"
                      onClick={() => fetchAvailableFolders(selectedCondo.id, navFolderId)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {/* 3. Navegador Ativo */}
                {!isLoadingAvailableFolders && !availableFoldersError && currentFolderMeta && (
                  <div className="space-y-4">
                    {/* Banner da Pasta Atual */}
                    <div className="p-4 bg-slate-800/80 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-white">
                          <svg className="w-4 h-4 text-[#FF6600]" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                          </svg>
                          <span className="truncate">Pasta Atual: {currentFolderMeta.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Contém <strong className="text-emerald-400">{currentFolderPdfs.length} PDF(s)</strong> diretamente e <strong className="text-slate-200">{availableFolders.length} subpasta(s)</strong>.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolderId(currentFolderMeta.id);
                          setSelectedFolderName(currentFolderMeta.name);
                        }}
                        className={\`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 \${
                          selectedFolderId === currentFolderMeta.id
                            ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm'
                            : 'bg-slate-700 hover:bg-slate-600 text-white'
                        }\`}
                      >
                        {selectedFolderId === currentFolderMeta.id ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Esta pasta está selecionada</span>
                          </>
                        ) : (
                          <span>Selecionar esta pasta ({currentFolderMeta.name})</span>
                        )}
                      </button>
                    </div>

                    {/* Subpastas para Navegação */}
                    {availableFolders.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                          <span>Subpastas em {currentFolderMeta.name} ({availableFolders.length})</span>
                          <span className="text-[10px] text-slate-500 font-normal">Clique para abrir ou selecione para vincular</span>
                        </h4>

                        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                          {availableFolders.map((sub) => {
                            const isSelected = selectedFolderId === sub.id;
                            return (
                              <div
                                key={sub.id}
                                className={\`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 \${
                                  isSelected
                                    ? 'bg-[#FF6600]/15 border-[#FF6600] text-white'
                                    : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800'
                                }\`}
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                    </svg>
                                  </div>
                                  <div className="truncate min-w-0">
                                    <div className="text-xs font-bold text-white truncate">{sub.name}</div>
                                    <div className="text-[10px] text-slate-400 truncate">
                                      {sub.pdf_count ?? 0} {(sub.pdf_count === 1) ? 'PDF direto' : 'PDFs diretos'}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => fetchAvailableFolders(selectedCondo.id, sub.id)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer transition-colors inline-flex items-center gap-1"
                                    title="Entrar nesta subpasta para visualizar o conteúdo"
                                  >
                                    <span>Abrir</span>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedFolderId(sub.id);
                                      setSelectedFolderName(sub.name);
                                    }}
                                    className={\`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer \${
                                      isSelected
                                        ? 'bg-emerald-500 text-slate-950 font-bold'
                                        : 'bg-slate-700/80 hover:bg-slate-700 text-slate-300'
                                    }\`}
                                  >
                                    {isSelected ? 'Selecionada' : 'Selecionar'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* PDFs contidos diretamente nesta pasta */}
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                        <span>PDFs Diretos na Pasta ({currentFolderPdfs.length})</span>
                      </h4>

                      {currentFolderPdfs.length > 0 ? (
                        <div className="p-3 bg-slate-800/40 border border-slate-700/60 rounded-xl space-y-2 max-h-36 overflow-y-auto">
                          {currentFolderPdfs.map((pdf) => (
                            <div key={pdf.id} className="flex items-center justify-between gap-2 text-xs text-slate-300 truncate">
                              <span className="truncate font-medium text-slate-200">{pdf.name}</span>
                              {pdf.size && <span className="text-[10px] text-slate-500 shrink-0">{formatBytes(pdf.size)}</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 bg-slate-800/30 border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500">
                          Nenhum PDF diretamente nesta pasta. {availableFolders.length > 0 ? 'Abra uma das subpastas acima.' : ''}
                        </div>
                      )}

                      {availableFolders.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-relaxed">
                          <strong>Nota sobre subpastas:</strong> Os PDFs contidos dentro de subpastas não são incluídos automaticamente. Você pode navegar e vincular cada subpasta separadamente.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mensagem de Erro na Vinculação */}
                {linkingFolderError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                    {linkingFolderError}
                  </div>
                )}
              </div>

              {/* Rodapé de Confirmação do Modal */}
              <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3 bg-slate-900/90 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">
                    Selecionado: <span className="text-[#FF6600]">{selectedFolderName || 'Nenhum'}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {selectedFolderId === currentFolderMeta?.id
                      ? \`\${currentFolderPdfs.length} PDF(s) diretos nesta pasta\`
                      : 'Pronto para vincular e sincronizar PDFs'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFolderModalOpen(false)}
                    disabled={isLinkingFolder}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmLinkFolder}
                    disabled={isLinkingFolder || !selectedFolderId || isLoadingAvailableFolders}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#FF6600] hover:bg-[#FF6600]/90 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
                  >
                    {isLinkingFolder ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Sincronizando PDFs da pasta...</span>
                      </>
                    ) : (
                      <span>Vincular pasta e sincronizar PDFs</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
           MODAL DE CONFIRMAÇÃO DE DESVINCULAÇÃO SELETIVA DE PASTA`;

if (startIdx > 0 && endIdx > startIdx) {
  content = content.slice(0, startIdx) + newFolderModalJsx + content.slice(endIdx);
  console.log('Folder Browser modal updated cleanly!');
} else {
  console.warn('Could not find exact modal boundaries in AuditoriaModule.tsx');
}

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
