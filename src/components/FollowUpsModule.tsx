import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useCRM, type Lead, type Interaction, type Contact } from '../lib/crmStore.tsx';
import { useTheme } from '../lib/themeContext.tsx';
import type { UserProfile } from '../App.tsx';
import {
  BentoViewConfigModal,
  DEFAULT_FOLLOWUPS_VIEW_CONFIG,
  type FollowUpsViewConfig,
} from './BentoViewConfigModal.tsx';
import {
  CardQuickActions,
  WhatsAppIcon,
  EmailIcon,
  FolderIcon,
  EyeIcon,
  EditIcon,
  TrashIcon,
  PRESET_ROLES,
} from './PipelineComponents.tsx';
import {
  getLeadFolderLink,
  saveLeadFolderLink,
  sanitizeTemperatureForDB,
  TEMPERATURE_OPTIONS,
} from './LeadsModule.tsx';
import {
  parseCalendarDate,
  formatDateBR,
  formatTimeBR,
  toDateInputValue,
  saveFollowUpTime,
  getFollowUpTime,
} from '../lib/dateUtils.ts';
import { renderFormattedTextWithLinks } from '../lib/linkUtils.tsx';
import UnifiedNoteModal from './UnifiedNoteModal.tsx';
import NotesTimelineModal from './NotesTimelineModal.tsx';
import FunnelVisualizer from './FunnelVisualizer.tsx';

export interface FollowUpsModuleProps {
  currentProfile: UserProfile;
  onOpenLead: (leadId: string) => void;
  currentModule?: string;
  onSelectModule?: (module: 'pipeline' | 'contacts' | 'followups' | 'activities' | 'reports') => void;
}

export interface FollowUpItem {
  lead: Lead;
  latestInteraction: Interaction;
  followUpDate: string;
  status: 'overdue' | 'today' | 'upcoming';
  responsibleName: string;
  stageName: string;
}

export function getFollowUpStatus(dateStr?: string | null): 'overdue' | 'today' | 'upcoming' {
  const target = parseCalendarDate(dateStr);
  if (!target) return 'upcoming';
  const now = new Date();

  const targetDateOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (targetDateOnly < todayOnly) {
    return 'overdue';
  } else if (targetDateOnly === todayOnly) {
    return 'today';
  } else {
    return 'upcoming';
  }
}

export { formatDateBR, formatTimeBR };

export default function FollowUpsModule({
  currentProfile,
  onOpenLead,
}: FollowUpsModuleProps) {
  const {
    leads,
    stages,
    interactions,
    profiles,
    stageMap,
    profileMap,
    getContactsForLead,
    upsertLeadLocally,
    upsertInteractionLocally,
    upsertContactLocally,
    deleteContactLocally,
    refreshAll,
  } = useCRM();

  // Inline Quick-Edit State (single field per card at a time)
  const [quickEdit, setQuickEdit] = useState<{
    leadId: string;
    field: 'stage' | 'date' | 'time' | 'temperature' | 'notes' | 'responsible';
    value: string;
    saving?: boolean;
  } | null>(null);

  const handleOpenQuickEdit = (
    leadId: string,
    field: 'stage' | 'date' | 'time' | 'temperature' | 'notes' | 'responsible',
    initialValue: string
  ) => {
    setQuickEdit({ leadId, field, value: initialValue, saving: false });
  };

  const handleSaveQuickField = async (
    item: FollowUpItem,
    overrideValue?: string
  ) => {
    if (!quickEdit || quickEdit.leadId !== item.lead.id) return;
    const val = (overrideValue !== undefined ? overrideValue : quickEdit.value).trim();
    const { field } = quickEdit;
    setQuickEdit((prev) => (prev ? { ...prev, saving: true } : null));

    try {
      if (field === 'stage') {
        if (!val) return;
        const updatedLead: Lead = { ...item.lead, current_stage_id: val };
        upsertLeadLocally(updatedLead);
        await supabase.from('leads').update({ current_stage_id: val }).eq('id', item.lead.id);
        setStatusFeedback({ type: 'success', message: 'Estágio do funil atualizado!' });
      } else if (field === 'temperature') {
        if (!val) return;
        const updatedLead: Lead = { ...item.lead, temperature: val };
        upsertLeadLocally(updatedLead);
        const dbTemp = sanitizeTemperatureForDB(val);
        const { error } = await supabase.from('leads').update({ temperature: dbTemp }).eq('id', item.lead.id);
        if (error && error.code === '23514') {
          await supabase.from('leads').update({ temperature: 'Morno' }).eq('id', item.lead.id);
        }
        setStatusFeedback({ type: 'success', message: `Temperatura alterada para ${val}!` });
      } else if (field === 'date') {
        if (!val) return;
        const currentTime = getFollowUpTime(item.followUpDate, item.latestInteraction.id, item.lead.id);
        const nextIso = `${val}T${currentTime}:00`;
        const updatedInteraction: Interaction = {
          ...item.latestInteraction,
          next_follow_up_date: nextIso,
        };
        upsertInteractionLocally(updatedInteraction);
        await supabase
          .from('interactions')
          .update({ next_follow_up_date: nextIso })
          .eq('id', item.latestInteraction.id);
        setStatusFeedback({ type: 'success', message: `Agendamento alterado para ${formatDateBR(nextIso)}!` });
      } else if (field === 'time') {
        if (!val) return;
        const currentDatePart = toDateInputValue(item.followUpDate);
        const nextIso = `${currentDatePart}T${val}:00`;
        saveFollowUpTime(item.latestInteraction.id, item.lead.id, val);
        const updatedInteraction: Interaction = {
          ...item.latestInteraction,
          next_follow_up_date: nextIso,
        };
        upsertInteractionLocally(updatedInteraction);
        await supabase
          .from('interactions')
          .update({ next_follow_up_date: nextIso })
          .eq('id', item.latestInteraction.id);
        setStatusFeedback({ type: 'success', message: `Horário alterado para ${val}!` });
      } else if (field === 'notes') {
        const updatedInteraction: Interaction = {
          ...item.latestInteraction,
          notes: val || null,
        };
        upsertInteractionLocally(updatedInteraction);
        await supabase
          .from('interactions')
          .update({ notes: val || null })
          .eq('id', item.latestInteraction.id);
        setStatusFeedback({ type: 'success', message: 'Mensagem da nota atualizada!' });
      } else if (field === 'responsible') {
        if (!val) return;
        const updatedLead: Lead = { ...item.lead, responsible_user_id: val };
        const updatedInteraction: Interaction = {
          ...item.latestInteraction,
          responsible_user_id: val,
        };
        upsertLeadLocally(updatedLead);
        upsertInteractionLocally(updatedInteraction);
        await Promise.all([
          supabase.from('leads').update({ responsible_user_id: val }).eq('id', item.lead.id),
          supabase.from('interactions').update({ responsible_user_id: val }).eq('id', item.latestInteraction.id),
        ]);
        setStatusFeedback({ type: 'success', message: 'Responsável atualizado!' });
      }

      setQuickEdit(null);
      refreshAll(true);
    } catch (err) {
      console.warn('Quick field update notice:', err);
      setQuickEdit(null);
    }
  };

  // View Mode (Cards, Lista, Funil)
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'funnel'>('cards');

  // Condominium Picker for "+ Novo Follow-up"
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'completed'>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Auto-dismiss status feedback notification toast after 2.5s
  useEffect(() => {
    if (statusFeedback) {
      const timer = setTimeout(() => {
        setStatusFeedback(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [statusFeedback]);

  // Bento Grid Customization Config
  const FOLLOWUPS_VIEW_CONFIG_KEY = 'triverus:followups-view-config:v1';

  const [viewConfig, setViewConfig] = useState<FollowUpsViewConfig>(() => {
    try {
      const stored = localStorage.getItem(FOLLOWUPS_VIEW_CONFIG_KEY);
      return stored ? { ...DEFAULT_FOLLOWUPS_VIEW_CONFIG, ...JSON.parse(stored) } : DEFAULT_FOLLOWUPS_VIEW_CONFIG;
    } catch {
      return DEFAULT_FOLLOWUPS_VIEW_CONFIG;
    }
  });

  const [isBentoModalOpen, setIsBentoModalOpen] = useState(false);

  const handleUpdateViewConfig = (key: keyof FollowUpsViewConfig, val: boolean) => {
    setViewConfig((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem(FOLLOWUPS_VIEW_CONFIG_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleResetViewConfig = () => {
    setViewConfig(DEFAULT_FOLLOWUPS_VIEW_CONFIG);
    try {
      localStorage.setItem(FOLLOWUPS_VIEW_CONFIG_KEY, JSON.stringify(DEFAULT_FOLLOWUPS_VIEW_CONFIG));
    } catch {}
    setStatusFeedback({ type: 'success', message: 'Visualização restaurada para o padrão.' });
  };

  // Popover States
  const [activeNoteModalLead, setActiveNoteModalLead] = useState<Lead | null>(null);
  const [activeNoteModalInteractionId, setActiveNoteModalInteractionId] = useState<string | null>(null);
  const [activeTimelineLead, setActiveTimelineLead] = useState<Lead | null>(null);

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
  const [waSaving, setWaSaving] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);

  // Email Independent Popover State (CRUD)
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
  const [emSaving, setEmSaving] = useState(false);
  const [emError, setEmError] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);

  // Folder Popover State
  const [folderPopover, setFolderPopover] = useState<{
    open: boolean;
    lead: Lead | null;
    folderUrl: string;
    error: string | null;
  }>({
    open: false,
    lead: null,
    folderUrl: '',
    error: null,
  });

  // Phone input formatting helper
  const handlePhoneInputChange = (value: string) => {
    const raw = value.replace(/\D/g, '').slice(0, 11);
    if (raw.length <= 2) {
      setWaPhone(raw ? `(${raw}` : '');
    } else if (raw.length <= 6) {
      setWaPhone(`(${raw.slice(0, 2)}) ${raw.slice(2)}`);
    } else if (raw.length <= 10) {
      setWaPhone(`(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`);
    } else {
      setWaPhone(`(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7, 11)}`);
    }
  };

  // WhatsApp Handlers
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
  };

  const handleOpenEditWhatsAppContact = (contact: Contact) => {
    const isStandardRole = (PRESET_ROLES as readonly string[]).includes(contact.role_title || '');
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
  };

  const handleSaveWhatsAppContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsappPopover.lead) return;
    setWaError(null);

    if (!waName.trim()) {
      setWaError('Informe o nome do contato.');
      return;
    }
    const cleanDigits = waPhone.replace(/\D/g, '');
    if (cleanDigits.length < 8) {
      setWaError('Informe um telefone válido (ao menos 8 dígitos).');
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

  // Email Handlers
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
  };

  const handleOpenEditEmailContact = (contact: Contact) => {
    const isStandardRole = (PRESET_ROLES as readonly string[]).includes(contact.role_title || '');
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

  const handleDeleteContact = async (contact: Contact, leadId: string) => {
    try {
      await supabase.from('lead_contacts').delete().eq('contact_id', contact.id).eq('lead_id', leadId);
      await supabase.from('contacts').delete().eq('id', contact.id);
    } catch (err) {
      console.warn('Delete contact notice:', err);
    }
    deleteContactLocally(contact.id);
    setStatusFeedback({
      type: 'success',
      message: `Contato "${contact.name}" excluído.`,
    });
  };

  // Compute follow-up list in memory: find the most relevant follow-up for each lead
  const followUpItems = useMemo<FollowUpItem[]>(() => {
    const items: FollowUpItem[] = [];

    // Group interactions by lead_id
    const interactionsByLead = new Map<string, Interaction[]>();
    interactions.forEach((i) => {
      const existing = interactionsByLead.get(i.lead_id) || [];
      existing.push(i);
      interactionsByLead.set(i.lead_id, existing);
    });

    leads.forEach((lead) => {
      const leadInteractions = interactionsByLead.get(lead.id) || [];
      if (leadInteractions.length === 0) return;

      // Sort by occurred_at desc (most recent first)
      const sorted = [...leadInteractions].sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );

      const latest = sorted[0];

      // A lead ONLY appears in the Follow-ups list if its LATEST interaction has an active open follow-up scheduled!
      if (latest.next_follow_up_date && latest.next_follow_up_date.trim() !== '') {
        const status = getFollowUpStatus(latest.next_follow_up_date);
        const responsibleId = latest.responsible_user_id || lead.responsible_user_id;
        const responsibleName = responsibleId ? profileMap.get(responsibleId) || 'Não atribuído' : 'Não atribuído';
        const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) || 'Estágio Inicial' : 'Estágio Inicial';

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

    // Sort order: overdue first (1), today (2), upcoming (3)
    return items.sort((a, b) => {
      const priority = { overdue: 1, today: 2, upcoming: 3 };
      if (priority[a.status] !== priority[b.status]) {
        return priority[a.status] - priority[b.status];
      }
      const timeA = parseCalendarDate(a.followUpDate)?.getTime() || 0;
      const timeB = parseCalendarDate(b.followUpDate)?.getTime() || 0;
      return timeA - timeB;
    });
  }, [leads, interactions, profileMap, stageMap]);

  // In-memory filtered follow-ups
  const filteredItems = useMemo(() => {
    return followUpItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (responsibleFilter !== 'all') {
        const respId = item.latestInteraction.responsible_user_id || item.lead.responsible_user_id;
        if (respId !== responsibleFilter) return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchLead = item.lead.name.toLowerCase().includes(term);
        const matchCity = item.lead.city ? item.lead.city.toLowerCase().includes(term) : false;
        const matchAddr = item.lead.address ? item.lead.address.toLowerCase().includes(term) : false;
        const matchAdm = item.lead.administrator ? item.lead.administrator.toLowerCase().includes(term) : false;
        const matchType = item.lead.condominium_type ? item.lead.condominium_type.toLowerCase().includes(term) : false;
        const matchResp = item.responsibleName ? item.responsibleName.toLowerCase().includes(term) : false;
        const matchStage = item.stageName ? item.stageName.toLowerCase().includes(term) : false;

        const leadContacts = getContactsForLead ? getContactsForLead(item.lead.id) : [];
        const matchContact = leadContacts.some(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            (c.role_title && c.role_title.toLowerCase().includes(term)) ||
            (c.phone && c.phone.includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term))
        );

        const matchNotes = item.latestInteraction.notes
          ? item.latestInteraction.notes.toLowerCase().includes(term)
          : false;
        const matchIntType = item.latestInteraction.interaction_type
          ? item.latestInteraction.interaction_type.toLowerCase().includes(term)
          : false;

        if (!matchLead && !matchCity && !matchAddr && !matchAdm && !matchType && !matchResp && !matchStage && !matchContact && !matchNotes && !matchIntType) {
          return false;
        }
      }
      return true;
    });
  }, [followUpItems, statusFilter, responsibleFilter, searchTerm, getContactsForLead]);

  // Counts by bucket
  const counts = useMemo(() => {
    return {
      all: followUpItems.length,
      overdue: followUpItems.filter((i) => i.status === 'overdue').length,
      today: followUpItems.filter((i) => i.status === 'today').length,
      upcoming: followUpItems.filter((i) => i.status === 'upcoming').length,
    };
  }, [followUpItems]);

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
    setFolderPopover({ open: false, lead: null, folderUrl: '', error: null });
  };

  const { theme } = useTheme();
  const isLight = theme === 'light';

  const getTemperatureCardBorder = (temp?: string | null) => {
    const norm = temp ? temp.trim().toLowerCase() : 'morno';
    if (norm === 'frio' || norm === 'cold') {
      return 'card-temp-frio';
    }
    if (norm === 'quente' || norm === 'hot') {
      return 'card-temp-quente';
    }
    if (norm === 'cliente' || norm === 'client' || norm === 'won') {
      return 'card-temp-cliente';
    }
    return 'card-temp-morno';
  };

  const getStageBadge = (stageId?: string | null) => {
    const stageName = stageId ? stageMap.get(stageId) || 'Início' : 'Início';
    const stageObj = stages.find((s) => s.id === stageId);
    let dotClass = 'bg-slate-400';
    let textClass = isLight ? 'text-slate-700' : 'text-slate-300';

    if (stageObj?.is_won || stageName.toLowerCase().includes('cliente')) {
      dotClass = 'bg-emerald-500';
      textClass = isLight ? 'text-emerald-700' : 'text-emerald-400';
    } else if (stageObj?.is_lost || stageName.toLowerCase().includes('perdid')) {
      dotClass = 'bg-rose-500';
      textClass = isLight ? 'text-rose-700' : 'text-rose-400';
    } else if (stageName.toLowerCase().includes('reuni')) {
      dotClass = 'bg-amber-400';
      textClass = isLight ? 'text-amber-700' : 'text-amber-400';
    } else if (stageName.toLowerCase().includes('proposta')) {
      dotClass = 'bg-sky-400';
      textClass = isLight ? 'text-sky-700' : 'text-sky-400';
    } else if (stageName.toLowerCase().includes('negocia')) {
      dotClass = 'bg-[#FF6600]';
      textClass = isLight ? 'text-orange-700' : 'text-[#FF6600]';
    } else if (stageName.toLowerCase().includes('contrato')) {
      dotClass = 'bg-purple-400';
      textClass = isLight ? 'text-purple-700' : 'text-purple-400';
    }

    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${textClass}`}>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        {stageName}
      </span>
    );
  };

  const getTemperatureBadge = (temp?: string | null) => {
    return getStageBadge(temp);
  };

  const getStatusBadge = (status: 'overdue' | 'today' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-xs ${
              isLight
                ? 'bg-white/90 text-rose-700 border-rose-400'
                : 'bg-amber-950/90 text-amber-300 border-amber-500/70'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isLight ? 'bg-rose-600' : 'bg-amber-400'}`} />
            Vencido
          </span>
        );
      case 'today':
        return (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-xs ${
              isLight
                ? 'bg-orange-50 text-[#FF6600] border-orange-200'
                : 'bg-orange-950/60 text-[#FF6600] border-orange-500/40'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF6600]" />
            Hoje
          </span>
        );
      case 'upcoming':
        return (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shadow-xs ${
              isLight
                ? 'bg-white/90 text-slate-800 border-slate-300'
                : 'bg-black/40 text-slate-200 border-white/20'
            }`}
          >
            Próximos
          </span>
        );
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* Notificação Toast Flutuante */}
      {statusFeedback && (
        <div className="fixed top-5 right-5 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold flex items-center gap-2 ${
              statusFeedback.type === 'success'
                ? 'bg-slate-900 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-900 border-rose-500/50 text-rose-300'
            }`}
          >
            <span>{statusFeedback.type === 'success' ? '✓' : '✕'}</span>
            <span>{statusFeedback.message}</span>
          </div>
        </div>
      )}

      {/* 1. Header Toolbar (Extrema Direita: Novo Follow-up) */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        {/* Left Controls Bar: Search + Status Filters + View Switcher + Eye Customizer */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          {/* Busca */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar follow-up..."
              className={`w-full pl-8 pr-7 py-2 rounded-xl text-xs focus:outline-none transition-colors ${
                isLight
                  ? 'bg-white border border-slate-300 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 shadow-2xs'
                  : 'bg-zinc-900 border border-zinc-800 focus:border-zinc-700 text-white placeholder-zinc-500'
              }`}
            />
            <svg
              className={`w-3.5 h-3.5 absolute left-2.5 top-2.5 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className={`absolute right-2.5 top-2 text-xs cursor-pointer ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-500 hover:text-white'}`}
              >
                ×
              </button>
            )}
          </div>

          {/* Filtros de Status (Esmaecidos/Inativos quando estiver na visualização de Funil) */}
          <div
            className={`flex items-center p-1 rounded-xl border transition-all ${
              isLight ? 'bg-white border-slate-300 shadow-2xs' : 'bg-zinc-900 border-zinc-800'
            } ${
              viewMode === 'funnel'
                ? 'opacity-30 grayscale pointer-events-none cursor-not-allowed select-none'
                : ''
            }`}
            title={
              viewMode === 'funnel'
                ? 'Filtros de status (Vencidos, Hoje, Próximos) não se aplicam à visualização de Funil'
                : undefined
            }
          >
            <button
              type="button"
              disabled={viewMode === 'funnel'}
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'all'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Todos</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums font-bold ${
                isLight ? 'bg-slate-100 text-slate-700 border border-slate-300/60' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {counts.all}
              </span>
            </button>
            <button
              type="button"
              disabled={viewMode === 'funnel'}
              onClick={() => setStatusFilter('overdue')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'overdue'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : counts.overdue > 0
                  ? isLight
                    ? 'text-amber-700 hover:text-amber-800 font-bold'
                    : 'text-amber-400 hover:text-amber-300'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {counts.overdue > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />}
              <span>Vencidos</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums font-bold ${
                  counts.overdue > 0
                    ? isLight
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                    : isLight
                    ? 'bg-slate-100 text-slate-700 border border-slate-300/60'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {counts.overdue}
              </span>
            </button>
            <button
              type="button"
              disabled={viewMode === 'funnel'}
              onClick={() => setStatusFilter('today')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'today'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Hoje</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums font-bold ${
                isLight ? 'bg-slate-100 text-slate-700 border border-slate-300/60' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {counts.today}
              </span>
            </button>
            <button
              type="button"
              disabled={viewMode === 'funnel'}
              onClick={() => setStatusFilter('upcoming')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'upcoming'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Próximos</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums font-bold ${
                isLight ? 'bg-slate-100 text-slate-700 border border-slate-300/60' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {counts.upcoming}
              </span>
            </button>
          </div>

          {/* Alternador de Visualização: Cards / Lista / Funil */}
          <div className={`flex items-center p-1 rounded-xl border ${
            isLight ? 'bg-white border-slate-300 shadow-2xs' : 'bg-zinc-900 border-zinc-800'
          }`}>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cards'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span>Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'list'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Lista</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('funnel')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'funnel'
                  ? 'bg-[#FF6600] text-white shadow-xs'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-950 hover:bg-slate-100'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span>Funil</span>
            </button>
          </div>

          {/* Eye Customizer */}
          <button
            type="button"
            onClick={() => setIsBentoModalOpen(true)}
            className={`p-2 rounded-xl border transition-colors cursor-pointer ${
              isLight
                ? 'bg-white border-slate-300 text-slate-700 hover:text-slate-950 hover:bg-slate-100 shadow-2xs'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
            }`}
            title="Personalizar visualização dos cards e tema da página"
            aria-label="Personalizar cards"
          >
            <EyeIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Right Action Button (Extrema Direita Superior da Tela - Idêntico ao Novo Condomínio) */}
        <div className="shrink-0 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              setPickerSearch('');
              setIsPickerOpen(true);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-[#FF6600] hover:bg-[#E65C00] text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Novo Follow-up</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {filteredItems.length === 0 ? (
        <div className={`mt-8 text-center py-16 rounded-3xl p-6 border ${
          isLight ? 'bg-white border-slate-200 shadow-md' : 'bg-slate-900/40 border-slate-800/80'
        }`}>
          <div className="w-12 h-12 rounded-2xl bg-[#FF6600]/10 border border-[#FF6600]/20 text-[#FF6600] flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className={`text-base font-semibold mb-1 ${isLight ? 'text-slate-950' : 'text-white'}`}>
            {searchTerm || statusFilter !== 'all' || responsibleFilter !== 'all'
              ? 'Nenhum follow-up encontrado para estes filtros'
              : 'Nenhum follow-up agendado no momento'}
          </h3>
          <p className={`text-xs max-w-sm mx-auto ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            Os follow-ups são gerados automaticamente quando você define uma data de próximo contato ao registrar uma interação em um condomínio.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW COM RODAPÉ IDÊNTICO AO PIPELINE */
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredItems.map((item) => {
            const leadContacts = getContactsForLead ? getContactsForLead(item.lead.id) : [];
            const waCount = leadContacts.filter((c) => c.phone && c.phone.trim()).length;
            const emCount = leadContacts.filter((c) => c.email && c.email.trim()).length;
            const hasFolder = Boolean(getLeadFolderLink(item.lead.id));
            const leadInteractionsCount = interactions.filter((i) => i.lead_id === item.lead.id).length;
            const isEditingField = (f: 'stage' | 'date' | 'time' | 'temperature' | 'notes' | 'responsible') =>
              quickEdit?.leadId === item.lead.id && quickEdit?.field === f;
            const currentResponsibleId = item.latestInteraction.responsible_user_id || item.lead.responsible_user_id || currentProfile.id;
            const displayTime = formatTimeBR(item.followUpDate, item.latestInteraction.id, item.lead.id);

            return (
              <div
                key={item.lead.id}
                data-lead-id={item.lead.id}
                className={`rounded-[22px] p-4 flex flex-col justify-between transition-all group ${getTemperatureCardBorder(item.lead.temperature)}`}
              >
                <div>
                  {/* Top: Condominium Name + Status Badge */}
                  <div className={`flex items-start justify-between gap-2 pb-2 mb-2 border-b ${isLight ? 'border-black/10' : 'border-white/15'}`}>
                    <div className="flex-1 min-w-0">
                      <h3
                        onClick={() => onOpenLead(item.lead.id)}
                        className={`font-bold text-sm transition-colors cursor-pointer leading-snug truncate ${
                          isLight ? 'text-slate-950 hover:text-indigo-700' : 'text-white hover:text-indigo-300'
                        }`}
                        title={item.lead.name}
                      >
                        {item.lead.name}
                      </h3>

                      {(viewConfig.showCityAndType || viewConfig.showStage) && (
                        <div className={`flex items-center flex-wrap gap-1.5 mt-0.5 text-[11px] ${isLight ? 'text-slate-800 font-medium' : 'text-slate-200/90'}`}>
                          {viewConfig.showCityAndType && (
                            <span className="truncate">
                              {item.lead.city
                                ? `${item.lead.city} · ${item.lead.condominium_type || 'Residencial'}`
                                : item.lead.condominium_type || 'Residencial'}
                            </span>
                          )}
                          {viewConfig.showCityAndType && viewConfig.showStage && <span>·</span>}
                          {viewConfig.showStage && (
                            isEditingField('stage') ? (
                              <div className="inline-flex items-center gap-1">
                                <select
                                  autoFocus
                                  value={quickEdit?.value || ''}
                                  onChange={(e) => handleSaveQuickField(item, e.target.value)}
                                  onBlur={() => setQuickEdit(null)}
                                  className="px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded-md text-[11px] text-slate-100 focus:outline-none"
                                >
                                  {stages.map((stg) => (
                                    <option key={stg.id} value={stg.id}>
                                      {stg.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <span className={`inline-flex items-center gap-1 font-semibold truncate ${isLight ? 'text-indigo-800' : 'text-indigo-200'}`}>
                                <span className="truncate">{item.stageName}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenQuickEdit(
                                      item.lead.id,
                                      'stage',
                                      item.lead.current_stage_id || (stages[0]?.id ?? '')
                                    )
                                  }
                                  title="Editar estágio do funil"
                                  className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                                    isLight ? 'text-slate-700 hover:text-indigo-700 hover:bg-white/70' : 'text-slate-300/80 hover:text-white hover:bg-black/30'
                                  }`}
                                >
                                  <EditIcon className="w-3 h-3" />
                                </button>
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                    {getStatusBadge(item.status)}
                  </div>

                  {/* Highlight Blocks: Agendamento / Horário / Temperatura */}
                  {(viewConfig.showFollowUpDate || viewConfig.showTemperature) && (
                    <div
                      className={`my-2.5 grid gap-2 text-xs ${
                        viewConfig.showFollowUpDate && viewConfig.showTemperature
                          ? 'grid-cols-3'
                          : viewConfig.showFollowUpDate
                          ? 'grid-cols-2'
                          : 'grid-cols-1'
                      }`}
                    >
                      {viewConfig.showFollowUpDate && (
                        <>
                          {/* Bloco 1: Agendamento */}
                          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${isLight ? 'bg-white/80 border-black/10' : 'bg-black/30 border-white/10'}`}>
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${isLight ? 'text-slate-600' : 'text-slate-300/80'}`}>
                                Agendamento
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  isEditingField('date')
                                    ? setQuickEdit(null)
                                    : handleOpenQuickEdit(item.lead.id, 'date', toDateInputValue(item.followUpDate))
                                }
                                title="Alterar data do agendamento"
                                className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                                  isLight ? 'text-slate-600 hover:text-slate-950 hover:bg-black/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <EditIcon className="w-3 h-3" />
                              </button>
                            </div>
                            {isEditingField('date') ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <input
                                  type="date"
                                  autoFocus
                                  value={quickEdit?.value || ''}
                                  onChange={(e) => {
                                    const nextVal = e.target.value;
                                    setQuickEdit((prev) => (prev ? { ...prev, value: nextVal } : null));
                                    if (nextVal) handleSaveQuickField(item, nextVal);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setQuickEdit(null);
                                  }}
                                  className="w-full px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded text-[11px] text-slate-100 focus:outline-none"
                                />
                              </div>
                            ) : (
                              <span className={`font-bold text-xs truncate ${isLight ? 'text-slate-950' : 'text-white'}`}>
                                {formatDateBR(item.followUpDate)}
                              </span>
                            )}
                          </div>

                          {/* Bloco 2: Horário */}
                          <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${isLight ? 'bg-white/80 border-black/10' : 'bg-black/30 border-white/10'}`}>
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${isLight ? 'text-slate-600' : 'text-slate-300/80'}`}>
                                Horário
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  isEditingField('time')
                                    ? setQuickEdit(null)
                                    : handleOpenQuickEdit(item.lead.id, 'time', displayTime)
                                }
                                title="Alterar horário do agendamento"
                                className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                                  isLight ? 'text-slate-600 hover:text-slate-950 hover:bg-black/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <EditIcon className="w-3 h-3" />
                              </button>
                            </div>
                            {isEditingField('time') ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <input
                                  type="time"
                                  autoFocus
                                  value={quickEdit?.value || '09:00'}
                                  onChange={(e) =>
                                    setQuickEdit((prev) => (prev ? { ...prev, value: e.target.value } : null))
                                  }
                                  onBlur={(e) => {
                                    if (e.target.value) handleSaveQuickField(item, e.target.value);
                                    else setQuickEdit(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveQuickField(item);
                                    if (e.key === 'Escape') setQuickEdit(null);
                                  }}
                                  className="w-full px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded text-[11px] text-slate-100 focus:outline-none"
                                />
                              </div>
                            ) : (
                              <span className={`font-bold text-xs truncate ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
                                {displayTime}
                              </span>
                            )}
                          </div>
                        </>
                      )}

                      {/* Bloco 3: Estágio Comercial */}
                      {viewConfig.showTemperature && (
                        <div className={`p-2.5 rounded-xl border flex flex-col justify-between ${isLight ? 'bg-white/80 border-black/10' : 'bg-black/30 border-white/10'}`}>
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${isLight ? 'text-slate-600' : 'text-slate-300/80'}`}>
                              Estágio
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                isEditingField('stage')
                                  ? setQuickEdit(null)
                                  : handleOpenQuickEdit(item.lead.id, 'stage', item.lead.current_stage_id || stages[0]?.id || '')
                              }
                              title="Alterar estágio comercial"
                              className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                                isLight ? 'text-slate-600 hover:text-slate-950 hover:bg-black/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              <EditIcon className="w-3 h-3" />
                            </button>
                          </div>
                          {isEditingField('stage') ? (
                            <select
                              autoFocus
                              value={quickEdit?.value || item.lead.current_stage_id || ''}
                              onChange={(e) => handleSaveQuickField(item, e.target.value)}
                              onBlur={() => setQuickEdit(null)}
                              className="w-full px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded text-[11px] text-slate-100 focus:outline-none mt-0.5"
                            >
                              {stages.map((stg) => (
                                <option key={stg.id} value={stg.id}>
                                  {stg.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="mt-0.5 truncate">
                              {getStageBadge(item.lead.current_stage_id)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Latest Interaction preview with Quick-Edit Pencil */}
                  {viewConfig.showLatestNotes && (
                    <div className={`text-xs space-y-1.5 p-2.5 rounded-xl border mb-2 ${isLight ? 'bg-white/75 border-black/10 text-slate-800' : 'bg-black/25 border-white/10 text-slate-200'}`}>
                      <div className={`flex items-center justify-between text-[11px] ${isLight ? 'text-slate-600 font-medium' : 'text-slate-300/80'}`}>
                        <span>Última interação ({item.latestInteraction.interaction_type}):</span>
                        <button
                          type="button"
                          onClick={() =>
                            isEditingField('notes')
                              ? setQuickEdit(null)
                              : handleOpenQuickEdit(item.lead.id, 'notes', item.latestInteraction.notes || '')
                          }
                          title="Editar mensagem da nota"
                          className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                            isLight ? 'text-slate-600 hover:text-slate-950 hover:bg-black/5' : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          <EditIcon className="w-3 h-3" />
                        </button>
                      </div>

                      {isEditingField('notes') ? (
                        <div className="space-y-1.5 pt-0.5">
                          <textarea
                            rows={2}
                            autoFocus
                            value={quickEdit?.value || ''}
                            onChange={(e) =>
                              setQuickEdit((prev) => (prev ? { ...prev, value: e.target.value } : null))
                            }
                            placeholder="Digite a observação..."
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-indigo-500 rounded-lg text-[11px] text-slate-100 focus:outline-none resize-none"
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setQuickEdit(null)}
                              className="px-2 py-0.5 rounded text-[10px] text-slate-500 hover:text-slate-900 cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={quickEdit?.saving}
                              onClick={() => handleSaveQuickField(item)}
                              className="px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold cursor-pointer"
                            >
                              {quickEdit?.saving ? 'Salvando...' : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      ) : item.latestInteraction.notes ? (
                        <p className={`text-[11px] line-clamp-2 italic ${isLight ? 'text-slate-900 font-medium' : 'text-slate-100/90'}`}>
                          "{renderFormattedTextWithLinks(item.latestInteraction.notes)}"
                        </p>
                      ) : (
                        <p className={`text-[11px] italic ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Sem mensagem registrada</p>
                      )}
                    </div>
                  )}

                  {/* Horizontal Split Row: Responsible (Left) + Last Note Date (Right) */}
                  {(viewConfig.showResponsible || viewConfig.showLatestNotes) && (
                    <div className={`flex items-center justify-between gap-2 mb-1 text-[11px] ${isLight ? 'text-slate-800 font-medium' : 'text-slate-200'}`}>
                      {viewConfig.showResponsible ? (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1" title={`Responsável: ${item.responsibleName}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isLight ? 'bg-white/85 text-slate-700 border border-black/10' : 'bg-black/35 text-slate-200 border border-white/10'}`}>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>

                          {isEditingField('responsible') ? (
                            <select
                              autoFocus
                              value={quickEdit?.value || currentResponsibleId}
                              onChange={(e) => handleSaveQuickField(item, e.target.value)}
                              onBlur={() => setQuickEdit(null)}
                              className="px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded text-[11px] text-slate-100 focus:outline-none max-w-[150px]"
                            >
                              {profiles.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.full_name || 'Usuário'}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <span className="truncate max-w-[135px]">{item.responsibleName}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenQuickEdit(item.lead.id, 'responsible', currentResponsibleId)
                                }
                                title="Alterar responsável pela demanda"
                                className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                                  isLight ? 'text-slate-700 hover:text-indigo-700 hover:bg-white/70' : 'text-slate-300/80 hover:text-white hover:bg-black/30'
                                }`}
                              >
                                <EditIcon className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <span />
                      )}

                      {/* Data da última nota na mesma linha horizontal à direita */}
                      <div
                        className={`flex items-center gap-1 text-[11px] shrink-0 ${isLight ? 'text-slate-700' : 'text-slate-300'}`}
                        title="Data da última nota registrada"
                      >
                        <span className={isLight ? 'text-slate-600' : 'text-slate-300/80'}>Última nota:</span>
                        <span className={`font-semibold ${isLight ? 'text-slate-950' : 'text-white'}`}>
                          {formatDateBR(item.latestInteraction.occurred_at)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rodapé Idêntico ao Pipeline (Linha do tempo, WhatsApp, Email, Pasta + Botão Circular "+") */}
                {(viewConfig.showQuickAction ?? true) && (
                  <CardQuickActions
                    lead={item.lead}
                    notesCount={leadInteractionsCount}
                    waCount={waCount}
                    emCount={emCount}
                    hasFolderLink={hasFolder}
                    onOpenTimeline={() => setActiveTimelineLead(item.lead)}
                    onOpenWhatsApp={() => handleOpenWhatsAppPopover(item.lead)}
                    onOpenEmail={() => handleOpenEmailPopover(item.lead)}
                    onOpenFolder={() => setFolderPopover({ open: true, lead: item.lead, folderUrl: getLeadFolderLink(item.lead.id), error: null })}
                    onOpenNotes={() => setActiveNoteModalLead(item.lead)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : viewMode === 'funnel' ? (
        /* VISUAL SALES FUNNEL VIEW */
        <div className="mt-5">
          <FunnelVisualizer
            leads={leads}
            stages={stages}
            interactions={interactions}
            profiles={profiles}
            profileMap={profileMap}
            stageMap={stageMap}
            currentProfile={currentProfile}
            getContactsForLead={getContactsForLead}
            onOpenLead={onOpenLead}
            onOpenTimeline={(l) => setActiveTimelineLead(l)}
            onOpenNotes={(l) => setActiveNoteModalLead(l)}
            onOpenWhatsApp={(l) => handleOpenWhatsAppPopover(l)}
            onOpenEmail={(l) => handleOpenEmailPopover(l)}
            onOpenFolder={(l) =>
              setFolderPopover({
                open: true,
                lead: l,
                folderUrl: getLeadFolderLink(l.id),
                error: null,
              })
            }
            onSuccessFeedback={(msg) => setStatusFeedback({ type: 'success', message: msg })}
          />
        </div>
      ) : (
        /* LIST VIEW */
        <div className={`mt-5 rounded-2xl overflow-hidden shadow-lg border ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900/80 border-slate-800'
        }`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${
                  isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-slate-800 bg-slate-950/60 text-slate-400'
                }`}>
                  <th className="py-3 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3 px-4">Data Follow-up</th>
                  <th className="py-3 px-4">Situação</th>
                  <th className="py-3 px-4 hidden md:table-cell">Última Interação</th>
                  <th className="py-3 px-4 hidden lg:table-cell">Temperatura</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Responsável</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isLight ? 'divide-slate-200 text-slate-800' : 'divide-slate-800/70 text-slate-200'}`}>
                {filteredItems.map((item) => (
                  <tr key={item.lead.id} className={isLight ? 'hover:bg-slate-50 transition-colors' : 'hover:bg-slate-800/40 transition-colors'}>
                    <td className={`py-3.5 px-4 sm:px-6 font-medium ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      <button
                        type="button"
                        onClick={() => onOpenLead(item.lead.id)}
                        className={`text-left font-semibold cursor-pointer ${
                          isLight ? 'text-slate-950 hover:text-indigo-600' : 'text-white hover:text-indigo-400'
                        }`}
                      >
                        {item.lead.name}
                      </button>
                      <span className={`text-[11px] block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{item.stageName}</span>
                    </td>
                    <td className={`py-3.5 px-4 font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      {formatDateBR(item.followUpDate)}
                    </td>
                    <td className="py-3.5 px-4">
                      {getStatusBadge(item.status)}
                    </td>
                    <td
                      onClick={() => setActiveTimelineLead(item.lead)}
                      className="py-3.5 px-4 text-xs text-slate-300 hidden md:table-cell cursor-pointer hover:text-indigo-300 transition-colors"
                      title="Clique para ver linha do tempo completa"
                    >
                      <div className="font-semibold text-indigo-300">{item.latestInteraction.interaction_type}</div>
                      <div className="text-[11px] text-slate-400">
                        {formatDateBR(item.latestInteraction.occurred_at)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 hidden lg:table-cell">
                      {getTemperatureBadge(item.lead.temperature)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-300 hidden sm:table-cell">
                      {item.responsibleName}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveTimelineLead(item.lead)}
                          title="Ver linha do tempo / histórico"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveNoteModalLead(item.lead)}
                          title="Adicionar nota ou registrar follow-up"
                          aria-label="Registrar interação"
                          className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-90 text-white inline-flex items-center justify-center shadow-md shadow-indigo-950/80 hover:shadow-indigo-500/40 ring-2 ring-indigo-500/25 transition-all cursor-pointer shrink-0"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
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

      {/* WHATSAPP-STYLE TIMELINE MODAL */}
      <NotesTimelineModal
        isOpen={Boolean(activeTimelineLead)}
        lead={activeTimelineLead}
        currentProfile={currentProfile}
        onClose={() => setActiveTimelineLead(null)}
        onOpenNewNote={(ld) => {
          setActiveTimelineLead(null);
          setActiveNoteModalInteractionId(null);
          setActiveNoteModalLead(ld);
        }}
        onEditNote={(ld, interactionId) => {
          setActiveTimelineLead(null);
          setActiveNoteModalInteractionId(interactionId);
          setActiveNoteModalLead(ld);
        }}
      />

      {/* UNIFIED CONVERSATIONAL TYPEFORM NOTE MODAL */}
      <UnifiedNoteModal
        isOpen={Boolean(activeNoteModalLead)}
        lead={activeNoteModalLead}
        editingInteractionId={activeNoteModalInteractionId}
        currentProfile={currentProfile}
        onClose={() => {
          setActiveNoteModalLead(null);
          setActiveNoteModalInteractionId(null);
          setActiveTimelineLead(null);
        }}
        onSuccessFeedback={(msg) => setStatusFeedback({ type: 'success', message: msg })}
      />

      {/* INDEPENDENT WHATSAPP POPOVER WITH FULL CRUD */}
      {whatsappPopover.open && whatsappPopover.lead && (
        <div
          onClick={() => setWhatsappPopover({ open: false, lead: null, mode: 'list', editingContactId: null })}
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
                  <h3 className="font-semibold text-xs text-white">Contatos no WhatsApp</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[190px]">{whatsappPopover.lead.name}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {whatsappPopover.mode === 'list' && (
                  <button
                    type="button"
                    onClick={() => setWhatsappPopover((prev) => ({ ...prev, mode: 'add', editingContactId: null }))}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    + Adicionar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWhatsappPopover({ open: false, lead: null, mode: 'list', editingContactId: null })}
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
                    const phoneContacts = leadContacts.filter((c) => c.phone);

                    if (phoneContacts.length === 0) {
                      return (
                        <div className="text-center py-6 bg-slate-950/60 rounded-xl border border-slate-800/80 p-4">
                          <p className="text-xs text-slate-400 mb-3">
                            Nenhum contato com telefone/WhatsApp cadastrado para este condomínio.
                          </p>
                          <button
                            type="button"
                            onClick={() => setWhatsappPopover((prev) => ({ ...prev, mode: 'add', editingContactId: null }))}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <WhatsAppIcon className="w-3.5 h-3.5" />
                            <span>+ Adicionar WhatsApp</span>
                          </button>
                        </div>
                      );
                    }

                    return phoneContacts.map((contact) => {
                      const cleanDigits = (contact.phone || '').replace(/\D/g, '');
                      const waLink = `https://wa.me/55${cleanDigits}`;

                      return (
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
                                onClick={() => handleDeleteContact(contact, whatsappPopover.lead!.id)}
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
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                            >
                              <WhatsAppIcon className="w-3.5 h-3.5" />
                              <span>Conversar</span>
                            </a>
                          </div>
                        </div>
                      );
                    });
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

      {/* INDEPENDENT EMAIL POPOVER WITH FULL CRUD & ONLY COPIAR (NO ENVIAR) */}
      {emailPopover.open && emailPopover.lead && (
        <div
          onClick={() => setEmailPopover({ open: false, lead: null, mode: 'list', editingContactId: null })}
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
                  <h3 className="font-semibold text-xs text-white">E-mails dos Contatos</h3>
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
                  onClick={() => setEmailPopover({ open: false, lead: null, mode: 'list', editingContactId: null })}
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
                              onClick={() => handleDeleteContact(contact, emailPopover.lead!.id)}
                              title="Excluir contato"
                              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Linha com E-mail e Botão Copiar (SEM ENVIAR) */}
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

      {/* FOLDER POPOVER */}
      {folderPopover.open && folderPopover.lead && (
        <div
          onClick={() => setFolderPopover({ open: false, lead: null, folderUrl: '', error: null })}
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
                onClick={() => setFolderPopover({ open: false, lead: null, folderUrl: '', error: null })}
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
                      onClick={() => {
                        saveLeadFolderLink(folderPopover.lead!.id, '');
                        setStatusFeedback({ type: 'success', message: 'Link da pasta removido.' });
                        setFolderPopover({ open: false, lead: null, folderUrl: '', error: null });
                      }}
                      className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                    >
                      Remover link
                    </button>
                  ) : <span />}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFolderPopover({ open: false, lead: null, folderUrl: '', error: null })}
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

      {/* Bento Grid Customization Modal */}
      <BentoViewConfigModal
        isOpen={isBentoModalOpen}
        onClose={() => setIsBentoModalOpen(false)}
        title="Personalizar Cards de Follow-up"
        description="Escolha os campos que deseja visualizar nos cards da lista"
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
            label: 'Estágio do Funil',
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
            key: 'showFollowUpDate',
            label: 'Data Agendada',
            checked: viewConfig.showFollowUpDate,
            onChange: (val) => handleUpdateViewConfig('showFollowUpDate', val),
          },
          {
            key: 'showTemperature',
            label: 'Temperatura',
            checked: viewConfig.showTemperature,
            onChange: (val) => handleUpdateViewConfig('showTemperature', val),
          },
          {
            key: 'showLatestNotes',
            label: 'Última Anotação',
            checked: viewConfig.showLatestNotes,
            onChange: (val) => handleUpdateViewConfig('showLatestNotes', val),
          },
          {
            key: 'showQuickAction',
            label: 'Atalhos do Rodapé',
            checked: viewConfig.showQuickAction ?? true,
            onChange: (val) => handleUpdateViewConfig('showQuickAction', val),
          },
        ]}
        onResetDefaults={handleResetViewConfig}
      />

      {/* CONDOMINIUM PICKER MODAL FOR "+ NOVO FOLLOW-UP" */}
      {isPickerOpen && (
        <div
          onClick={() => setIsPickerOpen(false)}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[85vh]"
          >
            <div className="px-6 py-4 border-b border-slate-800/90 bg-slate-950/90 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-xs font-bold">
                    +
                  </span>
                  <span>Novo Follow-up</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Selecione um dos condomínios do pipeline para registrar o contato
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 border-b border-slate-800 bg-slate-950/40">
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Pesquisar condomínio por nome, cidade ou administradora..."
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none"
                />
                <svg className="w-4 h-4 text-slate-500 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 max-h-[50vh]">
              {(() => {
                const filtered = leads.filter((l) => {
                  if (!pickerSearch.trim()) return true;
                  const q = pickerSearch.toLowerCase();
                  return (
                    l.name.toLowerCase().includes(q) ||
                    (l.city && l.city.toLowerCase().includes(q)) ||
                    (l.administrator && l.administrator.toLowerCase().includes(q))
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-8 text-xs text-slate-400">
                      Nenhum condomínio encontrado com "{pickerSearch}".
                    </div>
                  );
                }

                return filtered.map((lead) => {
                  const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) || 'Estágio Inicial' : 'Estágio Inicial';
                  const respName = lead.responsible_user_id ? profileMap.get(lead.responsible_user_id) || 'Não atribuído' : 'Não atribuído';

                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => {
                        setIsPickerOpen(false);
                        setActiveNoteModalLead(lead);
                      }}
                      className="w-full text-left p-3 rounded-2xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800/80 hover:border-indigo-500/50 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-xs text-white group-hover:text-indigo-300 transition-colors truncate">
                            {lead.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 shrink-0">
                            {stageName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
                          <span>{lead.condominium_type || 'Residencial'}</span>
                          {lead.city && <span>· {lead.city}</span>}
                          <span>· Resp: {respName}</span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {getTemperatureBadge(lead.temperature)}
                        <span className="w-7 h-7 rounded-xl bg-indigo-600/20 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center text-xs font-bold transition-all shadow-xs">
                          +
                        </span>
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
