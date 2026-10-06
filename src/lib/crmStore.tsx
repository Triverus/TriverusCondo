import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from './supabase.ts';
import type { UserProfile } from '../App.tsx';
import {
  loadCRMCache,
  saveCRMCache,
  getLeadTemperatureOverrides,
  saveLeadTemperatureOverride,
  getLeadStageOverrides,
  saveLeadStageOverride,
  getLeadLossReasonOverrides,
  getInteractionTypeOverrides,
  saveInteractionTypeOverride,
  type CRMPersistentData,
} from './crmCache.ts';

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

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  is_won?: boolean | null;
  is_lost?: boolean | null;
}

export const OFFICIAL_PIPELINE_STAGES: Omit<PipelineStage, 'id'>[] = [
  { name: 'Início', position: 1, is_won: false, is_lost: false },
  { name: 'Reunião', position: 2, is_won: false, is_lost: false },
  { name: 'Proposta', position: 3, is_won: false, is_lost: false },
  { name: 'Negociação', position: 4, is_won: false, is_lost: false },
  { name: 'Contrato', position: 5, is_won: false, is_lost: false },
  { name: 'Cliente', position: 6, is_won: true, is_lost: false },
  { name: 'Perdido', position: 7, is_won: false, is_lost: true },
];

export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  { id: 'stg_inicio', name: 'Início', position: 1, is_won: false, is_lost: false },
  { id: 'stg_reuniao', name: 'Reunião', position: 2, is_won: false, is_lost: false },
  { id: 'stg_proposta', name: 'Proposta', position: 3, is_won: false, is_lost: false },
  { id: 'stg_negociacao', name: 'Negociação', position: 4, is_won: false, is_lost: false },
  { id: 'stg_contrato', name: 'Contrato', position: 5, is_won: false, is_lost: false },
  { id: 'stg_cliente', name: 'Cliente', position: 6, is_won: true, is_lost: false },
  { id: 'stg_perdido', name: 'Perdido', position: 7, is_won: false, is_lost: true },
];

export const DEFAULT_TEAM_PROFILES: UserProfile[] = [
  { id: 'usr_edson', full_name: 'Edson', role: 'member' },
  { id: 'usr_jailma', full_name: 'Jailma', role: 'member' },
  { id: 'usr_rogerio', full_name: 'Rogerio', role: 'member' },
];

export interface ServiceItem {
  id: string;
  name?: string | null;
  title?: string | null;
}

export interface LeadServiceRelation {
  lead_id: string;
  service_id: string;
}

export interface Contact {
  id: string;
  name: string;
  role_title?: string | null;
  phone?: string | null;
  email?: string | null;
  created_at?: string;
}

export interface LeadContactRelation {
  lead_id: string;
  contact_id: string;
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

interface CRMContextType {
  leads: Lead[];
  stages: PipelineStage[];
  profiles: UserProfile[];
  services: ServiceItem[];
  leadServices: LeadServiceRelation[];
  contacts: Contact[];
  leadContacts: LeadContactRelation[];
  interactions: Interaction[];
  isInitialLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  stageMap: Map<string, string>;
  profileMap: Map<string, string>;
  serviceMap: Map<string, string>;
  leadMap: Map<string, Lead>;
  refreshAll: (silent?: boolean) => Promise<void>;
  upsertLeadLocally: (lead: Lead, serviceIds?: string[]) => void;
  upsertContactLocally: (contact: Contact, leadIds?: string[]) => void;
  upsertInteractionLocally: (interaction: Interaction) => void;
  deleteContactLocally: (contactId: string) => void;
  deleteInteractionLocally: (interactionId: string) => void;
  deleteLeadLocally: (leadId: string) => void;
  getLeadServices: (leadId: string) => string[];
  getContactsForLead: (leadId: string) => Contact[];
  getContactLeadIds: (contactId: string) => string[];
  getInteractionsForLead: (leadId: string) => Interaction[];
}

const CRMContext = createContext<CRMContextType | null>(null);

export function CRMProvider({
  children,
  currentProfile,
}: {
  children: React.ReactNode;
  currentProfile: UserProfile | null;
}) {
  // ETAPA 1: Ler o cache persistente imediatamente de forma síncrona
  const initialCacheRef = useRef<CRMPersistentData | null>(null);
  if (initialCacheRef.current === null) {
    initialCacheRef.current = loadCRMCache();
  }
  const cached = initialCacheRef.current;
  const hasCachedData = Boolean(cached && cached.stages && cached.stages.length > 0);

  // ETAPA 2: Inicializar o estado com o cache para renderizar no frame 0 sem spinner
  const [leads, setLeads] = useState<Lead[]>(() => cached?.leads || []);
  const [stages, setStages] = useState<PipelineStage[]>(() => (cached?.stages && cached.stages.length > 0) ? cached.stages : DEFAULT_PIPELINE_STAGES);
  const [profiles, setProfiles] = useState<UserProfile[]>(() => (cached?.profiles && cached.profiles.length > 0) ? cached.profiles : (currentProfile ? [currentProfile] : []));
  const [services, setServices] = useState<ServiceItem[]>(() => cached?.services || []);
  const [leadServices, setLeadServices] = useState<LeadServiceRelation[]>(() => cached?.leadServices || []);
  const [contacts, setContacts] = useState<Contact[]>(() => cached?.contacts || []);
  const [leadContacts, setLeadContacts] = useState<LeadContactRelation[]>(() => cached?.leadContacts || []);
  const [interactions, setInteractions] = useState<Interaction[]>(() => cached?.interactions || []);

  // Se já temos cache, não bloqueamos a interface com loading
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(!hasCachedData);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(hasCachedData);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const loadingPromiseRef = useRef<Promise<void> | null>(null);

  // Parallel optimized data fetching with in-flight deduplication
  const refreshAll = useCallback(async (silent = false) => {
    if (loadingPromiseRef.current) {
      return loadingPromiseRef.current;
    }
    if (!silent && !hasLoadedOnceRef.current && !hasCachedData) {
      setIsInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    const promise = (async () => {
      try {
        // Execute all independent queries in parallel with precise column selection
        const [
          stagesRes,
          profilesRes,
          servicesRes,
          leadsRes,
          leadServicesRes,
          contactsRes,
          leadContactsRes,
          interactionsRes,
        ] = await Promise.all([
          supabase.from('pipeline_stages').select('id, name, position, is_won, is_lost').order('position', { ascending: true }),
          supabase.from('profiles').select('id, full_name, role'),
          supabase.from('services').select('id, name, title'),
          supabase
            .from('leads')
            .select('id, name, cnpj, condominium_type, administrator, unit_count, address, city, lead_source, temperature, current_stage_id, responsible_user_id, loss_reason, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('lead_services').select('lead_id, service_id'),
          supabase.from('contacts').select('id, name, role_title, phone, email, created_at').order('name', { ascending: true }),
          supabase.from('lead_contacts').select('lead_id, contact_id'),
          supabase
            .from('interactions')
            .select('id, lead_id, interaction_type, occurred_at, notes, responsible_user_id, next_follow_up_date, created_at')
            .order('occurred_at', { ascending: false }),
        ]);

        const nextProfiles = profilesRes.data || [];
        const nextServices = servicesRes.data || [];
        const nextLeads = leadsRes.data || [];
        const nextLeadServices = leadServicesRes.data || [];
        const nextContacts = contactsRes.data || [];
        const nextLeadContacts = leadContactsRes.data || [];
        const nextInteractions = interactionsRes.data || [];

        let nextStages: PipelineStage[] = DEFAULT_PIPELINE_STAGES;

        if (stagesRes.data && stagesRes.data.length >= 7) {
          const sorted = [...stagesRes.data].sort((a, b) => (a.position || 0) - (b.position || 0));
          const updatedStages: PipelineStage[] = [];

          sorted.forEach((stg, idx) => {
            const official = OFFICIAL_PIPELINE_STAGES[idx] || OFFICIAL_PIPELINE_STAGES[OFFICIAL_PIPELINE_STAGES.length - 1];
            const needsUpdate =
              stg.name !== official.name ||
              stg.position !== official.position ||
              Boolean(stg.is_won) !== Boolean(official.is_won) ||
              Boolean(stg.is_lost) !== Boolean(official.is_lost);

            const unifiedStage: PipelineStage = {
              id: stg.id,
              name: official.name,
              position: official.position,
              is_won: official.is_won,
              is_lost: official.is_lost,
            };

            updatedStages.push(unifiedStage);

            if (needsUpdate) {
              (async () => {
                try {
                  await supabase
                    .from('pipeline_stages')
                    .update({
                      name: official.name,
                      position: official.position,
                      is_won: official.is_won,
                      is_lost: official.is_lost,
                    })
                    .eq('id', stg.id);
                } catch (err) {
                  console.warn('Stage rename sync notice:', err);
                }
              })();
            }
          });

          nextStages = updatedStages;
        } else if (stagesRes.data && stagesRes.data.length > 0) {
          nextStages = stagesRes.data;
        }

        setStages(nextStages);

        // Merge fetched profiles with default team profiles (Edson, Jailma, Rogerio)
        const fetchedProfiles = profilesRes.data || [];
        const profileMapById = new Map<string, UserProfile>();
        DEFAULT_TEAM_PROFILES.forEach((p) => profileMapById.set(p.id, p));
        if (currentProfile) profileMapById.set(currentProfile.id, currentProfile);
        fetchedProfiles.forEach((p) => profileMapById.set(p.id, p));
        const mergedProfiles = Array.from(profileMapById.values());
        setProfiles(mergedProfiles);

        if (servicesRes.data) setServices(nextServices);
        if (leadsRes.data) {
          const stageOverrides = getLeadStageOverrides();
          const lossOverrides = getLeadLossReasonOverrides();
          const defaultStageId = nextStages[0]?.id || '';

          const validStageIds = new Set(nextStages.map((s) => s.id));

          const leadsMapped = nextLeads.map((lead) => {
            let updated = { ...lead };
            const overriddenStage = stageOverrides[lead.id];
            if (overriddenStage && validStageIds.has(overriddenStage)) {
              updated.current_stage_id = overriddenStage;
            } else if (lead.current_stage_id && validStageIds.has(lead.current_stage_id)) {
              updated.current_stage_id = lead.current_stage_id;
            } else if (lead.current_stage_id) {
              updated.current_stage_id = lead.current_stage_id;
            } else {
              updated.current_stage_id = defaultStageId;
            }

            if (lossOverrides[lead.id] !== undefined) {
              updated.loss_reason = lossOverrides[lead.id];
            }
            return updated;
          });
          setLeads(leadsMapped);
        }
        if (leadServicesRes.data) setLeadServices(nextLeadServices);
        if (contactsRes.data) setContacts(nextContacts);
        if (leadContactsRes.data) setLeadContacts(nextLeadContacts);
        if (interactionsRes.data) {
          const intOverrides = getInteractionTypeOverrides();
          const interactionsWithOverrides = nextInteractions.map((i) => {
            if (intOverrides[i.id]) {
              return { ...i, interaction_type: intOverrides[i.id] };
            }
            return i;
          });
          setInteractions(interactionsWithOverrides);
        }

        // ETAPA 4: Salvar no cache persistente do navegador
        saveCRMCache({
          leads: nextLeads,
          stages: nextStages,
          profiles: nextProfiles,
          services: nextServices,
          leadServices: nextLeadServices,
          contacts: nextContacts,
          leadContacts: nextLeadContacts,
          interactions: nextInteractions,
        });

        hasLoadedOnceRef.current = true;
      } catch (err: any) {
        console.error('Error in CRM data loading:', err);
        setError(err?.message || 'Erro ao carregar dados do CRM.');
      } finally {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        loadingPromiseRef.current = null;
      }
    })();

    loadingPromiseRef.current = promise;
    return promise;
  }, [hasCachedData]);

  // Initial load: ETAPA 3: consulta Supabase em background (silenciosa se já possui cache)
  useEffect(() => {
    if (currentProfile?.id && !hasLoadedOnceRef.current) {
      refreshAll(hasCachedData);
    }
  }, [currentProfile?.id, hasCachedData, refreshAll]);

  // Sincronizar qualquer mutação local no cache persistente (debounced para não travar a main thread)
  useEffect(() => {
    if (!hasLoadedOnceRef.current && !hasCachedData) return;
    if (stages.length === 0) return;

    const timer = setTimeout(() => {
      saveCRMCache({
        leads,
        stages,
        profiles,
        services,
        leadServices,
        contacts,
        leadContacts,
        interactions,
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [leads, stages, profiles, services, leadServices, contacts, leadContacts, interactions, hasCachedData]);

  // Lookup maps for O(1) reads
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

  const serviceMap = useMemo(() => {
    const map = new Map<string, string>();
    services.forEach((s) => map.set(s.id, s.name || s.title || 'Serviço'));
    return map;
  }, [services]);

  const leadMap = useMemo(() => {
    const map = new Map<string, Lead>();
    leads.forEach((l) => map.set(l.id, l));
    return map;
  }, [leads]);

  // Helper selectors
  const getLeadServices = useCallback(
    (leadId: string): string[] => {
      return leadServices
        .filter((ls) => ls.lead_id === leadId)
        .map((ls) => ls.service_id);
    },
    [leadServices]
  );

  const getContactsForLead = useCallback(
    (leadId: string): Contact[] => {
      const contactIds = leadContacts
        .filter((lc) => lc.lead_id === leadId)
        .map((lc) => lc.contact_id);
      return contacts.filter((c) => contactIds.includes(c.id));
    },
    [leadContacts, contacts]
  );

  const getContactLeadIds = useCallback(
    (contactId: string): string[] => {
      return leadContacts
        .filter((lc) => lc.contact_id === contactId)
        .map((lc) => lc.lead_id);
    },
    [leadContacts]
  );

  const getInteractionsForLead = useCallback(
    (leadId: string): Interaction[] => {
      return interactions
        .filter((i) => i.lead_id === leadId)
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    },
    [interactions]
  );

  // Optimistic / Local upserts
  const upsertLeadLocally = useCallback((lead: Lead, serviceIds?: string[]) => {
    if (lead.id && lead.temperature) {
      saveLeadTemperatureOverride(lead.id, lead.temperature);
    }
    setLeads((prev) => {
      const idx = prev.findIndex((l) => l.id === lead.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = lead;
        return next;
      }
      return [lead, ...prev];
    });

    if (serviceIds) {
      setLeadServices((prev) => {
        const filtered = prev.filter((ls) => ls.lead_id !== lead.id);
        const added = serviceIds.map((sId) => ({ lead_id: lead.id, service_id: sId }));
        return [...filtered, ...added];
      });
    }
  }, []);

  const upsertContactLocally = useCallback((contact: Contact, leadIds?: string[]) => {
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === contact.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = contact;
        return next.sort((a, b) => a.name.localeCompare(b.name));
      }
      return [...prev, contact].sort((a, b) => a.name.localeCompare(b.name));
    });

    if (leadIds) {
      setLeadContacts((prev) => {
        const filtered = prev.filter((lc) => lc.contact_id !== contact.id);
        const added = leadIds.map((lId) => ({ lead_id: lId, contact_id: contact.id }));
        return [...filtered, ...added];
      });
    }
  }, []);

  const upsertInteractionLocally = useCallback((interaction: Interaction) => {
    if (interaction.id && interaction.interaction_type) {
      saveInteractionTypeOverride(interaction.id, interaction.interaction_type);
    }
    setInteractions((prev) => {
      const idx = prev.findIndex((i) => i.id === interaction.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = interaction;
        return next.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
      }
      return [interaction, ...prev].sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );
    });
  }, []);

  const deleteContactLocally = useCallback((contactId: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    setLeadContacts((prev) => prev.filter((lc) => lc.contact_id !== contactId));
  }, []);

  const deleteInteractionLocally = useCallback((interactionId: string) => {
    setInteractions((prev) => prev.filter((i) => i.id !== interactionId));
  }, []);

  const deleteLeadLocally = useCallback((leadId: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    setLeadServices((prev) => prev.filter((ls) => ls.lead_id !== leadId));
    setLeadContacts((prev) => prev.filter((lc) => lc.lead_id !== leadId));
    setInteractions((prev) => prev.filter((i) => i.lead_id !== leadId));
  }, []);

  const value = useMemo<CRMContextType>(
    () => ({
      leads,
      stages,
      profiles,
      services,
      leadServices,
      contacts,
      leadContacts,
      interactions,
      isInitialLoading,
      isRefreshing,
      error,
      stageMap,
      profileMap,
      serviceMap,
      leadMap,
      refreshAll,
      upsertLeadLocally,
      upsertContactLocally,
      upsertInteractionLocally,
      deleteContactLocally,
      deleteInteractionLocally,
      deleteLeadLocally,
      getLeadServices,
      getContactsForLead,
      getContactLeadIds,
      getInteractionsForLead,
    }),
    [
      leads,
      stages,
      profiles,
      services,
      leadServices,
      contacts,
      leadContacts,
      interactions,
      isInitialLoading,
      isRefreshing,
      error,
      stageMap,
      profileMap,
      serviceMap,
      leadMap,
      refreshAll,
      upsertLeadLocally,
      upsertContactLocally,
      upsertInteractionLocally,
      deleteContactLocally,
      deleteInteractionLocally,
      deleteLeadLocally,
      getLeadServices,
      getContactsForLead,
      getContactLeadIds,
      getInteractionsForLead,
    ]
  );

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const context = useContext(CRMContext);
  if (!context) {
    throw new Error('useCRM must be used within a CRMProvider');
  }
  return context;
}
