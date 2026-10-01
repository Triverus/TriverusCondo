import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';

export interface Contact {
  id: string;
  name: string;
  role_title?: string | null;
  phone?: string | null;
  email?: string | null;
  created_at?: string;
}

export interface LeadSummary {
  id: string;
  name: string;
  city?: string | null;
  condominium_type?: string | null;
}

export interface LeadContactRelation {
  lead_id: string;
  contact_id: string;
}

interface ContactsModuleProps {
  currentProfile: UserProfile;
}

const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
];

export default function ContactsModule({ currentProfile: _profile }: ContactsModuleProps) {
  // Data states
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [leadContacts, setLeadContacts] = useState<LeadContactRelation[]>([]);

  // UI View Mode (Default is Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  // UI and feedback states
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

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

  // Load contacts, leads and relationships
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const contactsRes = await supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true });
      setContacts(contactsRes.data || []);

      const leadsRes = await supabase
        .from('leads')
        .select('id, name, city, condominium_type')
        .order('name', { ascending: true });
      setLeads(leadsRes.data || []);

      const leadContactsRes = await supabase
        .from('lead_contacts')
        .select('lead_id, contact_id');
      setLeadContacts(leadContactsRes.data || []);
    } catch (err: any) {
      console.error('Error loading contacts data:', err);
      setStatusFeedback({
        type: 'error',
        message: 'Erro ao carregar dados de contatos do Supabase.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lead lookup map
  const leadMap = useMemo(() => {
    const map = new Map<string, LeadSummary>();
    leads.forEach((l) => map.set(l.id, l));
    return map;
  }, [leads]);

  // Get leads associated with a contact
  const getContactLeadIds = useCallback(
    (contactId: string): string[] => {
      return leadContacts
        .filter((lc) => lc.contact_id === contactId)
        .map((lc) => lc.lead_id);
    },
    [leadContacts]
  );

  // Filtered contacts
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

  // Open modal in create mode
  const handleOpenCreate = () => {
    setFormError(null);
    setFormName('');
    setFormRolePreset('Síndico');
    setFormCustomRole('');
    setFormPhone('');
    setFormEmail('');
    setFormSelectedLeadIds([]);
    setFormLeadSearch('');
    setSelectedContact(null);
    setQuizStep(1);
    setModalMode('create');
  };

  // Open modal in edit mode
  const handleOpenEdit = (contact: Contact) => {
    setFormError(null);
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
    setSelectedContact(contact);
    setQuizStep(1);
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

      let savedContactId: string | null = null;

      if (modalMode === 'create') {
        const { data: createdContact, error: createError } = await supabase
          .from('contacts')
          .insert([contactPayload])
          .select()
          .single();

        if (createError) throw createError;
        if (!createdContact) throw new Error('Não foi possível salvar o contato.');

        savedContactId = createdContact.id;
        setContacts((prev) => [...prev, createdContact].sort((a, b) => a.name.localeCompare(b.name)));
        setStatusFeedback({
          type: 'success',
          message: `Contato "${createdContact.name}" criado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedContact) {
        savedContactId = selectedContact.id;
        const { data: updatedContact, error: updateError } = await supabase
          .from('contacts')
          .update(contactPayload)
          .eq('id', selectedContact.id)
          .select()
          .single();

        if (updateError) throw updateError;
        if (!updatedContact) throw new Error('Falha ao atualizar o contato.');

        setContacts((prev) =>
          prev
            .map((item) => (item.id === selectedContact.id ? updatedContact : item))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        setStatusFeedback({
          type: 'success',
          message: `Contato "${updatedContact.name}" atualizado com sucesso!`,
        });
      }

      // Sync lead_contacts junction
      if (savedContactId) {
        await supabase.from('lead_contacts').delete().eq('contact_id', savedContactId);

        if (formSelectedLeadIds.length > 0) {
          const junctionInserts = formSelectedLeadIds.map((leadId) => ({
            lead_id: leadId,
            contact_id: savedContactId!,
          }));
          await supabase.from('lead_contacts').insert(junctionInserts);
        }

        const freshLeadContacts = await supabase
          .from('lead_contacts')
          .select('lead_id, contact_id');
        setLeadContacts(freshLeadContacts.data || []);
      }

      handleCloseModal();
    } catch (err: any) {
      console.error('Error saving contact:', err);
      setFormError(err.message || 'Erro ao salvar o contato no Supabase.');
    } finally {
      setFormSaving(false);
    }
  };

  const filteredFormLeads = useMemo(() => {
    if (!formLeadSearch.trim()) return leads;
    const term = formLeadSearch.toLowerCase();
    return leads.filter((l) => l.name.toLowerCase().includes(term) || (l.city && l.city.toLowerCase().includes(term)));
  }, [leads, formLeadSearch]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
            <span>CRM</span>
            <span aria-hidden="true">·</span>
            <span>Pessoas & Síndicos</span>
            <span aria-hidden="true">·</span>
            <span className="text-indigo-400 font-mono tabular-nums">{contacts.length} cadastrados</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Contatos & Síndicos
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
            Novo contato
          </button>
        </div>
      </div>

      {/* Feedback message */}
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

      {/* Search */}
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
            placeholder="Buscar por nome, cargo, telefone, e-mail ou condomínio..."
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
            {filteredContacts.length} {filteredContacts.length === 1 ? 'contato' : 'contatos'}
          </span>
        </div>
      </div>

      {/* Main Content: Cards View (Default) or List View */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs sm:text-sm">Carregando contatos...</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="mt-8 py-16 px-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center">
          <h3 className="text-base font-semibold text-white mb-1">
            {searchTerm ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado'}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
            {searchTerm
              ? 'Tente buscar por outro termo ou limpe os filtros.'
              : 'Cadastre síndicos, conselheiros ou gestores para vincular aos condomínios.'}
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW (DEFAULT) */
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
          {filteredContacts.map((contact) => {
            const associatedLeadIds = getContactLeadIds(contact.id);

            return (
              <div
                key={contact.id}
                className="bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-5 shadow-lg transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => handleOpenView(contact)}
                          className="font-bold text-base text-white hover:text-indigo-400 transition-colors cursor-pointer text-left block leading-tight"
                        >
                          {contact.name}
                        </button>
                        <span className="text-xs text-indigo-300 font-medium">
                          {contact.role_title || 'Contato'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Channels */}
                  <div className="space-y-1.5 py-3 border-y border-slate-800/60 my-3 text-xs">
                    <div className="flex items-center gap-2 text-slate-300">
                      <span className="text-slate-500 text-[11px] w-12">Telefone:</span>
                      {contact.phone ? (
                        <a href={`tel:${contact.phone}`} className="hover:text-indigo-400 transition-colors font-mono">
                          {contact.phone}
                        </a>
                      ) : (
                        <span className="text-slate-500 italic">Não informado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-300 truncate">
                      <span className="text-slate-500 text-[11px] w-12">E-mail:</span>
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="hover:text-indigo-400 transition-colors truncate">
                          {contact.email}
                        </a>
                      ) : (
                        <span className="text-slate-500 italic">Não informado</span>
                      )}
                    </div>
                  </div>

                  {/* Linked Condominiums */}
                  <div className="mb-4 text-xs">
                    <span className="text-slate-500 block text-[11px] mb-1.5">
                      Condomínios Vinculados ({associatedLeadIds.length})
                    </span>
                    {associatedLeadIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {associatedLeadIds.map((leadId) => {
                          const l = leadMap.get(leadId);
                          return (
                            <span
                              key={leadId}
                              className="px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-medium truncate max-w-[160px]"
                            >
                              {l ? l.name : 'Condomínio'}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-slate-500 italic text-[11px]">Nenhum condomínio vinculado.</span>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-800/60 flex items-center justify-end gap-2">
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
                    className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 transition-colors cursor-pointer"
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
                  <th className="py-3.5 px-4 hidden sm:table-cell">Condomínios Vinculados</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredContacts.map((contact) => {
                  const associatedLeadIds = getContactLeadIds(contact.id);
                  return (
                    <tr key={contact.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <button
                          type="button"
                          onClick={() => handleOpenView(contact)}
                          className="font-semibold text-white hover:text-indigo-400 transition-colors cursor-pointer"
                        >
                          {contact.name}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-indigo-300 text-xs">
                        {contact.role_title || 'Contato'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 font-mono text-xs hidden md:table-cell">
                        {contact.phone || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 text-xs hidden lg:table-cell truncate max-w-xs">
                        {contact.email || '-'}
                      </td>
                      <td className="py-3.5 px-4 hidden sm:table-cell text-xs">
                        <span className="text-slate-400 font-mono">
                          {associatedLeadIds.length} {associatedLeadIds.length === 1 ? 'condomínio' : 'condomínios'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenView(contact)}
                            title="Visualizar detalhes"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenEdit(contact)}
                            title="Editar contato"
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

      {/* DYNAMIC QUIZ-STYLE MODAL FOR CONTACT */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
            <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300">
                  Etapa {quizStep} de {totalQuizSteps}
                </span>
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

              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(quizStep / totalQuizSteps) * 100}%` }}
                />
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 text-xs">
              {formError && (
                <div className="mb-4 p-3 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200">
                  {formError}
                </div>
              )}

              {/* Step 1: Identificação & Cargo */}
              {quizStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Identificação do Contato
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Qual o nome e a função no condomínio?
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Nome Completo <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Carlos Eduardo Silva"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-2">
                      Cargo / Função
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {PRESET_ROLES.map((role) => (
                        <button
                          type="button"
                          key={role}
                          onClick={() => setFormRolePreset(role)}
                          className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                            formRolePreset === role
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormRolePreset('Outro')}
                        className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                          formRolePreset === 'Outro'
                            ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 font-semibold'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Outro cargo...
                      </button>
                    </div>

                    {formRolePreset === 'Outro' && (
                      <input
                        type="text"
                        value={formCustomRole}
                        onChange={(e) => setFormCustomRole(e.target.value)}
                        placeholder="Digite o cargo personalizado"
                        className="mt-2 w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Canais */}
              {quizStep === 2 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Canais de Comunicação
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Informe o telefone/WhatsApp e o endereço de e-mail:
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Telefone / WhatsApp</label>
                    <input
                      type="text"
                      autoFocus
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">E-mail</label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="sindico@condominio.com.br"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Step 3: Vinculação */}
              {quizStep === 3 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <h4 className="text-base font-bold text-white mb-1">
                      Vincular a Condomínios
                    </h4>
                    <p className="text-slate-400 text-xs">
                      Selecione os condomínios onde este contato atua:
                    </p>
                  </div>

                  <input
                    type="text"
                    value={formLeadSearch}
                    onChange={(e) => setFormLeadSearch(e.target.value)}
                    placeholder="Filtrar lista de condomínios..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none"
                  />

                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-800 p-2 rounded-xl bg-slate-950/60">
                    {filteredFormLeads.map((l) => {
                      const isSelected = formSelectedLeadIds.includes(l.id);
                      return (
                        <button
                          type="button"
                          key={l.id}
                          onClick={() => toggleLeadSelection(l.id)}
                          className={`w-full p-2.5 rounded-lg border text-xs font-medium flex items-center justify-between text-left cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="truncate mr-2">{l.name}</span>
                          <span className="text-xs font-bold text-indigo-400">{isSelected ? '✓' : '+'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={quizStep === 1 ? handleCloseModal : () => setQuizStep((p) => p - 1)}
                className="px-3.5 py-2 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {quizStep === 1 ? 'Cancelar' : '← Voltar'}
              </button>

              {quizStep < totalQuizSteps ? (
                <button
                  type="button"
                  onClick={handleNextQuizStep}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>Próximo</span>
                  <span>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubmitContact()}
                  disabled={formSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {formSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{modalMode === 'create' ? 'Concluir Cadastro' : 'Salvar Contato'}</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW CONTACT DETAILS MODAL */}
      {modalMode === 'view' && selectedContact && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <h3 className="text-base font-bold text-white">{selectedContact.name}</h3>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-500 block text-[11px]">Cargo / Função</span>
                  <span className="text-indigo-300 font-semibold">{selectedContact.role_title || 'Contato'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Telefone / WhatsApp</span>
                  <span className="text-slate-200 font-mono">{selectedContact.phone || 'Não informado'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">E-mail</span>
                  <span className="text-slate-200">{selectedContact.email || 'Não informado'}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block mb-2">
                  Condomínios Vinculados
                </span>
                {(() => {
                  const leadIds = getContactLeadIds(selectedContact.id);
                  if (leadIds.length === 0) {
                    return <p className="text-slate-500 italic">Nenhum condomínio vinculado.</p>;
                  }
                  return (
                    <div className="flex flex-wrap gap-2">
                      {leadIds.map((id) => {
                        const l = leadMap.get(id);
                        return (
                          <span key={id} className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
                            {l ? l.name : 'Condomínio'}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <button
                onClick={() => {
                  handleCloseModal();
                  handleOpenEdit(selectedContact);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Editar Contato
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
    </div>
  );
}
