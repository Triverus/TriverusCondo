import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// Target the render loop of CANONICAL_CATEGORIES
const startCardLoop = `              {/* Grid de categorias documentais canônicas com suporte a múltiplos arquivos */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {CANONICAL_CATEGORIES.map((cat) => {
                  const docs = linkedDocuments[cat.id] || [];
                  const hasDocs = docs.length > 0;
                  const canManage = canManageAuditoria || isAdmin;
                  return (
                    <div
                      key={cat.id}
                      className={\`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all duration-150 \${
                        hasDocs ? 'border-emerald-500/40 shadow-sm' : 'border-slate-800'
                      }\`}
                    >
                      <div className="space-y-3.5">
                        {/* Header do Card com Ícone e Estado */}
                        <div className="flex items-start justify-between gap-3">
                          <div
                            className={\`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 \${
                              hasDocs
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-slate-800 border-slate-700/80 text-[#FF6600]'
                            }\`}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.8}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              />
                            </svg>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasDocs ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0 inline-flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>{docs.length} {docs.length === 1 ? 'documento' : 'documentos'}</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/80 shrink-0">
                                Nenhum documento
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Título e Descrição da Categoria */}
                        <div>
                          <h3 className="text-sm font-bold text-white">
                            {cat.name}
                          </h3>
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            {cat.description}
                          </p>
                        </div>`;

const newCardHeader = `              {/* Grid de categorias documentais canônicas com suporte a vínculo de pastas e múltiplos arquivos */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {CANONICAL_CATEGORIES.map((cat) => {
                  const docs = linkedDocuments[cat.id] || [];
                  const hasDocs = docs.length > 0;
                  const canManage = canManageAuditoria || isAdmin;
                  const folder = folderLinks[cat.id];
                  const isSyncingThis = syncingCategory === cat.id;

                  return (
                    <div
                      key={cat.id}
                      className={\`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all duration-150 \${
                        folder || hasDocs ? 'border-emerald-500/40 shadow-sm' : 'border-slate-800'
                      }\`}
                    >
                      <div className="space-y-3.5">
                        {/* Header do Card com Ícone e Estado */}
                        <div className="flex items-start justify-between gap-3">
                          <div
                            className={\`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 \${
                              hasDocs
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-slate-800 border-slate-700/80 text-[#FF6600]'
                            }\`}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.8}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              />
                            </svg>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasDocs ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0 inline-flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>{docs.length} {docs.length === 1 ? 'documento' : 'documentos'}</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/80 shrink-0">
                                Nenhum documento
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Hierarquia Visual Exata: Título com maior destaque e descrição atenuada logo abaixo */}
                        <div>
                          <h3 className="text-base font-bold text-white tracking-tight">
                            {cat.name}
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            {cat.description}
                          </p>
                        </div>

                        {/* Bloco de Vínculo de Pasta do Google Drive */}
                        {folder ? (
                          <div className="p-3 bg-slate-800/90 border border-emerald-500/30 rounded-xl space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 flex items-center gap-2">
                                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                </svg>
                                <div className="truncate">
                                  <div className="text-xs font-bold text-white truncate" title={folder.drive_folder_name}>
                                    {folder.drive_folder_name}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {folder.last_synced_at
                                      ? \`Sincronizado \${formatDate(folder.last_synced_at)}\`
                                      : 'Pasta vinculada'}
                                  </div>
                                </div>
                              </div>

                              {/* Ações da pasta vinculada: Sincronizar e Desvincular */}
                              {canManage && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleSyncFolder(cat.id)}
                                    disabled={isSyncingThis}
                                    className="p-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center"
                                    title="Sincronizar novos PDFs desta pasta agora"
                                    aria-label="Sincronizar pasta"
                                  >
                                    <svg
                                      className={\`w-3.5 h-3.5 \${isSyncingThis ? 'animate-spin text-[#FF6600]' : 'text-slate-300'}\`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRequestUnlinkFolder(cat.id, folder)}
                                    disabled={isUnlinkingFolder}
                                    className="p-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center"
                                    title="Desvincular pasta (os arquivos no Drive permanecem intactos)"
                                    aria-label="Desvincular pasta da fase"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-slate-800/40 border border-dashed border-slate-700/80 rounded-xl flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
                              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                              </svg>
                              <span className="truncate">Sem pasta do Drive vinculada</span>
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => handleOpenLinkFolderModal(cat.id)}
                                className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 hover:border-[#FF6600] text-slate-200 hover:text-white text-[11px] font-semibold cursor-pointer transition-colors inline-flex items-center gap-1 shrink-0"
                              >
                                <span className="text-[#FF6600] font-bold">+</span>
                                <span>Vincular pasta</span>
                              </button>
                            )}
                          </div>
                        )}`;

if (content.includes(startCardLoop)) {
  content = content.replace(startCardLoop, newCardHeader);
  console.log('Card header and folder banner updated!');
} else {
  console.warn('Could not find startCardLoop');
}

// Update card footer to offer vincular pasta or single file
const cardFooterTarget = `                      {/* Rodapé do Card com Ação de Adicionar ou Vincular Mais Documentos */}
                      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 truncate">
                          {hasDocs ? 'Google Drive central' : 'Pendente de vínculo'}
                        </span>
                        <div>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => handleOpenVincularModal(cat.id)}
                              className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-800 hover:border-[#FF6600] text-slate-200 hover:text-white text-xs font-semibold cursor-pointer transition-all inline-flex items-center gap-1.5 shadow-2xs"
                            >
                              <span className="text-[#FF6600] font-bold">+</span>
                              <span>{hasDocs ? 'Adicionar outro' : 'Vincular documento'}</span>
                            </button>
                          ) : (
                            <span
                              className="text-[11px] text-slate-500 italic"
                              title="Requer permissão de gerenciamento (can_manage_auditoria)"
                            >
                              Somente leitura
                            </span>
                          )}
                        </div>
                      </div>`;

const newCardFooter = `                      {/* Rodapé do Card com Ação de Sincronização ou Adição de Arquivo Avulso */}
                      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 truncate">
                          {folder ? \`Pasta: \${folder.drive_folder_name}\` : hasDocs ? 'Google Drive central' : 'Pendente de pasta'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {canManage ? (
                            <>
                              {!folder ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenLinkFolderModal(cat.id)}
                                  className="px-2.5 py-1.5 rounded-xl border border-[#FF6600]/40 bg-[#FF6600]/10 hover:bg-[#FF6600]/20 text-[#FF6600] hover:text-white text-xs font-semibold cursor-pointer transition-all inline-flex items-center gap-1 shadow-2xs"
                                >
                                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                  </svg>
                                  <span>Vincular pasta</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenVincularModal(cat.id)}
                                  className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium cursor-pointer transition-all inline-flex items-center gap-1"
                                  title="Vincular documento PDF avulso diretamente"
                                >
                                  <span>+ PDF avulso</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <span
                              className="text-[11px] text-slate-500 italic"
                              title="Requer permissão de gerenciamento (can_manage_auditoria)"
                            >
                              Somente leitura
                            </span>
                          )}
                        </div>
                      </div>`;

if (content.includes(cardFooterTarget)) {
  content = content.replace(cardFooterTarget, newCardFooter);
  console.log('Card footer updated!');
} else {
  console.warn('Could not find cardFooterTarget');
}

// 4. Append Folder Modals right after {isConfirmUnlinkOpen && ...}
const unlinkModalEnd = `              {/* Rodapé do Modal */}
              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkOpen(false);
                    setDocToUnlink(null);
                  }}
                  disabled={isUnlinking}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlink}
                  disabled={isUnlinking}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isUnlinking ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Desvinculando...</span>
                    </>
                  ) : (
                    <span>Sim, desvincular</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}`;

const newModals = `              {/* Rodapé do Modal */}
              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkOpen(false);
                    setDocToUnlink(null);
                  }}
                  disabled={isUnlinking}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlink}
                  disabled={isUnlinking}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isUnlinking ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Desvinculando...</span>
                    </>
                  ) : (
                    <span>Sim, desvincular</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

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
                    Fase: <span className="text-[#FF6600] font-semibold">{CANONICAL_CATEGORIES.find((c) => c.id === activeFolderCategory)?.name}</span> · Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
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
                    <p className="text-slate-300">{availableFoldersError}</p>
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
                        <div className="py-8 text-center text-xs text-slate-400">
                          Nenhuma pasta encontrada no Google Drive central para este condomínio.
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
        )}`;

if (!content.includes('isFolderModalOpen && selectedCondo')) {
  content = content.replace(unlinkModalEnd, newModals);
  console.log('Modals added!');
}

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
