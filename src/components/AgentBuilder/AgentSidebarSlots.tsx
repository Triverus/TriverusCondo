import React from 'react';
import { Plus, Trash2, Sparkles, UserPlus } from 'lucide-react';
import { AgentSlotData } from '../../types/agentBuilder';
import { AgentAvatar } from '../ui/AgentAvatar';

interface AgentSidebarSlotsProps {
  savedAgents: AgentSlotData[];
  activeAgentId: string; // 'new' | saved agent id
  onSelectNew: () => void;
  onSelectSaved: (id: string) => void;
  onRequestDeleteAgent: (id: string, name: string) => void;
  canCreateNew?: boolean;
  onCreateAgent?: () => void;
  isCreating?: boolean;
  isAdmin?: boolean;
}

export const AgentSidebarSlots: React.FC<AgentSidebarSlotsProps> = ({
  savedAgents,
  activeAgentId,
  onSelectNew,
  onSelectSaved,
  onRequestDeleteAgent,
  canCreateNew = false,
  onCreateAgent,
  isCreating = false,
  isAdmin = true,
}) => {
  const totalCount = savedAgents.length;
  const isLimitReached = totalCount >= 5;
  const isNewActive = activeAgentId === 'new';

  return (
    <div className="w-full lg:w-72 xl:w-80 flex flex-col gap-3 shrink-0 min-w-0">
      {/* Section Header with dynamic counter (0 of 5, 1 of 5, etc.) */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Agentes da Plataforma ({totalCount}/5)
        </h3>
        <span className="text-[10px] text-slate-500 font-medium">
          {isLimitReached ? 'Limite de 5 atingido' : `${5 - totalCount} vagas restantes`}
        </span>
      </div>

      {/* Agents List */}
      <div className="space-y-2.5">
        {/* 1. NOVO AGENTE (FIXED CTA AT TOP - ADMIN ONLY) */}
        {!isAdmin ? (
          <div
            title="Apenas administradores podem criar novos agentes"
            className="p-3 rounded-2xl border border-[#303034] bg-[#242428] flex items-center gap-3 opacity-60 cursor-not-allowed select-none"
          >
            <div className="w-10 h-10 rounded-xl border border-[#3f3f46] bg-[#303034] text-slate-500 flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-400">Novo Agente</h4>
              <p className="text-[10px] text-slate-500 truncate mt-0.5">Exclusivo para administradores</p>
            </div>
          </div>
        ) : isLimitReached ? (
          /* Visible but disabled when limit is reached */
          <div
            title="Capacidade máxima de 5 agentes atingida"
            className="p-3.5 rounded-2xl border border-[#303034] bg-[#242428] flex items-center gap-3.5 opacity-50 cursor-not-allowed select-none"
          >
            <div className="w-10 h-10 rounded-xl border border-[#3f3f46] bg-[#303034] text-slate-500 flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5 stroke-[2]" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-400">
                Novo Agente
              </h4>
              <p className="text-[10px] text-slate-500 truncate mt-0.5">
                Limite de 5 agentes alcançado
              </p>
            </div>
          </div>
        ) : (
          /* Active / clickable Novo Agente CTA */
          <div
            onClick={onSelectNew}
            className={`group relative p-3 rounded-2xl border-2 transition-all cursor-pointer select-none flex items-center gap-3 ${
              isNewActive
                ? 'bg-[#303034] border-[#ec4899] shadow-[0_0_15px_rgba(236,72,153,0.35)] ring-1 ring-[#ec4899]/50'
                : 'bg-[#303034]/70 border-[#ec4899]/60 hover:border-[#ec4899] hover:bg-[#303034] shadow-[0_0_8px_rgba(236,72,153,0.15)]'
            }`}
          >
            {/* Plus Icon */}
            <div className="relative shrink-0">
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all ${
                  isNewActive
                    ? 'bg-pink-500/20 border-[#ec4899] text-[#ec4899]'
                    : 'bg-pink-500/10 border-pink-500/40 text-pink-400 group-hover:border-[#ec4899]'
                }`}
              >
                <Plus className="w-5 h-5 stroke-[2.5]" />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h4
                className={`text-xs font-bold truncate ${
                  isNewActive ? 'text-white' : 'text-slate-200 group-hover:text-white'
                }`}
              >
                Novo Agente
              </h4>
              <p className="text-[11px] text-pink-300/80 truncate mt-0.5">
                Criar e configurar
              </p>
            </div>

            {/* Action button: "Criar Agente" ONLY during creation when minimum fields are filled */}
            {isNewActive && canCreateNew && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateAgent?.();
                }}
                disabled={isCreating}
                title="Criar e salvar este novo agente"
                className="shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white shadow-md shadow-pink-500/30 flex items-center gap-1.5 transition-all cursor-pointer select-none"
              >
                {isCreating ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Criar Agente</span>
              </button>
            )}
          </div>
        )}

        {/* 2. AGENTES EFETIVAMENTE CRIADOS PELO USUÁRIO */}
        {savedAgents.length === 0 ? (
          <div className="p-4 rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 text-center flex flex-col items-center justify-center gap-2">
            <UserPlus className="w-6 h-6 text-slate-600" />
            <p className="text-xs text-slate-400 font-medium">
              Nenhum agente criado ainda.
            </p>
            <p className="text-[10px] text-slate-500">
              Clique em <strong className="text-pink-400">Novo Agente</strong> acima para criar seu primeiro especialista.
            </p>
          </div>
        ) : (
          savedAgents.map((agent) => {
            const isActive = activeAgentId === agent.id;

            return (
              <div
                key={agent.id}
                onClick={() => onSelectSaved(agent.id)}
                className={`group relative p-3 rounded-2xl border transition-all cursor-pointer select-none flex items-center gap-3 ${
                  isActive
                    ? 'bg-[#303034] border-[#38bdf8] ring-1 ring-[#38bdf8]/40 shadow-lg shadow-sky-500/15'
                    : 'bg-[#303034] border-[#3f3f46] hover:border-slate-500 hover:bg-[#38383e]'
                }`}
              >
                {/* Avatar Container */}
                <div className="relative shrink-0">
                  <div
                    className={`w-11 h-11 rounded-full overflow-hidden border-2 transition-transform ${
                      isActive ? 'border-[#38bdf8] scale-105' : 'border-slate-700'
                    }`}
                  >
                    <AgentAvatar
                      src={agent.avatarUrl}
                      alt={agent.name}
                      size="custom"
                      className="w-full h-full"
                      imgClassName="w-full h-full object-cover"
                      theme="dark"
                      fallbackText="?"
                    />
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h4
                    className={`text-xs font-bold truncate ${
                      isActive ? 'text-white' : 'text-slate-200 group-hover:text-white'
                    }`}
                  >
                    {agent.name || 'Agente Sem Nome'}
                  </h4>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {agent.role || 'Configuração em andamento'}
                  </p>
                </div>

                {/* Functional Trash Icon for Deletion (Admin Only) */}
                {isAdmin && (
                  <div className="shrink-0 flex items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDeleteAgent(agent.id, agent.name);
                      }}
                      title={`Excluir agente "${agent.name}"`}
                      className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 stroke-[1.75]" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
