import React, { useState, useMemo } from 'react';
import type { Lead, PipelineStage, Interaction, Contact } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import {
  CardQuickActions,
  WhatsAppIcon,
  EmailIcon,
  FolderIcon,
  EyeIcon,
  EditIcon,
  TrashIcon,
} from './PipelineComponents.tsx';
import {
  getLeadFolderLink,
  saveLeadFolderLink,
} from './LeadsModule.tsx';
import {
  parseCalendarDate,
  formatDateBR,
  formatTimeBR,
} from '../lib/dateUtils.ts';

export type FunnelType = 'temperature' | 'stages' | 'followups';

export interface FunnelTierData {
  id: string;
  name: string;
  subtitle?: string;
  count: number;
  percentage: number;
  color: {
    bg: string;
    border: string;
    text: string;
    accent: string;
    gradientFrom: string;
    gradientTo: string;
    glow: string;
    badgeBg: string;
  };
  leads: Lead[];
}

export interface FunnelVisualizerProps {
  leads: Lead[];
  stages: PipelineStage[];
  interactions: Interaction[];
  profiles: UserProfile[];
  profileMap: Map<string, string>;
  stageMap: Map<string, string>;
  currentProfile: UserProfile;
  getContactsForLead: (leadId: string) => Contact[];
  onOpenLead: (leadId: string) => void;
  onOpenTimeline: (lead: Lead) => void;
  onOpenNotes: (lead: Lead) => void;
  onOpenWhatsApp: (lead: Lead) => void;
  onOpenEmail: (lead: Lead) => void;
  onOpenFolder: (lead: Lead) => void;
  onSuccessFeedback?: (msg: string) => void;
}

export default function FunnelVisualizer({
  leads,
  stages,
  interactions,
  profiles,
  profileMap,
  stageMap,
  currentProfile,
  getContactsForLead,
  onOpenLead,
  onOpenTimeline,
  onOpenNotes,
  onOpenWhatsApp,
  onOpenEmail,
  onOpenFolder,
  onSuccessFeedback,
}: FunnelVisualizerProps) {
  const [funnelType, setFunnelType] = useState<FunnelType>('temperature');
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Group latest interaction by lead
  const latestInteractionByLead = useMemo(() => {
    const map = new Map<string, Interaction>();
    const grouped = new Map<string, Interaction[]>();
    interactions.forEach((i) => {
      const arr = grouped.get(i.lead_id) || [];
      arr.push(i);
      grouped.set(i.lead_id, arr);
    });

    grouped.forEach((list, leadId) => {
      const sorted = [...list].sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );
      if (sorted[0]) map.set(leadId, sorted[0]);
    });

    return map;
  }, [interactions]);

  // Compute funnel tiers based on selected funnel type
  const tiers = useMemo<FunnelTierData[]>(() => {
    const totalLeadsCount = leads.length;

    // 1. Funil de Temperatura
    if (funnelType === 'temperature') {
      const coldLeads = leads.filter((l) => (l.temperature || 'Morno').toLowerCase() === 'frio');
      const warmLeads = leads.filter((l) => (l.temperature || 'Morno').toLowerCase() === 'morno');
      const hotLeads = leads.filter((l) => (l.temperature || 'Morno').toLowerCase() === 'quente');
      const clientLeads = leads.filter((l) => (l.temperature || 'Morno').toLowerCase() === 'cliente');

      return [
        {
          id: 'frio',
          name: 'Frio',
          subtitle: 'Prospecção / Primeiro contato',
          count: coldLeads.length,
          percentage: totalLeadsCount > 0 ? Math.round((coldLeads.length / totalLeadsCount) * 100) : 0,
          color: {
            bg: 'bg-sky-950/70',
            border: 'border-sky-700/60',
            text: 'text-sky-300',
            accent: 'bg-sky-500',
            gradientFrom: 'from-sky-500/25',
            gradientTo: 'to-sky-600/10',
            glow: 'rgba(14, 165, 233, 0.25)',
            badgeBg: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
          },
          leads: coldLeads,
        },
        {
          id: 'morno',
          name: 'Morno',
          subtitle: 'Qualificação / Em negociação',
          count: warmLeads.length,
          percentage: totalLeadsCount > 0 ? Math.round((warmLeads.length / totalLeadsCount) * 100) : 0,
          color: {
            bg: 'bg-amber-950/70',
            border: 'border-amber-700/60',
            text: 'text-amber-300',
            accent: 'bg-amber-500',
            gradientFrom: 'from-amber-500/25',
            gradientTo: 'to-amber-600/10',
            glow: 'rgba(245, 158, 11, 0.25)',
            badgeBg: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
          },
          leads: warmLeads,
        },
        {
          id: 'quente',
          name: 'Quente',
          subtitle: 'Decisão / Proposta em análise',
          count: hotLeads.length,
          percentage: totalLeadsCount > 0 ? Math.round((hotLeads.length / totalLeadsCount) * 100) : 0,
          color: {
            bg: 'bg-rose-950/70',
            border: 'border-rose-700/60',
            text: 'text-rose-300',
            accent: 'bg-rose-500',
            gradientFrom: 'from-rose-500/25',
            gradientTo: 'to-rose-600/10',
            glow: 'rgba(244, 63, 94, 0.25)',
            badgeBg: 'bg-rose-500/20 text-rose-300 border border-rose-500/40',
          },
          leads: hotLeads,
        },
        {
          id: 'cliente',
          name: 'Cliente',
          subtitle: 'Convertido / Contrato fechado',
          count: clientLeads.length,
          percentage: totalLeadsCount > 0 ? Math.round((clientLeads.length / totalLeadsCount) * 100) : 0,
          color: {
            bg: 'bg-emerald-950/70',
            border: 'border-emerald-700/60',
            text: 'text-emerald-300',
            accent: 'bg-emerald-500',
            gradientFrom: 'from-emerald-500/25',
            gradientTo: 'to-emerald-600/10',
            glow: 'rgba(16, 185, 129, 0.25)',
            badgeBg: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
          },
          leads: clientLeads,
        },
      ];
    }

    // 2. Funil de Etapas (Sem a etapa de Perdido, focado no fechamento comercial)
    if (funnelType === 'stages') {
      const activeCommercialStages = stages.filter(
        (s) => !s.is_lost && !(s.name || '').toLowerCase().includes('perdid')
      );

      const palette = [
        {
          accent: 'bg-indigo-500',
          text: 'text-indigo-300',
          border: 'border-indigo-700/60',
          gradientFrom: 'from-indigo-500/25',
          gradientTo: 'to-indigo-600/10',
          glow: 'rgba(99, 102, 241, 0.25)',
          badgeBg: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40',
        },
        {
          accent: 'bg-sky-500',
          text: 'text-sky-300',
          border: 'border-sky-700/60',
          gradientFrom: 'from-sky-500/25',
          gradientTo: 'to-sky-600/10',
          glow: 'rgba(14, 165, 233, 0.25)',
          badgeBg: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
        },
        {
          accent: 'bg-teal-500',
          text: 'text-teal-300',
          border: 'border-teal-700/60',
          gradientFrom: 'from-teal-500/25',
          gradientTo: 'to-teal-600/10',
          glow: 'rgba(20, 184, 166, 0.25)',
          badgeBg: 'bg-teal-500/20 text-teal-300 border border-teal-500/40',
        },
        {
          accent: 'bg-amber-500',
          text: 'text-amber-300',
          border: 'border-amber-700/60',
          gradientFrom: 'from-amber-500/25',
          gradientTo: 'to-amber-600/10',
          glow: 'rgba(245, 158, 11, 0.25)',
          badgeBg: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
        },
        {
          accent: 'bg-rose-500',
          text: 'text-rose-300',
          border: 'border-rose-700/60',
          gradientFrom: 'from-rose-500/25',
          gradientTo: 'to-rose-600/10',
          glow: 'rgba(244, 63, 94, 0.25)',
          badgeBg: 'bg-rose-500/20 text-rose-300 border border-rose-500/40',
        },
        {
          accent: 'bg-emerald-500',
          text: 'text-emerald-300',
          border: 'border-emerald-700/60',
          gradientFrom: 'from-emerald-500/25',
          gradientTo: 'to-emerald-600/10',
          glow: 'rgba(16, 185, 129, 0.25)',
          badgeBg: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
        },
      ];

      return activeCommercialStages.map((stage, idx) => {
        const stageLeads = leads.filter((l) => {
          const sId = l.current_stage_id || (activeCommercialStages[0]?.id ?? '');
          return sId === stage.id;
        });
        const color = palette[idx % palette.length];

        return {
          id: stage.id,
          name: stage.name,
          subtitle: `Etapa ${idx + 1} do processo comercial`,
          count: stageLeads.length,
          percentage: totalLeadsCount > 0 ? Math.round((stageLeads.length / totalLeadsCount) * 100) : 0,
          color: {
            bg: 'bg-zinc-900/90',
            ...color,
          },
          leads: stageLeads,
        };
      });
    }

    // 3. Funil de Follow-ups (Total de Leads não-clientes > Contato agendado > Próximos dias > Hoje)
    const now = new Date();
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Total de Leads = condomínios no pipeline que ainda não são clientes
    const nonClientLeads = leads.filter(
      (l) => (l.temperature || 'Morno').toLowerCase() !== 'cliente'
    );

    // Contato agendado = leads não-clientes que possuem next_follow_up_date
    const scheduledLeads = nonClientLeads.filter((l) => {
      const latest = latestInteractionByLead.get(l.id);
      return Boolean(latest?.next_follow_up_date && latest.next_follow_up_date.trim() !== '');
    });

    // Próximos dias = agendamentos a partir de amanhã
    const upcomingDaysLeads = scheduledLeads.filter((l) => {
      const latest = latestInteractionByLead.get(l.id);
      const parsed = parseCalendarDate(latest?.next_follow_up_date);
      if (!parsed) return false;
      const targetOnly = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
      return targetOnly > todayOnly;
    });

    // Hoje = agendamentos programados exatamente para o dia de hoje
    const todayLeads = scheduledLeads.filter((l) => {
      const latest = latestInteractionByLead.get(l.id);
      const parsed = parseCalendarDate(latest?.next_follow_up_date);
      if (!parsed) return false;
      const targetOnly = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
      return targetOnly === todayOnly;
    });

    return [
      {
        id: 'total_leads',
        name: 'Total de Leads',
        subtitle: 'Condomínios no pipeline (não clientes)',
        count: nonClientLeads.length,
        percentage: 100,
        color: {
          bg: 'bg-indigo-950/70',
          border: 'border-indigo-700/60',
          text: 'text-indigo-300',
          accent: 'bg-indigo-500',
          gradientFrom: 'from-indigo-500/25',
          gradientTo: 'to-indigo-600/10',
          glow: 'rgba(99, 102, 241, 0.25)',
          badgeBg: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40',
        },
        leads: nonClientLeads,
      },
      {
        id: 'contato_agendado',
        name: 'Contato Agendado',
        subtitle: 'Leads com follow-up na agenda',
        count: scheduledLeads.length,
        percentage: nonClientLeads.length > 0 ? Math.round((scheduledLeads.length / nonClientLeads.length) * 100) : 0,
        color: {
          bg: 'bg-sky-950/70',
          border: 'border-sky-700/60',
          text: 'text-sky-300',
          accent: 'bg-sky-500',
          gradientFrom: 'from-sky-500/25',
          gradientTo: 'to-sky-600/10',
          glow: 'rgba(14, 165, 233, 0.25)',
          badgeBg: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
        },
        leads: scheduledLeads,
      },
      {
        id: 'proximos_dias',
        name: 'Próximos Dias',
        subtitle: 'Agendamentos futuros programados',
        count: upcomingDaysLeads.length,
        percentage: nonClientLeads.length > 0 ? Math.round((upcomingDaysLeads.length / nonClientLeads.length) * 100) : 0,
        color: {
          bg: 'bg-teal-950/70',
          border: 'border-teal-700/60',
          text: 'text-teal-300',
          accent: 'bg-teal-500',
          gradientFrom: 'from-teal-500/25',
          gradientTo: 'to-teal-600/10',
          glow: 'rgba(20, 184, 166, 0.25)',
          badgeBg: 'bg-teal-500/20 text-teal-300 border border-teal-500/40',
        },
        leads: upcomingDaysLeads,
      },
      {
        id: 'hoje',
        name: 'Hoje',
        subtitle: 'Follow-ups para contato hoje',
        count: todayLeads.length,
        percentage: nonClientLeads.length > 0 ? Math.round((todayLeads.length / nonClientLeads.length) * 100) : 0,
        color: {
          bg: 'bg-amber-950/70',
          border: 'border-amber-700/60',
          text: 'text-amber-300',
          accent: 'bg-amber-500',
          gradientFrom: 'from-amber-500/25',
          gradientTo: 'to-amber-600/10',
          glow: 'rgba(245, 158, 11, 0.25)',
          badgeBg: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
        },
        leads: todayLeads,
      },
    ];
  }, [funnelType, leads, stages, latestInteractionByLead]);

  // Selected tier leads with search filter
  const displayedLeads = useMemo(() => {
    let baseList: Lead[] = [];
    if (selectedTierId) {
      const found = tiers.find((t) => t.id === selectedTierId);
      baseList = found ? found.leads : leads;
    } else {
      baseList = leads;
    }

    if (!searchTerm.trim()) return baseList;
    const term = searchTerm.toLowerCase();

    return baseList.filter((l) => {
      const matchName = l.name.toLowerCase().includes(term);
      const matchCity = l.city ? l.city.toLowerCase().includes(term) : false;
      const matchAddr = l.address ? l.address.toLowerCase().includes(term) : false;
      const matchAdm = l.administrator ? l.administrator.toLowerCase().includes(term) : false;
      const contacts = getContactsForLead(l.id);
      const matchContact = contacts.some(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.phone && c.phone.includes(term)) ||
          (c.email && c.email.toLowerCase().includes(term))
      );
      return matchName || matchCity || matchAddr || matchAdm || matchContact;
    });
  }, [selectedTierId, tiers, leads, searchTerm, getContactsForLead]);

  const selectedTier = tiers.find((t) => t.id === selectedTierId);

  return (
    <div className="w-full">
      {/* 2-COLUMN COMPACT LAYOUT (Left: Funnel Drawing | Right: 2-Block Summarized Cards) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ========================================================================= */}
        {/* COLUNA ESQUERDA: DESENHO DO FUNIL COMPACTO (Sem taxas intermediárias)     */}
        {/* ========================================================================= */}
        <div className="lg:col-span-5 bg-[#121215] border border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xl backdrop-blur-md flex flex-col justify-between">
          <div>
            {/* Top Bar: Title + Seletor de Tipo Compacto */}
            <div className="flex flex-col gap-2.5 pb-3.5 border-b border-zinc-800/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Funil Comercial</h3>
                  </div>
                </div>

                {selectedTier && (
                  <button
                    type="button"
                    onClick={() => setSelectedTierId(null)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold underline cursor-pointer"
                  >
                    Ver todos
                  </button>
                )}
              </div>

              {/* Type Switcher Tabs (Compact) */}
              <div className="grid grid-cols-3 p-1 bg-[#09090b] rounded-xl border border-zinc-800 text-[11px] font-semibold text-center">
                <button
                  type="button"
                  onClick={() => {
                    setFunnelType('temperature');
                    setSelectedTierId(null);
                  }}
                  className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                    funnelType === 'temperature'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title="Funil por Temperatura"
                >
                  🔥 Temperatura
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFunnelType('stages');
                    setSelectedTierId(null);
                  }}
                  className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                    funnelType === 'stages'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title="Funil por Etapas"
                >
                  📊 Etapas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFunnelType('followups');
                    setSelectedTierId(null);
                  }}
                  className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                    funnelType === 'followups'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title="Funil de Follow-ups"
                >
                  📅 Follow-ups
                </button>
              </div>
            </div>

            {/* DESENHO REAL DO FUNIL EM TRAPÉZIOS PROGRESSIVOS COMPACTOS (SEM LINHAS DE PASSAGEM) */}
            <div className="py-4 space-y-2.5">
              {tiers.map((tier, idx) => {
                const totalTiers = tiers.length;
                // Width narrows down smoothly from 100% to 54%
                const widthFactor = 100 - (idx * (46 / Math.max(1, totalTiers - 1)));
                const isSelected = selectedTierId === tier.id;

                return (
                  <div key={tier.id} className="flex flex-col items-center">
                    {/* Funnel Tier Box */}
                    <div
                      onClick={() => setSelectedTierId(isSelected ? null : tier.id)}
                      style={{
                        width: `${Math.max(52, widthFactor)}%`,
                        boxShadow: isSelected ? `0 0 18px ${tier.color.glow}` : undefined,
                      }}
                      className={`relative group cursor-pointer transition-all duration-200 rounded-xl p-2.5 border ${
                        isSelected
                          ? `${tier.color.border} ring-2 ring-indigo-500 bg-zinc-900 scale-[1.02]`
                          : `${tier.color.border} hover:scale-[1.01] bg-[#09090b]/90 hover:bg-zinc-900/90`
                      }`}
                    >
                      <div
                        className={`absolute inset-0 rounded-xl bg-gradient-to-r ${tier.color.gradientFrom} ${tier.color.gradientTo} pointer-events-none opacity-40 group-hover:opacity-75 transition-opacity`}
                      />

                      <div className="relative z-10 flex items-center justify-between gap-2">
                        {/* Left: Dot + Title */}
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full ${tier.color.accent} shrink-0`} />
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-white truncate block group-hover:text-indigo-300 transition-colors">
                              {tier.name}
                            </span>
                            {tier.subtitle && (
                              <span className="text-[10px] text-zinc-400 truncate block">
                                {tier.subtitle}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Big Count + Percent */}
                        <div className="text-right shrink-0">
                          <span className="text-base font-black text-white tabular-nums block leading-tight">
                            {tier.count}
                          </span>
                          <span className="text-[9px] text-zinc-400 font-semibold block">
                            {tier.percentage}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick info footer */}
          <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              Filtrando: <strong className="text-white">{selectedTier ? selectedTier.name : 'Todos'}</strong>
            </span>
            <span>
              <strong className="text-white">{displayedLeads.length}</strong> condomínios
            </span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUNA DIREITA: CARDS EM 2 BLOCOS LADO A LADO (COMPACTOS E RESUMIDOS)     */}
        {/* ========================================================================= */}
        <div className="lg:col-span-7 flex flex-col">
          {/* Header da Lista de Cards com Busca Compacta */}
          <div className="flex items-center justify-between gap-3 mb-3 bg-[#121215] p-2.5 rounded-2xl border border-zinc-800">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-white truncate">
                {selectedTier ? `Etapa: ${selectedTier.name}` : 'Todos os Condomínios'}
              </span>
              <span className="px-2 py-0.2 rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-300 tabular-nums">
                {displayedLeads.length}
              </span>
            </div>

            {/* Input de Busca */}
            <div className="relative min-w-[150px] max-w-xs">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar condomínio..."
                className="w-full pl-7 pr-6 py-1 bg-[#09090b] border border-zinc-800 focus:border-indigo-500 rounded-xl text-white placeholder-zinc-500 text-[11px] focus:outline-none transition-colors"
              />
              <svg className="w-3 h-3 text-zinc-500 absolute left-2 top-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1 text-zinc-500 hover:text-white text-[10px] cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Container Scrollável dos Cards em 2 Colunas (Lado a Lado) */}
          <div className="max-h-[calc(100vh-230px)] min-h-[380px] overflow-y-auto pr-1">
            {displayedLeads.length === 0 ? (
              <div className="text-center py-12 bg-[#121215]/80 border border-zinc-800/80 rounded-2xl p-6">
                <p className="text-xs text-zinc-400">
                  Nenhum condomínio encontrado nesta etapa ou com esta busca.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {displayedLeads.map((lead) => {
                  const leadContacts = getContactsForLead(lead.id);
                  const waCount = leadContacts.filter((c) => c.phone).length;
                  const emCount = leadContacts.filter((c) => c.email).length;
                  const hasFolder = Boolean(getLeadFolderLink(lead.id));
                  const leadInteractionsCount = interactions.filter((i) => i.lead_id === lead.id).length;
                  const stageName = lead.current_stage_id
                    ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial';

                  const getTempBadgeStyle = (temp?: string | null) => {
                    const norm = (temp || 'morno').trim().toLowerCase();
                    if (norm === 'frio') return 'bg-sky-950/80 text-sky-300 border border-sky-800/60';
                    if (norm === 'quente') return 'bg-rose-950/80 text-rose-300 border border-rose-800/60';
                    if (norm === 'cliente') return 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60';
                    return 'bg-amber-950/80 text-amber-300 border border-amber-800/60';
                  };

                  const getCardBgClasses = (temp?: string | null) => {
                    const norm = (temp || 'morno').trim().toLowerCase();
                    if (norm === 'frio') return 'bg-[#0e1626]/80 hover:bg-[#0e1626] border-sky-900/50';
                    if (norm === 'quente') return 'bg-[#220d14]/80 hover:bg-[#220d14] border-rose-900/50';
                    if (norm === 'cliente') return 'bg-[#091e17]/80 hover:bg-[#091e17] border-emerald-900/50';
                    return 'bg-[#1f1709]/80 hover:bg-[#1f1709] border-amber-900/50';
                  };

                  return (
                    <div
                      key={lead.id}
                      className={`p-3 rounded-2xl border transition-all hover:shadow-md flex flex-col justify-between ${getCardBgClasses(lead.temperature)}`}
                    >
                      <div>
                        {/* Linha 1: Nome do Condomínio */}
                        <h5
                          onClick={() => onOpenLead(lead.id)}
                          className="font-bold text-xs text-white hover:text-indigo-400 cursor-pointer truncate mb-1.5"
                          title={lead.name}
                        >
                          {lead.name}
                        </h5>

                        {/* Linha 2: Temperatura + Status da Etapa */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${getTempBadgeStyle(lead.temperature)}`}>
                            {lead.temperature || 'Morno'}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-700/70 text-[10px] text-zinc-300 font-medium truncate max-w-[125px]"
                            title={stageName}
                          >
                            {stageName}
                          </span>
                        </div>
                      </div>

                      {/* Linha 3: Rodapé de Atalhos e Botão + (Apenas UMA linha divisória) */}
                      <CardQuickActions
                        lead={lead}
                        notesCount={leadInteractionsCount}
                        waCount={waCount}
                        emCount={emCount}
                        hasFolderLink={hasFolder}
                        onOpenTimeline={() => onOpenTimeline(lead)}
                        onOpenWhatsApp={() => onOpenWhatsApp(lead)}
                        onOpenEmail={() => onOpenEmail(lead)}
                        onOpenFolder={() => onOpenFolder(lead)}
                        onOpenNotes={() => onOpenNotes(lead)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
