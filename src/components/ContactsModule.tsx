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
      // 1. Load contacts
      const contactsRes = await supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true });
      setContacts(contactsRes.data || []);

      // 2. Load leads for linking
      const leadsRes = await supabase
        .from('leads')
        .select('id, name, city, condominium_type')
        .order('name', { ascending: true });
      setLeads(leadsRes.data || []);

      // 3. Load lead_contacts junction records
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

  // Filter contacts by search (name, email, phone)
  const filteredContacts = useMemo(() => {
    if (!searchTerm.trim()) return contacts;
    const term = searchTerm.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.email && c.email.toLowerCase().includes(term)) ||
        (c.phone && c.phone.toLowerCase().includes(term)) ||
        (c.role_title && c.role_title.toLowerCase().includes(term))
    );
  }, [contacts, searchTerm]);

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
    setModalMode('create');
  };

  // Open modal in edit mode
  const handleOpenEdit = (contact: Contact) => {
    setFormError(null);
    setFormName(contact.name || '');

    const currentRole = contact.role_title || '';
    if (PRESET_ROLES.includes(currentRole)) {
      setFormRolePreset(currentRole);
      setFormCustomRole('');
    } else if (currentRole) {
      setFormRolePreset('Outro');
      setFormCustomRole(currentRole);
    } else {
      setFormRolePreset('Síndico');
      setFormCustomRole('');
    }

    setFormPhone(contact.phone || '');
    setFormEmail(contact.email || '');
    setFormSelectedLeadIds(getContactLeadIds(contact.id));
    setFormLeadSearch('');
    setSelectedContact(contact);
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
  };

  // Toggle lead selection in form
  const toggleLeadSelection = (leadId: string) => {
    setFormSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  };

  // Save Contact (Create or Edit)
  const handleSubmitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation 1: Nome obrigatório
    if (!formName.trim()) {
      setFormError('O nome do contato é obrigatório.');
      return;
    }

    // Validation 2: Pelo menos telefone ou e-mail deve estar preenchido
    const phoneVal = formPhone.trim();
    const emailVal = formEmail.trim();
    if (!phoneVal && !emailVal) {
      setFormError('Informe pelo menos um meio de comunicação: Telefone ou E-mail.');
      return;
    }

    // Determine final role_title
    const finalRole =
      formRolePreset === 'Outro'
        ? formCustomRole.trim() || 'Outro'
        : formRolePreset;

    setFormSaving(true);

    try {
      const contactPayload = {
        name: formName.trim(),
        role_title: finalRole || null,
        phone: phoneVal || null,
        email: emailVal || null,
      };

      if (modalMode === 'create') {
        // Insert contact
        const { data: newContact, error: insertError } = await supabase
          .from('contacts')
          .insert([contactPayload])
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        // Insert relationships in lead_contacts
        if (newContact?.id && formSelectedLeadIds.length > 0) {
          const leadContactRows = formSelectedLeadIds.map((leadId) => ({
            contact_id: newContact.id,
            lead_id: leadId,
          }));
          const { error: relError } = await supabase
            .from('lead_contacts')
            .insert(leadContactRows);
          if (relError) {
            console.warn('Warning inserting lead_contacts:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Contato "${contactPayload.name}" cadastrado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedContact) {
        // Update contact
        const { error: updateError } = await supabase
          .from('contacts')
          .update(contactPayload)
          .eq('id', selectedContact.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Sync relationships in lead_contacts: delete and re-insert
        await supabase
          .from('lead_contacts')
          .delete()
          .eq('contact_id', selectedContact.id);

        if (formSelectedLeadIds.length > 0) {
          const leadContactRows = formSelectedLeadIds.map((leadId) => ({
            contact_id: selectedContact.id,
            lead_id: leadId,
          }));
          const { error: relError } = await supabase
            .from('lead_contacts')
            .insert(leadContactRows);
          if (relError) {
            console.warn('Warning syncing lead_contacts:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Contato "${contactPayload.name}" atualizado com sucesso!`,
        });
      }

      handleCloseModal();
      await loadData();
    } catch (err: any) {
      console.error('Error saving contact:', err);
      setFormError(err.message || 'Erro ao salvar o contato. Tente novamente.');
    } finally {
      setFormSaving(false);
    }
  };

  // Filtered leads for the multi-select input
  const selectableLeads = useMemo(() => {
    if (!formLeadSearch.trim()) return leads;
    const term = formLeadSearch.toLowerCase();
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.city && l.city.toLowerCase().includes(term))
    );
  }, [leads, formLeadSearch]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Contatos
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestão de síndicos, administradores e interlocutores dos condomínios
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
            Novo contato
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
            placeholder="Buscar por nome, e-mail ou telefone..."
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
            {contacts.length} {contacts.length === 1 ? 'contato' : 'contatos'}
          </span>
        </div>
      </div>

      {/* Main Table / List */}
      <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Carregando contatos...</p>
          </div>
        ) : filteredContacts.length === 0 ? (
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
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h3 className="text-base font-medium text-white mb-1">
              {searchTerm ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado ainda'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
              {searchTerm
                ? 'Tente pesquisar por outro termo ou limpe a busca.'
                : 'Cadastre síndicos e representantes de condomínios para centralizar o relacionamento comercial.'}
            </p>
            {!searchTerm && (
              <button
                onClick={handleOpenCreate}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Cadastrar primeiro contato
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3.5 px-4 sm:px-6">Nome</th>
                  <th className="py-3.5 px-4">Função / Cargo</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Telefone</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">E-mail</th>
                  <th className="py-3.5 px-4 text-center">Condomínios Vinculados</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredContacts.map((contact) => {
                  const linkedLeadIds = getContactLeadIds(contact.id);
                  const count = linkedLeadIds.length;

                  return (
                    <tr
                      key={contact.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-indigo-400 uppercase">
                            {contact.name.charAt(0)}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-white">
                              {contact.name}
                            </span>
                            <span className="text-[11px] text-slate-400 sm:hidden">
                              {contact.phone || contact.email || 'Sem contato'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-800 border border-slate-700/80 text-slate-300">
                          {contact.role_title || 'Não informado'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden md:table-cell text-xs font-mono">
                        {contact.phone || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden lg:table-cell text-xs font-mono">
                        {contact.email || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            count > 0
                              ? 'bg-indigo-950/80 border border-indigo-700/60 text-indigo-300'
                              : 'bg-slate-800/60 border border-slate-700 text-slate-400'
                          }`}
                        >
                          {count} {count === 1 ? 'condomínio' : 'condomínios'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenView(contact)}
                            title="Visualizar contato"
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
                            onClick={() => handleOpenEdit(contact)}
                            title="Editar contato"
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

      {/* Modal: Create & Edit */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {modalMode === 'create' ? 'Novo Contato' : 'Editar Contato'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Informações de contato e vínculo com condomínios
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
            <form onSubmit={handleSubmitContact} className="p-6 space-y-5">
              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nome Completo <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo de Oliveira"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Função / Cargo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Função / Cargo
                  </label>
                  <select
                    value={formRolePreset}
                    onChange={(e) => setFormRolePreset(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  >
                    {PRESET_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="Outro">Outro (especificar)</option>
                  </select>
                </div>

                {formRolePreset === 'Outro' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Especifique a Função
                    </label>
                    <input
                      type="text"
                      value={formCustomRole}
                      onChange={(e) => setFormCustomRole(e.target.value)}
                      placeholder="Ex: Gerente Predial, Advogado"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Meios de contato: Telefone e Email (pelo menos um obrigatório) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                    Canais de Comunicação
                  </span>
                  <span className="text-[11px] text-slate-400 italic">
                    Preencha ao menos telefone ou e-mail *
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Telefone / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(11) 98765-4321"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      E-mail
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="contato@condominio.com"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Vínculo com Condomínios (Seleção Múltipla) */}
              <div className="pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                    Condomínios Vinculados
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {formSelectedLeadIds.length} selecionado(s)
                  </span>
                </div>

                <div className="mb-2.5">
                  <input
                    type="text"
                    value={formLeadSearch}
                    onChange={(e) => setFormLeadSearch(e.target.value)}
                    placeholder="Filtrar condomínios..."
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="max-h-44 overflow-y-auto border border-slate-800 rounded-lg p-2 bg-slate-950/50 space-y-1.5 divide-y divide-slate-800/40">
                  {selectableLeads.length === 0 ? (
                    <p className="text-xs text-slate-500 p-2 italic text-center">
                      Nenhum condomínio encontrado.
                    </p>
                  ) : (
                    selectableLeads.map((lead) => {
                      const isSelected = formSelectedLeadIds.includes(lead.id);

                      return (
                        <div
                          key={lead.id}
                          onClick={() => toggleLeadSelection(lead.id)}
                          className={`pt-1.5 first:pt-0 flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-xs ${
                            isSelected
                              ? 'bg-indigo-950/70 text-indigo-200'
                              : 'hover:bg-slate-800/50 text-slate-300'
                          }`}
                        >
                          <div className="flex flex-col truncate pr-2">
                            <span className="font-medium text-white truncate">
                              {lead.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {lead.city || 'Sem cidade'} • {lead.condominium_type || 'Residencial'}
                            </span>
                          </div>
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] font-bold ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'border-slate-700 bg-slate-900 text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Action buttons */}
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
                    <span>
                      {modalMode === 'create' ? 'Cadastrar Contato' : 'Salvar Alterações'}
                    </span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Contact Details */}
      {modalMode === 'view' && selectedContact && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-950 border border-indigo-700/60 flex items-center justify-center text-sm font-bold text-indigo-300 uppercase">
                  {selectedContact.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {selectedContact.name}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                    {selectedContact.role_title || 'Contato'}
                  </span>
                </div>
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
            <div className="p-6 space-y-5">
              {/* Contact info grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block mb-0.5">Telefone / WhatsApp:</span>
                  <span className="text-slate-200 font-mono font-medium">
                    {selectedContact.phone || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">E-mail:</span>
                  <span className="text-slate-200 font-mono font-medium">
                    {selectedContact.email || 'Não informado'}
                  </span>
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-slate-800/80">
                  <span className="text-slate-400 block mb-0.5">Data de Cadastro:</span>
                  <span className="text-slate-300">
                    {selectedContact.created_at
                      ? new Date(selectedContact.created_at).toLocaleString('pt-BR')
                      : '-'}
                  </span>
                </div>
              </div>

              {/* Linked Condominiums list */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                  Condomínios Vinculados
                </h4>
                {(() => {
                  const linkedIds = getContactLeadIds(selectedContact.id);
                  if (linkedIds.length === 0) {
                    return (
                      <p className="text-xs text-slate-500 italic p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                        Nenhum condomínio vinculado a este contato.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {linkedIds.map((lId) => {
                        const leadItem = leadMap.get(lId);
                        if (!leadItem) return null;

                        return (
                          <div
                            key={lId}
                            className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-lg flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-medium text-white">
                                {leadItem.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {leadItem.city || 'Sem cidade'} • {leadItem.condominium_type || 'Residencial'}
                              </div>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                              Vinculado
                            </span>
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
                  handleOpenEdit(selectedContact);
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
                Editar contato
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
    </div>
  );
}
