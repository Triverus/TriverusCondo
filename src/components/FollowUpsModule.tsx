import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';
import { useCRM, type Lead, type Interaction } from '../lib/crmStore.tsx';
import { saveDraft, loadDraft, clearDraft } from '../lib/draftStorage.ts';

export interface FollowUpItem {
  lead: Lead;
  latestInteraction: Interaction;
  followUpDate: string;
  status: 'overdue' | 'today' | 'upcoming';
  responsibleName: string;
  stageName: string;
}

interface FollowUpsModuleProps {
  currentProfile: UserProfile;
  onOpenLead: (leadId: string) => void;
}

export const INTERACTION_TYPES = [
  'Ligação',
  'Reunião',
  'WhatsApp',
  'E-mail',
  'Evento BNI',
] as const;

export function getFollowUpStatus(dateStr: string): 'overdue' | 'today' | 'upcoming' {
  if (!dateStr) return 'upcoming';
  const target = new Date(dateStr);
  const now = new Date();
  const targetDateOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (targetDateOnly < todayDateOnly) {
    return 'overdue';
  } else if (targetDateOnly === todayDateOnly) {
    return 'today';
  } else {
    return 'upcoming';
  }
}

export function formatDateTimeBR(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

const getInteractionCreateDraftKey = (leadId: string) => `triverus_draft_interaction_create_${leadId}`;

interface InteractionDraftData {
  interactionQuizStep: number;
  formInteractionType: string;
  formInteractionOccurredAt: string;
  formInteractionResponsibleId: string;
  formInteractionNotes: string;
  formInteractionNextFollowUpDate: string;
}

export default function FollowUpsModule({ currentProfile, onOpenLead }: FollowUpsModuleProps) {
  // Use Centralized In-Memory & Cached CRM store
  const {
    leads,
    interactions,
    profiles,
    stageMap,
    profileMap,
    isInitialLoading,
    isRefreshing,
    upsertInteractionLocally,
    refreshAll,
  } = useCRM();

  // View Mode (Default is Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Quick Interaction Modal with Dynamic Quiz Flow
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLead, setModalLead] = useState<Lead | null>(null);
  const [quizStep, setQuizStep] = useState<number>(1);
  const [isRestoredDraft, setIsRestoredDraft] = useState<boolean>(false);
  const totalQuizSteps = 4;

  const [formType, setFormType] = useState<string>('Ligação');
  const [formOccurredAt, setFormOccurredAt] = useState<string>('');
  const [formResponsibleId, setFormResponsibleId] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formNextFollowUpDate, setFormNextFollowUpDate] = useState<string>('');
  const [savingInteraction, setSavingInteraction] = useState(false);

  // Save interaction draft
  useEffect(() => {
    if (modalOpen && modalLead) {
      const data: InteractionDraftData = {
        interactionQuizStep: quizStep,
        formInteractionType: formType,
        formInteractionOccurredAt: formOccurredAt,
        formInteractionResponsibleId: formResponsibleId,
        formInteractionNotes: formNotes,
        formInteractionNextFollowUpDate: formNextFollowUpDate,
      };
      if (formNotes.trim() || formNextFollowUpDate) {
        saveDraft(getInteractionCreateDraftKey(modalLead.id), data);
      }
    }
  }, [
    modalOpen,
    modalLead,
    quizStep,
    formType,
    formOccurredAt,
    formResponsibleId,
    formNotes,
    formNextFollowUpDate,
  ]);

  // Compute follow-up list in memory: for each lead, pick the latest interaction with a follow-up
  const followUpItems = useMemo<FollowUpItem[]>(() => {
    const items: FollowUpItem[] = [];

    // Group interactions by lead_id
    const interactionsByLead = new Map<string, Interaction[]>();
    interactions.forEach((i) => {
      const existing = interactionsByLead.get(i.lead_id) || [];
      existing.push(i);
      interactionsByLead.set(i.lead_id, existing);
    });

    leads.forEach((lead) => {
      const leadInteractions = interactionsByLead.get(lead.id) || [];
      if (leadInteractions.length === 0) return;

      // Sort by occurred_at desc
      const sorted = [...leadInteractions].sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );

      const latest = sorted[0];
      if (latest && latest.next_follow_up_date) {
        const status = getFollowUpStatus(latest.next_follow_up_date);
        const responsibleId = latest.responsible_user_id || lead.responsible_user_id;
        const responsibleName = responsibleId ? profileMap.get(responsibleId) || 'Não atribuído' : 'Não atribuído';
        const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) || 'Estágio Inicial' : 'Estágio Inicial';

        items.push({
          lead,
          latestInteraction: latest,
          followUpDate: latest.next_follow_up_date,
          status,
          responsibleName,
          stageName,
        });
      }
    });

    // Sort order: overdue first (oldest followUpDate first), today (earliest), upcoming (closest date first)
    return items.sort((a, b) => {
      const priority = { overdue: 1, today: 2, upcoming: 3 };
      if (priority[a.status] !== priority[b.status]) {
        return priority[a.status] - priority[b.status];
      }
      return new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime();
    });
  }, [leads, interactions, profileMap, stageMap]);

  // In-memory filtered follow-ups
  const filteredItems = useMemo(() => {
    return followUpItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (responsibleFilter !== 'all') {
        const respId = item.latestInteraction.responsible_user_id || item.lead.responsible_user_id;
        if (respId !== responsibleFilter) return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchLead = item.lead.name.toLowerCase().includes(term);
        const matchCity = item.lead.city ? item.lead.city.toLowerCase().includes(term) : false;
        if (!matchLead && !matchCity) return false;
      }
      return true;
    });
  }, [followUpItems, statusFilter, responsibleFilter, searchTerm]);

  // Counts by bucket
  const counts = useMemo(() => {
    return {
      all: followUpItems.length,
      overdue: followUpItems.filter((i) => i.status === 'overdue').length,
      today: followUpItems.filter((i) => i.status === 'today').length,
      upcoming: followUpItems.filter((i) => i.status === 'upcoming').length,
    };
  }, [followUpItems]);

  // Open Quick Interaction Modal
  const handleOpenInteractionModal = (lead: Lead) => {
    setModalLead(lead);
    setIsRestoredDraft(false);

    const draft = loadDraft<InteractionDraftData>(getInteractionCreateDraftKey(lead.id));
    if (draft && (draft.formInteractionNotes || draft.formInteractionNextFollowUpDate)) {
      setFormType(draft.formInteractionType || 'Ligação');
      setFormOccurredAt(draft.formInteractionOccurredAt || '');
      setFormResponsibleId(draft.formInteractionResponsibleId || currentProfile.id);
      setFormNotes(draft.formInteractionNotes || '');
      setFormNextFollowUpDate(draft.formInteractionNextFollowUpDate || '');
      setQuizStep(draft.interactionQuizStep || 1);
      setIsRestoredDraft(true);
    } else {
      setFormType('Ligação');
      const now = new Date();
      const tzOffset = now.getTimezoneOffset() * 60000;
      const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
      setFormOccurredAt(localISOTime);
      setFormResponsibleId(currentProfile.id);
      setFormNotes('');
      setFormNextFollowUpDate('');
      setQuizStep(1);
    }

    setModalOpen(true);
  };

  const handleCloseInteractionModal = () => {
    setModalOpen(false);
    setModalLead(null);
    setQuizStep(1);
    setIsRestoredDraft(false);
  };

  const handleDiscardInteractionDraft = () => {
    if (modalLead) {
      clearDraft(getInteractionCreateDraftKey(modalLead.id));
    }
    handleCloseInteractionModal();
  };

  // Submit quick interaction
  const handleSubmitInteraction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!modalLead) return;

    setSavingInteraction(true);
    try {
      const occurredAtIso = formOccurredAt ? new Date(formOccurredAt).toISOString() : new Date().toISOString();

      const payload = {
        lead_id: modalLead.id,
        interaction_type: formType,
        occurred_at: occurredAtIso,
        responsible_user_id: formResponsibleId || currentProfile.id,
        notes: formNotes.trim() || null,
        next_follow_up_date: formNextFollowUpDate ? formNextFollowUpDate : null,
      };

      const { data, error } = await supabase
        .from('interactions')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        upsertInteractionLocally(data);
        clearDraft(getInteractionCreateDraftKey(modalLead.id));
      }

      setStatusFeedback({
        type: 'success',
        message: 'Interação registrada e follow-up atualizado com sucesso!',
      });

      refreshAll(true);
      handleCloseInteractionModal();
    } catch (err: any) {
      console.error('Error recording interaction in follow-ups:', err);
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Erro ao registrar interação.',
      });
    } finally {
      setSavingInteraction(false);
    }
  };

  const getTemperatureBadge = (temp?: string | null) => {
    switch (temp) {
      case 'Quente':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            Quente
          </span>
        );
      case 'Frio':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400">
            <span className="w-2 h-2 rounded-full bg-sky-500" />
            Frio
          </span>
        );
      case 'Morno':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Morno
          </span>
        );
    }
  };

  const getStatusBadge = (status: 'overdue' | 'today' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return (
          <span className="px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300 text-xs font-semibold flex items-center gap-1.5 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Vencido
          </span>
        );
      case 'today':
        return (
          <span className="px-2.5 py-1 rounded-full bg-indigo-950/80 border border-indigo-500/60 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Hoje
          </span>
        );
      case 'upcoming':
      default:
        return (
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700/60 text-slate-300 text-xs font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Próximo
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
            <span>CRM</span>
            <span aria-hidden="true">·</span>
            <span>Atividades & Prazos</span>
            {isRefreshing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                sincronizando...
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Follow-ups & Prazos
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Acompanhamento dos próximos passos e contatos agendados com condomínios.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span className="hidden sm:inline">Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>
        </div>
      </div>

      {/* Feedback message */}
      {statusFeedback && (
        <div
          className={`mt-4 p-4 rounded-xl text-xs sm:text-sm flex items-center justify-between transition-all ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-600/60 text-emerald-200'
              : 'bg-rose-950/80 border border-rose-600/60 text-rose-200'
          }`}
        >
          <span>{statusFeedback.message}</span>
          <button
            type="button"
            onClick={() => setStatusFeedback(null)}
            className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer ml-3"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Filter Tabs / Buckets */}
      <div className="mt-6 flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
            statusFilter === 'all'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white'
          }`}
        >
          <span>Todos</span>
          <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px]">{counts.all}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('overdue')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
            statusFilter === 'overdue'
              ? 'bg-amber-600 text-white shadow-md'
              : 'bg-slate-900 border border-slate-800 text-amber-300/80 hover:text-amber-300'
          }`}
        >
          <span>Vencidos</span>
          <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px] font-bold">{counts.overdue}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('today')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
            statusFilter === 'today'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-slate-900 border border-slate-800 text-indigo-300/80 hover:text-indigo-300'
          }`}
        >
          <span>Hoje</span>
          <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px] font-bold">{counts.today}</span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('upcoming')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
            statusFilter === 'upcoming'
              ? 'bg-slate-700 text-white shadow-md'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <span>Próximos</span>
          <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px]">{counts.upcoming}</span>
        </button>
      </div>

      {/* Search & Responsible Filters */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por condomínio ou cidade..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-3 text-slate-500 hover:text-white text-xs cursor-pointer"
            >
              Limpar
            </button>
          )}
        </div>

        <div>
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="all">Todos os responsáveis</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || 'Sem nome'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content */}
      {isInitialLoading && followUpItems.length === 0 ? (
        <div className="mt-12 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-slate-400">Carregando follow-ups...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mt-8 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm || statusFilter !== 'all' || responsibleFilter !== 'all'
              ? 'Nenhum follow-up encontrado para estes filtros'
              : 'Nenhum follow-up agendado no momento'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Os follow-ups são gerados automaticamente quando você define uma data de próximo contato ao registrar uma interação em um condomínio.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredItems.map((item) => (
            <div
              key={item.lead.id}
              className={`bg-slate-900/80 border rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all group ${
                item.status === 'overdue'
                  ? 'border-amber-900/40 hover:border-amber-700/60 shadow-amber-950/10'
                  : item.status === 'today'
                  ? 'border-indigo-900/40 hover:border-indigo-700/60 shadow-indigo-950/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3
                      onClick={() => onOpenLead(item.lead.id)}
                      className="font-bold text-base text-white hover:text-indigo-400 transition-colors cursor-pointer leading-snug line-clamp-1"
                    >
                      {item.lead.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      {item.lead.city && <span>{item.lead.city}</span>}
                      {item.lead.city && <span>·</span>}
                      <span className="text-indigo-300 font-medium">{item.stageName}</span>
                    </div>
                  </div>
                  {getStatusBadge(item.status)}
                </div>

                {/* Date highlight box */}
                <div className="my-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold block mb-0.5">
                      Data Agendada
                    </span>
                    <span className="font-bold text-white text-sm">
                      {formatDateBR(item.followUpDate)}
                    </span>
                  </div>
                  <div>{getTemperatureBadge(item.lead.temperature)}</div>
                </div>

                {/* Latest Interaction preview */}
                <div className="text-xs text-slate-300 space-y-1.5 p-3 rounded-xl bg-slate-950/40 border border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Última interação ({item.latestInteraction.interaction_type}):</span>
                    <span>{formatDateBR(item.latestInteraction.occurred_at)}</span>
                  </div>
                  {item.latestInteraction.notes && (
                    <p className="text-xs text-slate-400 line-clamp-2 italic">
                      "{item.latestInteraction.notes}"
                    </p>
                  )}
                </div>
              </div>

              {/* Card Footer */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-300 uppercase">
                    {item.responsibleName.charAt(0)}
                  </div>
                  <span className="text-xs text-slate-400 truncate max-w-[100px]">
                    {item.responsibleName}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenInteractionModal(item.lead)}
                    className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>Registrar interação</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenLead(item.lead.id)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Ver lead"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="mt-6 bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3.5 px-4">Data Follow-up</th>
                  <th className="py-3.5 px-4">Situação</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Última Interação</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Temperatura</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Responsável</th>
                  <th className="py-3.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredItems.map((item) => (
                  <tr key={item.lead.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                      <button
                        type="button"
                        onClick={() => onOpenLead(item.lead.id)}
                        className="text-left font-semibold text-white hover:text-indigo-400 cursor-pointer"
                      >
                        {item.lead.name}
                      </button>
                      <span className="text-[11px] text-slate-400 block">{item.stageName}</span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      {formatDateBR(item.followUpDate)}
                    </td>
                    <td className="py-3.5 px-4">
                      {getStatusBadge(item.status)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-300 hidden md:table-cell">
                      <div>{item.latestInteraction.interaction_type}</div>
                      <div className="text-[11px] text-slate-400">
                        {formatDateBR(item.latestInteraction.occurred_at)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 hidden lg:table-cell">
                      {getTemperatureBadge(item.lead.temperature)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-300 hidden sm:table-cell">
                      {item.responsibleName}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenInteractionModal(item.lead)}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span>Registrar interação</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* QUICK INTERACTION MODAL */}
      {modalOpen && modalLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-300">
                    Passo {quizStep} de {totalQuizSteps}
                  </span>
                  <span className="text-xs text-slate-300 truncate max-w-[200px]">
                    {modalLead.name}
                  </span>
                  {isRestoredDraft && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300">
                      Rascunho
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isRestoredDraft && (
                    <button
                      type="button"
                      onClick={handleDiscardInteractionDraft}
                      className="text-xs text-rose-400 hover:text-rose-300 mr-2 cursor-pointer"
                    >
                      Descartar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCloseInteractionModal}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${(quizStep / totalQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto flex-1 text-sm">
              {/* STEP 1: Tipo & Data */}
              {quizStep === 1 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Qual tipo de interação foi realizada?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Escolha o canal utilizado para o contato com o condomínio.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {INTERACTION_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormType(type)}
                        className={`p-3 rounded-xl border text-center text-xs font-semibold transition-all cursor-pointer ${
                          formType === type
                            ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Data e Hora da Interação
                    </label>
                    <input
                      type="datetime-local"
                      value={formOccurredAt}
                      onChange={(e) => setFormOccurredAt(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Anotações */}
              {quizStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      O que foi tratado nesta interação?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Anote os principais pontos discutidos, objeções ou decisões.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Observações
                    </label>
                    <textarea
                      rows={5}
                      autoFocus
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="Ex: Conversamos sobre a proposta comercial, solicitou envio de referências..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Próximo Follow-up */}
              {quizStep === 3 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Atualizar próximo follow-up?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Defina a nova data limite para o próximo contato com este condomínio.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Data do Próximo Follow-up
                    </label>
                    <input
                      type="date"
                      autoFocus
                      value={formNextFollowUpDate}
                      onChange={(e) => setFormNextFollowUpDate(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Responsável */}
              {quizStep === 4 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Confirmar e Salvar
                    </h3>
                    <p className="text-xs text-slate-400">
                      Verifique o responsável e finalize o registro.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Responsável
                    </label>
                    <select
                      value={formResponsibleId}
                      onChange={(e) => setFormResponsibleId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || 'Sem nome'} {p.id === currentProfile.id ? '(Você)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-1.5 text-slate-300">
                    <div>Tipo: <strong>{formType}</strong></div>
                    {formNextFollowUpDate && (
                      <div>Novo Follow-up: <strong>{formatDateBR(formNextFollowUpDate)}</strong></div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <div>
                {quizStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setQuizStep((p) => p - 1)}
                    disabled={savingInteraction}
                    className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
                  >
                    ← Voltar
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseInteractionModal}
                  disabled={savingInteraction}
                  className="px-3 py-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancelar
                </button>

                {quizStep < totalQuizSteps ? (
                  <button
                    type="button"
                    onClick={() => setQuizStep((p) => p + 1)}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitInteraction}
                    disabled={savingInteraction}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {savingInteraction ? 'Salvando...' : 'Salvar Interação'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
