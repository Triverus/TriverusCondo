import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

const targetHeader = content.slice(
  content.indexOf('{CANONICAL_CATEGORIES.map((cat) => {'),
  content.indexOf('{/* Lista de Documentos Vinculados Nesta Categoria */}')
);

const newHeader = `{CANONICAL_CATEGORIES.map((cat) => {
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
                              <span className="truncate">Sem pasta vinculada</span>
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
                        )}
                        `;

content = content.replace(targetHeader, newHeader);
console.log('Card header and folder banner successfully applied!');

// 2. Replace the footer of the card
const footerStart = content.indexOf('{/* Rodapé do Card com Ação de Adicionar ou Vincular Mais Documentos */}');
const btnEnd = content.indexOf('</div>', content.indexOf('</button>', footerStart));
const divEnd = content.indexOf('</div>', btnEnd + 6) + 6;
const targetFooter = content.slice(footerStart, divEnd);

const newFooter = `{/* Rodapé do Card com Ação de Sincronização ou Adição de Arquivo Avulso */}
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

content = content.replace(targetFooter, newFooter);
console.log('Card footer successfully applied!');

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
