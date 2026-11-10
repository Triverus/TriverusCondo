import React, { useState, useEffect } from 'react';
import { X, Code2, Check } from 'lucide-react';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface PromptModalProps {
  isOpen: boolean;
  initialValue: string;
  onSave: (prompt: string) => void;
  onClose: () => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  isOpen,
  initialValue,
  onSave,
  onClose,
}) => {
  const [prompt, setPrompt] = useState(initialValue);

  useEffect(() => {
    setPrompt(initialValue || '');
  }, [initialValue, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(prompt.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onClose}
    >
      {/* Outer Shell with Neon Gradient Border */}
      <div
        className="w-full max-w-3xl neon-modal-shell overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="neon-modal-inner p-6 sm:p-8 flex flex-col overflow-hidden flex-1">
          {/* Header */}
          <div className="flex items-start justify-between pb-4 shrink-0">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.35)] shrink-0">
                <Code2 className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-white tracking-wide">
                  Prompt do Agente
                </h3>
                <InfoTooltip
                  title="Prompt do Agente"
                  content="Instruções comportamentais e diretrizes que orientam o raciocínio deste agente em todas as conversas da plataforma."
                  secondaryText="Recomendado detalhar regras de tom, limite de escopo e formato de resposta."
                  theme="dark"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#242428] transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body: Full-Width Textarea */}
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col justify-between space-y-3">
            <div className="w-full flex-1 min-h-0 flex flex-col py-1">
              <textarea
                autoFocus
                value={prompt}
                maxLength={12000}
                onChange={(e) => setPrompt(e.target.value.slice(0, 12000))}
                placeholder="Escreva com detalhes os seus comandos para esse Agente..."
                className="w-full flex-1 min-h-[220px] sm:min-h-[280px] p-5 sm:p-6 bg-[#303034] border border-[#3f3f46] focus:border-cyan-500/70 focus:ring-2 focus:ring-cyan-500/20 rounded-2xl text-white placeholder-slate-400 text-sm leading-relaxed resize-none transition-all custom-scrollbar outline-none shadow-inner"
              />
            </div>

            {/* Footer with Character Counter on Left and Actions on Right */}
            <div className="border-t border-[#242428] pt-4 mt-1 flex items-center justify-between gap-3 shrink-0">
              <div className="text-left">
                <span className="block text-[11px] text-slate-400 font-medium">
                  Contagem de caracteres
                </span>
                <span className="text-xs font-mono text-slate-200 font-semibold">
                  {prompt.length.toLocaleString('pt-BR')} / 12.000
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] border border-[#303034] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-[#FF6600] hover:bg-[#e65c00] transition-all shadow-lg shadow-orange-500/25 flex items-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Salvar Prompt</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
