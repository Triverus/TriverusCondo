import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';
import { useCRM, type Contact, type Lead } from '../lib/crmStore.tsx';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../lib/draftStorage.ts';

interface ContactsModuleProps {
  currentProfile: UserProfile;
}

const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
];

const DRAFT_CONTACT_CREATE_KEY = 'triverus_draft_contact_create';
const getContactEditDraftKey = (id: string) => `triverus_draft_contact_edit_${id}`;

interface ContactDraftData {
  quizStep: number;
  formName: string;
  formRolePreset: string;
  formCustomRole: string;
  formPhone: string;
  formEmail: string;
  formSelectedLeadIds: string[];
}

export default function ContactsModule({ currentProfile: _profile }: ContactsModuleProps) {
  // Use Centralized In-Memory & Cached CRM store
  const {
    contacts,
    leads,
    leadMap,
    isInitialLoading,
    isRefreshing,
    upsertContactLocally,
    refreshAll,
    getContactLeadIds,
  } = useCRM();

  // UI View Mode (Default is Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  // UI and feedback states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isRestoredDraft, setIsRestoredDraft] = useState<boolean>(false);

  // Dynamic Quiz Step for Contact Create/Edit (1 to 3)
  const [quizStep, setQuizStep] = useState<number>(1);
  const totalQuizSteps = 3;

  // Form states
  const [formName, setFormName] = useState('');
  const [formRolePreset, setFormRolePreset] = useState('Síndico');
  const [formCustomRole, setFormCustomRole] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSelectedLeadIds, setFormSelectedLeadIds] = useState<string[]>([]);
  const [formLeadSearch, setFormLeadSearch] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const initialDraftRestorationChecked = useRef(false);

  // Check and restore draft on initial mount
  useEffect(() => {
    if (initialDraftRestorationChecked.current) return;
    initialDraftRestorationChecked.current = true;

    const createDraft = loadDraft<ContactDraftData>(DRAFT_CONTACT_CREATE_KEY);
    if (createDraft && createDraft.formName?.trim()) {
      setFormName(createDraft.formName || '');
      setFormRolePreset(createDraft.formRolePreset || 'Síndico');
      setFormCustomRole(createDraft.formCustomRole || '');
      setFormPhone(createDraft.formPhone || '');
      setFormEmail(createDraft.formEmail || '');
      setFormSelectedLeadIds(createDraft.formSelectedLeadIds || []);
      setQuizStep(createDraft.quizStep || 1);
      setIsRestoredDraft(true);
      setModalMode('create');
    }
  }, []);

  // Save Contact form draft on state changes
  useEffect(() => {
    if (modalMode === 'create') {
      const data: ContactDraftData = {
        quizStep,
        formName,
        formRolePreset,
        formCustomRole,
        formPhone,
        formEmail,
        formSelectedLeadIds,
      };
      if (formName.trim() || formPhone.trim() || formEmail.trim() || formCustomRole.trim()) {
        saveDraft(DRAFT_CONTACT_CREATE_KEY, data);
      }
    } else if (modalMode === 'edit' && selectedContact) {
      const data: ContactDraftData = {
        quizStep,
        formName,
        formRolePreset,
        formCustomRole,
        formPhone,
        formEmail,
        formSelectedLeadIds,
      };
      saveDraft(getContactEditDraftKey(selectedContact.id), data);
    }
  }, [
    modalMode,
    selectedContact,
    quizStep,
    formName,
    formRolePreset,
    formCustomRole,
    formPhone,
    formEmail,
    formSelectedLeadIds,
  ]);

  // Filtered contacts in memory
  const filteredContacts = useMemo(() => {
    if (!searchTerm.trim()) return contacts;
    const term = searchTerm.toLowerCase();

    return contacts.filter((c) => {
      const matchName = c.name.toLowerCase().includes(term);
      const matchRole = c.role_title ? c.role_title.toLowerCase().includes(term) : false;
      const matchPhone = c.phone ? c.phone.includes(term) : false;
      const matchEmail = c.email ? c.email.toLowerCase().includes(term) : false;

      const associatedLeadIds = getContactLeadIds(c.id);
      const matchLead = associatedLeadIds.some((leadId) => {
        const l = leadMap.get(leadId);
        return l ? l.name.toLowerCase().includes(term) : false;
      });

      return matchName || matchRole || matchPhone || matchEmail || matchLead;
    });
  }, [contacts, searchTerm, getContactLeadIds, leadMap]);

  // Filter leads for selection modal
  const filteredAvailableLeads = useMemo(() => {
    if (!formLeadSearch.trim()) return leads;
    const term = formLeadSearch.toLowerCase();
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.city && l.city.toLowerCase().includes(term))
    );
  }, [leads, formLeadSearch]);

  // Open modal in create mode
  const handleOpenCreate = () => {
    setFormError(null);
    setIsRestoredDraft(false);

    const draft = loadDraft<ContactDraftData>(DRAFT_CONTACT_CREATE_KEY);
    if (draft && draft.formName?.trim()) {
      setFormName(draft.formName || '');
      setFormRolePreset(draft.formRolePreset || 'Síndico');
      setFormCustomRole(draft.formCustomRole || '');
      setFormPhone(draft.formPhone || '');
      setFormEmail(draft.formEmail || '');
      setFormSelectedLeadIds(draft.formSelectedLeadIds || []);
      setQuizStep(draft.quizStep || 1);
      setIsRestoredDraft(true);
    } else {
      setFormName('');
      setFormRolePreset('Síndico');
      setFormCustomRole('');
      setFormPhone('');
      setFormEmail('');
      setFormSelectedLeadIds([]);
      setFormLeadSearch('');
      setQuizStep(1);
    }

    setSelectedContact(null);
    setModalMode('create');
  };

  const handleDiscardContactDraft = () => {
    if (modalMode === 'create') {
      clearDraft(DRAFT_CONTACT_CREATE_KEY);
    } else if (modalMode === 'edit' && selectedContact) {
      clearDraft(getContactEditDraftKey(selectedContact.id));
    }
    setIsRestoredDraft(false);
    handleCloseModal();
  };

  // Open modal in edit mode
  const handleOpenEdit = (contact: Contact) => {
    setFormError(null);
    setSelectedContact(contact);

    const editDraft = loadDraft<ContactDraftData>(getContactEditDraftKey(contact.id));
    if (editDraft && editDraft.formName) {
      setFormName(editDraft.formName);
      setFormRolePreset(editDraft.formRolePreset || 'Síndico');
      setFormCustomRole(editDraft.formCustomRole || '');
      setFormPhone(editDraft.formPhone || '');
      setFormEmail(editDraft.formEmail || '');
      setFormSelectedLeadIds(editDraft.formSelectedLeadIds || []);
      setQuizStep(editDraft.quizStep || 1);
      setIsRestoredDraft(true);
    } else {
      setFormName(contact.name || '');
      if (contact.role_title && PRESET_ROLES.includes(contact.role_title)) {
        setFormRolePreset(contact.role_title);
        setFormCustomRole('');
      } else if (contact.role_title) {
        setFormRolePreset('Outro');
        setFormCustomRole(contact.role_title);
      } else {
        setFormRolePreset('Síndico');
        setFormCustomRole('');
      }
      setFormPhone(contact.phone || '');
      setFormEmail(contact.email || '');
      setFormSelectedLeadIds(getContactLeadIds(contact.id));
      setFormLeadSearch('');
      setQuizStep(1);
      setIsRestoredDraft(false);
    }

    setModalMode('edit');
  };

  // Open modal in view mode
  const handleOpenView = (contact: Contact) => {
    setSelectedContact(contact);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setSelectedContact(null);
    setFormError(null);
    setQuizStep(1);
    setIsRestoredDraft(false);
  };

  const toggleLeadSelection = (leadId: string) => {
    setFormSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  };

  const handleNextQuizStep = () => {
    setFormError(null);
    if (quizStep === 1) {
      if (!formName.trim()) {
        setFormError('Informe o nome do contato.');
        return;
      }
    }
    if (quizStep < totalQuizSteps) {
      setQuizStep((prev) => prev + 1);
    }
  };

  // Save Contact (Create or Edit)
  const handleSubmitContact = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setQuizStep(1);
      setFormError('O nome do contato é obrigatório.');
      return;
    }

    const finalRole =
      formRolePreset === 'Outro'
        ? formCustomRole.trim() || null
        : formRolePreset || null;

    setFormSaving(true);

    try {
      const contactPayload = {
        name: formName.trim(),
        role_title: finalRole,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
      };

      let savedContact: Contact | null = null;

      if (modalMode === 'create') {
        const { data: createdContact, error: createError } = await supabase
          .from('contacts')
          .insert([contactPayload])
          .select()
          .single();

        if (createError) throw createError;
        if (!createdContact) throw new Error('Não foi possível salvar o contato.');

        savedContact = createdContact;
        upsertContactLocally(createdContact, formSelectedLeadIds);
        clearDraft(DRAFT_CONTACT_CREATE_KEY);
        setStatusFeedback({
          type: 'success',
          message: `Contato "${createdContact.name}" criado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedContact) {
        const { data: updatedContact, error: updateError } = await supabase
          .from('contacts')
          .update(contactPayload)
          .eq('id', selectedContact.id)
          .select()
          .single();

        if (updateError) throw updateError;
        if (!updatedContact) throw new Error('Falha ao atualizar o contato.');

        savedContact = updatedContact;
        upsertContactLocally(updatedContact, formSelectedLeadIds);
        clearDraft(getContactEditDraftKey(selectedContact.id));
        setStatusFeedback({
          type: 'success',
          message: `Contato "${updatedContact.name}" atualizado com sucesso!`,
        });
      }

      // Sync lead_contacts junction
      if (savedContact) {
        await supabase.from('lead_contacts').delete().eq('contact_id', savedContact.id);

        if (formSelectedLeadIds.length > 0) {
          const junctionInserts = formSelectedLeadIds.map((leadId) => ({
            lead_id: leadId,
            contact_id: savedContact!.id,
          }));
          await supabase.from('lead_contacts').insert(junctionInserts);
        }

        refreshAll(true);
      }

      handleCloseModal();
    } catch (err: any) {
      console.error('Error saving contact:', err);
      setFormError(err.message || 'Erro ao salvar contato. Tente novamente.');
    } finally {
      setFormSaving(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
            <span>CRM</span>
            <span aria-hidden="true">·</span>
            <span>Pessoas & Síndicos</span>
            {isRefreshing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                sincronizando...
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Contatos
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gestão de síndicos, subsíndicos, conselheiros e administradores.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
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
              className={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>Novo Contato</span>
          </button>
        </div>
      </div>

      {/* Draft banner if contact draft exists and modal closed */}
      {modalMode === null && hasDraft(DRAFT_CONTACT_CREATE_KEY) && (
        <div className="mt-4 p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Existe um rascunho de contato pendente.</span>
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
                clearDraft(DRAFT_CONTACT_CREATE_KEY);
                setStatusFeedback({ type: 'success', message: 'Rascunho de contato descartado.' });
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
            placeholder="Buscar por nome, cargo, telefone, e-mail ou condomínio..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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

        <div className="text-xs text-slate-400">
          <span>Total: <strong>{filteredContacts.length}</strong> contatos</span>
        </div>
      </div>

      {/* Content */}
      {isInitialLoading && contacts.length === 0 ? (
        <div className="mt-12 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-2xl">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-slate-400">Carregando contatos...</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="mt-8 text-center py-16 bg-slate-900/40 border border-slate-800/60 rounded-3xl p-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
            {searchTerm
              ? 'Tente buscar com outro nome, telefone ou e-mail.'
              : 'Cadastre síndicos e gestores de condomínios para gerenciar o relacionamento.'}
          </p>
          {!searchTerm && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer"
            >
              + Criar primeiro contato
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredContacts.map((contact) => {
            const linkedLeadIds = getContactLeadIds(contact.id);

            return (
              <div
                key={contact.id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-indigo-300">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3
                          onClick={() => handleOpenView(contact)}
                          className="font-bold text-base text-white hover:text-indigo-400 transition-colors cursor-pointer leading-snug line-clamp-1"
                        >
                          {contact.name}
                        </h3>
                        <span className="text-xs text-slate-400 font-medium">
                          {contact.role_title || 'Contato Geral'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Phone & Email */}
                  <div className="space-y-1.5 text-xs text-slate-300 my-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <div className="flex items-center gap-2 truncate">
                      <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span className="truncate">{contact.phone || 'Sem telefone'}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate">{contact.email || 'Sem e-mail'}</span>
                    </div>
                  </div>

                  {/* Linked Leads Tags */}
                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                      Condomínios Vinculados ({linkedLeadIds.length})
                    </span>
                    {linkedLeadIds.length === 0 ? (
                      <span className="text-xs text-slate-500 italic">Nenhum condomínio vinculado</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {linkedLeadIds.map((lId) => {
                          const l = leadMap.get(lId);
                          return (
                            <span
                              key={lId}
                              className="px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700/60 text-[11px] text-slate-300 truncate max-w-[200px]"
                            >
                              {l ? l.name : 'Condomínio'}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenView(contact)}
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
                    onClick={() => handleOpenEdit(contact)}
                    title="Editar contato"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
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
                  <th className="py-3.5 px-4 sm:px-6">Nome</th>
                  <th className="py-3.5 px-4">Cargo / Função</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Telefone</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">E-mail</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Condomínios</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredContacts.map((contact) => {
                  const linkedLeadIds = getContactLeadIds(contact.id);

                  return (
                    <tr key={contact.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <button
                          type="button"
                          onClick={() => handleOpenView(contact)}
                          className="font-semibold text-white hover:text-indigo-400 cursor-pointer"
                        >
                          {contact.name}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {contact.role_title || 'Contato Geral'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden md:table-cell">
                        {contact.phone || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden lg:table-cell">
                        {contact.email || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden sm:table-cell">
                        <span className="text-xs text-slate-400">
                          {linkedLeadIds.length} vinculado(s)
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenView(contact)}
                            title="Visualizar"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenEdit(contact)}
                            title="Editar"
                            className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 cursor-pointer"
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

      {/* DYNAMIC QUIZ MODAL FOR CONTACT */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            {/* Header & Progress */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300">
                    Etapa {quizStep} de {totalQuizSteps}
                  </span>
                  <span className="text-xs text-slate-400">
                    {modalMode === 'create' ? 'Novo Contato' : 'Editar Contato'}
                  </span>
                  {isRestoredDraft && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-300">
                      Rascunho
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isRestoredDraft && (
                    <button
                      type="button"
                      onClick={handleDiscardContactDraft}
                      className="text-xs text-rose-400 hover:text-rose-300 mr-2 cursor-pointer"
                    >
                      Descartar rascunho
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

            {/* Quiz Body */}
            <div className="p-6 sm:p-8 overflow-y-auto flex-1 text-sm">
              {formError && (
                <div className="mb-5 p-3.5 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                  {formError}
                </div>
              )}

              {/* STEP 1: Nome & Cargo */}
              {quizStep === 1 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Quem é o contato?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Informe o nome completo e o papel desempenhado.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Nome Completo <span className="text-rose-400">*</span>
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
                      placeholder="Ex: João da Silva"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Cargo / Função
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {PRESET_ROLES.map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setFormRolePreset(role)}
                          className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                            formRolePreset === role
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormRolePreset('Outro')}
                        className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                          formRolePreset === 'Outro'
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Outro cargo...
                      </button>
                    </div>

                    {formRolePreset === 'Outro' && (
                      <div className="mt-3">
                        <input
                          type="text"
                          value={formCustomRole}
                          onChange={(e) => setFormCustomRole(e.target.value)}
                          placeholder="Especifique o cargo (ex: Gerente predial)..."
                          className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: Contato direto */}
              {quizStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Canais de comunicação
                    </h3>
                    <p className="text-xs text-slate-400">
                      Preencha o telefone / WhatsApp e o endereço de e-mail.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Telefone / WhatsApp
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      E-mail
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="sindico@condominio.com"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Vínculo com Condomínios */}
              {quizStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">
                      Vincular aos condomínios
                    </h3>
                    <p className="text-xs text-slate-400">
                      Selecione quais leads/condomínios este contato gerencia ou representa.
                    </p>
                  </div>

                  <input
                    type="text"
                    value={formLeadSearch}
                    onChange={(e) => setFormLeadSearch(e.target.value)}
                    placeholder="Filtrar condomínios..."
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none"
                  />

                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {filteredAvailableLeads.map((lead) => {
                      const isSelected = formSelectedLeadIds.includes(lead.id);
                      return (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => toggleLeadSelection(lead.id)}
                          className={`w-full p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="truncate">{lead.name}</span>
                          <span
                            className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                              isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-700'
                            }`}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Navigation */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <div>
                {quizStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setQuizStep((p) => p - 1)}
                    disabled={formSaving}
                    className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
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
                  className="px-3 py-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancelar
                </button>

                {quizStep < totalQuizSteps ? (
                  <button
                    type="button"
                    onClick={handleNextQuizStep}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Avançar →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmitContact}
                    disabled={formSaving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {formSaving ? 'Salvando...' : 'Salvar Contato'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {modalMode === 'view' && selectedContact && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col">
            <div className="px-6 py-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider block">
                  Perfil do Contato
                </span>
                <h2 className="text-xl font-bold text-white">{selectedContact.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleCloseModal();
                    handleOpenEdit(selectedContact);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white cursor-pointer"
                >
                  Editar
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

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-400 block">Cargo / Papel:</span>
                  <span className="text-slate-200 font-medium text-sm">
                    {selectedContact.role_title || 'Contato Geral'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Telefone:</span>
                  <span className="text-slate-200 font-medium">{selectedContact.phone || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">E-mail:</span>
                  <span className="text-slate-200 font-medium">{selectedContact.email || '-'}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-2">
                  Condomínios Vinculados
                </span>
                <div className="space-y-1.5">
                  {getContactLeadIds(selectedContact.id).map((lId) => {
                    const l = leadMap.get(lId);
                    return (
                      <div key={lId} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300">
                        {l ? l.name : 'Condomínio'}
                      </div>
                    );
                  })}
                  {getContactLeadIds(selectedContact.id).length === 0 && (
                    <p className="text-slate-500 italic">Nenhum condomínio vinculado.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
