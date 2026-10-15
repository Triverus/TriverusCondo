import React, { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { deleteInteractionCalendar } from '../lib/googleCalendarClient.ts';
import { useCRM, type Lead, type Interaction } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import { NotesIcon, EditIcon, TrashIcon } from './PipelineComponents.tsx';
import { formatDateBR, parseCalendarDate } from '../lib/dateUtils.ts';
import { renderFormattedTextWithLinks } from '../lib/linkUtils.tsx';
import { useUserPermissions } from '../lib/permissionsContext.tsx';

export interface NotesTimelineModalProps {
  isOpen: boolean;
  lead: Lead | null;
  currentProfile: UserProfile;
  onClose: () => void;
  onOpenNewNote: (lead: Lead) => void;
  onEditNote?: (lead: Lead, interactionId: string) => void;
}

export { formatDateBR };

export function formatDateTimeBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  } catch {
    return '';
  }
}

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
  const {
    interactions,
    profileMap,
    deleteInteractionLocally,
    stageMap,
    serviceMap,
    getLeadServices,
    getPrimaryContactForLead,
  } = useCRM();

  const { canManageNotes, canDeleteNotes } = useUserPermissions();

  const [activeTab, setActiveTab] = useState<'followups' | 'info'>('followups');
  const [isMaximized, setIsMaximized] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Limpa erros e reseta para a aba padrão 'followups' ao abrir o modal ou alternar lead
  React.useEffect(() => {
    if (isOpen) {
      setDeleteError(null);
      setConfirmDeleteId(null);
      setDeletingId(null);
      setActiveTab('followups');
    }
  }, [isOpen, lead?.id]);

  if (!isOpen || !lead) return null;

  // Informações complementares reais do lead
  const primaryContact = getPrimaryContactForLead(lead.id);
  const leadServiceIds = getLeadServices(lead.id);
  const leadServices = leadServiceIds
    .map((id) => serviceMap.get(id))
    .filter(Boolean) as string[];
  const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) : null;
  const responsibleName = lead.responsible_user_id ? profileMap.get(lead.responsible_user_id) : null;

  // Seções organizadas com apenas campos reais e preenchidos
  const generalData: { label: string; value: string }[] = [];
  if (lead.name) generalData.push({ label: 'Nome do Condomínio', value: lead.name });
  if (lead.condominium_type) generalData.push({ label: 'Tipo', value: lead.condominium_type });
  if (lead.unit_count && lead.unit_count > 0) generalData.push({ label: 'Unidades', value: `${lead.unit_count} unidades` });
  if (lead.address) generalData.push({ label: 'Endereço', value: lead.address });
  if (lead.city) generalData.push({ label: 'Cidade', value: lead.city });
  if (lead.cnpj) generalData.push({ label: 'CNPJ', value: lead.cnpj });

  const commercialData: { label: string; value: string }[] = [];
  if (stageName) commercialData.push({ label: 'Estágio Atual', value: stageName });
  if (responsibleName) commercialData.push({ label: 'Responsável', value: responsibleName });
  if (lead.administrator) commercialData.push({ label: 'Administradora', value: lead.administrator });

  const contactData: { label: string; value: string }[] = [];
  if (primaryContact?.name) contactData.push({ label: 'Contato Principal', value: primaryContact.name });
  if (primaryContact?.role_title) contactData.push({ label: 'Cargo', value: primaryContact.role_title });
  if (primaryContact?.phone) contactData.push({ label: 'Telefone', value: primaryContact.phone });
  if (primaryContact?.email) contactData.push({ label: 'E-mail', value: primaryContact.email });

  const hasAnyInfo =
    generalData.length > 0 ||
    commercialData.length > 0 ||
    contactData.length > 0 ||
    leadServices.length > 0;

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
    setDeleteError(null);
    const interaction = interactions.find((i) => i.id === interactionId);

    try {
      // Se houver evento vinculado ao Google Calendar, excluir no Calendar primeiro
      if (interaction?.google_event_id) {
        const result = await deleteInteractionCalendar(interactionId);
        if (!result.ok || result.data?.success === false) {
          const isIgnorable =
            result.data?.reason === 'no_google_event' ||
            result.data?.already_missing === true;
          if (!isIgnorable) {
            let errMsg = result.data?.message || result.error;
            if (result.data?.reason === 'google_calendar_not_connected') {
              errMsg = 'Conta do Google Calendar não conectada. Conecte sua agenda para remover o evento vinculado.';
            } else if (result.data?.reason === 'google_calendar_reauthorization_required') {
              errMsg = 'Reautorização do Google Calendar necessária para excluir este evento.';
            } else if (result.error?.includes('401') && !result.data?.reason) {
              errMsg = 'Sessão expirada. Por favor, recarregue a página.';
            } else if (!errMsg) {
              errMsg = 'Falha ao remover evento do Google Calendar.';
            }
            throw new Error(errMsg);
          }
        }
      }

      // Excluir no Supabase
      const { error } = await supabase.from('interactions').delete().eq('id', interactionId);
      if (error) throw error;

      // Remover do cache local
      deleteInteractionLocally(interactionId);
      setDeleteError(null);
    } catch (err: any) {
      console.error('Erro ao excluir interação:', err);
      setDeleteError(err?.message || 'Não foi possível excluir a anotação. Tente novamente.');
    } finally {
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
        {/* Header: Nome do condomínio, subtítulo, botões Maximizar e Fechar X */}
        <div className="px-5 py-3.5 border-b border-slate-800/90 bg-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-orange-500/15 text-[#FF6600] border border-orange-500/30 flex items-center justify-center font-bold shrink-0">
              <NotesIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate max-w-[240px] sm:max-w-sm">
                {lead.name}
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                <span>{lead.condominium_type || 'Residencial'}</span>
                {lead.city && <span>· {lead.city}</span>}
                {lead.administrator && <span>· {lead.administrator}</span>}
              </div>
            </div>
          </div>

          {/* Controles de janela: Maximizar e Fechar */}
          <div className="flex items-center gap-1.5 shrink-0">
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

        {/* Chave Seletora Segmentada: [ Follow-ups ]  [ Informações ] */}
        <div className="px-5 py-2.5 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between gap-3 shrink-0">
          <div className="inline-flex p-1 bg-slate-900 border border-slate-800 rounded-xl" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'followups'}
              onClick={() => setActiveTab('followups')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'followups'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Follow-ups</span>
              <span
                className={`px-1.5 py-0.2 rounded-md text-[10px] font-bold ${
                  activeTab === 'followups'
                    ? 'bg-[#FF6600]/25 text-[#FF6600]'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {leadInteractions.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'info'}
              onClick={() => setActiveTab('info')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'info'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Informações</span>
            </button>
          </div>

          {activeTab === 'followups' && leadInteractions.length > 0 && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              {leadInteractions.length} {leadInteractions.length === 1 ? 'interação registrada' : 'interações registradas'}
            </span>
          )}
          {activeTab === 'info' && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Ficha do condomínio
            </span>
          )}
        </div>

        {/* CORPO: ABA 1 (Follow-ups) OU ABA 2 (Informações) */}
        {activeTab === 'followups' ? (
          /* ABA FOLLOW-UPS: Timeline de interações (mais recente para a mais antiga) */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-950/60 custom-scrollbar">
            {deleteError && (
              <div className="p-3 bg-rose-950/90 border border-rose-600/70 rounded-xl flex items-center justify-between gap-3 text-rose-200 text-xs animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{deleteError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteError(null)}
                  className="p-1 hover:bg-rose-900/60 rounded text-rose-400 hover:text-white cursor-pointer"
                  title="Fechar alerta"
                >
                  ✕
                </button>
              </div>
            )}

            {leadInteractions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-[#FF6600] flex items-center justify-center mb-3">
                  <NotesIcon className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-white text-sm mb-1">Nenhum follow-up registrado</h4>
                <p className="text-xs text-slate-400 max-w-xs mb-4">
                  Clique no botão "+" no rodapé para registrar a primeira interação com este condomínio.
                </p>
                {canManageNotes && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenNewNote(lead);
                    }}
                    className="px-3.5 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
                  >
                    <span>+ Registrar Follow-up</span>
                  </button>
                )}
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

                  {/* Cards de interação com botões de Editar e Excluir */}
                  {group.items.map((item) => {
                    const respName = item.responsible_user_id
                      ? profileMap.get(item.responsible_user_id) || 'Atendente'
                      : 'Atendente';

                    // Autoria humana inviolável conforme arquitetura aprovada
                    const authorName = item.created_by_user_id
                      ? profileMap.get(item.created_by_user_id) || null
                      : null;
                    const editorName = item.last_edited_by_user_id
                      ? profileMap.get(item.last_edited_by_user_id) || null
                      : null;

                    const creationDateFormatted = formatDateTimeBR(item.created_at || item.occurred_at);
                    const lastEditedDateFormatted = item.last_edited_at ? formatDateTimeBR(item.last_edited_at) : null;

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
                                {item.responsible_user_id && (
                                  <span className="text-[11px] text-slate-400 font-medium" title="Responsável Comercial">
                                    Resp: {respName}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-500 font-mono mr-1">
                                  {formatTimeBR(item.occurred_at)}
                                </span>

                                {(canManageNotes || canDeleteNotes) && (
                                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                    {canManageNotes && (
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
                                    )}

                                    {canDeleteNotes && (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(item.id)}
                                        title="Excluir nota"
                                        aria-label="Excluir nota"
                                        className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                      >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
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

                            {/* Próximo follow-up agendado */}
                            {item.next_follow_up_date && (
                              <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 rounded-xl font-medium">
                                  <span>📅 Próximo follow-up:</span>
                                  <strong className="font-bold">{formatDateBR(item.next_follow_up_date)}</strong>
                                </div>
                                <span className="text-[10px] text-slate-500">Agendado</span>
                              </div>
                            )}

                            {/* Autoria Visual e Última Edição Humana (Auditada) */}
                            <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-400">
                              <div className="flex items-center gap-1.5 text-slate-300">
                                <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span>
                                  {authorName
                                    ? `Criada por ${authorName} em ${creationDateFormatted}`
                                    : `Criada em ${creationDateFormatted}`}
                                </span>
                              </div>

                              {lastEditedDateFormatted && (
                                <div className="flex items-center gap-1 text-[10px] text-slate-400 italic">
                                  <span>•</span>
                                  <span>
                                    {editorName
                                      ? `Última edição: ${editorName} em ${lastEditedDateFormatted}`
                                      : `Última edição em ${lastEditedDateFormatted}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : (
          /* ABA INFORMAÇÕES: Ficha interna organizada por seções lógicas */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-950/60 custom-scrollbar animate-in fade-in duration-150">
            {!hasAnyInfo ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="font-bold text-white text-sm mb-1">Nenhuma informação adicional preenchida</h4>
                <p className="text-xs text-slate-400 max-w-xs">
                  Os dados cadastrais deste condomínio ainda não foram informados.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* 1. SEÇÃO: DADOS GERAIS */}
                {generalData.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2 pb-2 border-b border-slate-800/80">
                      <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span>Dados Gerais</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {generalData.map((item) => (
                        <div key={item.label} className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
                          <span className="block text-[11px] font-medium text-slate-400">
                            {item.label}
                          </span>
                          <span className="block text-xs font-semibold text-white mt-0.5 break-words">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. SEÇÃO: COMERCIAL */}
                {commercialData.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2 pb-2 border-b border-slate-800/80">
                      <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span>Comercial</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {commercialData.map((item) => (
                        <div key={item.label} className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
                          <span className="block text-[11px] font-medium text-slate-400">
                            {item.label}
                          </span>
                          <span className="block text-xs font-semibold text-white mt-0.5 break-words">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. SEÇÃO: CONTATO */}
                {contactData.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2 pb-2 border-b border-slate-800/80">
                      <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>Contato</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {contactData.map((item) => (
                        <div key={item.label} className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
                          <span className="block text-[11px] font-medium text-slate-400">
                            {item.label}
                          </span>
                          <span className="block text-xs font-semibold text-white mt-0.5 break-words">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. SEÇÃO: SERVIÇOS */}
                {leadServices.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2 pb-2 border-b border-slate-800/80">
                      <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      </svg>
                      <span>Serviços Vinculados</span>
                    </h4>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {leadServices.map((srv) => (
                        <span
                          key={srv}
                          className="px-3 py-1 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs font-semibold"
                        >
                          {srv}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rodapé Fixo: Navegação contextual na esquerda e o botão oficial "+" laranja (#FF6600) na direita */}
        <div className="px-5 py-3 border-t border-slate-800/90 bg-slate-950 flex items-center justify-between shrink-0">
          <div>
            {activeTab === 'followups' ? (
              <button
                type="button"
                onClick={() => setActiveTab('info')}
                className="px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Ficha do condomínio</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('followups')}
                className="px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <NotesIcon className="w-3.5 h-3.5 text-[#FF6600]" />
                <span>Voltar aos follow-ups</span>
              </button>
            )}
          </div>

          {/* Botão "+" oficial laranja #FF6600 (habilitado apenas se possuir permissão can_manage_notes) */}
          {canManageNotes && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNewNote(lead);
              }}
              title="Registrar novo follow-up / nota"
              aria-label="Registrar novo follow-up"
              className="w-9 h-9 rounded-full bg-[#FF6600] hover:bg-[#e65c00] active:scale-95 text-white flex items-center justify-center shadow-lg ring-2 ring-[#FF6600]/30 transition-all cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
