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

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Quick Interaction Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLead, setModalLead] = useState<Lead | null>(null);
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

    // Group interactions by lead_id (interactions already sorted descending by occurred_at)
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

      // The most recent interaction
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

    // Sort: Vencidos first (oldest followUpDate to recent), then Hoje, then Próximos (closest date first)
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
      // Search by condominium name or city
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchName = item.lead.name.toLowerCase().includes(query);
        const matchCity = item.lead.city ? item.lead.city.toLowerCase().includes(query) : false;
        if (!matchName && !matchCity) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // Responsible filter
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
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-rose-950/80 border border-rose-700/60 text-rose-300 font-medium">
            Quente
          </span>
        );
      case 'Frio':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-sky-950/80 border border-sky-700/60 text-sky-300 font-medium">
            Frio
          </span>
        );
      case 'Morno':
      default:
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-950/80 border border-amber-700/60 text-amber-300 font-medium">
            Morno
          </span>
        );
    }
  };

  const getStatusBadge = (status: 'overdue' | 'today' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-amber-950/90 border border-amber-700/70 text-amber-300 font-semibold shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Vencido
          </span>
        );
      case 'today':
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-indigo-950/90 border border-indigo-700/70 text-indigo-300 font-semibold shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Hoje
          </span>
        );
      case 'upcoming':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 font-medium">
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
    setModalOpen(true);
  };

  const handleSaveQuickInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Follow-ups Comerciais
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300 font-semibold">
              {counts.all} ativos
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Acompanhamento de retornos e contatos agendados por ordem de prioridade
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="self-start sm:self-auto px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg text-xs text-slate-300 font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Atualizar
        </button>
      </div>

      {/* Feedback message */}
      {statusFeedback && (
        <div
          className={`mt-4 p-4 rounded-lg flex items-center justify-between text-sm ${
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

      {/* Situation Tabs: Vencidos / Hoje / Próximos */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'all'
              ? 'bg-slate-800 text-white border border-slate-700 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span>Todos</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-slate-300">
            {counts.all}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('overdue')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'overdue'
              ? 'bg-amber-950/80 text-amber-200 border border-amber-700/80 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-amber-300 border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Vencidos
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 border border-amber-800 text-amber-300">
            {counts.overdue}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('today')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'today'
              ? 'bg-indigo-950/80 text-indigo-200 border border-indigo-700/80 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-indigo-300 border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            Hoje
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950 border border-indigo-800 text-indigo-300">
            {counts.today}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('upcoming')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            statusFilter === 'upcoming'
              ? 'bg-slate-800 text-white border border-slate-600 shadow-xs'
              : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800/40'
          }`}
        >
          <span>Próximos</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-slate-300">
            {counts.upcoming}
          </span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="mt-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar condomínio ou cidade..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
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

        {/* Responsible user filter */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 shrink-0">Responsável:</span>
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="py-2 px-3 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
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

      {/* Main Follow-ups Table */}
      <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Carregando próximos follow-ups...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-base font-medium text-white mb-1">
              Nenhum follow-up encontrado
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
              {searchTerm || statusFilter !== 'all' || responsibleFilter !== 'all'
                ? 'Nenhum registro corresponde aos filtros selecionados.'
                : 'Quando você registra uma interação em um lead com data de próximo follow-up, ela aparecerá automaticamente aqui.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3.5 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3.5 px-4">Data do Follow-up</th>
                  <th className="py-3.5 px-4">Situação</th>
                  <th className="py-3.5 px-4">Última Interação</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Responsável</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Temperatura</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Estágio</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredItems.map((item) => {
                  const isOverdue = item.status === 'overdue';
                  const isToday = item.status === 'today';

                  return (
                    <tr
                      key={item.lead.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isOverdue ? 'bg-amber-950/10' : isToday ? 'bg-indigo-950/10' : ''
                      }`}
                    >
                      {/* Condomínio */}
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <button
                          type="button"
                          onClick={() => onOpenLead(item.lead.id)}
                          className="text-left group cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-white group-hover:text-indigo-400 transition-colors">
                            <span>{item.lead.name}</span>
                            <svg
                              className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </div>
                          {item.lead.city && (
                            <span className="text-[11px] text-slate-400 block">
                              {item.lead.city} {item.lead.administrator ? `• Adm: ${item.lead.administrator}` : ''}
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Data do Follow-up */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span
                            className={`font-semibold text-xs ${
                              isOverdue
                                ? 'text-amber-400'
                                : isToday
                                ? 'text-indigo-300'
                                : 'text-slate-200'
                            }`}
                          >
                            {formatDateBR(item.followUpDate)}
                          </span>
                        </div>
                      </td>

                      {/* Situação */}
                      <td className="py-3.5 px-4">
                        {getStatusBadge(item.status)}
                      </td>

                      {/* Última Interação */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col max-w-xs">
                          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[10px] text-indigo-300">
                              {item.latestInteraction.interaction_type}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              em {formatDateBR(item.latestInteraction.occurred_at)}
                            </span>
                          </div>
                          {item.latestInteraction.notes && (
                            <p className="text-[11px] text-slate-400 mt-1 truncate italic">
                              "{item.latestInteraction.notes}"
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Responsável */}
                      <td className="py-3.5 px-4 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300 uppercase font-semibold">
                            {item.responsibleName.charAt(0)}
                          </span>
                          <span className="text-xs truncate max-w-[130px] text-slate-300">
                            {item.responsibleName}
                          </span>
                        </div>
                      </td>

                      {/* Temperatura */}
                      <td className="py-3.5 px-4 hidden lg:table-cell">
                        {getTemperatureBadge(item.lead.temperature)}
                      </td>

                      {/* Estágio */}
                      <td className="py-3.5 px-4 hidden sm:table-cell">
                        <span className="text-xs font-medium text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 px-2 py-0.5 rounded">
                          {item.stageName}
                        </span>
                      </td>

                      {/* Ações */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenQuickInteraction(item.lead)}
                            title="Registrar nova interação"
                            className="px-2.5 py-1.5 bg-indigo-600/90 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 4v16m8-8H4"
                              />
                            </svg>
                            <span className="hidden sm:inline">Interagir</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenLead(item.lead.id)}
                            title="Abrir detalhes do lead"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Interaction Modal */}
      {modalOpen && modalLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
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
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveQuickInteraction} className="p-6 space-y-4 text-xs">
              {/* Tipo de Interação (Obrigatório) */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Tipo de Interação <span className="text-rose-400">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {INTERACTION_TYPES.map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setFormType(type)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer text-center ${
                        formType === type
                          ? 'bg-indigo-950 border-indigo-500 text-indigo-200'
                          : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Data e Hora + Responsável */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Data e Hora <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={formOccurredAt}
                    onChange={(e) => setFormOccurredAt(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Responsável
                  </label>
                  <select
                    value={formResponsibleId}
                    onChange={(e) => setFormResponsibleId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || 'Sem nome'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Observações */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Observações da Interação
                </label>
                <textarea
                  rows={3}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Descreva o que foi conversado, alinhamentos ou próximos passos..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Próximo Follow-up */}
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-medium">
                    Próximo Follow-up (Opcional)
                  </label>
                  {formNextFollowUpDate && (
                    <button
                      type="button"
                      onClick={() => setFormNextFollowUpDate('')}
                      className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Limpar data
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={formNextFollowUpDate}
                  onChange={(e) => setFormNextFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Ao definir esta data, ela se tornará o follow-up atual deste condomínio.
                </p>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={savingInteraction}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingInteraction}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {savingInteraction ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Registrar Interação</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
