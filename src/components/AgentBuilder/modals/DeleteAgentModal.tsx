import React from 'react';
import { Trash2, X } from 'lucide-react';

interface DeleteAgentModalProps {
  isOpen: boolean;
  agentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteAgentModal: React.FC<DeleteAgentModalProps> = ({
  isOpen,
  agentName,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-[#141418] border border-[#242428] rounded-3xl p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#242428] transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center pt-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
            <Trash2 className="w-6 h-6 stroke-[2]" />
          </div>

          <h3 className="text-base font-bold text-white mb-2">
            Excluir Agente
          </h3>

          <p className="text-xs text-slate-300 leading-relaxed mb-6">
            Tem certeza de que deseja excluir o agente '{agentName || 'Personalizado'}'? Esta ação é irreversível e todas as configurações associadas serão excluídas permanentemente.
          </p>

          <div className="flex items-center gap-3 w-full">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] border border-[#303034] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-md shadow-rose-600/30 cursor-pointer"
            >
              Excluir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
