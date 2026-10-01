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
  // Use Centralized In-Memory & Cached CRM store
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
    upsertInteractionLocally,
    getLeadServices,
    getContactsForLead,
    getInteractionsForLead,
  } = useCRM();

  // UI View Mode (Default is Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  // Search & feedback states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isRestoredDraft, setIsRestoredDraft] = useState<boolean>(false);

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

    // Check if there is an active create draft
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
      setFormTemperature(createDraft.formTemperature || 'Morno');
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
      // Only save if user has inputted something
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

  // Filter leads by search term locally in memory
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
    setIsRestoredDraft(false);

    // Check if there is an existing draft
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
      setFormTemperature(draft.formTemperature || 'Morno');
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

  // Discard draft explicitly
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
      setFormTemperature(editDraft.formTemperature || 'Morno');
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
      setFormTemperature(lead.temperature || 'Morno');
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

      // Sync lead_services junction
      if (savedLead) {
        await supabase.from('lead_services').delete().eq('lead_id', savedLead.id);

        if (formSelectedServices.length > 0) {
          const serviceInserts = formSelectedServices.map((sId) => ({
            lead_id: savedLead!.id,
            service_id: sId,
          }));
          await supabase.from('lead_services').insert(serviceInserts);
        }

        // Silent background sync
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

    // Check if interaction draft exists for this lead
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
            {isRefreshing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                sincronizando...
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Condomínios & Leads
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gestão de oportunidades comerciais, contas e histórico de relacionamentos.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* View Mode Toggle: Cards vs List */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              title="Visualização em Cards"
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
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
              title="Visualização em Lista"
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'list'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>

          {/* New Lead Button */}
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
            <span>Existe um rascunho salvo para criação de condomínio.</span>
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

      {/* Search Bar */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
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

        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span>Total: <strong>{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'registro' : 'registros'}</span>
        </div>
      </div>

      {/* Main Content: Cards or List */}
      {isInitialLoading && leads.length === 0 ? (
        <div className="mt-12 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-slate-400">Carregando condomínios...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="mt-8 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm ? 'Nenhum resultado encontrado' : 'Nenhum condomínio cadastrado'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
            {searchTerm
              ? 'Tente ajustar os termos de busca para encontrar o condomínio.'
              : 'Cadastre o primeiro lead de condomínio para iniciar o pipeline comercial.'}
          </p>
          {!searchTerm && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer"
            >
              + Criar primeiro condomínio
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW (DEFAULT) */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredLeads.map((lead) => {
            const stageName = lead.current_stage_id
              ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
              : 'Estágio inicial';
            const responsibleName = lead.responsible_user_id
              ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
              : 'Não atribuído';
            const leadServicesIds = getLeadServices(lead.id);
            const leadInteractions = getInteractionsForLead(lead.id);
            const latestInteraction = leadInteractions[0];
            const leadContactsList = getContactsForLead(lead.id);

            return (
              <div
                key={lead.id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all group hover:shadow-xl hover:shadow-indigo-950/20"
              >
                <div>
                  {/* Card Header: Condominium Name + Temperature */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3
                        onClick={() => handleOpenView(lead)}
                        className="font-bold text-base text-white hover:text-indigo-400 transition-colors cursor-pointer leading-snug line-clamp-1"
                      >
                        {lead.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                        {lead.city && <span>{lead.city}</span>}
                        {lead.city && lead.condominium_type && <span>·</span>}
                        <span>{lead.condominium_type || 'Residencial'}</span>
                      </div>
                    </div>
                    {getTemperatureBadge(lead.temperature)}
                  </div>

                  {/* Stage & Units Stats */}
                  <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-0.5">
                        Estágio
                      </span>
                      <span className="font-semibold text-indigo-300 truncate block">
                        {stageName}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-0.5">
                        Unidades
                      </span>
                      <span className="font-semibold text-slate-200 block">
                        {lead.unit_count != null ? `${lead.unit_count} un.` : '-'}
                      </span>
                    </div>
                  </div>

                  {/* Contact preview or Administrator */}
                  <div className="space-y-1.5 text-xs text-slate-300 mb-3">
                    {lead.administrator && (
                      <div className="flex items-center gap-1.5 text-slate-400 truncate">
                        <span className="text-slate-500">Adm:</span>
                        <span className="truncate">{lead.administrator}</span>
                      </div>
                    )}
                    {leadContactsList.length > 0 && (
                      <div className="flex items-center gap-1.5 text-slate-300 truncate">
                        <span className="text-slate-500">Contato:</span>
                        <span className="truncate font-medium">{leadContactsList[0].name}</span>
                        {leadContactsList[0].role_title && (
                          <span className="text-slate-400 text-[11px]">
                            ({leadContactsList[0].role_title})
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Services tags */}
                  {leadServicesIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {leadServicesIds.slice(0, 3).map((sId) => (
                        <span
                          key={sId}
                          className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/60 text-[10px] text-slate-300 font-medium"
                        >
                          {serviceMap.get(sId) || 'Serviço'}
                        </span>
                      ))}
                      {leadServicesIds.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-800/50 text-[10px] text-slate-400">
                          +{leadServicesIds.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Latest Interaction preview if available */}
                  {latestInteraction && (
                    <div className="mt-3 pt-3 border-t border-slate-800/60 text-xs">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span className="flex items-center gap-1">
                          Última interação: {getInteractionTypeBadge(latestInteraction.interaction_type)}
                        </span>
                        <span>{formatDateBR(latestInteraction.occurred_at)}</span>
                      </div>
                      {latestInteraction.next_follow_up_date && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Próximo follow-up:</span>
                          <span
                            className={`font-semibold ${
                              getFollowUpStatus(latestInteraction.next_follow_up_date) === 'overdue'
                                ? 'text-amber-400'
                                : getFollowUpStatus(latestInteraction.next_follow_up_date) === 'today'
                                ? 'text-indigo-400'
                                : 'text-slate-300'
                            }`}
                          >
                            {formatDateBR(latestInteraction.next_follow_up_date)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer: Responsible & Action Buttons */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-300 uppercase">
                      {responsibleName.charAt(0)}
                    </div>
                    <span className="text-xs text-slate-400 truncate max-w-[110px]">
                      {responsibleName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Direct Quick Interaction Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenCreateInteraction(lead)}
                      title="Registrar interação"
                      aria-label="Registrar interação"
                      className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/60 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
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
                  {isRestoredDraft && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300">
                      Rascunho recuperado
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isRestoredDraft && (
                    <button
                      type="button"
                      onClick={handleDiscardLeadDraft}
                      className="text-xs text-rose-400 hover:text-rose-300 mr-2 cursor-pointer"
                    >
                      Descartar rascunho
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
                      Número de Unidades <span className="text-rose-400">*</span>
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
                      Preencha o endereço e os dados da administradora contratada.
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

              {/* STEP 4: Origem & Serviços de Interesse */}
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

              {/* STEP 5: Pipeline, Temperatura & Responsável */}
              {quizStep === 5 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Pipeline Comercial
                    </h3>
                    <p className="text-xs text-slate-400">
                      Defina a temperatura, o estágio atual do funil e o responsável interno.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Temperatura
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
                      Confira todos os dados antes de finalizar o cadastro.
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
                        {formCondominiumType} ({formUnitCount} un.)
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
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium transition-colors cursor-pointer"
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
                  {getTemperatureBadge(selectedLead.temperature)}
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
                            {getInteractionTypeBadge(interaction.interaction_type)}
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
                      placeholder="Ex: Falamos com o síndico sobre a proposta de portaria remota. Ele pediu para reavaliar os valores..."
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
