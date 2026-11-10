import React, { useState, useEffect } from 'react';
import { X, Brain, Leaf, Scale, Rocket, Check } from 'lucide-react';
import { BrainProfile } from '../../../types/agentBuilder';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface BrainModalProps {
  isOpen: boolean;
  initialValue: BrainProfile;
  onSave: (profile: BrainProfile) => void;
  onClose: () => void;
}

export const BrainModal: React.FC<BrainModalProps> = ({
  isOpen,
  initialValue,
  onSave,
  onClose,
}) => {
  const [selectedProfile, setSelectedProfile] = useState<BrainProfile>(initialValue || 'equilibrado');

  useEffect(() => {
    setSelectedProfile(initialValue || 'equilibrado');
  }, [initialValue, isOpen]);

  if (!isOpen) return null;

  const options: Array<{
    id: BrainProfile;
    label: string;
    description: string;
    icon: typeof Leaf;
  }> = [
    {
      id: 'economico',
      label: 'Econômico',
      description: 'Respostas rápidas e alta economia de tokens de saída.',
      icon: Leaf,
    },
    {
      id: 'equilibrado',
      label: 'Equilibrado',
      description: 'Equilíbrio ideal entre profundidade de raciocínio e velocidade.',
      icon: Scale,
    },
    {
      id: 'avancado',
      label: 'Avançado',
      description: 'Raciocínio analítico profundo com orçamento estendido de tokens.',
      icon: Rocket,
    },
  ];

  const handleSave = () => {
    onSave(selectedProfile);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onClose}
    >
      {/* Outer Shell with Neon Gradient Border */}
      <div
        className="w-full max-w-2xl neon-modal-shell-brain overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="neon-modal-inner p-6 sm:p-8 flex flex-col space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/40 flex items-center justify-center text-[#FF6600] shadow-[0_0_15px_rgba(255,102,0,0.35)] shrink-0">
                <Brain className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-wide">
                  Cérebro do Agente
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defina o perfil cognitivo do seu agente.
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

          {/* Body: 2 Columns - Glowing 3D Neural Brain Image on Left + 3 Cards on Right */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center py-2">
            {/* Left Column: Official Neural Brain Art */}
            <div className="md:col-span-5 flex items-center justify-center relative min-h-[220px]">
              {/* Concentric Ambient Glow */}
              <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/25 via-amber-500/15 to-transparent blur-3xl rounded-full pointer-events-none" />

              <img
                src="http://adm.triveruscondo.com/wp-content/uploads/2026/11/triverus_cerebro_leve.webp"
                alt="Cérebro do Agente"
                className="w-52 h-52 sm:w-56 sm:h-56 object-contain relative z-10 drop-shadow-[0_0_30px_rgba(255,102,0,0.35)]"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Right Column: 3 Selectable Profile Cards */}
            <div className="md:col-span-7 space-y-3">
              {options.map((opt) => {
                const isSelected = selectedProfile === opt.id;
                const IconComponent = opt.icon;

                return (
                  <div
                    key={opt.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedProfile(opt.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedProfile(opt.id);
                      }
                    }}
                    className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between cursor-pointer select-none text-left ${
                      isSelected
                        ? 'bg-[#303034] border-[#FF6600] shadow-[0_0_20px_rgba(255,102,0,0.25)] text-white'
                        : 'bg-[#242428] border-[#303034] hover:border-[#3f3f46] text-slate-300 hover:text-white hover:bg-[#2b2b30]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-orange-500/20 text-[#FF6600] border border-orange-500/40 shadow-[0_0_10px_rgba(255,102,0,0.3)]'
                            : 'bg-[#1b1b1f] text-slate-400 border border-[#303034]'
                        }`}
                      >
                        <IconComponent className="w-5 h-5 stroke-[2]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white tracking-wide">
                            {opt.label}
                          </span>
                          <InfoTooltip
                            title={`Perfil ${opt.label}`}
                            content={opt.description}
                            theme="dark"
                            as="span"
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                          {opt.description}
                        </p>
                      </div>
                    </div>

                    {/* Radio Button */}
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all shrink-0 ${
                        isSelected
                          ? 'border-[#FF6600] bg-transparent'
                          : 'border-slate-600 bg-transparent'
                      }`}
                    >
                      {isSelected && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[#FF6600] shadow-[0_0_8px_#FF6600]" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#242428] pt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] border border-[#303034] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-[#FF6600] hover:bg-[#e65c00] transition-all shadow-lg shadow-orange-500/25 flex items-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Aplicar Cérebro</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
