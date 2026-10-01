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

export interface ContactSummary {
  id: string;
  name: string;
  role_title?: string | null;
  phone?: string | null;
  email?: string | null;
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

interface LeadsModuleProps {
  currentProfile: UserProfile;
  initialSelectedLeadId?: string | null;
  onClearInitialLead?: () => void;
}

export const INTERACTION_TYPES = [
  'Ligação',
  'Reunião',
  'WhatsApp',
  'E-mail',
  'Evento BNI',
] as const;

function getFollowUpStatus(dateStr?: string | null): 'overdue' | 'today' | 'upcoming' | null {
  if (!dateStr) return null;
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

function formatDateTimeBR(dateStr?: string | null): string {
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

function formatDateBR(dateStr?: string | null): string {
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

const CONDOMINIUM_TYPES = [
  'Residencial',
  'Comercial',
  'Associação de Moradores',
  'Misto',
];

const LEAD_SOURCES = [
  'Indicação (BNI/rede)',
  'Prospecção ativa',
  'Conteúdo/Marketing',
  'Outro',
];

const TEMPERATURE_OPTIONS = ['Quente', 'Morno', 'Frio'];

export default function LeadsModule({
  currentProfile,
  initialSelectedLeadId,
  onClearInitialLead,
}: LeadsModuleProps) {
  // Data states
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [leadServices, setLeadServices] = useState<LeadServiceRelation[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [leadContacts, setLeadContacts] = useState<LeadContactRelation[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  // Loading and error states
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Form field states for Lead
  const [formName, setFormName] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formCondominiumType, setFormCondominiumType] = useState('Residencial');
  const [formAdministrator, setFormAdministrator] = useState('');
  const [formUnitCount, setFormUnitCount] = useState<string>('');
  const [formAddress, setFormAddress] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formLeadSource, setFormLeadSource] = useState('Indicação (BNI/rede)');
  const [formTemperature, setFormTemperature] = useState('Morno');
  const [formCurrentStageId, setFormCurrentStageId] = useState('');
  const [formResponsibleUserId, setFormResponsibleUserId] = useState('');
  const [formLossReason, setFormLossReason] = useState('');
  const [formSelectedServices, setFormSelectedServices] = useState<string[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Interaction Modal States
  const [interactionModalMode, setInteractionModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);
  const [formInteractionType, setFormInteractionType] = useState<string>('Ligação');
  const [formInteractionOccurredAt, setFormInteractionOccurredAt] = useState<string>('');
  const [formInteractionResponsibleId, setFormInteractionResponsibleId] = useState<string>('');
  const [formInteractionNotes, setFormInteractionNotes] = useState<string>('');
  const [formInteractionNextFollowUpDate, setFormInteractionNextFollowUpDate] = useState<string>('');
  const [formInteractionSaving, setFormInteractionSaving] = useState<boolean>(false);
  const [formInteractionError, setFormInteractionError] = useState<string | null>(null);

  // Load all necessary initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Load pipeline stages ordered by position
      const stagesRes = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('position', { ascending: true });
      const stagesList = stagesRes.data || [];
      setStages(stagesList);

      // 2. Load profiles
      const profilesRes = await supabase
        .from('profiles')
        .select('id, full_name, role');
      const profilesList = profilesRes.data || [];
      setProfiles(profilesList);

      // 3. Load services dynamically
      const servicesRes = await supabase
        .from('services')
        .select('*');
      const servicesList = servicesRes.data || [];
      setServices(servicesList);

      // 4. Load leads
      const leadsRes = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      const leadsList = leadsRes.data || [];
      setLeads(leadsList);

      // 5. Load lead_services relations
      const leadServicesRes = await supabase
        .from('lead_services')
        .select('lead_id, service_id');
      setLeadServices(leadServicesRes.data || []);

      // 6. Load contacts and lead_contacts relations
      const contactsRes = await supabase
        .from('contacts')
        .select('id, name, role_title, phone, email');
      setContacts(contactsRes.data || []);

      const leadContactsRes = await supabase
        .from('lead_contacts')
        .select('lead_id, contact_id');
      setLeadContacts(leadContactsRes.data || []);

      // 7. Load interactions
      const interactionsRes = await supabase
        .from('interactions')
        .select('*')
        .order('occurred_at', { ascending: false });
      setInteractions(interactionsRes.data || []);
    } catch (err: any) {
      console.error('Error loading CRM leads data:', err);
      setStatusFeedback({
        type: 'error',
        message: 'Erro ao carregar dados do Supabase. Verifique a conexão.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle initialSelectedLeadId if passed from Follow-ups
  useEffect(() => {
    if (initialSelectedLeadId && leads.length > 0) {
      const target = leads.find((l) => l.id === initialSelectedLeadId);
      if (target) {
        setSelectedLead(target);
        setModalMode('view');
      }
      if (onClearInitialLead) {
        onClearInitialLead();
      }
    }
  }, [initialSelectedLeadId, leads, onClearInitialLead]);

  // Lookup maps for fast and resilient rendering
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

  // Get services associated with a specific lead
  const getLeadServices = useCallback(
    (leadId: string): string[] => {
      return leadServices
        .filter((ls) => ls.lead_id === leadId)
        .map((ls) => ls.service_id);
    },
    [leadServices]
  );

  // Get contacts associated with a specific lead
  const getContactsForLead = useCallback(
    (leadId: string): ContactSummary[] => {
      const contactIds = leadContacts
        .filter((lc) => lc.lead_id === leadId)
        .map((lc) => lc.contact_id);
      return contacts.filter((c) => contactIds.includes(c.id));
    },
    [leadContacts, contacts]
  );

  // Filter leads by search term
  const filteredLeads = useMemo(() => {
    if (!searchTerm.trim()) return leads;
    const term = searchTerm.toLowerCase();
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.city && l.city.toLowerCase().includes(term)) ||
        (l.administrator && l.administrator.toLowerCase().includes(term))
    );
  }, [leads, searchTerm]);

  // Check if a stage represents "Perdido" using is_lost or fallback to name
  const checkIsLostStage = useCallback(
    (stageId?: string | null): boolean => {
      if (!stageId) return false;
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) return false;
      if (typeof stage.is_lost === 'boolean') {
        return stage.is_lost;
      }
      return (stage.name || '').toLowerCase().includes('perdid');
    },
    [stages]
  );

  // Handle stage change in form: if moved away from Lost, clear loss_reason
  const handleStageChange = (newStageId: string) => {
    setFormCurrentStageId(newStageId);
    if (!checkIsLostStage(newStageId)) {
      setFormLossReason('');
    }
  };

  // Open modal in create mode
  const handleOpenCreate = () => {
    setFormError(null);
    setFormName('');
    setFormCnpj('');
    setFormCondominiumType('Residencial');
    setFormAdministrator('');
    setFormUnitCount('');
    setFormAddress('');
    setFormCity('');
    setFormLeadSource('Indicação (BNI/rede)');
    setFormTemperature('Morno');
    // If no stage chosen, use first available
    const initialStageId = stages.length > 0 ? stages[0].id : '';
    setFormCurrentStageId(initialStageId);
    // Default responsible to current profile
    setFormResponsibleUserId(currentProfile.id);
    setFormLossReason('');
    setFormSelectedServices([]);
    setSelectedLead(null);
    setModalMode('create');
  };

  // Open modal in edit mode
  const handleOpenEdit = (lead: Lead) => {
    setFormError(null);
    setFormName(lead.name || '');
    setFormCnpj(lead.cnpj || '');
    setFormCondominiumType(lead.condominium_type || 'Residencial');
    setFormAdministrator(lead.administrator || '');
    setFormUnitCount(lead.unit_count != null ? String(lead.unit_count) : '');
    setFormAddress(lead.address || '');
    setFormCity(lead.city || '');
    setFormLeadSource(lead.lead_source || 'Indicação (BNI/rede)');
    setFormTemperature(lead.temperature || 'Morno');
    const stageId = lead.current_stage_id || (stages.length > 0 ? stages[0].id : '');
    setFormCurrentStageId(stageId);
    setFormResponsibleUserId(lead.responsible_user_id || currentProfile.id);
    const isStageLost = checkIsLostStage(stageId);
    setFormLossReason(isStageLost ? (lead.loss_reason || '') : '');
    setFormSelectedServices(getLeadServices(lead.id));
    setSelectedLead(lead);
    setModalMode('edit');
  };

  // Get interactions for a specific lead
  const getInteractionsForLead = useCallback(
    (leadId: string): Interaction[] => {
      return interactions
        .filter((i) => i.lead_id === leadId)
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    },
    [interactions]
  );

  // Open modal in view mode
  const handleOpenView = (lead: Lead) => {
    setSelectedLead(lead);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setSelectedLead(null);
    setFormError(null);
  };

  // Interaction handlers
  const handleOpenCreateInteraction = (lead: Lead) => {
    setFormInteractionError(null);
    setSelectedInteraction(null);
    setFormInteractionType('Ligação');
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    setFormInteractionOccurredAt(localISOTime);
    setFormInteractionResponsibleId(currentProfile.id);
    setFormInteractionNotes('');
    setFormInteractionNextFollowUpDate('');
    setInteractionModalMode('create');
  };

  const handleOpenEditInteraction = (interaction: Interaction) => {
    setFormInteractionError(null);
    setSelectedInteraction(interaction);
    setFormInteractionType(interaction.interaction_type || 'Ligação');
    let dateStr = '';
    if (interaction.occurred_at) {
      const d = new Date(interaction.occurred_at);
      const tzOffset = d.getTimezoneOffset() * 60000;
      dateStr = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    }
    setFormInteractionOccurredAt(dateStr);
    setFormInteractionResponsibleId(interaction.responsible_user_id || currentProfile.id);
    setFormInteractionNotes(interaction.notes || '');
    setFormInteractionNextFollowUpDate(
      interaction.next_follow_up_date ? interaction.next_follow_up_date.slice(0, 10) : ''
    );
    setInteractionModalMode('edit');
  };

  const handleCloseInteractionModal = () => {
    setInteractionModalMode(null);
    setSelectedInteraction(null);
    setFormInteractionError(null);
  };

  const handleSubmitInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setFormInteractionError(null);
    setFormInteractionSaving(true);

    try {
      const occurredAtIso = formInteractionOccurredAt
        ? new Date(formInteractionOccurredAt).toISOString()
        : new Date().toISOString();

      const payload = {
        lead_id: selectedLead.id,
        interaction_type: formInteractionType,
        occurred_at: occurredAtIso,
        responsible_user_id: formInteractionResponsibleId || currentProfile.id,
        notes: formInteractionNotes.trim() || null,
        next_follow_up_date: formInteractionNextFollowUpDate ? formInteractionNextFollowUpDate : null,
      };

      if (interactionModalMode === 'create') {
        const { data, error } = await supabase
          .from('interactions')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        if (data) {
          setInteractions((prev) => [data, ...prev]);
        }
        setStatusFeedback({
          type: 'success',
          message: 'Interação registrada com sucesso!',
        });
      } else if (interactionModalMode === 'edit' && selectedInteraction) {
        const { data, error } = await supabase
          .from('interactions')
          .update(payload)
          .eq('id', selectedInteraction.id)
          .select()
          .single();
        if (error) throw error;
        if (data) {
          setInteractions((prev) =>
            prev.map((item) => (item.id === selectedInteraction.id ? data : item))
          );
        }
        setStatusFeedback({
          type: 'success',
          message: 'Interação atualizada com sucesso!',
        });
      }

      handleCloseInteractionModal();
    } catch (err: any) {
      console.error('Error saving interaction:', err);
      setFormInteractionError(err.message || 'Erro ao salvar interação no Supabase.');
    } finally {
      setFormInteractionSaving(false);
    }
  };

  const getInteractionTypeBadge = (type: string) => {
    switch (type) {
      case 'WhatsApp':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-medium">
            WhatsApp
          </span>
        );
      case 'Reunião':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950/80 border border-purple-700/60 text-purple-300 font-medium">
            Reunião
          </span>
        );
      case 'E-mail':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950/80 border border-sky-700/60 text-sky-300 font-medium">
            E-mail
          </span>
        );
      case 'Evento BNI':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 border border-amber-700/60 text-amber-300 font-medium">
            Evento BNI
          </span>
        );
      case 'Ligação':
      default:
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 font-medium">
            Ligação
          </span>
        );
    }
  };

  // Toggle service selection in form
  const toggleService = (serviceId: string) => {
    setFormSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // Save Lead (Create or Edit)
  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Validate mandatory field: name
    if (!formName.trim()) {
      setFormError('O nome do condomínio é obrigatório.');
      return;
    }

    // 1. Validate mandatory field: unit_count
    const unitCountTrimmed = formUnitCount.trim();
    if (!unitCountTrimmed) {
      setFormError('O número de unidades é obrigatório.');
      return;
    }
    const unitCountNum = parseInt(unitCountTrimmed, 10);
    if (isNaN(unitCountNum) || unitCountNum <= 0) {
      setFormError('O número de unidades deve ser um valor numérico válido maior que zero.');
      return;
    }

    const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
    const isStageLost = checkIsLostStage(stageIdToUse);

    // 2. Validate mandatory loss_reason if stage is Lost
    if (isStageLost && !formLossReason.trim()) {
      setFormError('O preenchimento do motivo de perda é obrigatório quando o estágio for Perdido.');
      return;
    }

    setFormSaving(true);

    try {
      const leadPayload = {
        name: formName.trim(),
        cnpj: formCnpj.trim() || null,
        condominium_type: formCondominiumType || null,
        administrator: formAdministrator.trim() || null,
        unit_count: unitCountNum,
        address: formAddress.trim() || null,
        city: formCity.trim() || null,
        lead_source: formLeadSource || null,
        temperature: formTemperature || null,
        current_stage_id: stageIdToUse,
        responsible_user_id: formResponsibleUserId || null,
        loss_reason: isStageLost ? formLossReason.trim() : null,
      };

      if (modalMode === 'create') {
        // Insert lead
        const { data: newLead, error: insertError } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        // Insert junction rows in lead_services
        if (newLead?.id && formSelectedServices.length > 0) {
          const serviceRows = formSelectedServices.map((serviceId) => ({
            lead_id: newLead.id,
            service_id: serviceId,
          }));
          const { error: relError } = await supabase
            .from('lead_services')
            .insert(serviceRows);
          if (relError) {
            console.warn('Warning inserting lead_services:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Lead "${leadPayload.name}" cadastrado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedLead) {
        // Update lead
        const { error: updateError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', selectedLead.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Sync lead_services: delete existing then insert new
        await supabase
          .from('lead_services')
          .delete()
          .eq('lead_id', selectedLead.id);

        if (formSelectedServices.length > 0) {
          const serviceRows = formSelectedServices.map((serviceId) => ({
            lead_id: selectedLead.id,
            service_id: serviceId,
          }));
          const { error: relError } = await supabase
            .from('lead_services')
            .insert(serviceRows);
          if (relError) {
            console.warn('Warning syncing lead_services:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Lead "${leadPayload.name}" atualizado com sucesso!`,
        });
      }

      handleCloseModal();
      await loadData();
    } catch (err: any) {
      console.error('Error saving lead:', err);
      setFormError(err.message || 'Erro ao salvar o lead. Tente novamente.');
    } finally {
      setFormSaving(false);
    }
  };

  // Temperature color helper
  const getTemperatureBadge = (temp?: string | null) => {
    switch (temp) {
      case 'Quente':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            Quente
          </span>
        );
      case 'Morno':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Morno
          </span>
        );
      case 'Frio':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            Frio
          </span>
        );
      default:
        return (
          <span className="text-xs text-slate-400">
            {temp || 'Não definido'}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Leads
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestão comercial de condomínios e oportunidades
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <svg
              className="w-4 h-4 mr-2"
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
            Novo lead
          </button>
        </div>
      </div>

      {/* Status Feedback banner */}
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

      {/* Search and stats bar */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
            placeholder="Buscar condomínio por nome ou cidade..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-white"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Total:</span>
          <span className="font-semibold text-white px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
            {leads.length} {leads.length === 1 ? 'condomínio' : 'condomínios'}
          </span>
        </div>
      </div>

      {/* Main Table / List */}
      <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Carregando lista de condomínios...</p>
          </div>
        ) : filteredLeads.length === 0 ? (
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h3 className="text-base font-medium text-white mb-1">
              {searchTerm ? 'Nenhum lead encontrado' : 'Nenhum lead cadastrado ainda'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
              {searchTerm
                ? 'Tente ajustar os termos da sua pesquisa para encontrar o condomínio.'
                : 'Cadastre seu primeiro condomínio para iniciar o acompanhamento comercial.'}
            </p>
            {!searchTerm && (
              <button
                onClick={handleOpenCreate}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Cadastrar primeiro lead
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3.5 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Cidade</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Tipo</th>
                  <th className="py-3.5 px-4">Temperatura</th>
                  <th className="py-3.5 px-4">Estágio</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Responsável</th>
                  <th className="py-3.5 px-4 hidden xl:table-cell">Criação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredLeads.map((lead) => {
                  const stageName = lead.current_stage_id
                    ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial';
                  const responsibleName = lead.responsible_user_id
                    ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
                    : 'Não atribuído';
                  const createdDate = lead.created_at
                    ? new Date(lead.created_at).toLocaleDateString('pt-BR')
                    : '-';

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <div className="flex flex-col">
                          <span>{lead.name}</span>
                          {lead.administrator && (
                            <span className="text-[11px] text-slate-400">
                              Adm: {lead.administrator}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden md:table-cell">
                        {lead.city || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden lg:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60">
                          {lead.condominium_type || 'Residencial'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {getTemperatureBadge(lead.temperature)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-xs font-medium text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 px-2 py-0.5 rounded">
                          {stageName}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300 uppercase font-semibold">
                            {responsibleName.charAt(0)}
                          </span>
                          <span className="text-xs truncate max-w-[130px]">
                            {responsibleName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-xs hidden xl:table-cell">
                        {createdDate}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenView(lead)}
                            title="Visualizar detalhes"
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
                          <button
                            onClick={() => handleOpenEdit(lead)}
                            title="Editar lead"
                            className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 transition-colors cursor-pointer"
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
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
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

      {/* Modal / Drawer for Create & Edit */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {modalMode === 'create' ? 'Novo Condomínio (Lead)' : 'Editar Condomínio'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Preencha as informações cadastrais e comerciais
                </p>
              </div>
              <button
                onClick={handleCloseModal}
                disabled={formSaving}
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

            {/* Error Message */}
            {formError && (
              <div className="mx-6 mt-4 p-3 bg-rose-950/80 border border-rose-500/50 rounded-lg text-rose-200 text-xs flex items-center gap-2">
                <span className="font-bold">Erro:</span>
                <span>{formError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmitLead} className="p-6 space-y-6">
              {/* Section 1: Dados do Condomínio */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400 mb-3">
                  1. Dados do Condomínio
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Nome do Condomínio <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Condomínio Edifício Solar das Flores"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={formCnpj}
                      onChange={(e) => setFormCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Tipo de Condomínio
                    </label>
                    <select
                      value={formCondominiumType}
                      onChange={(e) => setFormCondominiumType(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {CONDOMINIUM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Administradora
                    </label>
                    <input
                      type="text"
                      value={formAdministrator}
                      onChange={(e) => setFormAdministrator(e.target.value)}
                      placeholder="Ex: Lello, Hub, etc."
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Quantidade de Unidades <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formUnitCount}
                      onChange={(e) => setFormUnitCount(e.target.value)}
                      placeholder="Ex: 84"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Cidade
                    </label>
                    <input
                      type="text"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      placeholder="Ex: São Paulo"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Endereço
                    </label>
                    <input
                      type="text"
                      value={formAddress}
                      onChange={(e) => setFormAddress(e.target.value)}
                      placeholder="Rua, número, bairro"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Qualificação Comercial */}
              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400 mb-3">
                  2. Qualificação Comercial
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Origem do Lead
                    </label>
                    <select
                      value={formLeadSource}
                      onChange={(e) => setFormLeadSource(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {LEAD_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Temperatura
                    </label>
                    <select
                      value={formTemperature}
                      onChange={(e) => setFormTemperature(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {TEMPERATURE_OPTIONS.map((temp) => (
                        <option key={temp} value={temp}>
                          {temp}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Estágio do Pipeline
                    </label>
                    <select
                      value={formCurrentStageId}
                      onChange={(e) => handleStageChange(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                      {stages.length === 0 && (
                        <option value="">Carregando estágios...</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Responsável Comercial
                    </label>
                    <select
                      value={formResponsibleUserId}
                      onChange={(e) => setFormResponsibleUserId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {profiles.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.full_name || 'Sem nome'} ({prof.role || 'user'})
                        </option>
                      ))}
                      {profiles.length === 0 && (
                        <option value={currentProfile.id}>
                          {currentProfile.full_name || 'Meu usuário'}
                        </option>
                      )}
                    </select>
                  </div>

                  {checkIsLostStage(formCurrentStageId) && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-rose-300 mb-1">
                        Motivo de Perda <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formLossReason}
                        onChange={(e) => setFormLossReason(e.target.value)}
                        placeholder="Informe o motivo pelo qual o lead foi perdido..."
                        className="w-full px-3 py-2 bg-slate-800 border border-rose-500/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Tipos de Trabalho / Serviços (múltipla seleção) */}
              <div className="pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400">
                    3. Tipos de Trabalho / Serviços de Interesse
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    {formSelectedServices.length} selecionado(s)
                  </span>
                </div>

                {services.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Nenhum serviço disponível em public.services.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {services.map((service) => {
                      const isSelected = formSelectedServices.includes(service.id);
                      const serviceTitle = service.name || service.title || 'Serviço';

                      return (
                        <button
                          type="button"
                          key={service.id}
                          onClick={() => toggleService(service.id)}
                          className={`p-2.5 rounded-lg border text-left text-xs font-medium transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                              : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          <span className="truncate mr-2">{serviceTitle}</span>
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'border-slate-600 bg-slate-800'
                            }`}
                          >
                            {isSelected && '✓'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer Buttons */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={formSaving}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white text-xs font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {formSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{modalMode === 'create' ? 'Cadastrar Lead' : 'Salvar Alterações'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for View Details */}
      {modalMode === 'view' && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <span className="text-xs font-mono text-slate-400">
                  ID: {selectedLead.id.slice(0, 8)}...
                </span>
                <h3 className="text-xl font-bold text-white mt-0.5">
                  {selectedLead.name}
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
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

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Badges strip */}
              <div className="flex flex-wrap items-center gap-2">
                {getTemperatureBadge(selectedLead.temperature)}
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-800/60 text-indigo-300 font-medium">
                  {selectedLead.current_stage_id
                    ? stageMap.get(selectedLead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial'}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  {selectedLead.condominium_type || 'Residencial'}
                </span>
              </div>

              {/* Grid with info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block mb-0.5">CNPJ:</span>
                  <span className="text-slate-200 font-mono font-medium">
                    {selectedLead.cnpj || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Administradora:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.administrator || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Cidade:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.city || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Endereço:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.address || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Unidades:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.unit_count != null ? `${selectedLead.unit_count} unidades` : 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Origem do Lead:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.lead_source || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Responsável Comercial:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.responsible_user_id
                      ? profileMap.get(selectedLead.responsible_user_id) || 'Não atribuído'
                      : 'Não atribuído'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Cadastrado em:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.created_at
                      ? new Date(selectedLead.created_at).toLocaleString('pt-BR')
                      : '-'}
                  </span>
                </div>
              </div>

              {checkIsLostStage(selectedLead.current_stage_id) && selectedLead.loss_reason && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-lg text-xs">
                  <span className="text-amber-400 font-semibold block mb-0.5">
                    Motivo de perda:
                  </span>
                  <span className="text-amber-200">{selectedLead.loss_reason}</span>
                </div>
              )}

              {/* Associated Services */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                  Serviços de Interesse
                </h4>
                {(() => {
                  const leadServiceIds = getLeadServices(selectedLead.id);
                  if (leadServiceIds.length === 0) {
                    return (
                      <p className="text-xs text-slate-500 italic">
                        Nenhum serviço vinculado a este condomínio.
                      </p>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-2">
                      {leadServiceIds.map((sId) => (
                        <span
                          key={sId}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-950/80 border border-indigo-800 text-indigo-300"
                        >
                          {serviceMap.get(sId) || 'Serviço'}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Contatos Vinculados */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                  Contatos Vinculados
                </h4>
                {(() => {
                  const linkedContacts = getContactsForLead(selectedLead.id);
                  if (linkedContacts.length === 0) {
                    return (
                      <p className="text-xs text-slate-500 italic p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                        Nenhum contato vinculado a este condomínio.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {linkedContacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center justify-between text-xs"
                        >
                          <div>
                            <div className="font-semibold text-white flex items-center gap-2">
                              <span>{contact.name}</span>
                              <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                                {contact.role_title || 'Contato'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono">
                              {contact.phone && <span>Tel: {contact.phone}</span>}
                              {contact.email && <span>Email: {contact.email}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* HISTÓRICO DE INTERAÇÕES */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs uppercase tracking-wider font-bold text-indigo-300">
                      Histórico de Interações
                    </h4>
                    {(() => {
                      const leadInteractions = getInteractionsForLead(selectedLead.id);
                      return (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                          {leadInteractions.length} {leadInteractions.length === 1 ? 'registro' : 'registros'}
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateInteraction(selectedLead)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
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
                    Registrar interação
                  </button>
                </div>

                {(() => {
                  const leadInteractions = getInteractionsForLead(selectedLead.id);
                  if (leadInteractions.length === 0) {
                    return (
                      <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/80 text-center">
                        <p className="text-xs text-slate-400 mb-2">
                          Nenhuma interação registrada ainda para este condomínio.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleOpenCreateInteraction(selectedLead)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                        >
                          Clique aqui para registrar a primeira interação
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {leadInteractions.map((item) => {
                        const respName = item.responsible_user_id
                          ? profileMap.get(item.responsible_user_id) || 'Não atribuído'
                          : 'Não atribuído';
                        const followUpStatus = getFollowUpStatus(item.next_follow_up_date);

                        return (
                          <div
                            key={item.id}
                            className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl hover:border-slate-700/80 transition-colors"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-2.5 mb-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getInteractionTypeBadge(item.interaction_type)}
                                <span className="text-xs text-white font-medium">
                                  {formatDateTimeBR(item.occurred_at)}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                  <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[9px] text-slate-300 uppercase font-semibold">
                                    {respName.charAt(0)}
                                  </span>
                                  <span className="text-[11px] truncate max-w-[120px]">
                                    {respName}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleOpenEditInteraction(item)}
                                  title="Editar interação"
                                  className="text-[11px] px-2 py-0.5 rounded text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 transition-colors cursor-pointer border border-transparent hover:border-indigo-800/40"
                                >
                                  Editar
                                </button>
                              </div>
                            </div>

                            {/* Notes */}
                            {item.notes ? (
                              <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed mb-2.5">
                                {item.notes}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-500 italic mb-2.5">
                                Sem observações adicionais.
                              </p>
                            )}

                            {/* Próximo Follow-up */}
                            {item.next_follow_up_date && (
                              <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs">
                                <span className="text-slate-400 text-[11px]">
                                  Próximo Follow-up:
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-200">
                                    {formatDateBR(item.next_follow_up_date)}
                                  </span>
                                  {followUpStatus === 'overdue' && (
                                    <span className="text-[10px] px-2 py-0.2 rounded-full bg-amber-950 border border-amber-800 text-amber-300 font-medium">
                                      Vencido
                                    </span>
                                  )}
                                  {followUpStatus === 'today' && (
                                    <span className="text-[10px] px-2 py-0.2 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300 font-medium">
                                      Hoje
                                    </span>
                                  )}
                                  {followUpStatus === 'upcoming' && (
                                    <span className="text-[10px] px-2 py-0.2 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                                      Próximo
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <button
                onClick={() => {
                  handleCloseModal();
                  handleOpenEdit(selectedLead);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
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
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Editar este lead
              </button>
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Interaction Create / Edit */}
      {interactionModalMode && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-base font-bold text-white">
                  {interactionModalMode === 'create' ? 'Registrar Interação' : 'Editar Interação'}
                </h3>
                <p className="text-xs text-slate-400">
                  Condomínio: <span className="text-indigo-300 font-semibold">{selectedLead.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseInteractionModal}
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

            <form onSubmit={handleSubmitInteraction} className="p-6 space-y-4 text-xs">
              {formInteractionError && (
                <div className="p-3 bg-rose-950/80 border border-rose-600/50 rounded-lg text-rose-200 text-xs">
                  {formInteractionError}
                </div>
              )}

              {/* Tipo de Interação (Obrigatório) */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  Tipo de Interação <span className="text-rose-400">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {INTERACTION_TYPES.map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setFormInteractionType(type)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer text-center ${
                        formInteractionType === type
                          ? 'bg-indigo-950 border-indigo-500 text-indigo-200 font-semibold'
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
                    value={formInteractionOccurredAt}
                    onChange={(e) => setFormInteractionOccurredAt(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Responsável
                  </label>
                  <select
                    value={formInteractionResponsibleId}
                    onChange={(e) => setFormInteractionResponsibleId(e.target.value)}
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
                  value={formInteractionNotes}
                  onChange={(e) => setFormInteractionNotes(e.target.value)}
                  placeholder="Descreva o que foi tratado, alinhamentos ou próximos passos..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Próximo Follow-up */}
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-medium">
                    Próximo Follow-up (Opcional)
                  </label>
                  {formInteractionNextFollowUpDate && (
                    <button
                      type="button"
                      onClick={() => setFormInteractionNextFollowUpDate('')}
                      className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Limpar data
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={formInteractionNextFollowUpDate}
                  onChange={(e) => setFormInteractionNextFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Ao definir uma data aqui, ela será considerada como o próximo retorno prioritário para este condomínio.
                </p>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseInteractionModal}
                  disabled={formInteractionSaving}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formInteractionSaving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {formInteractionSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{interactionModalMode === 'create' ? 'Salvar Interação' : 'Atualizar Interação'}</span>
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
