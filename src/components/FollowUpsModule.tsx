import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';

export interface Lead {
  id: string;
  name: string;
  cnpj?: string | null;
  condominium_type?: string | null;
  administrator?: string | null;
  unit_count?: number | null;
  address?: string | null;
  city?: string | null;
  lead_source?: string | null;
  temperature?: string | null;
  current_stage_id?: string | null;
  responsible_user_id?: string | null;
  loss_reason?: string | null;
  created_at?: string;
}

export interface Interaction {
  id: string;
  lead_id: string;
  interaction_type: string;
  occurred_at: string;
  notes?: string | null;
  responsible_user_id?: string | null;
  next_follow_up_date?: string | null;
  created_at?: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
}

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

export default function FollowUpsModule({ currentProfile, onOpenLead }: FollowUpsModuleProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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
  const totalQuizSteps = 4;

  const [formType, setFormType] = useState<string>('Ligação');
  const [formOccurredAt, setFormOccurredAt] = useState<string>('');
  const [formResponsibleId, setFormResponsibleId] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formNextFollowUpDate, setFormNextFollowUpDate] = useState<string>('');
  const [savingInteraction, setSavingInteraction] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Leads
      const leadsRes = await supabase
        .from('leads')
        .select('*')
        .order('name', { ascending: true });
      setLeads(leadsRes.data || []);

      // 2. Stages
      const stagesRes = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('position', { ascending: true });
      setStages(stagesRes.data || []);

      // 3. Profiles
      const profilesRes = await supabase
        .from('profiles')
        .select('id, full_name, role');
      setProfiles(profilesRes.data || []);

      // 4. Interactions
      const interactionsRes = await supabase
        .from('interactions')
        .select('*')
        .order('occurred_at', { ascending: false });
      setInteractions(interactionsRes.data || []);
    } catch (err: any) {
      console.error('Error loading follow-ups data:', err);
      setStatusFeedback({
        type: 'error',
        message: 'Erro ao carregar follow-ups do Supabase.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lookup maps
  const stageMap = useMemo(() => {
    const map = new Map<string, string>();
    stages.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [stages]);

  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((p) => map.set(p.id, p.full_name || 'Sem nome'));
    return map;
  }, [profiles]);

  // Calculate active follow-up items per lead based on the most recent interaction
  const followUpItems = useMemo<FollowUpItem[]>(() => {
    if (!leads.length) return [];

    const interactionsByLead = new Map<string, Interaction[]>();
    interactions.forEach((item) => {
      const existing = interactionsByLead.get(item.lead_id) || [];
      existing.push(item);
      interactionsByLead.set(item.lead_id, existing);
    });

    const items: FollowUpItem[] = [];

    leads.forEach((lead) => {
      const leadInteractions = interactionsByLead.get(lead.id) || [];
      if (leadInteractions.length === 0) return;

      const latest = leadInteractions[0];
      if (latest.next_follow_up_date && latest.next_follow_up_date.trim() !== '') {
        const status = getFollowUpStatus(latest.next_follow_up_date);
        const responsibleId = latest.responsible_user_id || lead.responsible_user_id;
        const responsibleName = responsibleId ? profileMap.get(responsibleId) || 'Não atribuído' : 'Não atribuído';
        const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) || 'Estágio inicial' : 'Estágio inicial';

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

    const statusOrder = { overdue: 0, today: 1, upcoming: 2 };
    items.sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime();
    });

    return items;
  }, [leads, interactions, stageMap, profileMap]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return followUpItems.filter((item) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchName = item.lead.name.toLowerCase().includes(query);
        const matchCity = item.lead.city ? item.lead.city.toLowerCase().includes(query) : false;
        if (!matchName && !matchCity) return false;
      }

      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      if (responsibleFilter !== 'all') {
        const leadResp = item.latestInteraction.responsible_user_id || item.lead.responsible_user_id;
        if (leadResp !== responsibleFilter) return false;
      }

      return true;
    });
  }, [followUpItems, searchTerm, statusFilter, responsibleFilter]);

  // Counts for tabs/badges
  const counts = useMemo(() => {
    let overdue = 0;
    let today = 0;
    let upcoming = 0;
    followUpItems.forEach((i) => {
      if (i.status === 'overdue') overdue++;
      else if (i.status === 'today') today++;
      else if (i.status === 'upcoming') upcoming++;
    });
    return { all: followUpItems.length, overdue, today, upcoming };
  }, [followUpItems]);

  const getTemperatureBadge = (temp?: string | null) => {
    switch (temp) {
      case 'Quente':
        return <span className="text-rose-400 font-semibold text-xs">● Quente</span>;
      case 'Frio':
        return <span className="text-sky-400 font-medium text-xs">● Frio</span>;
      case 'Morno':
      default:
        return <span className="text-amber-400 font-medium text-xs">● Morno</span>;
    }
  };

  const getStatusBadge = (status: 'overdue' | 'today' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Vencido
          </span>
        );
      case 'today':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            Hoje
          </span>
        );
      case 'upcoming':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            Próximo
          </span>
        );
    }
  };

  // Quick Interaction Registration
  const handleOpenQuickInteraction = (lead: Lead) => {
    setModalLead(lead);
    setFormType('Ligação');
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    setFormOccurredAt(localISOTime);
    setFormResponsibleId(currentProfile.id);
    setFormNotes('');
    setFormNextFollowUpDate('');
    setQuizStep(1);
    setModalOpen(true);
  };

  const handleSaveQuickInteraction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!modalLead) return;

    setSavingInteraction(true);
    try {
      const payload = {
        lead_id: modalLead.id,
        interaction_type: formType,
        occurred_at: formOccurredAt ? new Date(formOccurredAt).toISOString() : new Date().toISOString(),
        responsible_user_id: formResponsibleId || currentProfile.id,
        notes: formNotes.trim() || null,
        next_follow_up_date: formNextFollowUpDate ? formNextFollowUpDate : null,
      };

      const { error } = await supabase.from('interactions').insert([payload]);
      if (error) throw error;

      setStatusFeedback({
        type: 'success',
        message: `Nova interação registrada com sucesso para ${modalLead.name}!`,
      });
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Error recording interaction:', err);
      setStatusFeedback({
        type: 'error',
        message: err.message || 'Erro ao registrar interação no Supabase.',
      });
    } finally {
      setSavingInteraction(false);
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
            <span>Retornos Comerciais</span>
            <span aria-hidden="true">·</span>
            <span className="text-indigo-400 font-mono tabular-nums">{counts.all} ativos</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Follow-ups Comerciais
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Segmented View Mode Toggle */}
          <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              title="Visualização em Cards"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span>Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="Visualização em Lista"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Lista</span>
            </button>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-slate-300 font-semibold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Atualizar
          </button>
        </div>
      </div>

      {/* Feedback message */}
      {statusFeedback && (
        <div
          className={`mt-4 p-4 rounded-xl flex items-center justify-between text-xs sm:text-sm ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/70 border border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{statusFeedback.message}</span>
          <button
            onClick={() => setStatusFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Situation Filter Segmented Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'all'
              ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span>Todos</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-950 text-slate-300 font-mono">
            {counts.all}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('overdue')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'overdue'
              ? 'bg-amber-950/80 text-amber-200 border border-amber-700/80 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-amber-300 border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Vencidos
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-950 border border-amber-800 text-amber-300 font-mono">
            {counts.overdue}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('today')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'today'
              ? 'bg-indigo-950/80 text-indigo-200 border border-indigo-700/80 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-indigo-300 border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            Hoje
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono">
            {counts.today}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('upcoming')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'upcoming'
              ? 'bg-slate-800 text-white border border-slate-600 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span>Próximos</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-950 text-slate-300 font-mono">
            {counts.upcoming}
          </span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="mt-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por condomínio ou cidade..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 shrink-0">Responsável:</span>
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="py-2 px-3 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
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

      {/* Main Content: Cards View (Default) or Table View */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs sm:text-sm">Carregando próximos retornos comerciais...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mt-8 py-16 px-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center">
          <h3 className="text-base font-semibold text-white mb-1">
            Nenhum follow-up encontrado
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {searchTerm || statusFilter !== 'all' || responsibleFilter !== 'all'
              ? 'Nenhum registro corresponde aos filtros ativos.'
              : 'Registre uma nova interação em qualquer lead com data de próximo retorno para que apareça nesta fila de prioridades.'}
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW (DEFAULT) */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {filteredItems.map((item) => {
            const isOverdue = item.status === 'overdue';
            const isToday = item.status === 'today';

            return (
              <div
                key={item.lead.id}
                className={`rounded-2xl p-5 shadow-lg transition-all flex flex-col justify-between border ${
                  isOverdue
                    ? 'bg-slate-900/90 border-amber-600/40 hover:border-amber-500/70'
                    : isToday
                    ? 'bg-slate-900/90 border-indigo-500/40 hover:border-indigo-400'
                    : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Top Status & Date */}
                  <div className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-800/60">
                    <div className="flex items-center gap-2">
                      {getStatusBadge(item.status)}
                      <span className="text-xs font-mono font-semibold text-white">
                        {formatDateBR(item.followUpDate)}
                      </span>
                    </div>

                    <div>
                      {getTemperatureBadge(item.lead.temperature)}
                    </div>
                  </div>

                  {/* Lead Name */}
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => onOpenLead(item.lead.id)}
                      className="text-left font-bold text-base text-white hover:text-indigo-400 transition-colors cursor-pointer leading-tight block"
                    >
                      {item.lead.name}
                    </button>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <span>{item.lead.city || 'Cidade não informada'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-indigo-300 font-medium">{item.stageName}</span>
                    </div>
                  </div>

                  {/* Latest Interaction Quote */}
                  <div className="mb-4 bg-slate-950/70 p-3 rounded-xl border border-slate-800/70 text-xs">
                    <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                      <span>Último: <strong className="text-slate-200">{item.latestInteraction.interaction_type}</strong></span>
                      <span className="font-mono text-slate-500">{formatDateBR(item.latestInteraction.occurred_at)}</span>
                    </div>
                    {item.latestInteraction.notes ? (
                      <p className="text-slate-300 italic line-clamp-2">
                        "{item.latestInteraction.notes}"
                      </p>
                    ) : (
                      <p className="text-slate-500 italic">Sem observações registradas.</p>
                    )}
                  </div>
                </div>

                {/* Footer Actions & Responsible */}
                <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300 uppercase font-semibold shrink-0">
                      {item.responsibleName.charAt(0)}
                    </span>
                    <span className="text-xs truncate max-w-[90px] text-slate-300">
                      {item.responsibleName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenQuickInteraction(item.lead)}
                      title="Registrar interação"
                      aria-label="Registrar interação"
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Registrar interação</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenLead(item.lead.id)}
                      title="Abrir lead"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="mt-6 bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3.5 px-4">Data do Follow-up</th>
                  <th className="py-3.5 px-4">Situação</th>
                  <th className="py-3.5 px-4">Última Interação</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Responsável</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Estágio</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredItems.map((item) => (
                  <tr key={item.lead.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                      <button
                        type="button"
                        onClick={() => onOpenLead(item.lead.id)}
                        className="text-left font-semibold text-white hover:text-indigo-400 transition-colors cursor-pointer"
                      >
                        {item.lead.name}
                      </button>
                      <span className="text-[11px] text-slate-400 block">{item.lead.city || '-'}</span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-xs">
                      {formatDateBR(item.followUpDate)}
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(item.status)}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-xs text-slate-300 block">{item.latestInteraction.interaction_type}</span>
                      {item.latestInteraction.notes && (
                        <span className="text-[11px] text-slate-400 truncate max-w-xs block italic">
                          "{item.latestInteraction.notes}"
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 hidden md:table-cell text-xs text-slate-300">
                      {item.responsibleName}
                    </td>
                    <td className="py-3.5 px-4 hidden sm:table-cell text-xs text-indigo-300">
                      {item.stageName}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenQuickInteraction(item.lead)}
                          title="Registrar interação"
                          aria-label="Registrar interação"
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="hidden sm:inline">Registrar interação</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenLead(item.lead.id)}
                          title="Ver detalhes"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DYNAMIC QUIZ-STYLE MODAL FOR INTERACTION */}
      {modalOpen && modalLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Registrar Interação
                  </h3>
                  <p className="text-xs text-slate-400">
                    Condomínio: <span className="text-indigo-300 font-semibold">{modalLead.name}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(quizStep / totalQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 text-xs">
              {quizStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h4 className="text-base font-bold text-white mb-1">
                    Qual foi o tipo de contato realizado?
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {INTERACTION_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type}
                        onClick={() => {
                          setFormType(type);
                          setQuizStep(2);
                        }}
                        className={`p-3.5 rounded-xl border text-xs font-semibold transition-all text-left flex items-center justify-between cursor-pointer ${
                          formType === type
                            ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <span>{type}</span>
                        <span className="text-slate-500">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {quizStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h4 className="text-base font-bold text-white mb-1">
                    Quando ocorreu e quem foi o responsável?
                  </h4>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Data e Hora</label>
                    <input
                      type="datetime-local"
                      value={formOccurredAt}
                      onChange={(e) => setFormOccurredAt(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Responsável</label>
                    <select
                      value={formResponsibleId}
                      onChange={(e) => setFormResponsibleId(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || 'Sem nome'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {quizStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h4 className="text-base font-bold text-white mb-1">
                    Observações da Interação
                  </h4>
                  <textarea
                    rows={4}
                    autoFocus
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Descreva o que foi tratado, alinhamentos ou próximos passos..."
                    className="w-full px-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                </div>
              )}

              {quizStep === 4 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <h4 className="text-base font-bold text-white mb-1">
                    Agendar Próximo Retorno?
                  </h4>
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium">Data do Retorno</label>
                      {formNextFollowUpDate && (
                        <button
                          type="button"
                          onClick={() => setFormNextFollowUpDate('')}
                          className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Remover data
                        </button>
                      )}
                    </div>
                    <input
                      type="date"
                      value={formNextFollowUpDate}
                      onChange={(e) => setFormNextFollowUpDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={quizStep === 1 ? () => setModalOpen(false) : () => setQuizStep((p) => p - 1)}
                className="px-3.5 py-2 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {quizStep === 1 ? 'Cancelar' : '← Voltar'}
              </button>

              {quizStep < totalQuizSteps ? (
                <button
                  type="button"
                  onClick={() => setQuizStep((p) => p + 1)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>Próximo</span>
                  <span>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSaveQuickInteraction()}
                  disabled={savingInteraction}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {savingInteraction ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Salvar Interação</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
