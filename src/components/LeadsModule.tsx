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

  // UI View Mode (Default is Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

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

  // Dynamic Quiz Step for Lead Create/Edit (1 to 6)
  const [quizStep, setQuizStep] = useState<number>(1);
  const totalQuizSteps = 6;

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

  // Interaction Modal States with Dynamic Quiz Steps (1 to 4)
  const [interactionModalMode, setInteractionModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);
  const [interactionQuizStep, setInteractionQuizStep] = useState<number>(1);
  const totalInteractionQuizSteps = 4;

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
      // 1. Pipeline stages
      const stagesRes = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('position', { ascending: true });
      setStages(stagesRes.data || []);

      // 2. Profiles
      const profilesRes = await supabase
        .from('profiles')
        .select('id, full_name, role');
      setProfiles(profilesRes.data || []);

      // 3. Services
      const servicesRes = await supabase
        .from('services')
        .select('*');
      setServices(servicesRes.data || []);

      // 4. Leads
      const leadsRes = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      setLeads(leadsRes.data || []);

      // 5. Lead services
      const leadServicesRes = await supabase
        .from('lead_services')
        .select('lead_id, service_id');
      setLeadServices(leadServicesRes.data || []);

      // 6. Contacts and Relations
      const contactsRes = await supabase
        .from('contacts')
        .select('id, name, role_title, phone, email');
      setContacts(contactsRes.data || []);

      const leadContactsRes = await supabase
        .from('lead_contacts')
        .select('lead_id, contact_id');
      setLeadContacts(leadContactsRes.data || []);

      // 7. Interactions
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

  const serviceMap = useMemo(() => {
    const map = new Map<string, string>();
    services.forEach((s) => map.set(s.id, s.name || s.title || 'Serviço'));
    return map;
  }, [services]);

  const getLeadServices = useCallback(
    (leadId: string): string[] => {
      return leadServices
        .filter((ls) => ls.lead_id === leadId)
        .map((ls) => ls.service_id);
    },
    [leadServices]
  );

  const getContactsForLead = useCallback(
    (leadId: string): ContactSummary[] => {
      const contactIds = leadContacts
        .filter((lc) => lc.lead_id === leadId)
        .map((lc) => lc.contact_id);
      return contacts.filter((c) => contactIds.includes(c.id));
    },
    [leadContacts, contacts]
  );

  const getInteractionsForLead = useCallback(
    (leadId: string): Interaction[] => {
      return interactions
        .filter((i) => i.lead_id === leadId)
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    },
    [interactions]
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
    const initialStageId = stages.length > 0 ? stages[0].id : '';
    setFormCurrentStageId(initialStageId);
    setFormResponsibleUserId(currentProfile.id);
    setFormLossReason('');
    setFormSelectedServices([]);
    setSelectedLead(null);
    setQuizStep(1);
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
    setQuizStep(1);
    setModalMode('edit');
  };

  // Open modal in view mode
  const handleOpenView = (lead: Lead) => {
    setSelectedLead(lead);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setSelectedLead(null);
    setFormError(null);
    setQuizStep(1);
  };

  // Toggle service selection in form
  const toggleService = (serviceId: string) => {
    setFormSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // Quiz step validation
  const handleNextQuizStep = () => {
    setFormError(null);
    if (quizStep === 1) {
      if (!formName.trim()) {
        setFormError('Informe o nome do condomínio para avançar.');
        return;
      }
    }
    if (quizStep === 2) {
      const unitCountTrimmed = formUnitCount.trim();
      if (!unitCountTrimmed) {
        setFormError('Informe o número de unidades do condomínio.');
        return;
      }
      const num = parseInt(unitCountTrimmed, 10);
      if (isNaN(num) || num <= 0) {
        setFormError('O número de unidades deve ser um número válido maior que zero.');
        return;
      }
    }
    if (quizStep === 5) {
      const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
      if (checkIsLostStage(stageIdToUse) && !formLossReason.trim()) {
        setFormError('Informe o motivo de perda para este estágio.');
        return;
      }
    }

    if (quizStep < totalQuizSteps) {
      setQuizStep((prev) => prev + 1);
    }
  };

  const handlePrevQuizStep = () => {
    setFormError(null);
    if (quizStep > 1) {
      setQuizStep((prev) => prev - 1);
    }
  };

  // Save Lead (Create or Edit)
  const handleSubmitLead = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setQuizStep(1);
      setFormError('O nome do condomínio é obrigatório.');
      return;
    }

    const unitCountTrimmed = formUnitCount.trim();
    if (!unitCountTrimmed) {
      setQuizStep(2);
      setFormError('O número de unidades é obrigatório.');
      return;
    }
    const unitCountNum = parseInt(unitCountTrimmed, 10);
    if (isNaN(unitCountNum) || unitCountNum <= 0) {
      setQuizStep(2);
      setFormError('O número de unidades deve ser um valor numérico válido maior que zero.');
      return;
    }

    const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
    const isStageLost = checkIsLostStage(stageIdToUse);

    if (isStageLost && !formLossReason.trim()) {
      setQuizStep(5);
      setFormError('O preenchimento do motivo de perda é obrigatório quando o estágio for Perdido.');
      return;
    }

    setFormSaving(true);

    try {
      const leadPayload = {
        name: formName.trim(),
        cnpj: formCnpj.trim() || null,
        condominium_type: formCondominiumType || 'Residencial',
        administrator: formAdministrator.trim() || null,
        unit_count: unitCountNum,
        address: formAddress.trim() || null,
        city: formCity.trim() || null,
        lead_source: formLeadSource || null,
        temperature: formTemperature || 'Morno',
        current_stage_id: stageIdToUse,
        responsible_user_id: formResponsibleUserId || currentProfile.id,
        loss_reason: isStageLost ? formLossReason.trim() : null,
      };

      let savedLeadId: string | null = null;

      if (modalMode === 'create') {
        const { data: createdLead, error: createError } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select()
          .single();

        if (createError) throw createError;
        if (!createdLead) throw new Error('Não foi possível recuperar o lead recém-criado.');

        savedLeadId = createdLead.id;
        setLeads((prev) => [createdLead, ...prev]);
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${createdLead.name}" cadastrado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedLead) {
        savedLeadId = selectedLead.id;
        const { data: updatedLead, error: updateError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', selectedLead.id)
          .select()
          .single();

        if (updateError) throw updateError;
        if (!updatedLead) throw new Error('Falha ao atualizar o lead.');

        setLeads((prev) =>
          prev.map((item) => (item.id === selectedLead.id ? updatedLead : item))
        );
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${updatedLead.name}" atualizado com sucesso!`,
        });
      }

      // Sync lead_services junction
      if (savedLeadId) {
        await supabase.from('lead_services').delete().eq('lead_id', savedLeadId);

        if (formSelectedServices.length > 0) {
          const serviceInserts = formSelectedServices.map((sId) => ({
            lead_id: savedLeadId!,
            service_id: sId,
          }));
          await supabase.from('lead_services').insert(serviceInserts);
        }

        const freshLeadServices = await supabase
          .from('lead_services')
          .select('lead_id, service_id');
        setLeadServices(freshLeadServices.data || []);
      }

      handleCloseModal();
    } catch (err: any) {
      console.error('Error saving lead:', err);
      setFormError(err.message || 'Erro ao salvar o lead. Tente novamente.');
    } finally {
      setFormSaving(false);
    }
  };

  // Direct Interaction Handlers
  const handleOpenCreateInteraction = (lead: Lead) => {
    setSelectedLead(lead);
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
    setInteractionQuizStep(1);
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
    setInteractionQuizStep(1);
    setInteractionModalMode('edit');
  };

  const handleCloseInteractionModal = () => {
    setInteractionModalMode(null);
    setSelectedInteraction(null);
    setFormInteractionError(null);
    setInteractionQuizStep(1);
  };

  const handleSubmitInteraction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

  const getInteractionTypeBadge = (type: string) => {
    switch (type) {
      case 'WhatsApp':
        return <span className="text-[11px] font-medium text-emerald-400">WhatsApp</span>;
      case 'Reunião':
        return <span className="text-[11px] font-medium text-purple-400">Reunião</span>;
      case 'E-mail':
        return <span className="text-[11px] font-medium text-sky-400">E-mail</span>;
      case 'Evento BNI':
        return <span className="text-[11px] font-medium text-amber-400">Evento BNI</span>;
      case 'Ligação':
      default:
        return <span className="text-[11px] font-medium text-indigo-400">Ligação</span>;
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
            <span>Oportunidades</span>
            <span aria-hidden="true">·</span>
            <span className="text-indigo-400 font-mono tabular-nums">{leads.length} condomínios</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Leads & Condomínios
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
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md transition-colors flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo lead
          </button>
        </div>
      </div>

      {/* Feedback Alert */}
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

      {/* Search Bar */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
            placeholder="Buscar condomínio por nome, cidade ou administradora..."
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

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Mostrando:</span>
          <span className="font-semibold text-white px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 font-mono tabular-nums">
            {filteredLeads.length} {filteredLeads.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>
      </div>

      {/* Content: Cards or List View */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs sm:text-sm">Carregando carteira de condomínios...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="mt-8 py-16 px-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center">
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm ? 'Nenhum lead encontrado' : 'Nenhum condomínio cadastrado'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
            {searchTerm
              ? 'Ajuste os termos da sua pesquisa para localizar o condomínio.'
              : 'Comece adicionando seu primeiro lead comercial no CRM.'}
          </p>
          {!searchTerm && (
            <button
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Cadastrar primeiro condomínio
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW (DEFAULT) */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {filteredLeads.map((lead) => {
            const stageName = lead.current_stage_id
              ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
              : 'Estágio inicial';
            const responsibleName = lead.responsible_user_id
              ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
              : 'Não atribuído';
            const leadInteractions = getInteractionsForLead(lead.id);
            const latestInteraction = leadInteractions[0];

            return (
              <div
                key={lead.id}
                className="bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-5 shadow-lg transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => handleOpenView(lead)}
                        className="text-left font-bold text-base text-white group-hover:text-indigo-400 transition-colors cursor-pointer leading-tight"
                      >
                        {lead.name}
                      </button>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                        <span>{lead.city || 'Cidade não informada'}</span>
                        {lead.administrator && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[140px]">Adm: {lead.administrator}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {getTemperatureBadge(lead.temperature)}
                    </div>
                  </div>

                  {/* Metadata Row */}
                  <div className="grid grid-cols-2 gap-2 py-3 border-y border-slate-800/60 my-3 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Porte / Tipo</span>
                      <span className="text-slate-200 font-medium">
                        <span className="font-mono tabular-nums">{lead.unit_count || '-'}</span> un. · {lead.condominium_type || 'Residencial'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Estágio Funil</span>
                      <span className="text-indigo-300 font-medium truncate block">
                        {stageName}
                      </span>
                    </div>
                  </div>

                  {/* Latest Interaction Snapshot */}
                  <div className="mb-4 text-xs">
                    <span className="text-slate-500 block text-[11px] mb-1">Última Interação</span>
                    {latestInteraction ? (
                      <div className="text-slate-300 flex items-center justify-between gap-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                        <div className="flex items-center gap-1.5 truncate">
                          {getInteractionTypeBadge(latestInteraction.interaction_type)}
                          <span className="text-slate-400 text-[11px] truncate">
                            {latestInteraction.notes || 'Sem observações'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                          {formatDateBR(latestInteraction.occurred_at)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">
                        Nenhuma interação registrada ainda.
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer: Responsible & Action Buttons */}
                <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300 uppercase font-semibold shrink-0">
                      {responsibleName.charAt(0)}
                    </span>
                    <span className="text-xs truncate max-w-[90px] text-slate-300">
                      {responsibleName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenCreateInteraction(lead)}
                      title="Registrar interação"
                      className="px-2.5 py-1.5 bg-indigo-600/90 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span>Interação</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenView(lead)}
                      title="Ver detalhes"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(lead)}
                      title="Editar condomínio"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
                  <th className="py-3.5 px-4 hidden md:table-cell">Cidade</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Tipo</th>
                  <th className="py-3.5 px-4">Temperatura</th>
                  <th className="py-3.5 px-4">Estágio</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Responsável</th>
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

                  return (
                    <tr key={lead.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <button
                          type="button"
                          onClick={() => handleOpenView(lead)}
                          className="text-left font-semibold text-white hover:text-indigo-400 transition-colors cursor-pointer"
                        >
                          {lead.name}
                        </button>
                        {lead.administrator && (
                          <span className="text-[11px] text-slate-400 block">
                            Adm: {lead.administrator}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden md:table-cell">
                        {lead.city || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden lg:table-cell">
                        {lead.condominium_type || 'Residencial'}
                      </td>
                      <td className="py-3.5 px-4">
                        {getTemperatureBadge(lead.temperature)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-xs font-medium text-indigo-300">
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
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenCreateInteraction(lead)}
                            title="Registrar interação"
                            aria-label="Registrar interação"
                            className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/60 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenView(lead)}
                            title="Visualizar detalhes"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenEdit(lead)}
                            title="Editar lead"
                            className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
        </div>
      )}

      {/* DYNAMIC QUIZ-STYLE MODAL FOR LEAD CREATE / EDIT */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            {/* Quiz Header & Progress Bar */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300">
                    Etapa {quizStep} de {totalQuizSteps}
                  </span>
                  <span className="text-xs text-slate-400">
                    {modalMode === 'create' ? 'Novo Condomínio' : 'Editar Condomínio'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Visual Progress Bar */}
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${(quizStep / totalQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            {/* Quiz Body: Step by Step */}
            <div className="p-6 sm:p-8 overflow-y-auto flex-1 text-sm">
              {formError && (
                <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                  {formError}
                </div>
              )}

              {/* STEP 1: Identificação */}
              {quizStep === 1 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Qual é o nome do condomínio?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Informe o nome comercial ou identificador principal.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Nome do Condomínio <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleNextQuizStep();
                        }
                      }}
                      placeholder="Ex: Condomínio Edifício Solar das Palmeiras"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      CNPJ (Opcional)
                    </label>
                    <input
                      type="text"
                      value={formCnpj}
                      onChange={(e) => setFormCnpj(e.target.value)}
                      placeholder="00.000.000/0001-00"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors font-mono"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Localização & Unidades */}
              {quizStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Onde está localizado e qual o porte?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Informe a cidade e a quantidade de unidades autônomas.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Cidade
                      </label>
                      <input
                        type="text"
                        autoFocus
                        value={formCity}
                        onChange={(e) => setFormCity(e.target.value)}
                        placeholder="Ex: São Paulo"
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Número de Unidades <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formUnitCount}
                        onChange={(e) => setFormUnitCount(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleNextQuizStep();
                          }
                        }}
                        placeholder="Ex: 84"
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Endereço Completo (Opcional)
                    </label>
                    <input
                      type="text"
                      value={formAddress}
                      onChange={(e) => setFormAddress(e.target.value)}
                      placeholder="Ex: Av. Paulista, 1000 - Bela Vista"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Tipo & Gestão */}
              {quizStep === 3 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Qual a tipologia e a administradora?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Selecione a categoria do empreendimento e informe se possui administradora.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Tipo de Condomínio
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {CONDOMINIUM_TYPES.map((type) => (
                        <button
                          type="button"
                          key={type}
                          onClick={() => setFormCondominiumType(type)}
                          className={`p-3 rounded-xl border text-xs font-medium transition-all text-left flex items-center justify-between cursor-pointer ${
                            formCondominiumType === type
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span>{type}</span>
                          {formCondominiumType === type && <span className="text-indigo-400">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Administradora de Condomínio
                    </label>
                    <input
                      type="text"
                      value={formAdministrator}
                      onChange={(e) => setFormAdministrator(e.target.value)}
                      placeholder="Ex: Lello, Hub, GK, etc."
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Origem & Temperatura */}
              {quizStep === 4 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Origem e Temperatura Comercial
                    </h3>
                    <p className="text-xs text-slate-400">
                      Qual a temperatura da oportunidade e como o lead foi originado?
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Temperatura da Oportunidade
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {TEMPERATURE_OPTIONS.map((temp) => (
                        <button
                          type="button"
                          key={temp}
                          onClick={() => setFormTemperature(temp)}
                          className={`p-3 rounded-xl border text-xs font-medium transition-all text-center cursor-pointer flex flex-col items-center gap-1.5 ${
                            formTemperature === temp
                              ? temp === 'Quente'
                                ? 'bg-rose-950/80 border-rose-500 text-rose-200 font-bold'
                                : temp === 'Morno'
                                ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                                : 'bg-sky-950/80 border-sky-500 text-sky-200 font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className={`w-3 h-3 rounded-full ${
                              temp === 'Quente'
                                ? 'bg-rose-500'
                                : temp === 'Morno'
                                ? 'bg-amber-500'
                                : 'bg-sky-500'
                            }`}
                          />
                          <span>{temp}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Origem do Lead
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {LEAD_SOURCES.map((source) => (
                        <button
                          type="button"
                          key={source}
                          onClick={() => setFormLeadSource(source)}
                          className={`p-2.5 rounded-xl border text-xs font-medium transition-all text-left cursor-pointer ${
                            formLeadSource === source
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {source}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Funil & Responsável */}
              {quizStep === 5 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Estágio no Funil e Responsável
                    </h3>
                    <p className="text-xs text-slate-400">
                      Vincule ao pipeline de vendas e atribua ao consultor responsável.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Estágio no Funil
                    </label>
                    <select
                      value={formCurrentStageId}
                      onChange={(e) => handleStageChange(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-sm focus:outline-none cursor-pointer"
                    >
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {checkIsLostStage(formCurrentStageId) && (
                    <div className="p-3.5 bg-amber-950/40 border border-amber-800/40 rounded-xl">
                      <label className="block text-xs font-medium text-amber-300 mb-1.5">
                        Motivo de Perda <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={formLossReason}
                        onChange={(e) => setFormLossReason(e.target.value)}
                        placeholder="Ex: Optou por concorrente por valor de taxa"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Responsável Comercial
                    </label>
                    <select
                      value={formResponsibleUserId}
                      onChange={(e) => setFormResponsibleUserId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-sm focus:outline-none cursor-pointer"
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

              {/* STEP 6: Serviços & Revisão */}
              {quizStep === 6 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Serviços de Interesse e Confirmação
                    </h3>
                    <p className="text-xs text-slate-400">
                      Selecione os serviços que o condomínio busca e finalize o cadastro.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Serviços
                    </label>
                    {services.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Nenhum serviço cadastrado.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {services.map((service) => {
                          const isSelected = formSelectedServices.includes(service.id);
                          const title = service.name || service.title || 'Serviço';

                          return (
                            <button
                              type="button"
                              key={service.id}
                              onClick={() => toggleService(service.id)}
                              className={`p-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-between text-left cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <span className="truncate mr-2">{title}</span>
                              <span className="text-xs font-bold text-indigo-400">
                                {isSelected ? '✓' : '+'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Review Box */}
                  <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-1.5 text-xs text-slate-300">
                    <div className="font-semibold text-white text-sm pb-1 border-b border-slate-800">
                      Resumo do Lead: {formName}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Porte / Tipo:</span>
                      <span>{formUnitCount} un. · {formCondominiumType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Localização:</span>
                      <span>{formCity || 'Não informada'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Temperatura:</span>
                      <span>{formTemperature}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quiz Navigation Footer */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={quizStep === 1 ? handleCloseModal : handlePrevQuizStep}
                className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-xl transition-colors cursor-pointer"
              >
                {quizStep === 1 ? 'Cancelar' : '← Voltar'}
              </button>

              <div className="flex items-center gap-2">
                {quizStep < totalQuizSteps ? (
                  <button
                    type="button"
                    onClick={handleNextQuizStep}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-md"
                  >
                    <span>Avançar</span>
                    <span>→</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSubmitLead()}
                    disabled={formSaving}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-2 shadow-md disabled:opacity-50"
                  >
                    {formSaving ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <span>{modalMode === 'create' ? 'Concluir Cadastro' : 'Salvar Alterações'}</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW LEAD DETAILS MODAL */}
      {modalMode === 'view' && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <span className="text-[11px] font-mono text-slate-400">
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
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* Badges strip */}
              <div className="flex flex-wrap items-center gap-3">
                {getTemperatureBadge(selectedLead.temperature)}
                <span className="text-xs text-indigo-300 font-medium">
                  {selectedLead.current_stage_id
                    ? stageMap.get(selectedLead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial'}
                </span>
                <span className="text-xs text-slate-400">
                  {selectedLead.condominium_type || 'Residencial'}
                </span>
              </div>

              {/* Grid with info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 p-4.5 rounded-2xl border border-slate-800/80">
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">CNPJ</span>
                  <span className="text-slate-200 font-mono font-medium">
                    {selectedLead.cnpj || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Administradora</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.administrator || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Cidade</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.city || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Endereço</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.address || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Unidades</span>
                  <span className="text-slate-200 font-medium font-mono tabular-nums">
                    {selectedLead.unit_count != null ? `${selectedLead.unit_count} unidades` : 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Origem do Lead</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.lead_source || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Responsável Comercial</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.responsible_user_id
                      ? profileMap.get(selectedLead.responsible_user_id) || 'Não atribuído'
                      : 'Não atribuído'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5 text-[11px]">Cadastrado em</span>
                  <span className="text-slate-200 font-medium font-mono">
                    {selectedLead.created_at
                      ? new Date(selectedLead.created_at).toLocaleString('pt-BR')
                      : '-'}
                  </span>
                </div>
              </div>

              {/* HISTÓRICO DE INTERAÇÕES */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs uppercase tracking-wider font-bold text-white">
                      Histórico de Interações
                    </h4>
                    {(() => {
                      const leadInteractions = getInteractionsForLead(selectedLead.id);
                      return (
                        <span className="text-[11px] font-mono text-slate-400">
                          ({leadInteractions.length})
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateInteraction(selectedLead)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Registrar interação
                  </button>
                </div>

                {(() => {
                  const leadInteractions = getInteractionsForLead(selectedLead.id);
                  if (leadInteractions.length === 0) {
                    return (
                      <div className="p-4 bg-slate-950/40 rounded-2xl border border-slate-800/80 text-center">
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
                            className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl hover:border-slate-700/80 transition-colors"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-2.5 mb-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getInteractionTypeBadge(item.interaction_type)}
                                <span className="text-xs text-white font-medium">
                                  {formatDateTimeBR(item.occurred_at)}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-slate-400">
                                  Por: {respName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditInteraction(item)}
                                  className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium"
                                >
                                  Editar
                                </button>
                              </div>
                            </div>

                            {item.notes && (
                              <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed mb-2">
                                {item.notes}
                              </p>
                            )}

                            {item.next_follow_up_date && (
                              <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs">
                                <span className="text-slate-500 text-[11px]">
                                  Próximo Follow-up:
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-200 font-mono">
                                    {formatDateBR(item.next_follow_up_date)}
                                  </span>
                                  {followUpStatus === 'overdue' && (
                                    <span className="text-[10px] text-amber-400 font-semibold">
                                      (Vencido)
                                    </span>
                                  )}
                                  {followUpStatus === 'today' && (
                                    <span className="text-[10px] text-indigo-400 font-semibold">
                                      (Hoje)
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
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Editar condomínio
              </button>
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC QUIZ-STYLE MODAL FOR INTERACTION REGISTRATION */}
      {interactionModalMode && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-2.5">
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Progress */}
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(interactionQuizStep / totalInteractionQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            {/* Quiz Body */}
            <div className="p-6 overflow-y-auto flex-1 text-xs">
              {formInteractionError && (
                <div className="mb-4 p-3 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200">
                  {formInteractionError}
                </div>
              )}

              {/* Step 1: Tipo */}
              {interactionQuizStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Qual foi o tipo de contato realizado?
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Selecione o canal ou formato da interação:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {INTERACTION_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type}
                        onClick={() => {
                          setFormInteractionType(type);
                          setInteractionQuizStep(2);
                        }}
                        className={`p-3.5 rounded-xl border text-xs font-semibold transition-all text-left flex items-center justify-between cursor-pointer ${
                          formInteractionType === type
                            ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <span>{type}</span>
                        <span className="text-slate-500 font-normal">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Data & Responsável */}
              {interactionQuizStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Quando ocorreu e quem foi o responsável?
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Confirme a data, horário e o consultor que realizou o contato.
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Data e Hora da Interação
                    </label>
                    <input
                      type="datetime-local"
                      value={formInteractionOccurredAt}
                      onChange={(e) => setFormInteractionOccurredAt(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Responsável
                    </label>
                    <select
                      value={formInteractionResponsibleId}
                      onChange={(e) => setFormInteractionResponsibleId(e.target.value)}
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

              {/* Step 3: Observações */}
              {interactionQuizStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Observações da Interação
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Descreva o que foi conversado, expectativas ou alinhamentos:
                    </p>
                  </div>

                  <textarea
                    rows={4}
                    autoFocus
                    value={formInteractionNotes}
                    onChange={(e) => setFormInteractionNotes(e.target.value)}
                    placeholder="Ex: Conversa com o síndico para apresentar proposta de portaria e agendar vistoria técnica..."
                    className="w-full px-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                </div>
              )}

              {/* Step 4: Próximo Follow-up & Conclusão */}
              {interactionQuizStep === 4 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Agendar Próximo Follow-up?
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Defina uma data de retorno para o sistema priorizar este lead.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium">Data do Retorno</label>
                      {formInteractionNextFollowUpDate && (
                        <button
                          type="button"
                          onClick={() => setFormInteractionNextFollowUpDate('')}
                          className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Remover data
                        </button>
                      )}
                    </div>
                    <input
                      type="date"
                      value={formInteractionNextFollowUpDate}
                      onChange={(e) => setFormInteractionNextFollowUpDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-slate-400 space-y-1 text-[11px]">
                    <div><span className="text-slate-500">Tipo:</span> {formInteractionType}</div>
                    {formInteractionNotes && (
                      <div className="truncate"><span className="text-slate-500">Notas:</span> {formInteractionNotes}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={
                  interactionQuizStep === 1
                    ? handleCloseInteractionModal
                    : () => setInteractionQuizStep((p) => p - 1)
                }
                className="px-3.5 py-2 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {interactionQuizStep === 1 ? 'Cancelar' : '← Voltar'}
              </button>

              {interactionQuizStep < totalInteractionQuizSteps ? (
                <button
                  type="button"
                  onClick={() => setInteractionQuizStep((p) => p + 1)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>Próximo</span>
                  <span>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubmitInteraction()}
                  disabled={formInteractionSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {formInteractionSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Registrar Interação</span>
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
