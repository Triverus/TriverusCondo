import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';
import { useCRM, type Lead, type PipelineStage, type ServiceItem, type Contact, type Interaction } from '../lib/crmStore.tsx';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../lib/draftStorage.ts';

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

export const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
  'Gerente Predial',
  'Outro',
];

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

const TEMPERATURE_OPTIONS = ['Frio', 'Morno', 'Quente'] as const;

const DRAFT_LEAD_CREATE_KEY = 'triverus_draft_lead_create';
const getLeadEditDraftKey = (id: string) => `triverus_draft_lead_edit_${id}`;
const getInteractionCreateDraftKey = (leadId: string) => `triverus_draft_interaction_create_${leadId}`;
const getInteractionEditDraftKey = (interactionId: string) => `triverus_draft_interaction_edit_${interactionId}`;

interface LeadDraftData {
  quizStep: number;
  formName: string;
  formCnpj: string;
  formCondominiumType: string;
  formAdministrator: string;
  formUnitCount: string;
  formAddress: string;
  formCity: string;
  formLeadSource: string;
  formTemperature: string;
  formCurrentStageId: string;
  formResponsibleUserId: string;
  formLossReason: string;
  formSelectedServices: string[];
}

interface InteractionDraftData {
  interactionQuizStep: number;
  formInteractionType: string;
  formInteractionOccurredAt: string;
  formInteractionResponsibleId: string;
  formInteractionNotes: string;
  formInteractionNextFollowUpDate: string;
}

export default function LeadsModule({
  currentProfile,
  initialSelectedLeadId,
  onClearInitialLead,
}: LeadsModuleProps) {
  // Centralized In-Memory & Cached CRM store
  const {
    leads,
    stages,
    profiles,
    services,
    isInitialLoading,
    isRefreshing,
    stageMap,
    profileMap,
    serviceMap,
    refreshAll,
    upsertLeadLocally,
    upsertContactLocally,
    upsertInteractionLocally,
    getLeadServices,
    getContactsForLead,
    getInteractionsForLead,
  } = useCRM();

  // Search & Filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Copied feedback helper
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isRestoredDraft, setIsRestoredDraft] = useState<boolean>(false);

  // Contact Popup State (WhatsApp or Email modal)
  const [contactPopup, setContactPopup] = useState<{
    open: boolean;
    lead: Lead | null;
    type: 'whatsapp' | 'email';
    mode: 'list' | 'add';
  }>({
    open: false,
    lead: null,
    type: 'whatsapp',
    mode: 'list',
  });

  // Contact Add Form inside Popup
  const [newContactName, setNewContactName] = useState('');
  const [newContactRolePreset, setNewContactRolePreset] = useState('Síndico');
  const [newContactCustomRole, setNewContactCustomRole] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactNotes, setNewContactNotes] = useState('');
  const [savingNewContact, setSavingNewContact] = useState(false);
  const [contactFormError, setContactFormError] = useState<string | null>(null);

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
  const [formTemperature, setFormTemperature] = useState<'Frio' | 'Morno' | 'Quente'>('Morno');
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
  const [isInteractionRestoredDraft, setIsInteractionRestoredDraft] = useState<boolean>(false);
  const totalInteractionQuizSteps = 4;

  const [formInteractionType, setFormInteractionType] = useState<string>('Ligação');
  const [formInteractionOccurredAt, setFormInteractionOccurredAt] = useState<string>('');
  const [formInteractionResponsibleId, setFormInteractionResponsibleId] = useState<string>('');
  const [formInteractionNotes, setFormInteractionNotes] = useState<string>('');
  const [formInteractionNextFollowUpDate, setFormInteractionNextFollowUpDate] = useState<string>('');
  const [formInteractionSaving, setFormInteractionSaving] = useState<boolean>(false);
  const [formInteractionError, setFormInteractionError] = useState<string | null>(null);

  const initialDraftRestorationChecked = useRef(false);

  // Check and restore draft on initial mount
  useEffect(() => {
    if (initialDraftRestorationChecked.current) return;
    initialDraftRestorationChecked.current = true;

    const createDraft = loadDraft<LeadDraftData>(DRAFT_LEAD_CREATE_KEY);
    if (createDraft && createDraft.formName?.trim()) {
      setFormName(createDraft.formName || '');
      setFormCnpj(createDraft.formCnpj || '');
      setFormCondominiumType(createDraft.formCondominiumType || 'Residencial');
      setFormAdministrator(createDraft.formAdministrator || '');
      setFormUnitCount(createDraft.formUnitCount || '');
      setFormAddress(createDraft.formAddress || '');
      setFormCity(createDraft.formCity || '');
      setFormLeadSource(createDraft.formLeadSource || 'Indicação (BNI/rede)');
      setFormTemperature((createDraft.formTemperature as 'Frio' | 'Morno' | 'Quente') || 'Morno');
      setFormCurrentStageId(createDraft.formCurrentStageId || '');
      setFormResponsibleUserId(createDraft.formResponsibleUserId || currentProfile.id);
      setFormLossReason(createDraft.formLossReason || '');
      setFormSelectedServices(createDraft.formSelectedServices || []);
      setQuizStep(createDraft.quizStep || 1);
      setIsRestoredDraft(true);
      setModalMode('create');
    }
  }, [currentProfile.id]);

  // Save Lead form draft on state changes
  useEffect(() => {
    if (modalMode === 'create') {
      const data: LeadDraftData = {
        quizStep,
        formName,
        formCnpj,
        formCondominiumType,
        formAdministrator,
        formUnitCount,
        formAddress,
        formCity,
        formLeadSource,
        formTemperature,
        formCurrentStageId,
        formResponsibleUserId,
        formLossReason,
        formSelectedServices,
      };
      if (formName.trim() || formCnpj.trim() || formAdministrator.trim() || formUnitCount.trim()) {
        saveDraft(DRAFT_LEAD_CREATE_KEY, data);
      }
    } else if (modalMode === 'edit' && selectedLead) {
      const data: LeadDraftData = {
        quizStep,
        formName,
        formCnpj,
        formCondominiumType,
        formAdministrator,
        formUnitCount,
        formAddress,
        formCity,
        formLeadSource,
        formTemperature,
        formCurrentStageId,
        formResponsibleUserId,
        formLossReason,
        formSelectedServices,
      };
      saveDraft(getLeadEditDraftKey(selectedLead.id), data);
    }
  }, [
    modalMode,
    selectedLead,
    quizStep,
    formName,
    formCnpj,
    formCondominiumType,
    formAdministrator,
    formUnitCount,
    formAddress,
    formCity,
    formLeadSource,
    formTemperature,
    formCurrentStageId,
    formResponsibleUserId,
    formLossReason,
    formSelectedServices,
  ]);

  // Save Interaction draft on state changes
  useEffect(() => {
    if (interactionModalMode === 'create' && selectedLead) {
      const data: InteractionDraftData = {
        interactionQuizStep,
        formInteractionType,
        formInteractionOccurredAt,
        formInteractionResponsibleId,
        formInteractionNotes,
        formInteractionNextFollowUpDate,
      };
      if (formInteractionNotes.trim() || formInteractionNextFollowUpDate) {
        saveDraft(getInteractionCreateDraftKey(selectedLead.id), data);
      }
    } else if (interactionModalMode === 'edit' && selectedInteraction) {
      const data: InteractionDraftData = {
        interactionQuizStep,
        formInteractionType,
        formInteractionOccurredAt,
        formInteractionResponsibleId,
        formInteractionNotes,
        formInteractionNextFollowUpDate,
      };
      saveDraft(getInteractionEditDraftKey(selectedInteraction.id), data);
    }
  }, [
    interactionModalMode,
    selectedLead,
    selectedInteraction,
    interactionQuizStep,
    formInteractionType,
    formInteractionOccurredAt,
    formInteractionResponsibleId,
    formInteractionNotes,
    formInteractionNextFollowUpDate,
  ]);

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

  // Filter leads by search and filters in memory
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (responsibleFilter !== 'all' && l.responsible_user_id !== responsibleFilter) {
        return false;
      }
      if (stageFilter !== 'all' && l.current_stage_id !== stageFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchName = l.name.toLowerCase().includes(term);
        const matchCity = l.city ? l.city.toLowerCase().includes(term) : false;
        const matchAdm = l.administrator ? l.administrator.toLowerCase().includes(term) : false;
        if (!matchName && !matchCity && !matchAdm) return false;
      }
      return true;
    });
  }, [leads, searchTerm, responsibleFilter, stageFilter]);

  // Pipeline Columns: Frio, Morno, Quente
  const pipelineColumns = useMemo(() => {
    const cold: Lead[] = [];
    const warm: Lead[] = [];
    const hot: Lead[] = [];

    filteredLeads.forEach((lead) => {
      const temp = (lead.temperature || 'Morno').toLowerCase();
      if (temp === 'quente') {
        hot.push(lead);
      } else if (temp === 'frio') {
        cold.push(lead);
      } else {
        warm.push(lead);
      }
    });

    return [
      {
        id: 'Frio',
        label: 'Frio',
        subtitle: 'Prospecções iniciais ou sem resposta recente',
        leads: cold,
        accentColor: 'border-sky-500/40 text-sky-400 bg-sky-500/10',
        headerBadgeColor: 'bg-sky-950/80 text-sky-300 border-sky-600/40',
        dotColor: 'bg-sky-400',
      },
      {
        id: 'Morno',
        label: 'Morno',
        subtitle: 'Em contato ativo ou aguardando decisão/reunião',
        leads: warm,
        accentColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
        headerBadgeColor: 'bg-amber-950/80 text-amber-300 border-amber-600/40',
        dotColor: 'bg-amber-400',
      },
      {
        id: 'Quente',
        label: 'Quente',
        subtitle: 'Negociação avançada, proposta em análise ou fechamento',
        leads: hot,
        accentColor: 'border-rose-500/40 text-rose-400 bg-rose-500/10',
        headerBadgeColor: 'bg-rose-950/80 text-rose-300 border-rose-600/40',
        dotColor: 'bg-rose-400 animate-pulse',
      },
    ];
  }, [filteredLeads]);

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
    setIsRestoredDraft(false);

    const draft = loadDraft<LeadDraftData>(DRAFT_LEAD_CREATE_KEY);
    if (draft && draft.formName?.trim()) {
      setFormName(draft.formName || '');
      setFormCnpj(draft.formCnpj || '');
      setFormCondominiumType(draft.formCondominiumType || 'Residencial');
      setFormAdministrator(draft.formAdministrator || '');
      setFormUnitCount(draft.formUnitCount || '');
      setFormAddress(draft.formAddress || '');
      setFormCity(draft.formCity || '');
      setFormLeadSource(draft.formLeadSource || 'Indicação (BNI/rede)');
      setFormTemperature((draft.formTemperature as 'Frio' | 'Morno' | 'Quente') || 'Morno');
      setFormCurrentStageId(draft.formCurrentStageId || (stages.length > 0 ? stages[0].id : ''));
      setFormResponsibleUserId(draft.formResponsibleUserId || currentProfile.id);
      setFormLossReason(draft.formLossReason || '');
      setFormSelectedServices(draft.formSelectedServices || []);
      setQuizStep(draft.quizStep || 1);
      setIsRestoredDraft(true);
    } else {
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
      setQuizStep(1);
    }

    setSelectedLead(null);
    setModalMode('create');
  };

  const handleDiscardLeadDraft = () => {
    if (modalMode === 'create') {
      clearDraft(DRAFT_LEAD_CREATE_KEY);
    } else if (modalMode === 'edit' && selectedLead) {
      clearDraft(getLeadEditDraftKey(selectedLead.id));
    }
    setIsRestoredDraft(false);
    handleCloseModal();
  };

  // Open modal in edit mode
  const handleOpenEdit = (lead: Lead) => {
    setFormError(null);
    setSelectedLead(lead);

    const editDraft = loadDraft<LeadDraftData>(getLeadEditDraftKey(lead.id));
    if (editDraft && editDraft.formName) {
      setFormName(editDraft.formName);
      setFormCnpj(editDraft.formCnpj || '');
      setFormCondominiumType(editDraft.formCondominiumType || 'Residencial');
      setFormAdministrator(editDraft.formAdministrator || '');
      setFormUnitCount(editDraft.formUnitCount || '');
      setFormAddress(editDraft.formAddress || '');
      setFormCity(editDraft.formCity || '');
      setFormLeadSource(editDraft.formLeadSource || 'Indicação (BNI/rede)');
      setFormTemperature((editDraft.formTemperature as 'Frio' | 'Morno' | 'Quente') || 'Morno');
      setFormCurrentStageId(editDraft.formCurrentStageId || '');
      setFormResponsibleUserId(editDraft.formResponsibleUserId || currentProfile.id);
      setFormLossReason(editDraft.formLossReason || '');
      setFormSelectedServices(editDraft.formSelectedServices || []);
      setQuizStep(editDraft.quizStep || 1);
      setIsRestoredDraft(true);
    } else {
      setFormName(lead.name || '');
      setFormCnpj(lead.cnpj || '');
      setFormCondominiumType(lead.condominium_type || 'Residencial');
      setFormAdministrator(lead.administrator || '');
      setFormUnitCount(lead.unit_count != null ? String(lead.unit_count) : '');
      setFormAddress(lead.address || '');
      setFormCity(lead.city || '');
      setFormLeadSource(lead.lead_source || 'Indicação (BNI/rede)');
      setFormTemperature((lead.temperature as 'Frio' | 'Morno' | 'Quente') || 'Morno');
      const stageId = lead.current_stage_id || (stages.length > 0 ? stages[0].id : '');
      setFormCurrentStageId(stageId);
      setFormResponsibleUserId(lead.responsible_user_id || currentProfile.id);
      const isStageLost = checkIsLostStage(stageId);
      setFormLossReason(isStageLost ? (lead.loss_reason || '') : '');
      setFormSelectedServices(getLeadServices(lead.id));
      setQuizStep(1);
      setIsRestoredDraft(false);
    }

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
    setIsRestoredDraft(false);
  };

  const toggleService = (serviceId: string) => {
    setFormSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

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
      if (unitCountTrimmed) {
        const num = parseInt(unitCountTrimmed, 10);
        if (isNaN(num) || num <= 0) {
          setFormError('O número de unidades deve ser um número válido maior que zero.');
          return;
        }
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

  // Save Lead (Supports saving from ANY current step without navigating to step 6!)
  const handleSubmitLead = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setQuizStep(1);
      setFormError('O nome do condomínio é obrigatório.');
      return;
    }

    let unitCountNum: number | null = null;
    const unitCountTrimmed = formUnitCount.trim();
    if (unitCountTrimmed) {
      const parsed = parseInt(unitCountTrimmed, 10);
      if (isNaN(parsed) || parsed <= 0) {
        setQuizStep(2);
        setFormError('O número de unidades deve ser um valor numérico válido.');
        return;
      }
      unitCountNum = parsed;
    } else if (modalMode === 'edit' && selectedLead?.unit_count != null) {
      unitCountNum = selectedLead.unit_count;
    }

    const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
    const isStageLost = checkIsLostStage(stageIdToUse);

    if (isStageLost && !formLossReason.trim() && quizStep === 5) {
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

      let savedLead: Lead | null = null;

      if (modalMode === 'create') {
        const { data: createdLead, error: createError } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select()
          .single();

        if (createError) throw createError;
        if (!createdLead) throw new Error('Não foi possível recuperar o lead recém-criado.');

        savedLead = createdLead;
        upsertLeadLocally(createdLead, formSelectedServices);
        clearDraft(DRAFT_LEAD_CREATE_KEY);
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${createdLead.name}" cadastrado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedLead) {
        const { data: updatedLead, error: updateError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', selectedLead.id)
          .select()
          .single();

        if (updateError) throw updateError;
        if (!updatedLead) throw new Error('Falha ao atualizar o lead.');

        savedLead = updatedLead;
        upsertLeadLocally(updatedLead, formSelectedServices);
        clearDraft(getLeadEditDraftKey(selectedLead.id));
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${updatedLead.name}" atualizado com sucesso!`,
        });
      }

      // Sync lead_services junction if present
      if (savedLead) {
        await supabase.from('lead_services').delete().eq('lead_id', savedLead.id);

        if (formSelectedServices.length > 0) {
          const serviceInserts = formSelectedServices.map((sId) => ({
            lead_id: savedLead!.id,
            service_id: sId,
          }));
          await supabase.from('lead_services').insert(serviceInserts);
        }

        refreshAll(true);
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
    setIsInteractionRestoredDraft(false);

    const draft = loadDraft<InteractionDraftData>(getInteractionCreateDraftKey(lead.id));
    if (draft && (draft.formInteractionNotes || draft.formInteractionNextFollowUpDate)) {
      setFormInteractionType(draft.formInteractionType || 'Ligação');
      setFormInteractionOccurredAt(draft.formInteractionOccurredAt || '');
      setFormInteractionResponsibleId(draft.formInteractionResponsibleId || currentProfile.id);
      setFormInteractionNotes(draft.formInteractionNotes || '');
      setFormInteractionNextFollowUpDate(draft.formInteractionNextFollowUpDate || '');
      setInteractionQuizStep(draft.interactionQuizStep || 1);
      setIsInteractionRestoredDraft(true);
    } else {
      setFormInteractionType('Ligação');
      const now = new Date();
      const tzOffset = now.getTimezoneOffset() * 60000;
      const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
      setFormInteractionOccurredAt(localISOTime);
      setFormInteractionResponsibleId(currentProfile.id);
      setFormInteractionNotes('');
      setFormInteractionNextFollowUpDate('');
      setInteractionQuizStep(1);
    }

    setInteractionModalMode('create');
  };

  const handleOpenEditInteraction = (interaction: Interaction) => {
    setFormInteractionError(null);
    setSelectedInteraction(interaction);
    setIsInteractionRestoredDraft(false);

    const draft = loadDraft<InteractionDraftData>(getInteractionEditDraftKey(interaction.id));
    if (draft && (draft.formInteractionNotes || draft.formInteractionNextFollowUpDate)) {
      setFormInteractionType(draft.formInteractionType || 'Ligação');
      setFormInteractionOccurredAt(draft.formInteractionOccurredAt || '');
      setFormInteractionResponsibleId(draft.formInteractionResponsibleId || currentProfile.id);
      setFormInteractionNotes(draft.formInteractionNotes || '');
      setFormInteractionNextFollowUpDate(draft.formInteractionNextFollowUpDate || '');
      setInteractionQuizStep(draft.interactionQuizStep || 1);
      setIsInteractionRestoredDraft(true);
    } else {
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
    }

    setInteractionModalMode('edit');
  };

  const handleCloseInteractionModal = () => {
    setInteractionModalMode(null);
    setSelectedInteraction(null);
    setFormInteractionError(null);
    setInteractionQuizStep(1);
    setIsInteractionRestoredDraft(false);
  };

  const handleDiscardInteractionDraft = () => {
    if (interactionModalMode === 'create' && selectedLead) {
      clearDraft(getInteractionCreateDraftKey(selectedLead.id));
    } else if (interactionModalMode === 'edit' && selectedInteraction) {
      clearDraft(getInteractionEditDraftKey(selectedInteraction.id));
    }
    handleCloseInteractionModal();
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
          upsertInteractionLocally(data);
          clearDraft(getInteractionCreateDraftKey(selectedLead.id));
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
          upsertInteractionLocally(data);
          clearDraft(getInteractionEditDraftKey(selectedInteraction.id));
        }
        setStatusFeedback({
          type: 'success',
          message: 'Interação atualizada com sucesso!',
        });
      }

      refreshAll(true);
      handleCloseInteractionModal();
    } catch (err: any) {
      console.error('Error saving interaction:', err);
      setFormInteractionError(err.message || 'Erro ao salvar interação no Supabase.');
    } finally {
      setFormInteractionSaving(false);
    }
  };

  // Contacts Popup Helpers
  const handleOpenContactPopup = (lead: Lead, type: 'whatsapp' | 'email') => {
    setContactPopup({
      open: true,
      lead,
      type,
      mode: 'list',
    });
    setContactFormError(null);
    setNewContactName('');
    setNewContactRolePreset('Síndico');
    setNewContactCustomRole('');
    setNewContactPhone('');
    setNewContactEmail('');
    setNewContactNotes('');
  };

  const handleCloseContactPopup = () => {
    setContactPopup({
      open: false,
      lead: null,
      type: 'whatsapp',
      mode: 'list',
    });
    setContactFormError(null);
  };

  // Copy text helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Clean phone number for WhatsApp link
  const getWhatsAppLink = (phone?: string | null) => {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const cleanNumber = digits.startsWith('55') ? digits : `55${digits}`;
    return `https://wa.me/${cleanNumber}`;
  };

  // Save new contact from popup and link to current lead
  const handleSaveContactFromPopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactPopup.lead) return;
    setContactFormError(null);

    if (!newContactName.trim()) {
      setContactFormError('O nome do contato é obrigatório.');
      return;
    }

    const finalRole =
      newContactRolePreset === 'Outro'
        ? newContactCustomRole.trim() || null
        : newContactRolePreset || null;

    setSavingNewContact(true);

    try {
      const contactPayload = {
        name: newContactName.trim(),
        role_title: finalRole,
        phone: newContactPhone.trim() || null,
        email: newContactEmail.trim() || null,
      };

      const { data: createdContact, error: createError } = await supabase
        .from('contacts')
        .insert([contactPayload])
        .select()
        .single();

      if (createError) throw createError;
      if (!createdContact) throw new Error('Falha ao salvar contato.');

      // Link to current lead
      const { error: linkError } = await supabase
        .from('lead_contacts')
        .insert([{ lead_id: contactPopup.lead.id, contact_id: createdContact.id }]);

      if (linkError) throw linkError;

      // Update local store
      upsertContactLocally(createdContact, [contactPopup.lead.id]);
      refreshAll(true);

      // Return to contact list in popup
      setContactPopup((prev) => ({ ...prev, mode: 'list' }));
      setStatusFeedback({
        type: 'success',
        message: `Contato "${createdContact.name}" vinculado a ${contactPopup.lead.name}!`,
      });
    } catch (err: any) {
      console.error('Error adding contact to lead:', err);
      setContactFormError(err.message || 'Erro ao vincular contato ao condomínio.');
    } finally {
      setSavingNewContact(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
            <span>CRM Comercial</span>
            <span aria-hidden="true">·</span>
            <span>Pipeline de Oportunidades</span>
            {isRefreshing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                sincronizando...
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Pipeline de Leads
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gestão visual por temperatura, histórico e contatos diretos por condomínio.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>Novo Condomínio</span>
          </button>
        </div>
      </div>

      {/* Draft banner if create draft exists and modal closed */}
      {modalMode === null && hasDraft(DRAFT_LEAD_CREATE_KEY) && (
        <div className="mt-4 p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Existe um rascunho de condomínio em andamento.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium cursor-pointer"
            >
              Continuar preenchendo
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft(DRAFT_LEAD_CREATE_KEY);
                setStatusFeedback({ type: 'success', message: 'Rascunho descartado.' });
              }}
              className="px-2.5 py-1 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Feedback Messages */}
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

      {/* Search & Filter Bar */}
      <div className="mt-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por condomínio, cidade ou administradora..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          <svg
            className="w-4 h-4 text-slate-500 absolute left-3.5 top-3"
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

        <div className="flex items-center gap-3">
          {/* Filter by Stage */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Todos os estágios</option>
            {stages.map((stg) => (
              <option key={stg.id} value={stg.id}>
                {stg.name}
              </option>
            ))}
          </select>

          {/* Filter by Responsible */}
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
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

      {/* PIPELINE VISUAL (KANBAN COLUMNS BY TEMPERATURE) */}
      {isInitialLoading && leads.length === 0 ? (
        <div className="mt-12 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-slate-400">Carregando pipeline de condomínios...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="mt-8 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm || responsibleFilter !== 'all' || stageFilter !== 'all'
              ? 'Nenhum condomínio encontrado com esses filtros'
              : 'Nenhum condomínio cadastrado'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
            Cadastre novos leads para acompanhar as oportunidades no pipeline visual por temperatura.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer"
          >
            + Criar primeiro condomínio
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {pipelineColumns.map((col) => (
            <div
              key={col.id}
              className="bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 flex flex-col min-h-[500px]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`} />
                  <h2 className="font-bold text-sm text-white tracking-tight">{col.label}</h2>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold border tabular-nums ${col.headerBadgeColor}`}
                >
                  {col.leads.length}
                </span>
              </div>

              {/* Column Cards */}
              <div className="space-y-3.5 flex-1">
                {col.leads.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 italic border border-dashed border-slate-800/80 rounded-xl bg-slate-950/30">
                    Nenhum condomínio nesta temperatura
                  </div>
                ) : (
                  col.leads.map((lead) => {
                    const stageName = lead.current_stage_id
                      ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
                      : 'Estágio inicial';
                    const responsibleName = lead.responsible_user_id
                      ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
                      : 'Não atribuído';
                    const leadContactsList = getContactsForLead(lead.id);
                    const leadInteractions = getInteractionsForLead(lead.id);
                    const latestInteraction = leadInteractions[0];
                    const leadServicesIds = getLeadServices(lead.id);

                    return (
                      <div
                        key={lead.id}
                        className="bg-slate-950/80 hover:bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl p-4 shadow-md transition-all flex flex-col justify-between group"
                      >
                        <div>
                          {/* Card Title & Stage */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3
                              onClick={() => handleOpenView(lead)}
                              className="font-bold text-sm text-white hover:text-indigo-400 transition-colors cursor-pointer leading-tight line-clamp-2"
                            >
                              {lead.name}
                            </h3>
                          </div>

                          {/* Location, Type & Units */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mb-2.5">
                            {lead.city && <span className="text-slate-300">{lead.city}</span>}
                            {lead.city && <span>·</span>}
                            <span>{lead.condominium_type || 'Residencial'}</span>
                            {lead.unit_count != null && (
                              <>
                                <span>·</span>
                                <span className="text-slate-300 font-medium">{lead.unit_count} un.</span>
                              </>
                            )}
                          </div>

                          {/* Pipeline Stage Tag */}
                          <div className="mb-2.5">
                            <span className="inline-block px-2.5 py-0.5 rounded-lg bg-indigo-950/60 border border-indigo-700/40 text-[11px] font-medium text-indigo-300">
                              {stageName}
                            </span>
                          </div>

                          {/* Administrator & Contact summary */}
                          <div className="space-y-1 text-xs text-slate-400 mb-3 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/60">
                            {lead.administrator && (
                              <div className="truncate">
                                <span className="text-slate-500">Adm:</span>{' '}
                                <span className="text-slate-300 font-medium">{lead.administrator}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-500">Contatos:</span>
                              <span className="text-slate-300 font-semibold">
                                {leadContactsList.length > 0
                                  ? `${leadContactsList.length} cadastrado(s)`
                                  : 'Nenhum'}
                              </span>
                            </div>
                            {latestInteraction && (
                              <div className="text-[11px] text-slate-400 truncate pt-1 border-t border-slate-800/60">
                                <span className="text-slate-500">Última:</span>{' '}
                                {latestInteraction.interaction_type} em {formatDateBR(latestInteraction.occurred_at)}
                              </div>
                            )}
                          </div>

                          {/* Services Tags if any */}
                          {leadServicesIds.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {leadServicesIds.slice(0, 2).map((sId) => (
                                <span
                                  key={sId}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-medium"
                                >
                                  {serviceMap.get(sId) || 'Serviço'}
                                </span>
                              ))}
                              {leadServicesIds.length > 2 && (
                                <span className="text-[10px] text-slate-500 self-center">
                                  +{leadServicesIds.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* CARD FOOTER: Actions & Responsible */}
                        <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-300 uppercase">
                              {responsibleName.charAt(0)}
                            </div>
                            <span className="text-[11px] text-slate-400 truncate max-w-[80px]">
                              {responsibleName}
                            </span>
                          </div>

                          {/* Action Icons in Footer */}
                          <div className="flex items-center gap-1">
                            {/* WhatsApp Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenContactPopup(lead, 'whatsapp')}
                              title="Contatos e WhatsApp"
                              aria-label="Contatos e WhatsApp"
                              className="p-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-700/50 transition-all cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                            </button>

                            {/* Email Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenContactPopup(lead, 'email')}
                              title="Contatos e E-mail"
                              aria-label="Contatos e E-mail"
                              className="p-1.5 rounded-lg bg-sky-950/60 hover:bg-sky-900/80 text-sky-400 border border-sky-700/50 transition-all cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </button>

                            {/* Direct Interaction Shortcut */}
                            <button
                              type="button"
                              onClick={() => handleOpenCreateInteraction(lead)}
                              title="Registrar interação"
                              aria-label="Registrar interação"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-950/60 border border-transparent hover:border-indigo-800/50 transition-all cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                            </button>

                            {/* Edit Pencil Icon */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(lead)}
                              title="Editar condomínio"
                              aria-label="Editar condomínio"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent transition-all cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* POPUP DE CONTATOS (WHATSAPP E E-MAIL) */}
      {contactPopup.open && contactPopup.lead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[85vh]">
            {/* Popup Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    contactPopup.type === 'whatsapp'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                      : 'bg-sky-950 text-sky-400 border border-sky-700/50'
                  }`}
                >
                  {contactPopup.type === 'whatsapp' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    {contactPopup.type === 'whatsapp' ? 'WhatsApp & Telefones' : 'E-mails de Contato'}
                  </h3>
                  <p className="text-xs text-slate-400 truncate max-w-[260px]">
                    {contactPopup.lead.name}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {contactPopup.mode === 'list' && (
                  <button
                    type="button"
                    onClick={() => setContactPopup((prev) => ({ ...prev, mode: 'add' }))}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer flex items-center gap-1"
                  >
                    + Novo
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseContactPopup}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Popup Content */}
            <div className="p-6 overflow-y-auto flex-1 text-sm">
              {contactPopup.mode === 'list' ? (
                /* CONTACTS LIST */
                <div className="space-y-3">
                  {(() => {
                    const leadContacts = getContactsForLead(contactPopup.lead.id);

                    if (leadContacts.length === 0) {
                      return (
                        <div className="text-center py-8 bg-slate-950/60 rounded-2xl border border-slate-800 p-6">
                          <p className="text-xs text-slate-400 mb-3">
                            Nenhum contato cadastrado para este condomínio.
                          </p>
                          <button
                            type="button"
                            onClick={() => setContactPopup((prev) => ({ ...prev, mode: 'add' }))}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
                          >
                            + Adicionar contato
                          </button>
                        </div>
                      );
                    }

                    return leadContacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl flex flex-col gap-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-bold text-sm text-white">{contact.name}</h4>
                            <span className="text-xs text-indigo-400 font-medium">
                              {contact.role_title || 'Contato do Condomínio'}
                            </span>
                          </div>
                        </div>

                        {/* WhatsApp / Phone Row */}
                        {contactPopup.type === 'whatsapp' && (
                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                            <span className="text-xs text-slate-300 font-mono">
                              {contact.phone || 'Sem telefone'}
                            </span>
                            {contact.phone ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(contact.phone!, contact.id)}
                                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
                                >
                                  {copiedId === contact.id ? 'Copiado!' : 'Copiar'}
                                </button>
                                <a
                                  href={getWhatsAppLink(contact.phone)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5"
                                >
                                  <span>Conversar no WhatsApp</span>
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-500">Telefone não informado</span>
                            )}
                          </div>
                        )}

                        {/* Email Row */}
                        {contactPopup.type === 'email' && (
                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                            <span className="text-xs text-slate-300 truncate max-w-[200px]">
                              {contact.email || 'Sem e-mail'}
                            </span>
                            {contact.email ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(contact.email!, contact.id)}
                                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
                                >
                                  {copiedId === contact.id ? 'Copiado!' : 'Copiar'}
                                </button>
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5"
                                >
                                  <span>Enviar E-mail</span>
                                </a>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-500">E-mail não informado</span>
                            )}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                /* ADD CONTACT FORM IN POPUP */
                <form onSubmit={handleSaveContactFromPopup} className="space-y-4">
                  {contactFormError && (
                    <div className="p-3 bg-rose-950 border border-rose-600/50 rounded-xl text-xs text-rose-200">
                      {contactFormError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Nome Completo <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Ex: Carlos Síndico"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Vínculo / Cargo
                    </label>
                    <select
                      value={newContactRolePreset}
                      onChange={(e) => setNewContactRolePreset(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {PRESET_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    {newContactRolePreset === 'Outro' && (
                      <input
                        type="text"
                        value={newContactCustomRole}
                        onChange={(e) => setNewContactCustomRole(e.target.value)}
                        placeholder="Especifique o cargo..."
                        className="mt-2 w-full px-3.5 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      WhatsApp / Telefone {contactPopup.type === 'whatsapp' && <span className="text-emerald-400 font-normal">(Principal)</span>}
                    </label>
                    <input
                      type="text"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      E-mail {contactPopup.type === 'email' && <span className="text-sky-400 font-normal">(Principal)</span>}
                    </label>
                    <input
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      placeholder="contato@condominio.com"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Observação (opcional)
                    </label>
                    <input
                      type="text"
                      value={newContactNotes}
                      onChange={(e) => setNewContactNotes(e.target.value)}
                      placeholder="Ex: Melhor horário para contato: após as 18h"
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setContactPopup((prev) => ({ ...prev, mode: 'list' }))}
                      disabled={savingNewContact}
                      className="px-3 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingNewContact}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {savingNewContact ? 'Salvando...' : 'Salvar Contato'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC QUIZ-STYLE MODAL FOR LEAD CREATE / EDIT WITH INSTANT SAVE BUTTON */}
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
                  {isRestoredDraft && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300">
                      Rascunho recuperado
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* DIRECT SAVE BUTTON AVAILABLE IN ALL STEPS */}
                  <button
                    type="button"
                    onClick={handleSubmitLead}
                    disabled={formSaving || !formName.trim()}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                    title="Gravar alterações agora sem precisar navegar todos os passos"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{formSaving ? 'Salvando...' : 'Salvar agora'}</span>
                  </button>

                  {isRestoredDraft && (
                    <button
                      type="button"
                      onClick={handleDiscardLeadDraft}
                      className="text-xs text-rose-400 hover:text-rose-300 mr-1 cursor-pointer"
                    >
                      Descartar
                    </button>
                  )}
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
                      CNPJ (opcional)
                    </label>
                    <input
                      type="text"
                      value={formCnpj}
                      onChange={(e) => setFormCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Perfil do Condomínio */}
              {quizStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Características do condomínio
                    </h3>
                    <p className="text-xs text-slate-400">
                      Selecione o tipo e a quantidade total de unidades/apartamentos.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Tipo de Condomínio
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {CONDOMINIUM_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormCondominiumType(type)}
                          className={`p-3 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                            formCondominiumType === type
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Número de Unidades
                    </label>
                    <input
                      type="number"
                      autoFocus
                      min="1"
                      value={formUnitCount}
                      onChange={(e) => setFormUnitCount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleNextQuizStep();
                        }
                      }}
                      placeholder="Ex: 80"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Localização & Administradora */}
              {quizStep === 3 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Onde fica e quem administra?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Preencha a cidade, endereço e administradora.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Cidade
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      placeholder="Ex: São Paulo, Rio de Janeiro..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Endereço Completo
                    </label>
                    <input
                      type="text"
                      value={formAddress}
                      onChange={(e) => setFormAddress(e.target.value)}
                      placeholder="Ex: Av. Paulista, 1000 - Bela Vista"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Administradora Responsável
                    </label>
                    <input
                      type="text"
                      value={formAdministrator}
                      onChange={(e) => setFormAdministrator(e.target.value)}
                      placeholder="Ex: Lello, Hub, CIPA..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Origem & Serviços */}
              {quizStep === 4 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Origem & Serviços de Interesse
                    </h3>
                    <p className="text-xs text-slate-400">
                      Como conheceu a Triverus e quais soluções têm demanda?
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Origem do Lead
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {LEAD_SOURCES.map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setFormLeadSource(src)}
                          className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                            formLeadSource === src
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {src}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Serviços / Oportunidades
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {services.map((srv) => {
                        const isChecked = formSelectedServices.includes(srv.id);
                        return (
                          <button
                            key={srv.id}
                            type="button"
                            onClick={() => toggleService(srv.id)}
                            className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex items-center justify-between ${
                              isChecked
                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <span className="truncate">{srv.name || srv.title || 'Serviço'}</span>
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                                isChecked ? 'bg-indigo-600 text-white' : 'border border-slate-700'
                              }`}
                            >
                              {isChecked ? '✓' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Pipeline & Temperatura */}
              {quizStep === 5 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Pipeline Comercial & Temperatura
                    </h3>
                    <p className="text-xs text-slate-400">
                      Defina a temperatura no pipeline, estágio atual e responsável.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Temperatura do Lead
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {TEMPERATURE_OPTIONS.map((temp) => (
                        <button
                          key={temp}
                          type="button"
                          onClick={() => setFormTemperature(temp)}
                          className={`p-2.5 rounded-xl border text-center text-xs font-semibold transition-all cursor-pointer ${
                            formTemperature === temp
                              ? temp === 'Quente'
                                ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                                : temp === 'Frio'
                                ? 'bg-sky-950/60 border-sky-500 text-sky-300'
                                : 'bg-amber-950/60 border-amber-500 text-amber-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          {temp}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Estágio do Funil
                    </label>
                    <select
                      value={formCurrentStageId}
                      onChange={(e) => handleStageChange(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-sm focus:outline-none transition-colors"
                    >
                      {stages.map((stg) => (
                        <option key={stg.id} value={stg.id}>
                          {stg.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {checkIsLostStage(formCurrentStageId) && (
                    <div className="animate-in fade-in duration-150">
                      <label className="block text-xs font-medium text-rose-400 mb-1.5">
                        Motivo da Perda <span className="text-rose-400">*</span>
                      </label>
                      <textarea
                        rows={2}
                        value={formLossReason}
                        onChange={(e) => setFormLossReason(e.target.value)}
                        placeholder="Explique o motivo do descarte ou recusa..."
                        className="w-full px-4 py-2.5 bg-slate-950 border border-rose-900/60 focus:border-rose-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Responsável Interno
                    </label>
                    <select
                      value={formResponsibleUserId}
                      onChange={(e) => setFormResponsibleUserId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-sm focus:outline-none transition-colors"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || 'Sem nome'} {p.id === currentProfile.id ? '(Você)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* STEP 6: Resumo & Confirmação */}
              {quizStep === 6 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Revisão do Condomínio
                    </h3>
                    <p className="text-xs text-slate-400">
                      Confira todos os dados antes de salvar.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
                    <div className="flex justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-slate-400">Nome:</span>
                      <span className="font-semibold text-white">{formName || '-'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-slate-400">Tipo / Unidades:</span>
                      <span className="font-semibold text-white">
                        {formCondominiumType} ({formUnitCount || '0'} un.)
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-slate-400">Cidade:</span>
                      <span className="font-semibold text-white">{formCity || '-'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-slate-400">Administradora:</span>
                      <span className="font-semibold text-white">{formAdministrator || '-'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-slate-400">Temperatura / Estágio:</span>
                      <span className="font-semibold text-indigo-300">
                        {formTemperature} · {stageMap.get(formCurrentStageId) || 'Estágio inicial'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Responsável:</span>
                      <span className="font-semibold text-white">
                        {profileMap.get(formResponsibleUserId) || currentProfile.full_name || 'Você'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quiz Navigation Footer */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <div>
                {quizStep > 1 && (
                  <button
                    type="button"
                    onClick={handlePrevQuizStep}
                    disabled={formSaving}
                    className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    ← Voltar
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={formSaving}
                  className="px-3 py-2 text-slate-400 hover:text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancelar
                </button>

                {quizStep < totalQuizSteps ? (
                  <button
                    type="button"
                    onClick={handleNextQuizStep}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Avançar</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitLead}
                    disabled={formSaving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {formSaving ? 'Salvando...' : modalMode === 'create' ? 'Concluir Cadastro' : 'Salvar Alterações'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {modalMode === 'view' && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            <div className="px-6 py-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider block">
                  Detalhes da Conta
                </span>
                <h2 className="text-xl font-bold text-white">{selectedLead.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleCloseModal();
                    handleOpenEdit(selectedLead);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto space-y-6 text-sm">
              {/* Key details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Temperatura
                  </span>
                  <span className="font-semibold text-xs text-indigo-300">
                    {selectedLead.temperature || 'Morno'}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Estágio
                  </span>
                  <span className="text-xs font-semibold text-indigo-300 block truncate">
                    {stageMap.get(selectedLead.current_stage_id || '') || 'Inicial'}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Unidades
                  </span>
                  <span className="text-xs font-semibold text-white block">
                    {selectedLead.unit_count != null ? `${selectedLead.unit_count} un.` : '-'}
                  </span>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Responsável
                  </span>
                  <span className="text-xs font-semibold text-white block truncate">
                    {profileMap.get(selectedLead.responsible_user_id || '') || 'Não atribuído'}
                  </span>
                </div>
              </div>

              {/* Informações Gerais */}
              <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-2xl space-y-2 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-400 block mb-0.5">CNPJ:</span>
                    <span className="text-slate-200 font-mono">{selectedLead.cnpj || 'Não informado'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Administradora:</span>
                    <span className="text-slate-200 font-medium">{selectedLead.administrator || 'Não informada'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Cidade:</span>
                    <span className="text-slate-200">{selectedLead.city || 'Não informada'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Endereço:</span>
                    <span className="text-slate-200">{selectedLead.address || 'Não informado'}</span>
                  </div>
                </div>
              </div>

              {/* CONTATOS DO CONDOMÍNIO */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Contatos Vinculados
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-semibold">
                      {getContactsForLead(selectedLead.id).length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenContactPopup(selectedLead, 'whatsapp')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <span>+ Gerenciar Contatos</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {getContactsForLead(selectedLead.id).map((c) => (
                    <div key={c.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-white">{c.name}</div>
                        <div className="text-slate-400 text-[11px]">{c.role_title || 'Contato Geral'}</div>
                      </div>
                      <div className="flex items-center gap-3 text-slate-300 text-[11px]">
                        {c.phone && <span>{c.phone}</span>}
                        {c.email && <span>{c.email}</span>}
                      </div>
                    </div>
                  ))}
                  {getContactsForLead(selectedLead.id).length === 0 && (
                    <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl text-center text-xs text-slate-500">
                      Nenhum contato vinculado a este condomínio.
                    </div>
                  )}
                </div>
              </div>

              {/* HISTÓRICO DE INTERAÇÕES */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Histórico de Interações
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-semibold">
                      {getInteractionsForLead(selectedLead.id).length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateInteraction(selectedLead)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Registrar interação</span>
                  </button>
                </div>

                {getInteractionsForLead(selectedLead.id).length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-400">
                    Nenhuma interação registrada para este condomínio.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {getInteractionsForLead(selectedLead.id).map((interaction) => (
                      <div
                        key={interaction.id}
                        className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-indigo-300 font-semibold text-[11px]">
                              {interaction.interaction_type}
                            </span>
                            <span className="text-slate-400 text-[11px]">
                              {formatDateTimeBR(interaction.occurred_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400">
                              Por: <strong>{profileMap.get(interaction.responsible_user_id || '') || 'Equipe'}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenEditInteraction(interaction)}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer ml-1"
                            >
                              Editar
                            </button>
                          </div>
                        </div>

                        {interaction.notes && (
                          <p className="text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 whitespace-pre-wrap">
                            {interaction.notes}
                          </p>
                        )}

                        {interaction.next_follow_up_date && (
                          <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/60">
                            <span className="text-slate-400">Próximo follow-up agendado:</span>
                            <span
                              className={`font-semibold ${
                                getFollowUpStatus(interaction.next_follow_up_date) === 'overdue'
                                  ? 'text-amber-400'
                                  : getFollowUpStatus(interaction.next_follow_up_date) === 'today'
                                  ? 'text-indigo-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {formatDateBR(interaction.next_follow_up_date)}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK DYNAMIC QUIZ MODAL FOR INTERACTIONS */}
      {interactionModalMode && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-300">
                    Passo {interactionQuizStep} de {totalInteractionQuizSteps}
                  </span>
                  <span className="text-xs text-slate-300 truncate max-w-[200px]">
                    {selectedLead.name}
                  </span>
                  {isInteractionRestoredDraft && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300">
                      Rascunho
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isInteractionRestoredDraft && (
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
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
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
                  style={{ width: `${(interactionQuizStep / totalInteractionQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto flex-1 text-sm">
              {formInteractionError && (
                <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                  {formInteractionError}
                </div>
              )}

              {/* STEP 1: Tipo & Data */}
              {interactionQuizStep === 1 && (
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
                        onClick={() => setFormInteractionType(type)}
                        className={`p-3 rounded-xl border text-center text-xs font-semibold transition-all cursor-pointer ${
                          formInteractionType === type
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
                      value={formInteractionOccurredAt}
                      onChange={(e) => setFormInteractionOccurredAt(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Observações / Anotações */}
              {interactionQuizStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      O que foi tratado nesta interação?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Anote os principais pontos discutidos, objeções ou decisões tomadas.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Observações (opcional)
                    </label>
                    <textarea
                      rows={5}
                      autoFocus
                      value={formInteractionNotes}
                      onChange={(e) => setFormInteractionNotes(e.target.value)}
                      placeholder="Ex: Falamos com o síndico sobre a proposta comercial..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Próximo Follow-up */}
              {interactionQuizStep === 3 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Agendar próximo follow-up?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Se necessário, defina a data limite para o próximo contato com este lead.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Data do Próximo Follow-up (opcional)
                    </label>
                    <input
                      type="date"
                      autoFocus
                      value={formInteractionNextFollowUpDate}
                      onChange={(e) => setFormInteractionNextFollowUpDate(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Responsável & Confirmação */}
              {interactionQuizStep === 4 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Confirmar registro de interação
                    </h3>
                    <p className="text-xs text-slate-400">
                      Verifique o responsável e confirme a gravação.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Responsável pelo Registro
                    </label>
                    <select
                      value={formInteractionResponsibleId}
                      onChange={(e) => setFormInteractionResponsibleId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none transition-colors"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || 'Sem nome'} {p.id === currentProfile.id ? '(Você)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-1.5 text-slate-300">
                    <div>Tipo: <strong>{formInteractionType}</strong></div>
                    {formInteractionNextFollowUpDate && (
                      <div>Próximo Follow-up: <strong>{formatDateBR(formInteractionNextFollowUpDate)}</strong></div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <div>
                {interactionQuizStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setInteractionQuizStep((p) => p - 1)}
                    disabled={formInteractionSaving}
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
                  disabled={formInteractionSaving}
                  className="px-3 py-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancelar
                </button>

                {interactionQuizStep < totalInteractionQuizSteps ? (
                  <button
                    type="button"
                    onClick={() => setInteractionQuizStep((p) => p + 1)}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitInteraction}
                    disabled={formInteractionSaving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {formInteractionSaving ? 'Salvando...' : 'Salvar Interação'}
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
