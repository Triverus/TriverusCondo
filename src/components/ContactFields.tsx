import React from 'react';
import {
  PRESET_ROLES,
  formatPhoneMask,
  type ContactFormState,
} from '../lib/contactAdapter.ts';

interface ContactFieldsProps {
  value: ContactFormState;
  onChange: (updater: (prev: ContactFormState) => ContactFormState) => void;
  isLight?: boolean;
  requiredName?: boolean;
  autoFocusName?: boolean;
  disabled?: boolean;
}

export default function ContactFields({
  value,
  onChange,
  isLight = false,
  requiredName = false,
  autoFocusName = false,
  disabled = false,
}: ContactFieldsProps) {
  const handlePhoneChange = (raw: string) => {
    const formatted = formatPhoneMask(raw);
    onChange((prev) => ({ ...prev, phone: formatted }));
  };

  const isOtherRole = value.roleTitle === 'Outro';

  return (
    <div className="space-y-3">
      {/* 1. Nome do Contato */}
      <div>
        <label
          className={`block text-xs font-medium mb-1.5 ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          Nome do contato {requiredName && <span className="text-rose-500">*</span>}
        </label>
        <input
          type="text"
          autoFocus={autoFocusName}
          disabled={disabled}
          value={value.name}
          onChange={(e) => {
            const val = e.target.value;
            onChange((prev) => ({ ...prev, name: val }));
          }}
          placeholder="Ex: Carlos Síndico ou Aldair"
          className={`w-full px-3.5 py-2.5 rounded-xl text-xs focus:outline-none transition-all ${
            isLight
              ? 'bg-white border border-slate-300 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400'
              : 'bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white placeholder:text-slate-600'
          }`}
        />
      </div>

      {/* 2. Vínculo / Cargo */}
      <div>
        <label
          className={`block text-xs font-medium mb-1.5 ${
            isLight ? 'text-slate-700' : 'text-slate-300'
          }`}
        >
          Vínculo / Cargo
        </label>
        <select
          disabled={disabled}
          value={value.roleTitle || 'Síndico'}
          onChange={(e) => {
            const role = e.target.value;
            onChange((prev) => ({
              ...prev,
              roleTitle: role,
              customRoleTitle: role === 'Outro' ? prev.customRoleTitle : '',
            }));
          }}
          className={`w-full px-3.5 py-2.5 rounded-xl text-xs focus:outline-none transition-all ${
            isLight
              ? 'bg-white border border-slate-300 focus:border-indigo-600 text-slate-900'
              : 'bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white'
          }`}
        >
          {PRESET_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>

        {isOtherRole && (
          <div className="mt-2">
            <input
              type="text"
              disabled={disabled}
              value={value.customRoleTitle || ''}
              onChange={(e) => {
                const custom = e.target.value;
                onChange((prev) => ({ ...prev, customRoleTitle: custom }));
              }}
              placeholder="Especifique o cargo (ex: Gestor Predial, Tesoureiro...)"
              className={`w-full px-3.5 py-2 rounded-xl text-xs focus:outline-none transition-all ${
                isLight
                  ? 'bg-white border border-amber-400 focus:border-amber-600 text-slate-900 placeholder:text-slate-400'
                  : 'bg-slate-950 border border-amber-600/60 focus:border-amber-500 text-white placeholder:text-slate-600'
              }`}
            />
          </div>
        )}
      </div>

      {/* 3. Telefone / WhatsApp + E-mail em grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            className={`block text-xs font-medium mb-1.5 ${
              isLight ? 'text-slate-700' : 'text-slate-300'
            }`}
          >
            WhatsApp / Telefone
          </label>
          <input
            type="text"
            disabled={disabled}
            value={value.phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="(11) 98765-4321"
            className={`w-full px-3.5 py-2.5 rounded-xl text-xs focus:outline-none transition-all ${
              isLight
                ? 'bg-white border border-slate-300 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400'
                : 'bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white placeholder:text-slate-600'
            }`}
          />
        </div>

        <div>
          <label
            className={`block text-xs font-medium mb-1.5 ${
              isLight ? 'text-slate-700' : 'text-slate-300'
            }`}
          >
            E-mail
          </label>
          <input
            type="email"
            disabled={disabled}
            value={value.email}
            onChange={(e) => {
              const val = e.target.value;
              onChange((prev) => ({ ...prev, email: val }));
            }}
            placeholder="contato@exemplo.com"
            className={`w-full px-3.5 py-2.5 rounded-xl text-xs focus:outline-none transition-all ${
              isLight
                ? 'bg-white border border-slate-300 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400'
                : 'bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white placeholder:text-slate-600'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
