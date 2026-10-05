import React, { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useCRM, type Lead, type Interaction } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import { NotesIcon, EditIcon, TrashIcon } from './PipelineComponents.tsx';
import { formatDateBR, parseCalendarDate } from '../lib/dateUtils.ts';
import { renderFormattedTextWithLinks } from '../lib/linkUtils.tsx';

export interface NotesTimelineModalProps {
  isOpen: boolean;
  lead: Lead | null;
  currentProfile: UserProfile;
  onClose: () => void;
  onOpenNewNote: (lead: Lead) => void;
  onEditNote?: (lead: Lead, interactionId: string) => void;
}

export { formatDateBR };

export function formatTimeBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = parseCalendarDate(dateStr);
    if (!d) return '';
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Group interactions by friendly date label (Hoje, Ontem, etc.)
function getDateGroupLabel(dateStr?: string | null): string {
  if (!dateStr) return 'Sem data';
  try {
    const d = parseCalendarDate(dateStr);
    if (!d) return dateStr;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    if (target === today) return 'HOJE';
    if (target === yesterday) return 'ONTEM';

    return d.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    }).toUpperCase();
  } catch {
    return dateStr || 'Sem data';
  }
}

export default function NotesTimelineModal({
  isOpen,
  lead,
  onClose,
  onOpenNewNote,
  onEditNote,
}: NotesTimelineModalProps) {
  const { interactions, profileMap, deleteInteractionLocally } = useCRM();
  const [isMaximized, setIsMaximized] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen || !lead) return null;

  // Ordenação: Da mais recente (topo) para as mais antigas (base)
  const leadInteractions = interactions
    .filter((i) => i.lead_id === lead.id)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  // Agrupamento por data mantendo a ordem mais recente no topo
  const groupedInteractions: { label: string; items: Interaction[] }[] = [];
  leadInteractions.forEach((item) => {
    const label = getDateGroupLabel(item.occurred_at);
    const existing = groupedInteractions.find((g) => g.label === label);
    if (existing) {
      existing.items.push(item);
    } else {
      groupedInteractions.push({ label, items: [item] });
    }
  });

  const handleDeleteInteraction = async (interactionId: string) => {
    setDeletingId(interactionId);
    try {
      await supabase.from('interactions').delete().eq('id', interactionId);
    } catch (err) {
      console.warn('Notice deleting interaction from Supabase:', err);
    } finally {
      deleteInteractionLocally(interactionId);
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full bg-slate-900 border border-slate-800 shadow-2xl flex flex-col transition-all duration-200 ${
          isMaximized
            ? 'h-[96vh] max-w-[96vw] rounded-2xl'
            : 'max-w-xl max-h-[85vh] h-[640px] rounded-3xl my-auto'
        } overflow-hidden`}
      >
        {/* Header: Nome do condomínio, tags e no topo direito: botão circular "+" idêntico aos cards + maximizar + X */}
        <div className="px-5 py-4 border-b border-slate-800/90 bg-slate-950/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold shrink-0">
              <NotesIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white truncate max-w-[220px] sm:max-w-sm">
                  {lead.name}
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold shrink-0">
                  {leadInteractions.length} {leadInteractions.length === 1 ? 'nota' : 'notas'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                <span>{lead.condominium_type || 'Residencial'}</span>
                {lead.city && <span>· {lead.city}</span>}
                {lead.administrator && <span>· {lead.administrator}</span>}
              </div>
            </div>
          </div>

          {/* Topo direito: Botão circular "+" idêntico aos cards, Maximizar e Fechar X */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Círculo "+" idêntico aos cards para registrar nova nota */}
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNewNote(lead);
              }}
              title="Adicionar nota ou registrar follow-up"
              aria-label="Adicionar nota / follow-up"
              className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-90 text-white flex items-center justify-center shadow-md shadow-indigo-950/80 hover:shadow-indigo-500/40 ring-2 ring-indigo-500/25 transition-all cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>

            {/* Maximizar / Restaurar */}
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title={isMaximized ? 'Restaurar tamanho' : 'Maximizar tela'}
            >
              {isMaximized ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0l5 0m-5 0l0 5M15 9l5-5m0 0l-5 0m5 0l0 5M9 15l-5 5m0 0l5 0m-5 0l0-5M15 15l5 5m0 0l-5 0m5 0l0-5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>

            {/* Fechar X */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Fechar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Timeline Body - Da mais recente para a mais antiga */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-950/60 custom-scrollbar">
          {leadInteractions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3">
                <NotesIcon className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-white text-sm mb-1">Nenhuma nota registrada</h4>
              <p className="text-xs text-slate-400 max-w-xs mb-4">
                Clique no botão "+" no topo direito para registrar a primeira conversa.
              </p>
            </div>
          ) : (
            groupedInteractions.map((group) => (
              <div key={group.label} className="space-y-3">
                {/* Divisor de data no centro */}
                <div className="flex items-center justify-center my-2">
                  <span className="px-3 py-0.5 rounded-full bg-slate-800/90 border border-slate-700/60 text-[10px] font-bold text-slate-300 shadow-xs tracking-wider">
                    {group.label}
                  </span>
                </div>

                {/* Cards de interação (mais recente primeiro) com botões de Editar e Excluir */}
                {group.items.map((item) => {
                  const respName = item.responsible_user_id
                    ? profileMap.get(item.responsible_user_id) || 'Atendente'
                    : 'Atendente';

                  // Estilos por canal
                  const typeStyles: Record<string, { badge: string; border: string }> = {
                    'WhatsApp': { badge: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/50', border: 'border-emerald-500/30' },
                    'Ligação': { badge: 'bg-indigo-950/90 text-indigo-300 border-indigo-700/50', border: 'border-indigo-500/30' },
                    'E-mail': { badge: 'bg-sky-950/90 text-sky-300 border-sky-700/50', border: 'border-sky-500/30' },
                    'Reunião': { badge: 'bg-violet-950/90 text-violet-300 border-violet-700/50', border: 'border-violet-500/30' },
                    'Evento': { badge: 'bg-amber-950/90 text-amber-300 border-amber-700/50', border: 'border-amber-500/30' },
                    'Redes Sociais': { badge: 'bg-pink-950/90 text-pink-300 border-pink-700/50', border: 'border-pink-500/30' },
                    'Visita': { badge: 'bg-teal-950/90 text-teal-300 border-teal-700/50', border: 'border-teal-500/30' },
                    'Outro': { badge: 'bg-slate-800 text-slate-300 border-slate-700', border: 'border-slate-700' },
                  };

                  const style = typeStyles[item.interaction_type || 'Outro'] || typeStyles['Outro'];
                  const isConfirmingDelete = confirmDeleteId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`w-full bg-slate-900 border ${style.border} rounded-2xl p-3.5 shadow-md space-y-2 relative group hover:border-slate-600 transition-all ${
                        deletingId === item.id ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      {isConfirmingDelete ? (
                        /* Inline Custom Confirmation Bar (Solves iframe window.confirm blocking) */
                        <div className="p-2.5 bg-rose-950/90 border border-rose-600/70 rounded-xl flex items-center justify-between gap-2 animate-in fade-in duration-150">
                          <div className="flex items-center gap-2 text-rose-200 text-xs font-semibold">
                            <TrashIcon className="w-4 h-4 shrink-0 text-rose-400" />
                            <span>Confirmar exclusão desta nota?</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteInteraction(item.id)}
                              disabled={deletingId === item.id}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold cursor-pointer shadow-xs disabled:opacity-50"
                            >
                              {deletingId === item.id ? 'Excluindo...' : 'Sim, Excluir'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Cabeçalho da nota: Canal + Atendente + Horário + Botões Editar e Excluir */}
                          <div className="flex items-center justify-between text-xs pb-1.5 border-b border-slate-800/60">
                            <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold ${style.badge}`}>
                                {item.interaction_type || 'Contato'}
                              </span>
                              <span className="text-[11px] text-slate-400 font-medium">
                                {respName}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-500 font-mono mr-1">
                                {formatTimeBR(item.occurred_at)}
                              </span>

                              {/* Botões de Ação: Editar e Excluir Nota */}
                              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    if (onEditNote) {
                                      onEditNote(lead, item.id);
                                    } else {
                                      onOpenNewNote(lead);
                                    }
                                  }}
                                  title="Editar nota"
                                  aria-label="Editar nota"
                                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <EditIcon className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(item.id)}
                                  title="Excluir nota"
                                  aria-label="Excluir nota"
                                  className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Conteúdo da anotação */}
                          {item.notes ? (
                            <p className="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed">
                              {renderFormattedTextWithLinks(item.notes)}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500 italic">
                              Sem anotações de texto.
                            </p>
                          )}

                          {/* Rodapé interno se houver próximo follow-up agendado */}
                          {item.next_follow_up_date && (
                            <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 rounded-xl font-medium">
                                <span>📅 Próximo follow-up:</span>
                                <strong className="font-bold">{formatDateBR(item.next_follow_up_date)}</strong>
                              </div>
                              <span className="text-[10px] text-slate-500">Agendado</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
