import fs from 'fs';

// ----------------------------------------------------------------------------
// 1. UPDATE AuditoriaModule.tsx FOR MODALS AND NAVIGATION
// ----------------------------------------------------------------------------
let auditoriaContent = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// A. Insert Folder Modals right before isAnalysisModalOpen
const analysisModalMarker = '{/* =========================================================================\n           MODAL DE ANÁLISE INTELIGENTE DE DOCUMENTOS COM IA';
const analysisModalMarkerCompact = '{/* =========================================================================           MODAL DE ANÁLISE INTELIGENTE DE DOCUMENTOS COM IA';

const folderModalsJsx = `
        {/* =========================================================================
           MODAL DE SELEÇÃO DE PASTA DO GOOGLE DRIVE POR FASE
           ========================================================================= */}
        {isFolderModalOpen && selectedCondo && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Topo do Modal */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#FF6600]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <span>Vincular Pasta do Google Drive</span>
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

              {/* Informação sobre a sincronização de pastas */}
              <div className="px-5 py-3 bg-slate-800/40 border-b border-slate-800/80 text-xs text-slate-300 flex items-start gap-2.5">
                <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="leading-relaxed">
                  Ao selecionar a pasta, todos os PDFs nela existentes serão identificados e vinculados automaticamente no CRM.
                  <strong className="text-white block mt-0.5">Arquivos originais no Google Drive permanecem intactos.</strong>
                </div>
              </div>

              {/* Corpo do Modal */}
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {/* 1. Loading */}
                {isLoadingAvailableFolders && (
                  <div className="py-12 text-center space-y-3">
                    <div className="inline-block animate-spin w-8 h-8 border-2 border-[#FF6600] border-t-transparent rounded-full" />
                    <p className="text-xs text-slate-400 font-medium">
                      Escaneando pastas no Google Drive do condomínio...
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
                      <span>Falha ao consultar pastas do Drive</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{availableFoldersError}</p>
                    <button
                      type="button"
                      onClick={() => fetchAvailableFolders(selectedCondo.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {/* 3. Lista de Pastas Disponíveis */}
                {!isLoadingAvailableFolders && !availableFoldersError && (
                  <div className="space-y-3">
                    {/* Campo de busca de pastas */}
                    {availableFolders.length > 3 && (
                      <div>
                        <input
                          type="text"
                          value={folderSearchTerm}
                          onChange={(e) => setFolderSearchTerm(e.target.value)}
                          placeholder="Filtrar pastas por nome..."
                          className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#FF6600]"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      {availableFolders
                        .filter((f) =>
                          folderSearchTerm ? f.name.toLowerCase().includes(folderSearchTerm.toLowerCase()) : true
                        )
                        .map((folder) => {
                          const isSelected = selectedFolderId === folder.id;
                          return (
                            <div
                              key={folder.id}
                              onClick={() => setSelectedFolderId(folder.id)}
                              className={\`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 \${
                                isSelected
                                  ? 'bg-[#FF6600]/10 border-[#FF6600] text-white'
                                  : 'bg-slate-800/60 border-slate-700/80 hover:bg-slate-800 text-slate-300'
                              }\`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={\`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 \${
                                    isSelected
                                      ? 'bg-[#FF6600] text-white'
                                      : 'bg-slate-700/80 text-amber-400'
                                  }\`}
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                  </svg>
                                </div>
                                <div className="truncate">
                                  <div className="text-xs font-bold truncate text-white flex items-center gap-2">
                                    <span>{folder.name}</span>
                                    {folder.is_condo_root && (
                                      <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                        Pasta Raiz
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                    Caminho: {folder.path}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/60 text-slate-300 border border-slate-600/60">
                                  {folder.pdf_count ?? 0} {(folder.pdf_count === 1) ? 'PDF' : 'PDFs'}
                                </span>
                                <input
                                  type="radio"
                                  name="selectedFolder"
                                  checked={isSelected}
                                  onChange={() => setSelectedFolderId(folder.id)}
                                  className="accent-[#FF6600] w-4 h-4 cursor-pointer"
                                />
                              </div>
                            </div>
                          );
                        })}

                      {availableFolders.length === 0 && (
                        <div className="py-8 text-center text-xs text-slate-400 space-y-1">
                          <p className="font-semibold text-slate-300">Nenhuma pasta de documentos localizada.</p>
                          <p>Verifique se o condomínio possui pastas criadas no Google Drive central.</p>
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

              {/* Rodapé do Modal */}
              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-900/50">
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#FF6600] hover:bg-[#FF6600]/90 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
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
        )}

        {/* =========================================================================
           MODAL DE CONFIRMAÇÃO DE DESVINCULAÇÃO SELETIVA DE PASTA
           ========================================================================= */}
        {isConfirmUnlinkFolderOpen && selectedCondo && folderToUnlink && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Desvincular Pasta</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkFolderOpen(false);
                    setFolderToUnlink(null);
                  }}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs leading-relaxed">
                <p className="text-slate-300">
                  Deseja desvincular a pasta <strong className="text-white">"{folderToUnlink.folder.drive_folder_name}"</strong> da fase <strong className="text-white">{CANONICAL_CATEGORIES.find((c) => c.id === folderToUnlink.category)?.name}</strong>?
                </p>

                <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Segurança dos arquivos:</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Esta ação remove apenas os vínculos locais com os documentos desta pasta no CRM.
                    <strong className="text-white block mt-1">Os arquivos originais no seu Google Drive permanecerão 100% intactos.</strong>
                    Vínculos de outras fases também não são afetados.
                  </p>
                </div>

                {unlinkFolderError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
                    {unlinkFolderError}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkFolderOpen(false);
                    setFolderToUnlink(null);
                  }}
                  disabled={isUnlinkingFolder}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlinkFolder}
                  disabled={isUnlinkingFolder}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isUnlinkingFolder ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Desvinculando...</span>
                    </>
                  ) : (
                    <span>Sim, desvincular pasta</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
\n`;

if (!auditoriaContent.includes('isFolderModalOpen && selectedCondo')) {
  if (auditoriaContent.includes(analysisModalMarkerCompact)) {
    auditoriaContent = auditoriaContent.replace(analysisModalMarkerCompact, folderModalsJsx + analysisModalMarkerCompact);
    console.log('Folder modals successfully inserted before compact analysis modal marker!');
  } else if (auditoriaContent.includes(analysisModalMarker)) {
    auditoriaContent = auditoriaContent.replace(analysisModalMarker, folderModalsJsx + analysisModalMarker);
    console.log('Folder modals successfully inserted before analysis modal marker!');
  } else {
    console.warn('Could not find analysis modal marker in AuditoriaModule.tsx');
  }
} else {
  console.log('isFolderModalOpen already exists in AuditoriaModule.tsx JSX!');
}

// B. Fix Navigation & Breadcrumb in AuditoriaModule.tsx
// Replace commercial breadcrumb `Pipeline / Auditoria / {Name}` with `Condomínios / {Name}`
const oldBreadcrumbSnippet = `<button
            type="button"
            onClick={onBackToPipeline}
            className="hover:text-[#FF6600] transition-colors flex items-center gap-1 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Pipeline</span>
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={handleBackToList}
            className="hover:text-[#FF6600] transition-colors cursor-pointer"
          >
            Auditoria
          </button>`;

const newBreadcrumbSnippet = `<button
            type="button"
            onClick={handleBackToList}
            className="hover:text-[#FF6600] transition-colors flex items-center gap-1 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Condomínios em Auditoria</span>
          </button>`;

if (auditoriaContent.includes(oldBreadcrumbSnippet)) {
  auditoriaContent = auditoriaContent.replace(oldBreadcrumbSnippet, newBreadcrumbSnippet);
  console.log('Breadcrumb updated cleanly!');
} else {
  // Check single line or alternate whitespace
  auditoriaContent = auditoriaContent.replace(/<span>Pipeline<\/span>\s*<\/button>\s*<span>\/<\/span>\s*<button[^>]*>\s*Auditoria/g, '<span>Condomínios em Auditoria');
  console.log('Breadcrumb updated via regex!');
}

// Replace "Voltar para clientes" with "Voltar para condomínios"
auditoriaContent = auditoriaContent.replace('Voltar para clientes', 'Voltar para condomínios');
console.log('Updated "Voltar para clientes" to "Voltar para condomínios"');

fs.writeFileSync('src/components/AuditoriaModule.tsx', auditoriaContent, 'utf8');


// ----------------------------------------------------------------------------
// 2. UPDATE App.tsx FOR TOP HEADER NAVIGATION WHEN IN AUDITORIA
// ----------------------------------------------------------------------------
let appContent = fs.readFileSync('src/App.tsx', 'utf8');

const targetHeaderModuleSelector = `<div className="flex items-center bg-slate-800/70 border border-slate-700/60 rounded-xl p-1">
                    <button
                      type="button"
                      data-help-id="pipeline-menu"
                      onClick={() => navigate('/app/leads')}
                      className={\`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer \${
                        !isFollowUpsActive && !isUsersSettingsActive && !isAuditoriaActive
                          ? 'bg-[#FF6600] text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                      }\`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span>Pipeline</span>
                    </button>
                    <button
                      type="button"
                      data-help-id="followups-menu"
                      onClick={() => navigate('/app/followups')}
                      className={\`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer \${
                        isFollowUpsActive
                          ? 'bg-[#FF6600] text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                      }\`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Follow-ups</span>
                    </button>
                  </div>`;

const newHeaderAuditoriaSelector = `{isAuditoriaActive ? (
                    <div className="flex items-center gap-2.5">
                      <div className="px-3.5 py-1.5 rounded-xl bg-[#FF6600]/15 border border-[#FF6600]/30 text-[#FF6600] text-xs font-bold flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>Módulo de Auditoria</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/app/leads')}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        title="Ir para o CRM Comercial"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        <span>Voltar ao CRM</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center bg-slate-800/70 border border-slate-700/60 rounded-xl p-1">
                      <button
                        type="button"
                        data-help-id="pipeline-menu"
                        onClick={() => navigate('/app/leads')}
                        className={\`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer \${
                          !isFollowUpsActive && !isUsersSettingsActive && !isAuditoriaActive
                            ? 'bg-[#FF6600] text-white shadow-xs'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                        }\`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span>Pipeline</span>
                      </button>
                      <button
                        type="button"
                        data-help-id="followups-menu"
                        onClick={() => navigate('/app/followups')}
                        className={\`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer \${
                          isFollowUpsActive
                            ? 'bg-[#FF6600] text-white shadow-xs'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                        }\`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>Follow-ups</span>
                      </button>
                    </div>
                  )}`;

if (appContent.includes(targetHeaderModuleSelector)) {
  appContent = appContent.replace(targetHeaderModuleSelector, newHeaderAuditoriaSelector);
  console.log('App.tsx top header navigation updated cleanly for Auditoria!');
} else {
  // Regex fallback
  appContent = appContent.replace(/<div className="flex items-center bg-slate-800\/70 border border-slate-700\/60 rounded-xl p-1">[\s\S]*?<\/div>/, newHeaderAuditoriaSelector);
  console.log('App.tsx top header navigation updated via regex fallback!');
}

fs.writeFileSync('src/App.tsx', appContent, 'utf8');
