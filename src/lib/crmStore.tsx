import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabase.ts';
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

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  is_lost?: boolean | null;
}

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [leadServices, setLeadServices] = useState<LeadServiceRelation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leadContacts, setLeadContacts] = useState<LeadContactRelation[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);

  // Parallel optimized data fetching
  const refreshAll = useCallback(async (silent = false) => {
    if (!silent && !hasLoadedOnce) {
      setIsInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

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
        supabase.from('pipeline_stages').select('id, name, position, is_lost').order('position', { ascending: true }),
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

      if (stagesRes.data) setStages(stagesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (servicesRes.data) setServices(servicesRes.data);
      if (leadsRes.data) setLeads(leadsRes.data);
      if (leadServicesRes.data) setLeadServices(leadServicesRes.data);
      if (contactsRes.data) setContacts(contactsRes.data);
      if (leadContactsRes.data) setLeadContacts(leadContactsRes.data);
      if (interactionsRes.data) setInteractions(interactionsRes.data);

      setHasLoadedOnce(true);
    } catch (err: any) {
      console.error('Error in CRM data loading:', err);
      setError(err?.message || 'Erro ao carregar dados do CRM.');
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, [hasLoadedOnce]);

  // Initial load when profile is ready
  useEffect(() => {
    if (currentProfile) {
      refreshAll(false);
    }
  }, [currentProfile, refreshAll]);

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
