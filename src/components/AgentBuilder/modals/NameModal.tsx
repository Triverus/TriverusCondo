import React, { useState, useEffect } from 'react';
import { X, Tag, Check } from 'lucide-react';

interface NameModalProps {
  isOpen: boolean;
  initialValue: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export const NameModal: React.FC<NameModalProps> = ({
  isOpen,
  initialValue,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(initialValue);

  useEffect(() => {
    setName((initialValue || '').slice(0, 20));
  }, [initialValue, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name.trim().slice(0, 20));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onClose}
    >
      {/* Outer Shell with Neon Gradient Border */}
      <div
        className="w-full max-w-2xl neon-modal-shell overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="neon-modal-inner p-6 sm:p-8 flex flex-col space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/40 flex items-center justify-center text-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.35)] shrink-0">
                <Tag className="w-6 h-6 stroke-[2.2] -rotate-45" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-wide">
                  Nome do Agente
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defina um nome para o seu agente.
                </p>
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

          {/* Form Body with 2 Columns: Neon Art on Left + Input on Right */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center py-2">
              {/* Left Column: Neon Tags Art */}
              <div className="sm:col-span-5 flex items-center justify-center relative min-h-[150px]">
                {/* Ambient glow behind illustration */}
                <div className="absolute inset-0 bg-gradient-to-tr from-pink-500/20 via-purple-500/15 to-transparent blur-2xl rounded-full pointer-events-none" />

                <svg
                  className="w-40 h-36 relative z-10"
                  viewBox="0 0 160 140"
                  fill="none"
                >
                  <defs>
                    <filter id="neon-glow-pink" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="neon-glow-orange" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <linearGradient id="tag1-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ec4899" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                    <linearGradient id="tag2-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f43f5e" />
                      <stop offset="100%" stopColor="#f97316" />
                    </linearGradient>
                  </defs>

                  {/* Background Tag (Purple/Pink Neon) */}
                  <g transform="translate(48, 16) rotate(16)">
                    <rect
                      x="0"
                      y="0"
                      width="54"
                      height="74"
                      rx="14"
                      fill="#12121a"
                      stroke="url(#tag1-grad)"
                      strokeWidth="2.5"
                      filter="url(#neon-glow-pink)"
                    />
                    <circle cx="27" cy="18" r="4.5" stroke="#ec4899" strokeWidth="2.5" fill="#12121a" />
                    <line x1="14" y1="36" x2="40" y2="36" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="14" y1="46" x2="32" y2="46" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />
                  </g>

                  {/* Foreground Tag (Hot Pink/Orange Neon) */}
                  <g transform="translate(18, 22) rotate(-14)">
                    <rect
                      x="0"
                      y="0"
                      width="56"
                      height="78"
                      rx="14"
                      fill="#181824"
                      stroke="url(#tag2-grad)"
                      strokeWidth="3"
                      filter="url(#neon-glow-orange)"
                    />
                    <circle cx="28" cy="18" r="5" stroke="#f43f5e" strokeWidth="3" fill="#181824" />
                    <line x1="14" y1="38" x2="42" y2="38" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
                    <line x1="14" y1="48" x2="34" y2="48" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
                    <line x1="14" y1="58" x2="26" y2="58" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
                  </g>

                  {/* Neon light wave underneath */}
                  <path
                    d="M 10 115 C 35 128, 65 96, 95 118 C 120 135, 145 110, 155 112"
                    stroke="#ec4899"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    filter="url(#neon-glow-pink)"
                  />
                  <path
                    d="M 20 118 C 45 130, 75 102, 105 122 C 128 136, 145 120, 150 120"
                    stroke="#06b6d4"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.8"
                  />
                </svg>
              </div>

              {/* Right Column: Input Box with Inline Counter */}
              <div className="sm:col-span-7 flex flex-col justify-center">
                <div className="relative flex items-center bg-[#303034] border border-[#3f3f46] focus-within:border-pink-500/70 focus-within:ring-2 focus-within:ring-pink-500/20 rounded-2xl transition-all shadow-inner overflow-hidden">
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    maxLength={20}
                    onChange={(e) => setName(e.target.value.slice(0, 20))}
                    placeholder="Digite o nome do agente..."
                    className="w-full pl-5 pr-20 py-4 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 rounded-2xl text-white placeholder-slate-400 text-sm leading-relaxed"
                  />
                  <div className="absolute right-4 text-xs font-mono text-slate-400 select-none pointer-events-none">
                    {name.length} / 20
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[#242428] pt-4 flex items-center justify-end gap-3">
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
                <span>Salvar Nome</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
