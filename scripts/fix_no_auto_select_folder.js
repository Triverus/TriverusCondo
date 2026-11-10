import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// 1. Add state for selectedFolderPdfCount
if (!content.includes('selectedFolderPdfCount')) {
  content = content.replace(
    'const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);',
    'const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);\n  const [selectedFolderPdfCount, setSelectedFolderPdfCount] = useState<number | null>(null);'
  );
  console.log('Added selectedFolderPdfCount state!');
}

// 2. Remove auto-selection inside fetchAvailableFolders
const oldAutoSelectSnippet = `      if (data.currentFolder && data.currentFolder.id) {
        setSelectedFolderId(data.currentFolder.id);
        setSelectedFolderName(data.currentFolder.name);
      }`;

if (content.includes(oldAutoSelectSnippet)) {
  content = content.replace(oldAutoSelectSnippet, '      // Navegação pura: NUNCA selecionar a pasta navegada automaticamente!');
  console.log('Removed auto-selection from fetchAvailableFolders!');
}

// 3. Reset selection state inside handleOpenLinkFolderModal
const oldHandleOpen = `  // Abrir modal para vincular pasta a uma fase canônica
  const handleOpenLinkFolderModal = useCallback((category: string) => {
    if (!currentCondoId) return;
    setActiveFolderCategory(category);
    setSelectedFolderId(null);
    setLinkingFolderError(null);
    setFolderSearchTerm('');
    setIsFolderModalOpen(true);
    fetchAvailableFolders(currentCondoId);
  }, [currentCondoId, fetchAvailableFolders]);`;

const newHandleOpen = `  // Abrir modal para vincular pasta a uma fase canônica (inicia sem seleção prévia)
  const handleOpenLinkFolderModal = useCallback((category: string) => {
    if (!currentCondoId) return;
    setActiveFolderCategory(category);
    setSelectedFolderId(null);
    setSelectedFolderName(null);
    setSelectedFolderPdfCount(null);
    setLinkingFolderError(null);
    setFolderSearchTerm('');
    setIsFolderModalOpen(true);
    fetchAvailableFolders(currentCondoId, null);
  }, [currentCondoId, fetchAvailableFolders]);`;

if (content.includes(oldHandleOpen)) {
  content = content.replace(oldHandleOpen, newHandleOpen);
  console.log('handleOpenLinkFolderModal updated to reset selection!');
}

// 4. Update Current Folder Banner in modal
const oldFolderBanner = `<span className="truncate">Pasta Atual: {currentFolderMeta.name}</span>`;
const newFolderBanner = `<span className="truncate">Pasta em Navegação: {currentFolderMeta.name}</span>`;
content = content.replace(oldFolderBanner, newFolderBanner);

const oldCurrentFolderButton = `<button
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
                      </button>`;

const newCurrentFolderButton = `<button
                        type="button"
                        onClick={() => {
                          setSelectedFolderId(currentFolderMeta.id);
                          setSelectedFolderName(currentFolderMeta.name);
                          setSelectedFolderPdfCount(currentFolderPdfs.length);
                        }}
                        className={\`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 \${
                          selectedFolderId === currentFolderMeta.id
                            ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm'
                            : 'bg-[#FF6600] hover:bg-[#e65c00] text-white shadow-xs'
                        }\`}
                      >
                        {selectedFolderId === currentFolderMeta.id ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>✓ Pasta selecionada para vínculo</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Selecionar esta pasta ({currentFolderMeta.name})</span>
                          </>
                        )}
                      </button>`;

content = content.replace(oldCurrentFolderButton, newCurrentFolderButton);

// 5. Update Subfolder item button
const oldSubfolderButton = `onClick={() => {
                                      setSelectedFolderId(sub.id);
                                      setSelectedFolderName(sub.name);
                                    }}`;

const newSubfolderButton = `onClick={() => {
                                      setSelectedFolderId(sub.id);
                                      setSelectedFolderName(sub.name);
                                      setSelectedFolderPdfCount(sub.pdf_count);
                                    }}`;

content = content.replace(oldSubfolderButton, newSubfolderButton);

// 6. Update Footer Summary & Disabled State
const oldFooterInfo = `<div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">
                    Selecionado: <span className="text-[#FF6600]">{selectedFolderName || 'Nenhum'}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {selectedFolderId === currentFolderMeta?.id
                      ? \`\${currentFolderPdfs.length} PDF(s) diretos nesta pasta\`
                      : 'Pronto para vincular e sincronizar PDFs'}
                  </div>
                </div>`;

const newFooterInfo = `<div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">
                    Selecionado: <span className={selectedFolderId ? "text-emerald-400 font-extrabold" : "text-slate-400 font-normal"}>
                      {selectedFolderName ? \`"\${selectedFolderName}"\` : 'Nenhuma pasta selecionada'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {selectedFolderId
                      ? \`\${selectedFolderPdfCount ?? 0} PDF(s) diretos nesta pasta a vincular\`
                      : 'Clique em "Selecionar esta pasta" na pasta desejada'}
                  </div>
                </div>`;

content = content.replace(oldFooterInfo, newFooterInfo);

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
console.log('AuditoriaModule.tsx updated cleanly for no auto-selection!');
