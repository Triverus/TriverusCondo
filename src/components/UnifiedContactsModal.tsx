import React, { useState, useEffect } from 'react';
import type { Lead, Contact } from '../lib/crmStore.tsx';
import {
  PRESET_ROLES,
  formatPhoneMask,
  normalizeEmail,
  type ContactFormState,
} from '../lib/contactAdapter.ts';
import { WhatsAppIcon, EmailIcon, EditIcon, TrashIcon, ContactIcon } from './PipelineComponents.tsx';

export interface UnifiedContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  contacts: Contact[];
  canManageContacts: boolean;
  onSaveContact: (contactState: ContactFormState) => Promise<{ success: boolean; error?: string }>;
  onRequestDeleteContact?: (contact: Contact, leadId: string) => void;
}

export function UnifiedContactsModal({
  isOpen,
  onClose,
  lead,
  contacts,
  canManageContacts,
  onSaveContact,
  onRequestDeleteContact,
}: UnifiedContactsModalProps) {
  // Mode: 'view' (overview with WhatsApp and Email sections) or 'form' (create / edit)
  const [mode, setMode] = useState<'view' | 'form'>('view');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Síndico');
  const [formCustomRole, setFormCustomRole] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Copied email state tracking for discrete visual confirmation
  const [copiedContactId, setCopiedContactId] = useState<string | null>(null);

  // Focus target when opening form
  const [initialFocusField, setInitialFocusField] = useState<'name' | 'phone' | 'email'>('name');

  // Reset modal state when lead changes or modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setMode('view');
      setEditingContactId(null);
      setFormError(null);
      setCopiedContactId(null);
    }
  }, [isOpen, lead?.id]);

  if (!isOpen || !lead) return null;

  // Filter contacts by channel
  const waContacts = contacts.filter((c) => Boolean(c.phone && c.phone.trim()));
  const emContacts = contacts.filter((c) => Boolean(c.email && c.email.trim()));

  const handlePhoneChange = (val: string) => {
    setFormPhone(formatPhoneMask(val));
  };

  const handleOpenAddForm = (focusField: 'name' | 'phone' | 'email' = 'name') => {
    setEditingContactId(null);
    setFormName('');
    setFormRole('Síndico');
    setFormCustomRole('');
    setFormPhone('');
    setFormEmail('');
    setFormError(null);
    setInitialFocusField(focusField);
    setMode('form');
  };

  const handleOpenEditForm = (contact: Contact, focusField: 'name' | 'phone' | 'email' = 'name') => {
    const isStandardRole = (PRESET_ROLES as readonly string[]).includes(contact.role_title || '');
    setEditingContactId(contact.id);
    setFormName(contact.name || '');
    setFormRole(isStandardRole ? (contact.role_title || 'Síndico') : 'Outro');
    setFormCustomRole(isStandardRole ? '' : (contact.role_title || ''));
    setFormPhone(contact.phone ? formatPhoneMask(contact.phone) : '');
    setFormEmail(contact.email || '');
    setFormError(null);
    setInitialFocusField(focusField);
    setMode('form');
  };

  const handleCopyEmail = (email: string, contactId: string) => {
    try {
      navigator.clipboard.writeText(email);
      setCopiedContactId(contactId);
      setTimeout(() => {
        setCopiedContactId((prev) => (prev === contactId ? null : prev));
      }, 2000);
    } catch {
      // Fallback
      setCopiedContactId(contactId);
      setTimeout(() => setCopiedContactId(null), 2000);
    }
  };

  const getWhatsAppLink = (phone?: string | null) => {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const cleanNumber = digits.startsWith('55') ? digits : `55${digits}`;
    return `https://wa.me/${cleanNumber}`;
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError('Informe o nome do contato.');
      return;
    }

    const phoneDigits = formPhone.replace(/\D/g, '');
    const trimmedEmail = formEmail.trim();

    if (!phoneDigits && !trimmedEmail) {
      setFormError('Informe ao menos um número de WhatsApp ou um endereço de e-mail.');
      return;
    }

    if (phoneDigits && phoneDigits.length < 8) {
      setFormError('Informe um número de WhatsApp válido com DDD (mínimo 8 dígitos).');
      return;
    }

    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        setFormError('Informe um endereço de e-mail válido.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const contactState: ContactFormState = {
        id: editingContactId || undefined,
        name: trimmedName,
        roleTitle: formRole,
        customRoleTitle: formCustomRole,
        phone: formPhone.trim(),
        email: formEmail.trim(),
      };

      const result = await onSaveContact(contactState);
      if (!result.success) {
        setFormError(result.error || 'Erro ao salvar contato.');
        setIsSaving(false);
        return;
      }

      setMode('view');
      setEditingContactId(null);
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao salvar contato.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]"
      >
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-orange-500/20 text-[#FF6600] border border-orange-500/30 font-bold shrink-0">
              <ContactIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>Contatos</span>
              </h3>
              <p className="text-[11px] text-slate-400 truncate max-w-[240px] sm:max-w-xs">
                {lead.name} {lead.city && <span>· {lead.city}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Fechar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 text-sm space-y-6">
          {mode === 'view' ? (
            <>
              {/* =========================================================
                  SEÇÃO 1: WHATSAPP
                  ========================================================= */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-950/90 text-emerald-400 border border-emerald-700/50 flex items-center justify-center">
                      <WhatsAppIcon className="w-3.5 h-3.5" />
                    </div>
                    <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-400">
                      WhatsApp
                    </h4>
                    {waContacts.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                        {waContacts.length}
                      </span>
                    )}
                  </div>

                  {canManageContacts && waContacts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenAddForm('phone')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer hover:underline"
                    >
                      + Adicionar número
                    </button>
                  )}
                </div>

                {waContacts.length > 0 ? (
                  <div className="space-y-2.5">
                    {waContacts.map((contact) => (
                      <div
                        key={`wa-${contact.id}`}
                        className="p-3.5 bg-slate-950/90 border border-slate-800/90 rounded-2xl space-y-2.5 transition-all hover:border-slate-700"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-semibold text-xs text-white block truncate">
                              {contact.name}
                            </span>
                            <span className="text-[11px] text-slate-400 block truncate">
                              {contact.role_title || 'Contato Geral'}
                            </span>
                          </div>

                          {canManageContacts && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleOpenEditForm(contact, 'phone')}
                                title="Editar WhatsApp deste contato"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </button>
                              {onRequestDeleteContact && (
                                <button
                                  type="button"
                                  onClick={() => onRequestDeleteContact(contact, lead.id)}
                                  title="Desvincular contato deste condomínio"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/70 gap-2">
                          <span className="font-mono text-slate-200 text-xs font-semibold">
                            {formatPhoneMask(contact.phone || '')}
                          </span>

                          <a
                            href={getWhatsAppLink(contact.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                          >
                            <WhatsAppIcon className="w-3.5 h-3.5" />
                            <span>Falar no WhatsApp</span>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                      Nenhum número de WhatsApp cadastrado.
                    </p>
                    {canManageContacts && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddForm('phone')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        <WhatsAppIcon className="w-3.5 h-3.5" />
                        <span>+ Cadastrar WhatsApp</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* =========================================================
                  SEÇÃO 2: E-MAIL
                  ========================================================= */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-sky-950/90 text-sky-400 border border-sky-700/50 flex items-center justify-center">
                      <EmailIcon className="w-3.5 h-3.5" />
                    </div>
                    <h4 className="font-bold text-xs uppercase tracking-wider text-sky-400">
                      E-mail
                    </h4>
                    {emContacts.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-950/80 text-sky-300 border border-sky-800/60">
                        {emContacts.length}
                      </span>
                    )}
                  </div>

                  {canManageContacts && emContacts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenAddForm('email')}
                      className="text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer hover:underline"
                    >
                      + Adicionar e-mail
                    </button>
                  )}
                </div>

                {emContacts.length > 0 ? (
                  <div className="space-y-2.5">
                    {emContacts.map((contact) => {
                      const isCopied = copiedContactId === contact.id;

                      return (
                        <div
                          key={`em-${contact.id}`}
                          className="p-3.5 bg-slate-950/90 border border-slate-800/90 rounded-2xl space-y-2.5 transition-all hover:border-slate-700"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-semibold text-xs text-white block truncate">
                                {contact.name}
                              </span>
                              <span className="text-[11px] text-slate-400 block truncate">
                                {contact.role_title || 'Contato Geral'}
                              </span>
                            </div>

                            {canManageContacts && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditForm(contact, 'email')}
                                  title="Editar e-mail deste contato"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <EditIcon className="w-3.5 h-3.5" />
                                </button>
                                {onRequestDeleteContact && (
                                  <button
                                    type="button"
                                    onClick={() => onRequestDeleteContact(contact, lead.id)}
                                    title="Desvincular contato deste condomínio"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                  >
                                    <TrashIcon className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/70 gap-2">
                            <span className="text-slate-200 text-xs truncate max-w-[210px] sm:max-w-xs font-mono">
                              {contact.email}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleCopyEmail(contact.email!, contact.id)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                                isCopied
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 hover:text-white'
                              }`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              <span>{isCopied ? 'Copiado!' : 'Copiar e-mail'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                      Nenhum endereço de e-mail cadastrado.
                    </p>
                    {canManageContacts && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddForm('email')}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        <EmailIcon className="w-3.5 h-3.5" />
                        <span>+ Cadastrar E-mail</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* =========================================================
               FORMULÁRIO UNIFICADO: CADASTRO / EDIÇÃO
               ========================================================= */
            <form onSubmit={handleSubmitForm} className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-300">
                  {editingContactId ? 'Editar Contato' : 'Cadastrar Contato'}
                </h4>
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ← Voltar à lista
                </button>
              </div>

              {formError && (
                <div className="p-3 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
                  {formError}
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome do contato *
                </label>
                <input
                  type="text"
                  autoFocus={initialFocusField === 'name'}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Carlos Síndico"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-[#FF6600] rounded-xl text-white text-xs focus:outline-none"
                />
              </div>

              {/* Vínculo / Cargo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Vínculo / Cargo
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-[#FF6600] rounded-xl text-white text-xs focus:outline-none"
                  >
                    {PRESET_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                {formRole === 'Outro' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Especifique o cargo
                    </label>
                    <input
                      type="text"
                      value={formCustomRole}
                      onChange={(e) => setFormCustomRole(e.target.value)}
                      placeholder="Ex: Zelador Chefe"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-[#FF6600] rounded-xl text-white text-xs focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* WhatsApp & E-mail juntos na mesma operação */}
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-emerald-400 mb-1.5 flex items-center gap-1.5">
                    <WhatsAppIcon className="w-3.5 h-3.5" />
                    <span>WhatsApp / Telefone</span>
                  </label>
                  <input
                    type="text"
                    autoFocus={initialFocusField === 'phone'}
                    value={formPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl text-white text-xs focus:outline-none font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Preencha para habilitar o botão "Falar no WhatsApp".
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sky-400 mb-1.5 flex items-center gap-1.5">
                    <EmailIcon className="w-3.5 h-3.5" />
                    <span>E-mail</span>
                  </label>
                  <input
                    type="email"
                    autoFocus={initialFocusField === 'email'}
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="contato@condominio.com.br"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl text-white text-xs focus:outline-none font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Preencha para habilitar o botão "Copiar e-mail".
                  </p>
                </div>
              </div>

              {/* Botões de Ação do Formulário */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={isSaving}
                  className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] active:bg-[#cc5200] text-white rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-orange-500/10"
                >
                  {isSaving ? 'Salvando...' : editingContactId ? 'Salvar Alterações' : 'Salvar Contato'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Rodapé (Footer) - Regra: CTAs SEMPRE no rodapé */}
        {mode === 'view' && (
          <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/90 flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              Fechar
            </button>

            {canManageContacts && (
              <button
                type="button"
                onClick={() => handleOpenAddForm('name')}
                className="px-4 py-2.5 bg-[#FF6600] hover:bg-[#e65c00] active:bg-[#cc5200] text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-orange-500/15 inline-flex items-center gap-2"
              >
                <ContactIcon className="w-4 h-4" />
                <span>+ Novo Contato</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
