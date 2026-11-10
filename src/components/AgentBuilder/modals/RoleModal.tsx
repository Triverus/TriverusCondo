import React, { useState, useEffect } from 'react';
import { X, Building2, ShieldCheck, HardDrive, Brain, Calendar, Lock, AlertCircle, Loader2, Layers, Check } from 'lucide-react';
import { AGENT_CAPABILITIES_CATALOG } from '../../../types/agentBuilder';

interface RoleModalProps {
  isOpen: boolean;
  initialValue: string;
  initialCapabilities?: Record<string, boolean>;
  onSave: (role: string, capabilities: Record<string, boolean>) => Promise<{ ok: boolean; error?: string } | void> | void;
  onClose: () => void;
  readOnly?: boolean;
}

export const RoleModal: React.FC<RoleModalProps> = ({
  isOpen,
  initialValue,
  initialCapabilities,
  onSave,
  onClose,
  readOnly = false,
}) => {
  const [role, setRole] = useState(initialValue);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>(() => ({
    crm: false,
    auditoria: false,
    google_drive: false,
    memorias: false,
    agenda: false,
    ...(initialCapabilities || {}),
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setRole(initialValue ? initialValue.slice(0, 34) : '');
    setCapabilities({
      crm: false,
      auditoria: false,
      google_drive: false,
      memorias: false,
      agenda: false,
      ...(initialCapabilities || {}),
    });
    setErrorMessage(null);
    setIsSaving(false);
  }, [initialValue, initialCapabilities, isOpen]);

  if (!isOpen) return null;

  const handleToggleCapability = (key: string, isImplemented: boolean) => {
    if (readOnly || !isImplemented || isSaving) return;
    setCapabilities((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || isSaving) return;
    setErrorMessage(null);
    setIsSaving(true);

    try {
      const trimmed = role.trim().slice(0, 34);
      const sanitizedCapabilities: Record<string, boolean> = {
        crm: Boolean(capabilities.crm),
        auditoria: Boolean(capabilities.auditoria),
        google_drive: false,
        memorias: false,
        agenda: false,
      };

      const result = await onSave(trimmed, sanitizedCapabilities);
      if (result && (result as any).ok === false) {
        setErrorMessage('Não foi possível salvar as alterações. Tente novamente.');
        setIsSaving(false);
        return;
      }

      setIsSaving(false);
      onClose();
    } catch (err: any) {
      setErrorMessage('Não foi possível salvar as alterações. Tente novamente.');
      setIsSaving(false);
    }
  };

  const getCapabilityIcon = (key: string) => {
    switch (key) {
      case 'crm':
        return (
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.25)] shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
        );
      case 'auditoria':
        return (
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)] shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
        );
      case 'google_drive':
        return (
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
        );
      case 'memorias':
        return (
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Brain className="w-5 h-5" />
          </div>
        );
      case 'agenda':
        return (
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={isSaving ? undefined : onClose}
    >
      {/* Outer Shell with Neon Gradient Border */}
      <div
        className="w-full max-w-2xl neon-modal-shell overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="neon-modal-inner p-6 sm:p-8 flex flex-col overflow-hidden flex-1">
          {/* Header */}
          <div className="flex items-start justify-between pb-5 shrink-0">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/40 flex items-center justify-center text-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.35)] shrink-0">
                <Layers className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-wide">
                  Função do Agente
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defina a função e selecione as capacidades que este agente poderá utilizar.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#242428] transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body with Scroll */}
          <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1 space-y-5">
            <div className="overflow-y-auto space-y-5 flex-1 pr-1 custom-scrollbar">
              {/* Mensagem de Erro */}
              {errorMessage && (
                <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5 shadow-sm shadow-red-950/50 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-200 leading-relaxed break-words">{errorMessage}</p>
                </div>
              )}

              {/* Seção 1: Campo Função do Agente (Máx 34 caracteres) */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-white">
                  Função do Agente
                </label>
                <div className="relative flex items-center bg-[#303034] border border-[#3f3f46] focus-within:border-purple-500/70 focus-within:ring-2 focus-within:ring-purple-500/20 rounded-2xl transition-all shadow-inner overflow-hidden">
                  <input
                    type="text"
                    autoFocus
                    disabled={readOnly || isSaving}
                    value={role}
                    maxLength={34}
                    onChange={(e) => setRole(e.target.value.slice(0, 34))}
                    placeholder="Descreva a função principal do agente..."
                    className="w-full pl-5 pr-20 py-3.5 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 rounded-2xl text-white placeholder-slate-400 text-sm leading-relaxed disabled:opacity-60"
                  />
                  <div className="absolute right-4 text-xs font-mono text-slate-400 select-none pointer-events-none">
                    {role.length} / 34
                  </div>
                </div>
              </div>

              {/* Seção 2: Capacidades do Agente */}
              <div className="space-y-3 pt-1">
                <h4 className="text-sm font-bold text-white tracking-wide">
                  Capacidades do Agente
                </h4>

                <div className="space-y-2.5">
                  {AGENT_CAPABILITIES_CATALOG.map((cap) => {
                    const isEnabled = Boolean(capabilities[cap.key]) && cap.isImplemented;
                    const isDisabledOption = !cap.isImplemented || readOnly || isSaving;

                    return (
                      <div
                        key={cap.key}
                        onClick={() => handleToggleCapability(cap.key, cap.isImplemented)}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                          !cap.isImplemented
                            ? 'bg-[#242428]/60 border-[#303034]/50 opacity-70 cursor-not-allowed'
                            : isEnabled
                            ? 'bg-[#303034] border-purple-500/50 shadow-md shadow-purple-500/10 cursor-pointer'
                            : 'bg-[#242428] border-[#303034] hover:border-[#3f3f46] hover:bg-[#2b2b30] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {getCapabilityIcon(cap.key)}

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-white tracking-tight">
                                {cap.name}
                              </span>
                              {!cap.isImplemented && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  <Lock className="w-2.5 h-2.5 shrink-0" /> Em desenvolvimento
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 truncate leading-relaxed">
                              {cap.description}
                            </p>
                          </div>
                        </div>

                        {/* Toggle Switch */}
                        <div className="shrink-0">
                          <button
                            type="button"
                            disabled={isDisabledOption}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleCapability(cap.key, cap.isImplemented);
                            }}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed ${
                              isEnabled
                                ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                                : 'bg-[#3f3f46]'
                            }`}
                            aria-label={`Alternar ${cap.name}`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                isEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-[#242428] pt-4 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                disabled={isSaving}
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] border border-[#303034] transition-colors cursor-pointer disabled:opacity-50"
              >
                {readOnly ? 'Fechar' : 'Cancelar'}
              </button>
              {!readOnly && (
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 transition-all shadow-lg shadow-purple-500/25 flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>Salvar Função e Capacidades</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
