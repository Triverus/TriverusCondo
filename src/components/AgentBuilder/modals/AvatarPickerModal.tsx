import React from 'react';
import { X, Ban } from 'lucide-react';
import { AVAILABLE_OWL_AVATARS, OwlAvatarOption } from '../../../types/agentBuilder';
import { AgentAvatar } from '../../ui/AgentAvatar';

interface AvatarPickerModalProps {
  isOpen: boolean;
  currentAvatarUrl: string;
  unavailableAvatarUrls?: string[];
  onSelectAvatar: (avatar: OwlAvatarOption) => void;
  onClose: () => void;
}

export const AvatarPickerModal: React.FC<AvatarPickerModalProps> = ({
  isOpen,
  currentAvatarUrl,
  unavailableAvatarUrls = [],
  onSelectAvatar,
  onClose,
}) => {
  if (!isOpen) return null;

  // Split into 5 males (J, F, G, H, I) and 5 females (A, B, C, D, E)
  const maleAvatars = AVAILABLE_OWL_AVATARS.filter((a) => a.gender === 'masculino');
  const femaleAvatars = AVAILABLE_OWL_AVATARS.filter((a) => a.gender === 'feminino');

  const renderAvatarItem = (avatar: OwlAvatarOption) => {
    const isCurrent = currentAvatarUrl === avatar.url;
    const isUnavailable = !isCurrent && unavailableAvatarUrls.includes(avatar.url);

    return (
      <div
        key={avatar.id}
        onClick={() => {
          if (!isUnavailable) {
            onSelectAvatar(avatar);
            onClose();
          }
        }}
        title={
          isUnavailable
            ? 'Avatar já em uso por outro agente'
            : isCurrent
            ? 'Avatar atual'
            : 'Selecionar este avatar'
        }
        className={`group relative w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full flex items-center justify-center select-none transition-all duration-200 ${
          isUnavailable
            ? 'opacity-30 cursor-not-allowed grayscale-[40%]'
            : isCurrent
            ? 'cursor-pointer ring-4 ring-[#ec4899] shadow-[0_0_20px_rgba(236,72,153,0.55)] scale-105'
            : 'cursor-pointer ring-2 ring-slate-800 hover:ring-pink-500/70 hover:scale-105 hover:shadow-[0_0_15px_rgba(236,72,153,0.35)]'
        }`}
      >
        <div className="w-full h-full rounded-full overflow-hidden bg-[#242428]">
          <AgentAvatar
            src={avatar.url}
            alt={avatar.name}
            size="custom"
            className="w-full h-full"
            imgClassName={`w-full h-full object-cover transition-transform duration-200 ${
              !isUnavailable ? 'group-hover:scale-105' : ''
            }`}
            theme="dark"
          />
        </div>

        {/* Prohibited indicator for unavailable avatars */}
        {isUnavailable && (
          <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center pointer-events-none">
            <Ban className="w-7 h-7 sm:w-8 sm:h-8 text-rose-500/90 stroke-[2.5]" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-[#141418] border border-[#242428] rounded-3xl p-6 sm:p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-right close 'X' button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-[#242428] transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 2 Exact Rows: 5 Masculinos (J, F, G, H, I) + 5 Femininos (A, B, C, D, E) */}
        <div className="flex flex-col gap-5 sm:gap-6 pt-3 pb-2">
          {/* Row 1 — Masculinos (5) */}
          <div className="grid grid-cols-5 gap-3 sm:gap-4 md:gap-5 justify-items-center">
            {maleAvatars.map(renderAvatarItem)}
          </div>

          {/* Row 2 — Femininos (5) */}
          <div className="grid grid-cols-5 gap-3 sm:gap-4 md:gap-5 justify-items-center">
            {femaleAvatars.map(renderAvatarItem)}
          </div>
        </div>
      </div>
    </div>
  );
};
