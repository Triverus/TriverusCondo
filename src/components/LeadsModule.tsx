import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';
import { useCRM, type Lead, type PipelineStage, type ServiceItem, type Contact, type Interaction } from '../lib/crmStore.tsx';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../lib/draftStorage.ts';
import {
  WhatsAppIcon,
  EmailIcon,
  EditIcon,
  NotesIcon,
  FolderIcon,
  TrashIcon,
  PipelineToolbar,
  PipelineBoard,
  PipelineColumn,
  LeadCard,
} from './PipelineComponents.tsx';
import {
  BentoViewConfigModal,
  DEFAULT_PIPELINE_VIEW_CONFIG,
  type PipelineViewConfig,
} from './BentoViewConfigModal.tsx';
import {
  formatDateBR,
  parseCalendarDate,
  getFollowUpTime,
  saveFollowUpTime,
} from '../lib/dateUtils.ts';
import UnifiedNoteModal from './UnifiedNoteModal.tsx';
import NotesTimelineModal from './NotesTimelineModal.tsx';

interface LeadsModuleProps {
  currentProfile: UserProfile;
  initialSelectedLeadId?: string | null;
  onClearInitialLead?: () => void;
  currentModule?: 'pipeline' | 'followups';
  onSelectModule?: (mod: 'pipeline' | 'followups') => void;
}

export const INTERACTION_TYPES = [
  'Ligação',
  'WhatsApp',
  'E-mail',
  'Reunião',
  'Evento',
  'Redes Sociais',
  'Visita',
  'Outro',
] as const;

export const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
  'Gerente Predial',
  'Outro',
];

const CONDOMINIUM_TYPES = [
  'Residencial',
  'Comercial',
  'Associação de Moradores',
  'Misto',
];

export const TEMPERATURE_OPTIONS = ['Frio', 'Morno', 'Quente', 'Cliente'] as const;

export function sanitizeTemperatureForDB(temp?: string | null): string {
  if (!temp) return 'Morno';
  const val = temp.trim().toLowerCase();
  if (val === 'frio' || val === 'cold') return 'Frio';
  if (val === 'morno' || val === 'warm') return 'Morno';
  if (val === 'quente' || val === 'hot') return 'Quente';
  if (val === 'cliente' || val === 'client' || val === 'ganho' || val === 'won') return 'Cliente';
  return 'Morno';
}

export function sanitizeInteractionTypeForDB(type?: string | null): string {
  if (!type) return 'Ligação';
  const val = type.trim();
  const lower = val.toLowerCase();
  if (lower.includes('liga') || lower.includes('call') || lower.includes('tel')) return 'Ligação';
  if (lower.includes('whats') || lower.includes('zap') || lower.includes('msg')) return 'WhatsApp';
  if (lower.includes('mail')) return 'E-mail';
  if (lower.includes('reun') || lower.includes('meet')) return 'Reunião';
  if (lower.includes('event')) return 'Evento';
  if (lower.includes('visit')) return 'Visita';
  if (lower.includes('outro') || lower.includes('other') || lower.includes('nota')) return 'Outro';
  return 'Ligação';
}

async function saveInteractionToSupabase(
  mode: 'insert' | 'update',
  payload: any,
  interactionId?: string
) {
  const primaryType = sanitizeInteractionTypeForDB(payload.interaction_type);
  const attemptPayload = { ...payload, interaction_type: primaryType };

  const query = mode === 'insert'
    ? supabase.from('interactions').insert([attemptPayload]).select().single()
    : supabase.from('interactions').update(attemptPayload).eq('id', interactionId!).select().single();

  const res = await query;
  if (!res.error && res.data) return res.data;

  // Fallback for check constraint violation (code 23514)
  if (res.error && res.error.code === '23514') {
    const candidateTypes = ['Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Outro', 'Anotação', 'call', 'meeting', 'email', 'other'];
    for (const cand of candidateTypes) {
      if (cand === primaryType) continue;
      const retryPayload = { ...payload, interaction_type: cand };
      const retryQuery = mode === 'insert'
        ? supabase.from('interactions').insert([retryPayload]).select().single()
        : supabase.from('interactions').update(retryPayload).eq('id', interactionId!).select().single();
      const retryRes = await retryQuery;
      if (!retryRes.error && retryRes.data) {
        return retryRes.data;
      }
    }
  }

  throw res.error;
}

const LEAD_FOLDERS_STORAGE_KEY = 'triverus:lead-folder-links:v1';

export function getLeadFolderLink(leadId: string): string {
  try {
    const raw = localStorage.getItem(LEAD_FOLDERS_STORAGE_KEY);
    if (!raw) return '';
    const map = JSON.parse(raw);
    return map[leadId] || '';
  } catch {
    return '';
  }
}

export function saveLeadFolderLink(leadId: string, url: string): void {
  try {
    const raw = localStorage.getItem(LEAD_FOLDERS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (url.trim()) {
      map[leadId] = url.trim();
    } else {
      delete map[leadId];
    }
    localStorage.setItem(LEAD_FOLDERS_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

const DRAFT_LEAD_CREATE_KEY = 'triverus_draft_lead_create';
const getLeadEditDraftKey = (id: string) => `triverus_draft_lead_edit_${id}`;
const getInteractionCreateDraftKey = (leadId: string) => `triverus_draft_interaction_create_${leadId}`;

interface LeadDraftData {
  quizStep: number;
  formName: string;
  formCnpj: string;
  formCondominiumType: string;
  formAdministrator: string;
  formUnitCount: string;
  formAddress: string;
  formCity: string;
  formTemperature: string;
  formCurrentStageId: string;
  formResponsibleUserId: string;
}

interface InteractionDraftData {
  interactionQuizStep: number;
  formInteractionType: string;
  formInteractionOccurredAt: string;
  formInteractionResponsibleId: string;
  formInteractionNotes: string;
  formInteractionNextFollowUpDate: string;
}

// Operational Follow-up Status Helper
function getFollowUpDisplay(
  dateStr?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): {
  label: string;
  type: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'none';
  badgeClass: string;
  rawDate?: string | null;
  time?: string | null;
  displayFull?: string;
} {
  if (!dateStr || !dateStr.trim()) {
    return {
      label: 'Sem contato marcado',
      type: 'none',
      badgeClass: 'text-slate-500 font-normal hover:text-indigo-300',
      displayFull: 'Sem contato marcado',
    };
  }

  const target = parseCalendarDate(dateStr);
  if (!target) {
    return {
      label: 'Sem contato marcado',
      type: 'none',
      badgeClass: 'text-slate-500 font-normal hover:text-indigo-300',
      displayFull: 'Sem contato marcado',
    };
  }

  const time = getFollowUpTime(dateStr, interactionId, leadId);
  const now = new Date();
  const targetDateOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((targetDateOnly - todayDateOnly) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const formattedDate = target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return {
      label: `Atrasado (${formattedDate})`,
      type: 'overdue',
      badgeClass: 'text-rose-400 font-semibold',
      rawDate: dateStr,
      time,
      displayFull: `Atrasado: ${formattedDate} ${time}`,
    };
  }

  if (diffDays === 0) {
    return {
      label: 'Hoje',
      type: 'today',
      badgeClass: 'text-amber-400 font-bold',
      rawDate: dateStr,
      time,
      displayFull: `Hoje às ${time}`,
    };
  }

  if (diffDays === 1) {
    return {
      label: 'Amanhã',
      type: 'tomorrow',
      badgeClass: 'text-sky-300 font-medium',
      rawDate: dateStr,
      time,
      displayFull: `Amanhã às ${time}`,
    };
  }

  const formattedDate = target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return {
    label: formattedDate,
    type: 'upcoming',
    badgeClass: 'text-slate-300 font-medium',
    rawDate: dateStr,
    time,
    displayFull: `${formattedDate} às ${time}`,
  };
}

function formatDateTimeBR(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const d = parseCalendarDate(dateStr);
    if (!d) return dateStr;
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

export { formatDateBR };

export default function LeadsModule({
  currentProfile,
  initialSelectedLeadId,
  onClearInitialLead,
  currentModule = 'pipeline',
  onSelectModule,
}: LeadsModuleProps) {
  const {
    leads,
    stages,
    profiles,
    services,
    contacts,
    leadContacts,
    interactions,
    isInitialLoading,
    isRefreshing,
    stageMap,
    profileMap,
    serviceMap,
    refreshAll,
    upsertLeadLocally,
    upsertContactLocally,
    upsertInteractionLocally,
    deleteContactLocally,
    deleteInteractionLocally,
    deleteLeadLocally,
    getLeadServices,
    getContactsForLead,
    getInteractionsForLead,
  } = useCRM();

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-dismiss status feedback notification toast after 2.5s
  useEffect(() => {
    if (statusFeedback) {
      const timer = setTimeout(() => {
        setStatusFeedback(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [statusFeedback]);

  // View Customization Config (LocalStorage Persistence)
  const PIPELINE_VIEW_CONFIG_KEY = 'triverus:pipeline-view-config:v1';

  const [viewConfig, setViewConfig] = useState<PipelineViewConfig>(() => {
    try {
      const stored = localStorage.getItem(PIPELINE_VIEW_CONFIG_KEY);
      return stored ? { ...DEFAULT_PIPELINE_VIEW_CONFIG, ...JSON.parse(stored) } : DEFAULT_PIPELINE_VIEW_CONFIG;
    } catch {
      return DEFAULT_PIPELINE_VIEW_CONFIG;
    }
  });

  const [isBentoModalOpen, setIsBentoModalOpen] = useState(false);

  const handleUpdateViewConfig = (key: keyof PipelineViewConfig, val: boolean) => {
    setViewConfig((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem(PIPELINE_VIEW_CONFIG_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleResetViewConfig = () => {
    setViewConfig(DEFAULT_PIPELINE_VIEW_CONFIG);
    try {
      localStorage.setItem(PIPELINE_VIEW_CONFIG_KEY, JSON.stringify(DEFAULT_PIPELINE_VIEW_CONFIG));
    } catch {}
    setStatusFeedback({ type: 'success', message: 'Visualização restaurada para o padrão.' });
  };

  // Mobile active column tab
  const [mobileActiveCol, setMobileActiveCol] = useState<'Frio' | 'Morno' | 'Quente' | 'Cliente'>('Morno');

  // Drag & Drop State
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const draggedLeadRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Card Menu State
  const [activeMenuLeadId, setActiveMenuLeadId] = useState<string | null>(null);

  // Intra-column in-memory reordering state
  const [columnOrder, setColumnOrder] = useState<Record<string, string[]>>({});

  // Document Folder Popover State (Google Drive / Cloud Links)
  const [folderPopover, setFolderPopover] = useState<{
    open: boolean;
    lead: Lead | null;
    folderUrl: string;
    isSaving: boolean;
    error: string | null;
  }>({
    open: false,
    lead: null,
    folderUrl: '',
    isSaving: false,
    error: null,
  });

  // Timeline Modal State (WhatsApp style conversation feed)
  const [timelineLead, setTimelineLead] = useState<Lead | null>(null);

  // WhatsApp Independent Popover State (CRUD)
  const [whatsappPopover, setWhatsappPopover] = useState<{
    open: boolean;
    lead: Lead | null;
    mode: 'list' | 'add' | 'edit';
    editingContactId?: string | null;
  }>({
    open: false,
    lead: null,
    mode: 'list',
    editingContactId: null,
  });
  const [waName, setWaName] = useState('');
  const [waRole, setWaRole] = useState('Síndico');
  const [waCustomRole, setWaCustomRole] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waNotes, setWaNotes] = useState('');
  const [waSaving, setWaSaving] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);

  // E-mail Independent Popover State (CRUD)
  const [emailPopover, setEmailPopover] = useState<{
    open: boolean;
    lead: Lead | null;
    mode: 'list' | 'add' | 'edit';
    editingContactId?: string | null;
  }>({
    open: false,
    lead: null,
    mode: 'list',
    editingContactId: null,
  });
  const [emName, setEmName] = useState('');
  const [emRole, setEmRole] = useState('Síndico');
  const [emCustomRole, setEmCustomRole] = useState('');
  const [emEmail, setEmEmail] = useState('');
  const [emNotes, setEmNotes] = useState('');
  const [emSaving, setEmSaving] = useState(false);
  const [emError, setEmError] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);

  // Notas Independent Panel State (CRUD)
  const [notesPopover, setNotesPopover] = useState<{
    open: boolean;
    lead: Lead | null;
    mode: 'list' | 'create' | 'edit';
    editingInteractionId?: string | null;
  }>({
    open: false,
    lead: null,
    mode: 'create',
    editingInteractionId: null,
  });
  const [noteType, setNoteType] = useState('WhatsApp');
  const [noteOccurredAt, setNoteOccurredAt] = useState('');
  const [noteResponsibleId, setNoteResponsibleId] = useState('');
  const [noteFollowUpDate, setNoteFollowUpDate] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Shared Confirmation Modal for Deletions
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: async () => {},
  });
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  // Lead Modal Mode: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isRestoredDraft, setIsRestoredDraft] = useState(false);

  // Quiz Steps (1 to 6)
  const [quizStep, setQuizStep] = useState(1);
  const totalQuizSteps = 5;

  // Form States
  const [formName, setFormName] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formCondominiumType, setFormCondominiumType] = useState('Residencial');
  const [formAdministrator, setFormAdministrator] = useState('');
  const [formUnitCount, setFormUnitCount] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formTemperature, setFormTemperature] = useState<'Frio' | 'Morno' | 'Quente' | 'Cliente'>('Morno');
  const [formCurrentStageId, setFormCurrentStageId] = useState('');
  const [formResponsibleUserId, setFormResponsibleUserId] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Interaction Modal States
  const [interactionModalMode, setInteractionModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);
  const [interactionQuizStep, setInteractionQuizStep] = useState(1);
  const totalInteractionQuizSteps = 4;
  const [formInteractionType, setFormInteractionType] = useState('Ligação');
  const [formInteractionOccurredAt, setFormInteractionOccurredAt] = useState('');
  const [formInteractionResponsibleId, setFormInteractionResponsibleId] = useState('');
  const [formInteractionNotes, setFormInteractionNotes] = useState('');
  const [formInteractionNextFollowUpDate, setFormInteractionNextFollowUpDate] = useState('');
  const [formInteractionSaving, setFormInteractionSaving] = useState(false);
  const [formInteractionError, setFormInteractionError] = useState<string | null>(null);

  const initialDraftRestorationChecked = useRef(false);

  // Close menus when clicking outside
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.card-dropdown-menu')) {
        setActiveMenuLeadId(null);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

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
      setFormTemperature((createDraft.formTemperature as 'Frio' | 'Morno' | 'Quente' | 'Cliente') || 'Morno');
      setFormCurrentStageId(createDraft.formCurrentStageId || '');
      setFormResponsibleUserId(createDraft.formResponsibleUserId || currentProfile.id);
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
        formTemperature,
        formCurrentStageId,
        formResponsibleUserId,
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
        formTemperature,
        formCurrentStageId,
        formResponsibleUserId,
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
    formTemperature,
    formCurrentStageId,
    formResponsibleUserId,
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

  // Pre-indexed text maps for ultra-fast, lag-free search (O(N+M) single-pass)
  const contactsTextMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!contacts.length || !leadContacts.length) return map;

    const contactDetailMap = new Map<string, string>();
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      contactDetailMap.set(c.id, `${c.name} ${c.role_title || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase());
    }

    for (let i = 0; i < leadContacts.length; i++) {
      const rel = leadContacts[i];
      const detail = contactDetailMap.get(rel.contact_id);
      if (detail) {
        const prev = map.get(rel.lead_id) || '';
        map.set(rel.lead_id, prev ? `${prev} ${detail}` : detail);
      }
    }
    return map;
  }, [contacts, leadContacts]);

  const notesTextMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!interactions.length) return map;

    for (let i = 0; i < interactions.length; i++) {
      const item = interactions[i];
      const text = `${item.notes || ''} ${item.interaction_type || ''}`.toLowerCase();
      const prev = map.get(item.lead_id) || '';
      map.set(item.lead_id, prev ? `${prev} ${text}` : text);
    }
    return map;
  }, [interactions]);

  // Filtered Leads in Memory (Instant memoized search on all card details)
  const filteredLeads = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return leads.filter((l) => {
      if (responsibleFilter !== 'all' && l.responsible_user_id !== responsibleFilter) return false;
      if (stageFilter !== 'all' && l.current_stage_id !== stageFilter) return false;
      if (term) {
        // 1. Condominium name, city, address, administrator, type
        const matchName = l.name.toLowerCase().includes(term);
        const matchCity = l.city ? l.city.toLowerCase().includes(term) : false;
        const matchAddr = l.address ? l.address.toLowerCase().includes(term) : false;
        const matchAdm = l.administrator ? l.administrator.toLowerCase().includes(term) : false;
        const matchType = l.condominium_type ? l.condominium_type.toLowerCase().includes(term) : false;

        // 2. Responsible persona name
        const respName = l.responsible_user_id ? profileMap.get(l.responsible_user_id)?.toLowerCase() || '' : '';
        const matchResp = respName.includes(term);

        // 3. Stage name
        const stgName = l.current_stage_id ? stageMap.get(l.current_stage_id)?.toLowerCase() || '' : '';
        const matchStage = stgName.includes(term);

        // 4. Contact names of this lead (O(1) fast lookup)
        const matchContact = contactsTextMap.get(l.id)?.includes(term) || false;

        // 5. Interaction notes / follow-ups of this lead (O(1) fast lookup)
        const matchNotes = notesTextMap.get(l.id)?.includes(term) || false;

        if (!matchName && !matchCity && !matchAddr && !matchAdm && !matchType && !matchResp && !matchStage && !matchContact && !matchNotes) {
          return false;
        }
      }
      return true;
    });
  }, [leads, searchTerm, responsibleFilter, stageFilter, profileMap, stageMap, contactsTextMap, notesTextMap]);

  // Pipeline Columns (4 Categories: Frio, Morno, Quente, Cliente) with Pinned Cards Pinned to Top
  const pipelineColumns = useMemo(() => {
    const cold: Lead[] = [];
    const warm: Lead[] = [];
    const hot: Lead[] = [];
    const client: Lead[] = [];

    filteredLeads.forEach((lead) => {
      const temp = (lead.temperature || 'Morno').toLowerCase();
      if (temp === 'quente') {
        hot.push(lead);
      } else if (temp === 'frio') {
        cold.push(lead);
      } else if (temp === 'cliente') {
        client.push(lead);
      } else {
        warm.push(lead);
      }
    });

    const sortByOrder = (list: Lead[], colId: string) => {
      const order = columnOrder[colId] || [];
      return [...list].sort((a, b) => {
        const idxA = order.indexOf(a.id);
        const idxB = order.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    };

    return [
      {
        id: 'Frio' as const,
        label: 'Frio',
        leads: sortByOrder(cold, 'Frio'),
        dotClass: 'bg-sky-400',
      },
      {
        id: 'Morno' as const,
        label: 'Morno',
        leads: sortByOrder(warm, 'Morno'),
        dotClass: 'bg-amber-400',
      },
      {
        id: 'Quente' as const,
        label: 'Quente',
        leads: sortByOrder(hot, 'Quente'),
        dotClass: 'bg-rose-400',
      },
      {
        id: 'Cliente' as const,
        label: 'Cliente',
        leads: sortByOrder(client, 'Cliente'),
        dotClass: 'bg-emerald-400',
      },
    ];
  }, [filteredLeads, columnOrder]);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    try {
      e.dataTransfer.setData('text/plain', leadId);
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
    draggedLeadRef.current = leadId;
    setDraggedLeadId(leadId);
  };

  const handleDragEnd = () => {
    draggedLeadRef.current = null;
    setDraggedLeadId(null);
    setDragOverCol(null);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {}
    if (dragOverCol !== colId) {
      setDragOverCol(colId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (
    e: React.DragEvent,
    targetTemperature: 'Frio' | 'Morno' | 'Quente' | 'Cliente',
    specificLeadId?: string
  ) => {
    e.preventDefault();
    setDragOverCol(null);
    let leadId = specificLeadId;
    if (!leadId) {
      try {
        leadId = e.dataTransfer.getData('text/plain');
      } catch {}
    }
    if (!leadId) {
      leadId = draggedLeadRef.current || draggedLeadId || '';
    }
    draggedLeadRef.current = null;
    setDraggedLeadId(null);
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    if (lead.temperature && lead.temperature.toLowerCase() === targetTemperature.toLowerCase()) return;

    const updatedLead: Lead = { ...lead, temperature: targetTemperature };

    // Optimistic UI update in central store & local cache
    upsertLeadLocally(updatedLead);

    // Asynchronous background persistence to Supabase (with DB-safe temperature value)
    try {
      const dbTemperature = sanitizeTemperatureForDB(targetTemperature);
      const { error } = await supabase
        .from('leads')
        .update({ temperature: dbTemperature })
        .eq('id', leadId);

      if (error) {
        console.warn('Supabase background update notice:', error.message);
        if (error.code === '23514') {
          // Fallback retry if check constraint rejects custom string
          await supabase
            .from('leads')
            .update({ temperature: 'Quente' })
            .eq('id', leadId);
        }
      }
    } catch (err: any) {
      console.warn('Background network sync notice:', err?.message || err);
    }
  };

  // Intra-column card reordering handler
  const handleDropOnCard = (e: React.DragEvent, targetLeadId: string, colId: 'Frio' | 'Morno' | 'Quente' | 'Cliente') => {
    e.stopPropagation();
    e.preventDefault();
    setDragOverCol(null);
    let sourceLeadId = '';
    try {
      sourceLeadId = e.dataTransfer.getData('text/plain');
    } catch {}
    if (!sourceLeadId) {
      sourceLeadId = draggedLeadRef.current || draggedLeadId || '';
    }
    if (!sourceLeadId) return;

    const sourceLead = leads.find((l) => l.id === sourceLeadId);
    if (!sourceLead) return;

    // If dropped across columns, trigger column drop
    if (sourceLead.temperature?.toLowerCase() !== colId.toLowerCase()) {
      handleDrop(e, colId, sourceLeadId);
      return;
    }

    draggedLeadRef.current = null;
    setDraggedLeadId(null);

    if (sourceLeadId === targetLeadId) return;

    const currentCol = pipelineColumns.find((c) => c.id === colId);
    const currentIds = currentCol ? currentCol.leads.map((l) => l.id) : [];
    const sourceIdx = currentIds.indexOf(sourceLeadId);
    const targetIdx = currentIds.indexOf(targetLeadId);

    if (sourceIdx >= 0 && targetIdx >= 0 && sourceIdx !== targetIdx) {
      const reordered = [...currentIds];
      reordered.splice(sourceIdx, 1);
      reordered.splice(targetIdx, 0, sourceLeadId);
      setColumnOrder((prev) => ({ ...prev, [colId]: reordered }));
    }
  };

  // Inline quick update handler for LeadCard shortcuts
  const handleQuickUpdateLead = async (
    leadId: string,
    field: 'stage' | 'responsible' | 'temperature' | 'follow_up_date',
    value: string
  ) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || !value) return;

    if (field === 'stage') {
      const updated = { ...lead, current_stage_id: value };
      upsertLeadLocally(updated);
      try {
        await supabase.from('leads').update({ current_stage_id: value }).eq('id', leadId);
        setStatusFeedback({ type: 'success', message: 'Estágio do funil atualizado!' });
      } catch (err) {
        console.error(err);
      }
    } else if (field === 'responsible') {
      const updated = { ...lead, responsible_user_id: value };
      upsertLeadLocally(updated);
      try {
        await supabase.from('leads').update({ responsible_user_id: value }).eq('id', leadId);
        setStatusFeedback({ type: 'success', message: 'Responsável atualizado com sucesso!' });
      } catch (err) {
        console.error(err);
      }
    } else if (field === 'temperature') {
      const updated = { ...lead, temperature: value };
      upsertLeadLocally(updated);
      try {
        const dbTemp = sanitizeTemperatureForDB(value);
        await supabase.from('leads').update({ temperature: dbTemp }).eq('id', leadId);
        setStatusFeedback({ type: 'success', message: `Temperatura alterada para ${value}!` });
      } catch (err) {
        console.error(err);
      }
    } else if (field === 'follow_up_date') {
      const leadInteractions = getInteractionsForLead(leadId);
      const latest = leadInteractions[0];
      const timeVal = value.includes('T') ? value.split('T')[1]?.slice(0, 5) : '09:00';
      if (latest) {
        saveFollowUpTime(latest.id, leadId, timeVal);
        const updatedInt: Interaction = {
          ...latest,
          next_follow_up_date: value,
        };
        upsertInteractionLocally(updatedInt);
        try {
          await supabase
            .from('interactions')
            .update({ next_follow_up_date: value })
            .eq('id', latest.id);
          setStatusFeedback({ type: 'success', message: 'Data de próximo contato atualizada!' });
        } catch (err) {
          console.error(err);
        }
      } else {
        const newInt: Interaction = {
          id: `int_${Date.now()}`,
          lead_id: leadId,
          interaction_type: 'Ligação',
          occurred_at: new Date().toISOString(),
          next_follow_up_date: value,
          responsible_user_id: lead.responsible_user_id || currentProfile.id,
          notes: 'Agendamento de próximo contato',
          created_at: new Date().toISOString(),
        };
        saveFollowUpTime(newInt.id, leadId, timeVal);
        upsertInteractionLocally(newInt);
        try {
          await supabase.from('interactions').insert([newInt]);
          setStatusFeedback({ type: 'success', message: 'Próximo contato agendado!' });
        } catch (err) {
          console.error(err);
        }
      }
      refreshAll(true);
    }
  };

  // Safe delete lead with confirmation modal
  const handleRequestDeleteLead = (lead: Lead) => {
    setActiveMenuLeadId(null);
    setDeleteConfirmModal({
      open: true,
      title: 'Excluir condomínio',
      message: `Tem certeza que deseja excluir o condomínio "${lead.name}"? Todos os serviços vinculados, contatos associados e histórico de interações deste condomínio serão permanentemente removidos. Essa ação não poderá ser desfeita.`,
      onConfirm: async () => {
        setIsDeletingItem(true);
        try {
          await supabase.from('lead_services').delete().eq('lead_id', lead.id);
          await supabase.from('lead_contacts').delete().eq('lead_id', lead.id);
          await supabase.from('interactions').delete().eq('lead_id', lead.id);
          const { error } = await supabase.from('leads').delete().eq('id', lead.id);
          if (error) throw error;

          deleteLeadLocally(lead.id);
          clearDraft(getLeadEditDraftKey(lead.id));
          refreshAll(true);
          setStatusFeedback({
            type: 'success',
            message: `Condomínio "${lead.name}" excluído com sucesso.`,
          });
          if (selectedLead?.id === lead.id) {
            handleCloseModal();
          }
          setDeleteConfirmModal((prev) => ({ ...prev, open: false }));
        } catch (err: any) {
          console.error('Error deleting lead:', err);
          setStatusFeedback({
            type: 'error',
            message: 'Erro ao excluir condomínio. Tente novamente.',
          });
        } finally {
          setIsDeletingItem(false);
        }
      },
    });
  };

  const handleStageChange = (newStageId: string) => {
    setFormCurrentStageId(newStageId);
  };

  // Modal handlers
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
      setFormTemperature((draft.formTemperature as 'Frio' | 'Morno' | 'Quente' | 'Cliente') || 'Morno');
      setFormCurrentStageId(draft.formCurrentStageId || (stages.length > 0 ? stages[0].id : ''));
      setFormResponsibleUserId(draft.formResponsibleUserId || currentProfile.id);
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
      setFormTemperature('Morno');
      setFormCurrentStageId(stages.length > 0 ? stages[0].id : '');
      setFormResponsibleUserId(currentProfile.id);
      setQuizStep(1);
    }

    setSelectedLead(null);
    setModalMode('create');
  };

  const handleOpenEdit = (lead: Lead) => {
    setFormError(null);
    setSelectedLead(lead);
    setActiveMenuLeadId(null);

    const editDraft = loadDraft<LeadDraftData>(getLeadEditDraftKey(lead.id));
    if (editDraft && editDraft.formName) {
      setFormName(editDraft.formName);
      setFormCnpj(editDraft.formCnpj || '');
      setFormCondominiumType(editDraft.formCondominiumType || 'Residencial');
      setFormAdministrator(editDraft.formAdministrator || '');
      setFormUnitCount(editDraft.formUnitCount || '');
      setFormAddress(editDraft.formAddress || '');
      setFormCity(editDraft.formCity || '');
      setFormTemperature((editDraft.formTemperature as 'Frio' | 'Morno' | 'Quente' | 'Cliente') || 'Morno');
      setFormCurrentStageId(editDraft.formCurrentStageId || '');
      setFormResponsibleUserId(editDraft.formResponsibleUserId || currentProfile.id);
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
      setFormTemperature((lead.temperature as 'Frio' | 'Morno' | 'Quente' | 'Cliente') || 'Morno');
      const stageId = lead.current_stage_id || (stages.length > 0 ? stages[0].id : '');
      setFormCurrentStageId(stageId);
      setFormResponsibleUserId(lead.responsible_user_id || currentProfile.id);
      setQuizStep(1);
      setIsRestoredDraft(false);
    }

    setModalMode('edit');
  };

  const handleOpenView = (lead: Lead) => {
    setSelectedLead(lead);
    setActiveMenuLeadId(null);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setSelectedLead(null);
    setFormError(null);
    setQuizStep(1);
    setIsRestoredDraft(false);
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

  const handleNextQuizStep = () => {
    setFormError(null);
    if (quizStep === 1 && !formName.trim()) {
      setFormError('Informe o nome do condomínio para avançar.');
      return;
    }
    if (quizStep < totalQuizSteps) {
      setQuizStep((prev) => prev + 1);
    }
  };

  const handlePrevQuizStep = () => {
    setFormError(null);
    if (quizStep > 1) setQuizStep((prev) => prev - 1);
  };

  // Submit Lead with instant save from any step
  const isValidUUID = (str?: string | null): boolean => {
    if (!str) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  };

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
        setFormError('Número de unidades inválido.');
        return;
      }
      unitCountNum = parsed;
    } else if (modalMode === 'edit' && selectedLead?.unit_count != null) {
      unitCountNum = selectedLead.unit_count;
    }

    const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
    let dbStageId = isValidUUID(stageIdToUse) ? stageIdToUse : (stages.find((s) => isValidUUID(s.id))?.id || null);
    
    // Fallback: Se não temos um UUID de estágio válido no estado local, busca o primeiro estágio do Supabase
    if (!dbStageId) {
      try {
        const { data: stageRow } = await supabase
          .from('pipeline_stages')
          .select('id')
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (stageRow?.id && isValidUUID(stageRow.id)) {
          dbStageId = stageRow.id;
        }
      } catch {}
    }

    const validResponsibleId = isValidUUID(formResponsibleUserId)
      ? formResponsibleUserId
      : isValidUUID(currentProfile?.id)
      ? currentProfile.id
      : null;

    setFormSaving(true);

    try {
      const dbTemperature = sanitizeTemperatureForDB(formTemperature);
      const leadPayload = {
        name: formName.trim(),
        cnpj: formCnpj.trim() || null,
        condominium_type: formCondominiumType || 'Residencial',
        administrator: formAdministrator.trim() || null,
        unit_count: unitCountNum ?? 0,
        address: formAddress.trim() || null,
        city: formCity.trim() || null,
        temperature: dbTemperature,
        current_stage_id: dbStageId,
        responsible_user_id: validResponsibleId,
      };

      let savedLead: Lead | null = null;

      if (modalMode === 'create') {
        const { data: createdLead, error: createError } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select()
          .single();

        if (createError) {
          // Se falhou por chave estrangeira, sintaxe de UUID ou check constraint, tenta fallback com valores padronizados
          const fallbackPayload = {
            ...leadPayload,
            temperature: 'Morno',
            current_stage_id: dbStageId,
            responsible_user_id: validResponsibleId,
          };
          const { data: retryLead, error: retryError } = await supabase
            .from('leads')
            .insert([fallbackPayload])
            .select()
            .single();

          if (retryError) throw retryError;
          savedLead = retryLead;
        } else {
          savedLead = createdLead;
        }

        if (!savedLead) {
          throw new Error('Não foi possível obter o condomínio criado do banco de dados.');
        }

        // Preserve user's chosen temperature in local state and cache
        const localLead: Lead = {
          ...savedLead,
          temperature: formTemperature || savedLead.temperature,
          current_stage_id: formCurrentStageId || savedLead.current_stage_id,
        };

        upsertLeadLocally(localLead);
        clearDraft(DRAFT_LEAD_CREATE_KEY);
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${savedLead.name}" salvo com sucesso no banco!`,
        });
      } else if (modalMode === 'edit' && selectedLead) {
        const { data: updatedLead, error: updateError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', selectedLead.id)
          .select()
          .single();

        if (updateError) {
          const fallbackPayload = {
            ...leadPayload,
            temperature: 'Morno',
            current_stage_id: dbStageId,
            responsible_user_id: validResponsibleId,
          };
          const { data: retryLead, error: retryError } = await supabase
            .from('leads')
            .update(fallbackPayload)
            .eq('id', selectedLead.id)
            .select()
            .single();

          if (retryError) throw retryError;
          savedLead = retryLead;
        } else {
          savedLead = updatedLead;
        }

        if (!savedLead) {
          throw new Error('Não foi possível atualizar o condomínio no banco de dados.');
        }

        // Preserve user's chosen temperature in local state and cache
        const localLead: Lead = {
          ...savedLead,
          temperature: formTemperature || savedLead.temperature,
          current_stage_id: formCurrentStageId || savedLead.current_stage_id,
        };

        upsertLeadLocally(localLead);
        clearDraft(getLeadEditDraftKey(selectedLead.id));
        setStatusFeedback({
          type: 'success',
          message: `Condomínio "${savedLead.name}" atualizado com sucesso!`,
        });
      }

      refreshAll(true);
      handleCloseModal();
    } catch (err: any) {
      console.error('Erro ao salvar condomínio:', err);
      setFormError(err?.message || 'Erro ao persistir no Supabase. Verifique a conexão.');
    } finally {
      setFormSaving(false);
    }
  };

  // Direct Interaction Handlers
  const handleOpenCreateInteraction = (lead: Lead) => {
    setSelectedLead(lead);
    setFormInteractionError(null);
    setSelectedInteraction(null);
    setActiveMenuLeadId(null);

    const draft = loadDraft<InteractionDraftData>(getInteractionCreateDraftKey(lead.id));
    if (draft && (draft.formInteractionNotes || draft.formInteractionNextFollowUpDate)) {
      setFormInteractionType(draft.formInteractionType || 'Ligação');
      setFormInteractionOccurredAt(draft.formInteractionOccurredAt || '');
      setFormInteractionResponsibleId(draft.formInteractionResponsibleId || currentProfile.id);
      setFormInteractionNotes(draft.formInteractionNotes || '');
      setFormInteractionNextFollowUpDate(draft.formInteractionNextFollowUpDate || '');
      setInteractionQuizStep(draft.interactionQuizStep || 1);
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
        const savedData = await saveInteractionToSupabase('insert', payload);
        if (savedData) {
          upsertInteractionLocally({
            ...savedData,
            interaction_type: formInteractionType || savedData.interaction_type,
          });
          clearDraft(getInteractionCreateDraftKey(selectedLead.id));
        }
        setStatusFeedback({ type: 'success', message: 'Interação registrada com sucesso!' });
      } else if (interactionModalMode === 'edit' && selectedInteraction) {
        const savedData = await saveInteractionToSupabase('update', payload, selectedInteraction.id);
        if (savedData) {
          upsertInteractionLocally({
            ...savedData,
            interaction_type: formInteractionType || savedData.interaction_type,
          });
        }
        setStatusFeedback({ type: 'success', message: 'Interação atualizada com sucesso!' });
      }

      refreshAll(true);
      setInteractionModalMode(null);
    } catch (err: any) {
      console.error('Error saving interaction:', err);
      setFormInteractionError(err.message || 'Erro ao salvar interação.');
    } finally {
      setFormInteractionSaving(false);
    }
  };

  // WhatsApp Popover handlers
  const handleOpenWhatsAppPopover = (lead: Lead) => {
    setWhatsappPopover({
      open: true,
      lead,
      mode: 'list',
      editingContactId: null,
    });
    setWaError(null);
    setWaName('');
    setWaRole('Síndico');
    setWaCustomRole('');
    setWaPhone('');
    setWaNotes('');
  };

  const handleCloseWhatsAppPopover = () => {
    setWhatsappPopover({ open: false, lead: null, mode: 'list', editingContactId: null });
    setWaError(null);
  };

  const handleOpenEditWhatsAppContact = (contact: Contact) => {
    const isStandardRole = PRESET_ROLES.includes(contact.role_title || '');
    setWhatsappPopover((prev) => ({
      ...prev,
      mode: 'edit',
      editingContactId: contact.id,
    }));
    setWaError(null);
    setWaName(contact.name || '');
    setWaRole(isStandardRole ? (contact.role_title || 'Síndico') : 'Outro');
    setWaCustomRole(isStandardRole ? '' : (contact.role_title || ''));
    setWaPhone(contact.phone || '');
    setWaNotes('');
  };

  const getWhatsAppLink = (phone?: string | null) => {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const cleanNumber = digits.startsWith('55') ? digits : `55${digits}`;
    return `https://wa.me/${cleanNumber}`;
  };

  const handlePhoneInputChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (!digits) {
      setWaPhone('');
      return;
    }
    if (digits.length <= 2) {
      setWaPhone(`(${digits}`);
      return;
    }
    if (digits.length <= 6) {
      setWaPhone(`(${digits.slice(0, 2)}) ${digits.slice(2)}`);
      return;
    }
    if (digits.length <= 10) {
      setWaPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
      return;
    }
    setWaPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`);
  };

  const handleSaveWhatsAppContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsappPopover.lead) return;
    setWaError(null);

    if (!waName.trim()) {
      setWaError('Informe o nome do contato.');
      return;
    }
    const digits = waPhone.replace(/\D/g, '');
    if (!digits) {
      setWaError('Informe o número de WhatsApp / telefone.');
      return;
    }
    if (digits.length < 8) {
      setWaError('Informe um telefone ou WhatsApp válido com DDD (mínimo 8 dígitos).');
      return;
    }

    const finalRole = waRole === 'Outro' ? waCustomRole.trim() || null : waRole;
    setWaSaving(true);

    try {
      const contactPayload = {
        name: waName.trim(),
        role_title: finalRole,
        phone: waPhone.trim(),
      };

      let savedContact: Contact = {
        id: whatsappPopover.editingContactId || `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ...contactPayload,
        created_at: new Date().toISOString(),
      };

      if (whatsappPopover.mode === 'edit' && whatsappPopover.editingContactId) {
        try {
          const { data, error } = await supabase
            .from('contacts')
            .update(contactPayload)
            .eq('id', whatsappPopover.editingContactId)
            .select()
            .maybeSingle();

          if (!error && data) {
            savedContact = data;
          }
        } catch (err) {
          console.warn('Supabase update contact notice:', err);
        }
        upsertContactLocally(savedContact, [whatsappPopover.lead.id]);
        setStatusFeedback({
          type: 'success',
          message: `Contato "${savedContact.name}" atualizado com sucesso!`,
        });
      } else {
        try {
          const { data: createdContact, error: createError } = await supabase
            .from('contacts')
            .insert([contactPayload])
            .select()
            .maybeSingle();

          if (!createError && createdContact) {
            savedContact = createdContact;
            await supabase
              .from('lead_contacts')
              .insert([{ lead_id: whatsappPopover.lead.id, contact_id: createdContact.id }]);
          }
        } catch (err) {
          console.warn('Supabase insert contact notice:', err);
        }

        upsertContactLocally(savedContact, [whatsappPopover.lead.id]);
        setStatusFeedback({
          type: 'success',
          message: `Contato "${savedContact.name}" adicionado com sucesso!`,
        });
      }

      setWhatsappPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }));
    } catch (err: any) {
      console.error('Error saving WhatsApp contact:', err);
      const fallbackContact: Contact = {
        id: whatsappPopover.editingContactId || `cnt_${Date.now()}`,
        name: waName.trim(),
        role_title: finalRole,
        phone: waPhone.trim(),
      };
      upsertContactLocally(fallbackContact, [whatsappPopover.lead.id]);
      setStatusFeedback({
        type: 'success',
        message: `Contato "${fallbackContact.name}" salvo com sucesso!`,
      });
      setWhatsappPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }));
    } finally {
      setWaSaving(false);
    }
  };

  // E-mail Popover handlers
  const handleOpenEmailPopover = (lead: Lead) => {
    setEmailPopover({
      open: true,
      lead,
      mode: 'list',
      editingContactId: null,
    });
    setEmError(null);
    setEmName('');
    setEmRole('Síndico');
    setEmCustomRole('');
    setEmEmail('');
    setEmNotes('');
  };

  const handleCloseEmailPopover = () => {
    setEmailPopover({ open: false, lead: null, mode: 'list', editingContactId: null });
    setEmError(null);
  };

  const handleOpenEditEmailContact = (contact: Contact) => {
    const isStandardRole = PRESET_ROLES.includes(contact.role_title || '');
    setEmailPopover((prev) => ({
      ...prev,
      mode: 'edit',
      editingContactId: contact.id,
    }));
    setEmError(null);
    setEmName(contact.name || '');
    setEmRole(isStandardRole ? (contact.role_title || 'Síndico') : 'Outro');
    setEmCustomRole(isStandardRole ? '' : (contact.role_title || ''));
    setEmEmail(contact.email || '');
    setEmNotes('');
  };

  const handleCopyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmailId(id);
    setTimeout(() => setCopiedEmailId(null), 2000);
  };

  const handleSaveEmailContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailPopover.lead) return;
    setEmError(null);

    if (!emName.trim()) {
      setEmError('Informe o nome do contato.');
      return;
    }
    const emailTrimmed = emEmail.trim();
    if (!emailTrimmed) {
      setEmError('Informe o endereço de e-mail.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
      setEmError('Informe um endereço de e-mail válido (ex: contato@exemplo.com).');
      return;
    }

    const finalRole = emRole === 'Outro' ? emCustomRole.trim() || null : emRole;
    setEmSaving(true);

    try {
      const contactPayload = {
        name: emName.trim(),
        role_title: finalRole,
        email: emailTrimmed,
      };

      let savedContact: Contact = {
        id: emailPopover.editingContactId || `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ...contactPayload,
        created_at: new Date().toISOString(),
      };

      if (emailPopover.mode === 'edit' && emailPopover.editingContactId) {
        try {
          const { data, error } = await supabase
            .from('contacts')
            .update(contactPayload)
            .eq('id', emailPopover.editingContactId)
            .select()
            .maybeSingle();

          if (!error && data) {
            savedContact = data;
          }
        } catch (err) {
          console.warn('Supabase update contact notice:', err);
        }
        upsertContactLocally(savedContact, [emailPopover.lead.id]);
        setStatusFeedback({
          type: 'success',
          message: `Contato "${savedContact.name}" atualizado com sucesso!`,
        });
      } else {
        try {
          const { data: createdContact, error: createError } = await supabase
            .from('contacts')
            .insert([contactPayload])
            .select()
            .maybeSingle();

          if (!createError && createdContact) {
            savedContact = createdContact;
            await supabase
              .from('lead_contacts')
              .insert([{ lead_id: emailPopover.lead.id, contact_id: createdContact.id }]);
          }
        } catch (err) {
          console.warn('Supabase insert contact notice:', err);
        }

        upsertContactLocally(savedContact, [emailPopover.lead.id]);
        setStatusFeedback({
          type: 'success',
          message: `Contato "${savedContact.name}" adicionado com sucesso!`,
        });
      }

      setEmailPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }));
    } catch (err: any) {
      console.error('Error saving Email contact:', err);
      const fallbackContact: Contact = {
        id: emailPopover.editingContactId || `cnt_${Date.now()}`,
        name: emName.trim(),
        role_title: finalRole,
        email: emailTrimmed,
      };
      upsertContactLocally(fallbackContact, [emailPopover.lead.id]);
      setStatusFeedback({
        type: 'success',
        message: `Contato "${fallbackContact.name}" salvo com sucesso!`,
      });
      setEmailPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }));
    } finally {
      setEmSaving(false);
    }
  };

  // Contact Delete with confirmation
  const handleRequestDeleteContact = (contact: Contact, leadId: string) => {
    setDeleteConfirmModal({
      open: true,
      title: 'Excluir contato',
      message: `Tem certeza que deseja excluir o contato "${contact.name}"? Essa ação não poderá ser desfeita.`,
      onConfirm: async () => {
        setIsDeletingItem(true);
        try {
          await supabase.from('lead_contacts').delete().match({ lead_id: leadId, contact_id: contact.id });
          await supabase.from('contacts').delete().eq('id', contact.id);
          deleteContactLocally(contact.id);
          refreshAll(true);
          setStatusFeedback({ type: 'success', message: 'Contato excluído com sucesso.' });
          setDeleteConfirmModal((prev) => ({ ...prev, open: false }));
        } catch (err: any) {
          console.error('Error deleting contact:', err);
          setStatusFeedback({ type: 'error', message: 'Erro ao excluir contato.' });
        } finally {
          setIsDeletingItem(false);
        }
      },
    });
  };

  // Notas / Follow-up Handlers
  const handleOpenNotesPopover = (lead: Lead) => {
    setNotesPopover({
      open: true,
      lead,
      mode: 'create',
      editingInteractionId: null,
    });
    setNoteError(null);
  };

  const handleOpenEditNotesPopover = (lead: Lead, interactionId: string) => {
    setNotesPopover({
      open: true,
      lead,
      mode: 'edit',
      editingInteractionId: interactionId,
    });
    setNoteError(null);
  };

  const handleCloseNotesPopover = () => {
    setNotesPopover({ open: false, lead: null, mode: 'create', editingInteractionId: null });
    setNoteError(null);
  };

  const handleOpenCreateNote = () => {
    setNotesPopover((prev) => ({ ...prev, mode: 'create', editingInteractionId: null }));
    setNoteError(null);
  };

  const handleOpenEditNote = (interaction: Interaction) => {
    let dateStr = '';
    if (interaction.occurred_at) {
      const d = new Date(interaction.occurred_at);
      const tzOffset = d.getTimezoneOffset() * 60000;
      dateStr = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    }

    setNotesPopover((prev) => ({
      ...prev,
      mode: 'edit',
      editingInteractionId: interaction.id,
    }));
    setNoteError(null);
    setNoteType(interaction.interaction_type || 'WhatsApp');
    setNoteOccurredAt(dateStr);
    setNoteResponsibleId(interaction.responsible_user_id || currentProfile.id);
    setNoteFollowUpDate(interaction.next_follow_up_date ? interaction.next_follow_up_date.slice(0, 10) : '');
    setNoteContent(interaction.notes || '');
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notesPopover.lead) return;
    setNoteError(null);

    if (!noteContent.trim() && !noteFollowUpDate) {
      setNoteError('Informe ao menos uma observação ou a data do próximo follow-up.');
      return;
    }

    setNoteSaving(true);
    try {
      const occurredAtIso = noteOccurredAt
        ? new Date(noteOccurredAt).toISOString()
        : new Date().toISOString();

      const validLeadId = isValidUUID(notesPopover.lead.id) ? notesPopover.lead.id : notesPopover.lead.id;
      const validResponsibleId = isValidUUID(noteResponsibleId)
        ? noteResponsibleId
        : isValidUUID(currentProfile?.id)
        ? currentProfile.id
        : null;

      const payload = {
        lead_id: validLeadId,
        interaction_type: noteType,
        occurred_at: occurredAtIso,
        responsible_user_id: validResponsibleId,
        notes: noteContent.trim() || null,
        next_follow_up_date: noteFollowUpDate ? noteFollowUpDate : null,
      };

      let savedInteraction: Interaction | null = null;

      if (notesPopover.mode === 'edit' && notesPopover.editingInteractionId) {
        savedInteraction = await saveInteractionToSupabase('update', payload, notesPopover.editingInteractionId);
        if (savedInteraction) {
          upsertInteractionLocally({
            ...savedInteraction,
            interaction_type: noteType || savedInteraction.interaction_type,
          });
        }
        setStatusFeedback({ type: 'success', message: 'Nota atualizada com sucesso!' });
      } else {
        savedInteraction = await saveInteractionToSupabase('insert', payload);
        if (savedInteraction) {
          upsertInteractionLocally({
            ...savedInteraction,
            interaction_type: noteType || savedInteraction.interaction_type,
          });
        }
        setStatusFeedback({ type: 'success', message: 'Nova nota registrada com sucesso!' });
      }

      refreshAll(true);
      setNotesPopover((prev) => ({ ...prev, mode: 'list', editingInteractionId: null }));
    } catch (err: any) {
      console.error('Error saving note:', err);
      setNoteError(err?.message || 'Erro ao salvar nota no Supabase.');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleRequestDeleteNote = (interactionId: string) => {
    setDeleteConfirmModal({
      open: true,
      title: 'Excluir atualização',
      message: 'Tem certeza que deseja excluir esta atualização? Essa ação não poderá ser desfeita.',
      onConfirm: async () => {
        setIsDeletingItem(true);
        try {
          const { error } = await supabase.from('interactions').delete().eq('id', interactionId);
          if (error) throw error;
          deleteInteractionLocally(interactionId);
          refreshAll(true);
          setStatusFeedback({ type: 'success', message: 'Atualização excluída com sucesso.' });
          setDeleteConfirmModal((prev) => ({ ...prev, open: false }));
        } catch (err: any) {
          console.error('Error deleting interaction:', err);
          setStatusFeedback({ type: 'error', message: 'Erro ao excluir atualização.' });
        } finally {
          setIsDeletingItem(false);
        }
      },
    });
  };

  // Document Folder / Google Drive Popover Handlers
  const handleOpenFolderPopover = (lead: Lead) => {
    setFolderPopover({
      open: true,
      lead,
      folderUrl: getLeadFolderLink(lead.id),
      isSaving: false,
      error: null,
    });
  };

  const handleCloseFolderPopover = () => {
    setFolderPopover({
      open: false,
      lead: null,
      folderUrl: '',
      isSaving: false,
      error: null,
    });
  };

  const handleSaveFolderLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderPopover.lead) return;
    const urlTrimmed = folderPopover.folderUrl.trim();
    if (urlTrimmed && !urlTrimmed.startsWith('http://') && !urlTrimmed.startsWith('https://')) {
      setFolderPopover((prev) => ({
        ...prev,
        error: 'O link deve começar com https:// (ex: https://drive.google.com/...)',
      }));
      return;
    }
    saveLeadFolderLink(folderPopover.lead.id, urlTrimmed);
    setStatusFeedback({
      type: 'success',
      message: urlTrimmed ? 'Link da pasta salvo com sucesso!' : 'Link da pasta removido.',
    });
    handleCloseFolderPopover();
  };

  const handleRemoveFolderLink = () => {
    if (!folderPopover.lead) return;
    saveLeadFolderLink(folderPopover.lead.id, '');
    setStatusFeedback({ type: 'success', message: 'Link da pasta removido com sucesso.' });
    handleCloseFolderPopover();
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* 1. Header da Página - Redesenho PipelineToolbar */}
      <PipelineToolbar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        responsibleFilter={responsibleFilter}
        onResponsibleFilterChange={setResponsibleFilter}
        stages={stages}
        profiles={profiles}
        onOpenCreate={handleOpenCreate}
        onOpenViewConfig={() => setIsBentoModalOpen(true)}
        isRefreshing={isRefreshing}
      />

      {/* Floating Auto-Dismiss Toast Notification */}
      {statusFeedback && (
        <div className="fixed top-16 right-4 sm:right-6 z-50 max-w-sm w-full animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
          <div
            className={`p-3.5 rounded-2xl shadow-2xl border flex items-center justify-between gap-3 text-xs font-semibold backdrop-blur-md ${
              statusFeedback.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/80 text-emerald-200 shadow-emerald-950/40'
                : 'bg-rose-950/95 border-rose-500/80 text-rose-200 shadow-rose-950/40'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {statusFeedback.type === 'success' ? (
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              )}
              <span className="truncate">{statusFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusFeedback(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer shrink-0"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Mobile Column Tabs (Segmented Control) */}
      <div className="mb-4 flex md:hidden p-1 bg-slate-900 border border-slate-800 rounded-lg">
        {pipelineColumns.map((col) => (
          <button
            key={col.id}
            type="button"
            onClick={() => setMobileActiveCol(col.id)}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mobileActiveCol === col.id
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
            <span>{col.label}</span>
            <span className="text-[10px] opacity-70 tabular-nums">({col.leads.length})</span>
          </button>
        ))}
      </div>

      {/* 2. PipelineBoard & PipelineColumns */}
      {isInitialLoading && leads.length === 0 ? (
        <div className="mt-8 text-center py-16 bg-slate-900/30 border border-slate-800/60 rounded-xl">
          <div className="inline-block animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mb-3" />
          <p className="text-xs text-slate-400">Carregando pipeline comercial...</p>
        </div>
      ) : (
        <PipelineBoard>
          {pipelineColumns.map((col) => {
            const isColHiddenOnMobile = mobileActiveCol !== col.id;
            const isDropTarget = dragOverCol === col.id;

            return (
              <div
                key={col.id}
                className={`h-full flex flex-col ${isColHiddenOnMobile ? 'hidden md:flex' : 'flex'}`}
              >
                <PipelineColumn
                  id={col.id}
                  label={col.label}
                  leadCount={col.leads.length}
                  dotClass={col.dotClass}
                  isDropTarget={isDropTarget}
                  onDragOver={(e) => handleDragOver(e, col.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  {col.leads.length === 0 ? (
                    <div className="py-6 px-3 text-center text-xs text-slate-500 rounded-lg select-none">
                      Arraste um condomínio para cá
                    </div>
                  ) : (
                    col.leads.map((lead) => {
                      const stageName = lead.current_stage_id
                        ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
                        : 'Estágio inicial';
                      const responsibleName = lead.responsible_user_id
                        ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
                        : 'Não atribuído';
                      const leadInteractions = getInteractionsForLead(lead.id);
                      const leadContacts = getContactsForLead(lead.id);
                      const waContactsCount = leadContacts.filter((c) => c.phone).length;
                      const emContactsCount = leadContacts.filter((c) => c.email).length;
                      const notesCount = leadInteractions.length;
                      const activeFollowUpDate = leadInteractions[0]?.next_follow_up_date || null;
                      const followUpInfo = getFollowUpDisplay(
                        activeFollowUpDate,
                        leadInteractions[0]?.id,
                        lead.id
                      );

                      return (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          stageName={stageName}
                          responsibleName={responsibleName}
                          followUpInfo={followUpInfo}
                          waCount={waContactsCount}
                          emCount={emContactsCount}
                          notesCount={notesCount}
                          hasFolderLink={Boolean(getLeadFolderLink(lead.id))}
                          viewConfig={viewConfig}
                          stages={stages}
                          profiles={profiles}
                          onQuickUpdate={handleQuickUpdateLead}
                          isMenuOpen={activeMenuLeadId === lead.id}
                          isDragging={draggedLeadId === lead.id}
                          onToggleMenu={() => setActiveMenuLeadId(activeMenuLeadId === lead.id ? null : lead.id)}
                          onCloseMenu={() => setActiveMenuLeadId(null)}
                          onDragStart={(e) => handleDragStart(e, lead.id)}
                          onDragEnd={handleDragEnd}
                          onDropOnCard={(e) => handleDropOnCard(e, lead.id, col.id)}
                          onOpenView={() => handleOpenView(lead)}
                          onOpenEdit={() => handleOpenEdit(lead)}
                          onOpenTimeline={() => setTimelineLead(lead)}
                          onOpenNotes={() => handleOpenNotesPopover(lead)}
                          onOpenFolder={() => handleOpenFolderPopover(lead)}
                          onOpenWhatsApp={() => handleOpenWhatsAppPopover(lead)}
                          onOpenEmail={() => handleOpenEmailPopover(lead)}
                          onRequestDelete={() => handleRequestDeleteLead(lead)}
                        />
                      );
                    })
                  )}
                </PipelineColumn>
              </div>
            );
          })}
        </PipelineBoard>
      )}

      {/* INDEPENDENT WHATSAPP POPOVER */}
      {whatsappPopover.open && whatsappPopover.lead && (
        <div
          onClick={handleCloseWhatsAppPopover}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-950 text-emerald-400 border border-emerald-700/50">
                  <WhatsAppIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-white">WhatsApp</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[190px]">{whatsappPopover.lead.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {whatsappPopover.mode === 'list' && (
                  <button
                    type="button"
                    onClick={() => setWhatsappPopover((prev) => ({ ...prev, mode: 'add' }))}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    + Adicionar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseWhatsAppPopover}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto max-h-80 text-xs">
              {whatsappPopover.mode === 'list' ? (
                <div className="space-y-2.5">
                  {(() => {
                    const leadContacts = getContactsForLead(whatsappPopover.lead.id);
                    const waContacts = leadContacts.filter((c) => c.phone);

                    if (waContacts.length === 0) {
                      return (
                        <div className="text-center py-6 bg-slate-950/60 rounded-xl border border-slate-800/80 p-4">
                          <p className="text-xs text-slate-400 mb-3">
                            Nenhum contato com WhatsApp cadastrado para este condomínio.
                          </p>
                          <button
                            type="button"
                            onClick={() => setWhatsappPopover((prev) => ({ ...prev, mode: 'add' }))}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <WhatsAppIcon className="w-3.5 h-3.5" />
                            <span>+ Adicionar WhatsApp</span>
                          </button>
                        </div>
                      );
                    }

                    return waContacts.map((contact) => (
                      <div key={contact.id} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold text-white block text-xs">{contact.name}</span>
                            <span className="text-[11px] text-slate-400">{contact.role_title || 'Contato Geral'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEditWhatsAppContact(contact)}
                              title="Editar contato"
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-850 transition-colors cursor-pointer"
                            >
                              <EditIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRequestDeleteContact(contact, whatsappPopover.lead!.id)}
                              title="Excluir contato"
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 gap-2">
                          <span className="font-mono text-slate-300 text-xs truncate">{contact.phone}</span>
                          <a
                            href={getWhatsAppLink(contact.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                          >
                            <WhatsAppIcon className="w-3.5 h-3.5" />
                            <span>Conversar no WhatsApp</span>
                          </a>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <form onSubmit={handleSaveWhatsAppContact} className="space-y-3">
                  {waError && <div className="p-2.5 bg-rose-950 border border-rose-600/50 rounded-xl text-rose-200 text-xs">{waError}</div>}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Nome do contato *</label>
                    <input
                      type="text"
                      autoFocus
                      value={waName}
                      onChange={(e) => setWaName(e.target.value)}
                      placeholder="Ex: Carlos Síndico"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Vínculo / Cargo</label>
                    <select
                      value={waRole}
                      onChange={(e) => setWaRole(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {PRESET_ROLES.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </div>

                  {waRole === 'Outro' && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">Especifique o cargo</label>
                      <input
                        type="text"
                        value={waCustomRole}
                        onChange={(e) => setWaCustomRole(e.target.value)}
                        placeholder="Ex: Zelador Chefe"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">WhatsApp / Telefone *</label>
                    <input
                      type="text"
                      value={waPhone}
                      onChange={(e) => handlePhoneInputChange(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none font-mono"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setWhatsappPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }))}
                      disabled={waSaving}
                      className="px-3 py-1.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={waSaving}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {waSaving ? 'Salvando...' : whatsappPopover.mode === 'edit' ? 'Salvar alterações' : 'Salvar WhatsApp'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* INDEPENDENT EMAIL POPOVER */}
      {emailPopover.open && emailPopover.lead && (
        <div
          onClick={handleCloseEmailPopover}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-sky-950 text-sky-400 border border-sky-700/50">
                  <EmailIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-white">E-mail</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[190px]">{emailPopover.lead.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {emailPopover.mode === 'list' && (
                  <button
                    type="button"
                    onClick={() => setEmailPopover((prev) => ({ ...prev, mode: 'add', editingContactId: null }))}
                    className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    + Adicionar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseEmailPopover}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto max-h-80 text-xs">
              {emailPopover.mode === 'list' ? (
                <div className="space-y-2.5">
                  {(() => {
                    const leadContacts = getContactsForLead(emailPopover.lead.id);
                    const mailContacts = leadContacts.filter((c) => c.email);

                    if (mailContacts.length === 0) {
                      return (
                        <div className="text-center py-6 bg-slate-950/60 rounded-xl border border-slate-800/80 p-4">
                          <p className="text-xs text-slate-400 mb-3">
                            Nenhum contato com e-mail cadastrado para este condomínio.
                          </p>
                          <button
                            type="button"
                            onClick={() => setEmailPopover((prev) => ({ ...prev, mode: 'add', editingContactId: null }))}
                            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <EmailIcon className="w-3.5 h-3.5" />
                            <span>+ Adicionar E-mail</span>
                          </button>
                        </div>
                      );
                    }

                    return mailContacts.map((contact) => (
                      <div key={contact.id} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold text-white block text-xs">{contact.name}</span>
                            <span className="text-[11px] text-slate-400">{contact.role_title || 'Contato Geral'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEditEmailContact(contact)}
                              title="Editar contato"
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-850 transition-colors cursor-pointer"
                            >
                              <EditIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRequestDeleteContact(contact, emailPopover.lead!.id)}
                              title="Excluir contato"
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 gap-2">
                          <span className="text-slate-300 text-xs truncate max-w-[160px]">{contact.email}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyEmail(contact.email!, contact.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                              copiedEmailId === contact.id
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 hover:text-white'
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>{copiedEmailId === contact.id ? 'Copiado!' : 'Copiar e-mail'}</span>
                          </button>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <form onSubmit={handleSaveEmailContact} className="space-y-3">
                  {emError && <div className="p-2.5 bg-rose-950 border border-rose-600/50 rounded-xl text-rose-200 text-xs">{emError}</div>}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Nome do contato *</label>
                    <input
                      type="text"
                      autoFocus
                      value={emName}
                      onChange={(e) => setEmName(e.target.value)}
                      placeholder="Ex: Carlos Síndico"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Vínculo / Cargo</label>
                    <select
                      value={emRole}
                      onChange={(e) => setEmRole(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {PRESET_ROLES.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </div>

                  {emRole === 'Outro' && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">Especifique o cargo</label>
                      <input
                        type="text"
                        value={emCustomRole}
                        onChange={(e) => setEmCustomRole(e.target.value)}
                        placeholder="Ex: Zelador Chefe"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">E-mail *</label>
                    <input
                      type="email"
                      value={emEmail}
                      onChange={(e) => setEmEmail(e.target.value)}
                      placeholder="contato@condominio.com"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEmailPopover((prev) => ({ ...prev, mode: 'list', editingContactId: null }))}
                      disabled={emSaving}
                      className="px-3 py-1.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={emSaving}
                      className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {emSaving ? 'Salvando...' : emailPopover.mode === 'edit' ? 'Salvar alterações' : 'Salvar E-mail'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WHATSAPP-STYLE TIMELINE POPUP */}
      <NotesTimelineModal
        isOpen={Boolean(timelineLead)}
        lead={timelineLead}
        currentProfile={currentProfile}
        onClose={() => setTimelineLead(null)}
        onOpenNewNote={(ld) => {
          setTimelineLead(null);
          handleOpenNotesPopover(ld);
        }}
        onEditNote={(ld, interactionId) => {
          setTimelineLead(null);
          handleOpenEditNotesPopover(ld, interactionId);
        }}
      />

      {/* UNIFIED CONVERSATIONAL TYPEFORM NOTAS MODAL */}
      <UnifiedNoteModal
        isOpen={notesPopover.open && Boolean(notesPopover.lead)}
        lead={notesPopover.lead}
        editingInteractionId={notesPopover.editingInteractionId}
        currentProfile={currentProfile}
        onClose={handleCloseNotesPopover}
        onSuccessFeedback={(msg) => setStatusFeedback({ type: 'success', message: msg })}
      />

      {/* DOCUMENT FOLDER / GOOGLE DRIVE POPOVER */}
      {folderPopover.open && folderPopover.lead && (
        <div
          onClick={handleCloseFolderPopover}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-950 text-amber-400 border border-amber-700/50">
                  <FolderIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-white">Pasta de Documentos</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{folderPopover.lead.name}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseFolderPopover}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 text-xs">
              {getLeadFolderLink(folderPopover.lead.id) && (
                <div className="mb-4 p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                  <span className="text-[11px] text-slate-400 font-medium block">Link salvo atualmente:</span>
                  <a
                    href={getLeadFolderLink(folderPopover.lead.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-3.5 py-2.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <FolderIcon className="w-4 h-4" />
                    <span>Abrir pasta no Google Drive</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}

              <form onSubmit={handleSaveFolderLink} className="space-y-3.5">
                {folderPopover.error && (
                  <div className="p-2.5 bg-rose-950 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                    {folderPopover.error}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                    Link da pasta (Google Drive, Dropbox, etc.)
                  </label>
                  <input
                    type="url"
                    value={folderPopover.folderUrl}
                    onChange={(e) => setFolderPopover((prev) => ({ ...prev, folderUrl: e.target.value, error: null }))}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-white text-xs focus:outline-none placeholder-slate-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between">
                  {getLeadFolderLink(folderPopover.lead.id) ? (
                    <button
                      type="button"
                      onClick={handleRemoveFolderLink}
                      className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                    >
                      Remover link
                    </button>
                  ) : <span />}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCloseFolderPopover}
                      className="px-3 py-1.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-semibold cursor-pointer shadow-xs transition-colors"
                    >
                      Salvar Link
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR DELETIONS (High Z-Index in front of all cards) */}
      {deleteConfirmModal.open && (
        <div
          onClick={() => setDeleteConfirmModal((prev) => ({ ...prev, open: false }))}
          className="fixed inset-0 z-[100] overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 my-6 flex flex-col"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-rose-400 shrink-0">
                <TrashIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">{deleteConfirmModal.title}</h3>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-5">
              {deleteConfirmModal.message}
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal((prev) => ({ ...prev, open: false }))}
                disabled={isDeletingItem}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={deleteConfirmModal.onConfirm}
                disabled={isDeletingItem}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isDeletingItem ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUIZ MODAL FOR LEAD CREATE / EDIT WITH INSTANT SAVE */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div
          onClick={handleCloseModal}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]"
          >
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
                  <button
                    type="button"
                    onClick={handleSubmitLead}
                    disabled={formSaving || !formName.trim()}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                    title="Gravar alterações agora"
                  >
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
                  className="bg-indigo-500 h-full transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${(quizStep / totalQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            <div className="p-6 sm:p-8 overflow-y-auto flex-1 text-sm">
              {formError && (
                <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                  {formError}
                </div>
              )}

              {quizStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Qual é o nome do condomínio?</h3>
                    <p className="text-xs text-slate-400">Nome comercial ou identificador principal.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Nome do Condomínio *</label>
                    <input
                      type="text"
                      autoFocus
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Condomínio Edifício Solar"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">CNPJ (opcional)</label>
                    <input
                      type="text"
                      value={formCnpj}
                      onChange={(e) => setFormCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {quizStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Características</h3>
                    <p className="text-xs text-slate-400">Tipo e unidades.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {CONDOMINIUM_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormCondominiumType(type)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-medium cursor-pointer ${
                          formCondominiumType === type
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Número de Unidades</label>
                    <input
                      type="number"
                      min="1"
                      value={formUnitCount}
                      onChange={(e) => setFormUnitCount(e.target.value)}
                      placeholder="Ex: 80"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {quizStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Localização & Administradora</h3>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Cidade</label>
                    <input
                      type="text"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      placeholder="Ex: São Paulo"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Administradora</label>
                    <input
                      type="text"
                      value={formAdministrator}
                      onChange={(e) => setFormAdministrator(e.target.value)}
                      placeholder="Ex: Lello, Hub, CIPA..."
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {quizStep === 4 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Temperatura & Estágio</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TEMPERATURE_OPTIONS.map((temp) => (
                      <button
                        key={temp}
                        type="button"
                        onClick={() => setFormTemperature(temp)}
                        className={`p-2.5 rounded-xl border text-center text-xs font-semibold cursor-pointer transition-all ${
                          formTemperature === temp
                            ? temp === 'Quente'
                              ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                              : temp === 'Frio'
                              ? 'bg-sky-950/60 border-sky-500 text-sky-300'
                              : temp === 'Cliente'
                              ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                              : 'bg-amber-950/60 border-amber-500 text-amber-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {temp}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Estágio do Funil</label>
                    <select
                      value={formCurrentStageId}
                      onChange={(e) => handleStageChange(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {stages.map((stg) => (
                        <option key={stg.id} value={stg.id}>{stg.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Responsável</label>
                    <select
                      value={formResponsibleUserId}
                      onChange={(e) => setFormResponsibleUserId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || 'Sem nome'}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {quizStep === 5 && (
                <div className="space-y-3 text-xs">
                  <h3 className="text-base font-bold text-white mb-2">Revisão</h3>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex justify-between"><span>Nome:</span><strong className="text-white">{formName}</strong></div>
                    {formCnpj && <div className="flex justify-between"><span>CNPJ:</span><strong className="text-white">{formCnpj}</strong></div>}
                    <div className="flex justify-between"><span>Tipo:</span><strong className="text-white">{formCondominiumType}</strong></div>
                    {formUnitCount && <div className="flex justify-between"><span>Unidades:</span><strong className="text-white">{formUnitCount}</strong></div>}
                    <div className="flex justify-between"><span>Cidade:</span><strong className="text-white">{formCity || '-'}</strong></div>
                    {formAdministrator && <div className="flex justify-between"><span>Administradora:</span><strong className="text-white">{formAdministrator}</strong></div>}
                    <div className="flex justify-between"><span>Temperatura / Estágio:</span><strong className="text-indigo-300">{formTemperature} · {stageMap.get(formCurrentStageId) || 'Inicial'}</strong></div>
                    <div className="flex justify-between"><span>Responsável:</span><strong className="text-white">{profileMap.get(formResponsibleUserId) || 'Não atribuído'}</strong></div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {quizStep > 1 && (
                  <button
                    type="button"
                    onClick={handlePrevQuizStep}
                    disabled={formSaving}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    ← Voltar
                  </button>
                )}
                {modalMode === 'edit' && selectedLead && (
                  <button
                    type="button"
                    onClick={() => handleRequestDeleteLead(selectedLead)}
                    className="text-xs text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    <span>Excluir condomínio</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={formSaving}
                  className="px-3 py-1.5 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancelar
                </button>

                {quizStep < totalQuizSteps ? (
                  <button
                    type="button"
                    onClick={handleNextQuizStep}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitLead}
                    disabled={formSaving}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {formSaving ? 'Salvando...' : 'Concluir'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {modalMode === 'view' && selectedLead && (
        <div
          onClick={handleCloseModal}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider block">Detalhes da Conta</span>
                <h2 className="text-lg font-bold text-white">{selectedLead.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleCloseModal();
                    handleOpenEdit(selectedLead);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white cursor-pointer"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleRequestDeleteLead(selectedLead)}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-xs text-rose-300 hover:text-rose-200 cursor-pointer flex items-center gap-1"
                  title="Excluir condomínio"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  <span>Excluir</span>
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block mb-0.5">Temperatura</span>
                  <span className="font-bold text-white text-sm">{selectedLead.temperature || 'Morno'}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block mb-0.5">Estágio</span>
                  <span className="font-semibold text-indigo-300 truncate block">{stageMap.get(selectedLead.current_stage_id || '') || 'Inicial'}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block mb-0.5">Responsável</span>
                  <span className="font-semibold text-white truncate block">{profileMap.get(selectedLead.responsible_user_id || '') || 'Não atribuído'}</span>
                </div>
              </div>

              {/* Interações */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="font-bold uppercase tracking-wider text-slate-300">Histórico de Interações</h3>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateInteraction(selectedLead)}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    + Registrar interação
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {getInteractionsForLead(selectedLead.id).map((i) => (
                    <div key={i.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-indigo-300">{i.interaction_type} · {formatDateBR(i.occurred_at)}</span>
                        {i.next_follow_up_date && (
                          <span className="text-amber-300 text-[10px]">Follow-up: {formatDateBR(i.next_follow_up_date)}</span>
                        )}
                      </div>
                      {i.notes && <p className="text-slate-300 whitespace-pre-wrap">{i.notes}</p>}
                    </div>
                  ))}
                  {getInteractionsForLead(selectedLead.id).length === 0 && (
                    <p className="text-slate-500 text-center py-4 bg-slate-950 rounded-xl border border-slate-800">Nenhuma interação registrada.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK INTERACTION MODAL */}
      {interactionModalMode && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">Registrar Interação · {selectedLead.name}</h3>
              <button
                type="button"
                onClick={() => setInteractionModalMode(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitInteraction} className="p-6 space-y-4 text-xs">
              {formInteractionError && <div className="p-3 bg-rose-950 border border-rose-600/50 rounded-xl text-rose-200">{formInteractionError}</div>}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Tipo</label>
                <div className="grid grid-cols-3 gap-2">
                  {INTERACTION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormInteractionType(type)}
                      className={`p-2 rounded-xl border text-center font-medium ${
                        formInteractionType === type ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200' : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Observações</label>
                <textarea
                  rows={4}
                  value={formInteractionNotes}
                  onChange={(e) => setFormInteractionNotes(e.target.value)}
                  placeholder="Resumo do contato..."
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Próximo Follow-up (opcional)</label>
                <input
                  type="date"
                  value={formInteractionNextFollowUpDate}
                  onChange={(e) => setFormInteractionNextFollowUpDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white focus:outline-none"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInteractionModalMode(null)}
                  className="px-3 py-2 text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formInteractionSaving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
                >
                  {formInteractionSaving ? 'Salvando...' : 'Salvar interação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bento Grid Visual Customization & Persona Filter Modal */}
      <BentoViewConfigModal
        isOpen={isBentoModalOpen}
        onClose={() => setIsBentoModalOpen(false)}
        title="Personalizar Cards"
        description="Escolha o que aparece nos cards"
        profiles={profiles}
        selectedResponsible={responsibleFilter}
        onSelectResponsible={(id) => setResponsibleFilter(id)}
        toggles={[
          {
            key: 'showCityAndType',
            label: 'Tipo e Cidade',
            checked: viewConfig.showCityAndType,
            onChange: (val) => handleUpdateViewConfig('showCityAndType', val),
          },
          {
            key: 'showStage',
            label: 'Estágio',
            checked: viewConfig.showStage,
            onChange: (val) => handleUpdateViewConfig('showStage', val),
          },
          {
            key: 'showResponsible',
            label: 'Responsável',
            checked: viewConfig.showResponsible,
            onChange: (val) => handleUpdateViewConfig('showResponsible', val),
          },
          {
            key: 'showNextContact',
            label: 'Próximo Contato',
            checked: viewConfig.showNextContact,
            onChange: (val) => handleUpdateViewConfig('showNextContact', val),
          },
        ]}
        onResetDefaults={handleResetViewConfig}
      />
    </div>
  );
}
