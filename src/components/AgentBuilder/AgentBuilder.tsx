import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import {
  AgentSlotData,
  OwlAvatarOption,
  BrainProfile,
} from '../../types/agentBuilder';
import {
  getSavedAgents,
  saveAgents,
  deleteAgent as deleteAgentFromStore,
  subscribeToAgents,
  syncGlobalAgentsWithBackend,
  syncGlobalAssignmentsWithBackend,
  persistAgentToBackend,
  removeAgentFromBackend,
} from '../../lib/agentStore';
import { useUserPermissions } from '../../lib/permissionsContext';
import { AgentSidebarSlots } from './AgentSidebarSlots';
import { AgentCenterCircuit } from './AgentCenterCircuit';
import { AvatarPickerModal } from './modals/AvatarPickerModal';
import { NameModal } from './modals/NameModal';
import { RoleModal } from './modals/RoleModal';
import { PromptModal } from './modals/PromptModal';
import { BrainModal } from './modals/BrainModal';
import { ModelModal } from './modals/ModelModal';
import { DeleteAgentModal } from './modals/DeleteAgentModal';

// All fields start completely empty for a new draft agent (neutral avatar circle)
const createDefaultDraft = (slotNumber = 1): AgentSlotData => ({
  id: 'draft',
  slotNumber,
  name: '',
  role: '',
  avatarUrl: '',
  avatarId: '',
  prompt: '',
  brainProfile: '' as BrainProfile,
  modelId: '',
  isConfigured: false,
  capabilities: {
    crm: false,
    auditoria: false,
    google_drive: false,
    memorias: false,
    agenda: false,
  },
});

type ModalType = 'avatar' | 'name' | 'role' | 'prompt' | 'brain' | 'model' | null;

export const AgentBuilder: React.FC = () => {
  const { isAdmin } = useUserPermissions();
  const [savedAgents, setSavedAgents] = useState<AgentSlotData[]>(getSavedAgents);
  const [activeAgentId, setActiveAgentId] = useState<string>(() => {
    const initial = getSavedAgents();
    return initial.length > 0 ? initial[0].id : 'new';
  });
  const [draftAgent, setDraftAgent] = useState<AgentSlotData>(() =>
    createDefaultDraft(savedAgents.length + 1)
  );

  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isAvatarChanging, setIsAvatarChanging] = useState(false);

  // Avatar speech bubble state
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);
  const speechBubbleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerSpeechBubble = (text: string) => {
    if (speechBubbleTimerRef.current) {
      clearTimeout(speechBubbleTimerRef.current);
    }
    setSpeechBubbleText(text);
    speechBubbleTimerRef.current = setTimeout(() => {
      setSpeechBubbleText(null);
      speechBubbleTimerRef.current = null;
    }, 4000);
  };

  // Sync with agentStore subscription and backend on mount
  useEffect(() => {
    syncGlobalAgentsWithBackend().then((agents) => {
      if (agents && agents.length > 0) setSavedAgents(agents);
    });
    syncGlobalAssignmentsWithBackend();

    const unsubscribe = subscribeToAgents(() => {
      const updated = getSavedAgents();
      setSavedAgents(updated);
    });
    return () => unsubscribe();
  }, []);

  // Current active slot object
  const currentSlot: AgentSlotData = (() => {
    if (activeAgentId === 'new') {
      return draftAgent;
    }
    const found = savedAgents.find((a) => a.id === activeAgentId);
    return found || draftAgent;
  })();

  // Dynamically calculate which avatars are currently in use by OTHER agents (exclusive rule)
  const unavailableAvatarUrls: string[] = (() => {
    const urls: string[] = [];

    if (activeAgentId === 'new') {
      savedAgents.forEach((a) => {
        if (a.avatarUrl) urls.push(a.avatarUrl);
      });
    } else {
      savedAgents.forEach((a) => {
        if (a.id !== activeAgentId && a.avatarUrl) {
          urls.push(a.avatarUrl);
        }
      });
    }

    return urls;
  })();

  // Update active slot field (immediate persistence to backend for existing agents)
  const updateCurrentSlot = async (
    patch: Partial<AgentSlotData>
  ): Promise<{ ok: boolean; error?: string; agent?: AgentSlotData }> => {
    if (!isAdmin && activeAgentId !== 'new') {
      triggerSpeechBubble('Apenas administradores ativos podem alterar as configurações do agente! 🔒');
      return { ok: false, error: 'Apenas administradores ativos podem alterar as configurações do agente.' };
    }

    const nowIso = new Date().toISOString();

    if (activeAgentId === 'new') {
      // Draft agent: holds state until "Criar Agente"
      setDraftAgent((prev) => ({
        ...prev,
        ...patch,
        updatedAt: nowIso,
      }));
      return { ok: true };
    } else {
      // Existing custom agent: persists to Supabase backend first
      const existing = savedAgents.find((a) => a.id === activeAgentId);
      if (!existing) return { ok: false, error: 'Agente não encontrado no cadastro.' };

      const targetAgent: AgentSlotData = {
        ...existing,
        ...patch,
        updatedAt: nowIso,
      };

      if (isAdmin) {
        const res = await persistAgentToBackend(targetAgent);
        if (!res.ok) {
          setErrorToast('Não foi possível salvar as alterações. Tente novamente.');
          triggerSpeechBubble('⚠️ Não foi possível salvar as alterações. Tente novamente.');
          setTimeout(() => setErrorToast(null), 5000);
          return { ok: false, error: 'Não foi possível salvar as alterações. Tente novamente.' };
        }

        const saved = res.agent || targetAgent;
        const updated = savedAgents.map((agent) => (agent.id === activeAgentId ? saved : agent));
        setSavedAgents(updated);
        return { ok: true, agent: saved };
      }
      return { ok: true };
    }
  };

  // Avatar select handler
  const handleSelectAvatar = (avatar: OwlAvatarOption) => {
    updateCurrentSlot({
      avatarUrl: avatar.url,
      avatarId: avatar.id,
    });
    setActiveModal(null);
    triggerSpeechBubble('Amei esse visual! 🥰');
  };

  // Name save handler with speech reaction
  const handleSaveName = (name: string) => {
    updateCurrentSlot({ name });
    if (name.trim()) {
      triggerSpeechBubble('Yesss, agora tenho um nome super legal 🥳');
    }
  };

  // Role and capabilities save handler with speech reaction and backend error return
  const handleSaveRole = async (
    role: string,
    capabilities?: Record<string, boolean>
  ): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = role.trim().slice(0, 34);
    const res = await updateCurrentSlot({ role: trimmed, capabilities });
    if (res && res.ok === false) {
      setErrorToast('Não foi possível salvar as alterações. Tente novamente.');
      triggerSpeechBubble('⚠️ Não foi possível salvar as alterações. Tente novamente.');
      setTimeout(() => setErrorToast(null), 5000);
      return { ok: false, error: 'Não foi possível salvar as alterações. Tente novamente.' };
    }
    setSuccessToast('Função e capacidades atualizadas com sucesso.');
    setTimeout(() => setSuccessToast(null), 4000);

    // Revalidação de compatibilidade do modelo atual com as novas capacidades
    if (currentSlot.modelId && capabilities) {
      const currentModelId = currentSlot.modelId.toLowerCase();
      const reqAuditoria = Boolean(capabilities.auditoria);
      const reqCrm = Boolean(capabilities.crm);

      const isNoTools = currentModelId.includes('o1-preview') || currentModelId.includes('o1-mini');
      const isNoPdf = !currentModelId.includes('gpt-4o') && !currentModelId.includes('o1') && !currentModelId.includes('gemini') && !currentModelId.includes('o3-mini');

      if ((reqAuditoria || reqCrm) && isNoTools) {
        triggerSpeechBubble('⚠️ O modelo atual não suporta ferramentas. Por favor selecione um modelo compatível.');
        setActiveModal('model');
        return { ok: true };
      }
      if (reqAuditoria && isNoPdf) {
        triggerSpeechBubble('⚠️ A capacidade Auditoria exige um modelo com suporte a leitura de PDFs. Selecione um modelo compatível.');
        setActiveModal('model');
        return { ok: true };
      }
    }

    if (trimmed) {
      triggerSpeechBubble('Uhuuu, adorei a minha função e capacidades! 😊');
    }
    return { ok: true };
  };

  // Prompt save handler with speech reaction
  const handleSavePrompt = (prompt: string) => {
    updateCurrentSlot({ prompt });
    if (prompt.trim()) {
      triggerSpeechBubble('Prometo honrar essa minha missão 🫡');
    }
  };

  // Brain save handler with speech reaction
  const handleSaveBrain = (brainProfile: BrainProfile) => {
    updateCurrentSlot({ brainProfile });
    if (brainProfile === 'economico') {
      triggerSpeechBubble('Vou trabalhar com inteligência e eficiência! ⚡');
    } else if (brainProfile === 'equilibrado') {
      triggerSpeechBubble('Adorei! Inteligência na medida certa! 🧠');
    } else if (brainProfile === 'avancado') {
      triggerSpeechBubble('Uau! Agora posso dar o meu melhor! 🚀');
    }
  };

  // Model save handler with speech reaction
  const handleSaveModel = (modelId: string) => {
    updateCurrentSlot({ modelId });
    if (modelId) {
      triggerSpeechBubble('Agora sim, estou pronta para trabalhar! ✨');
    }
  };

  // Check mandatory conditions for creating a new agent
  const canCreateNew =
    isAdmin &&
    Boolean(draftAgent.avatarUrl) &&
    Boolean(draftAgent.name?.trim()) &&
    Boolean(draftAgent.role?.trim());

  // Final Action: "Criar Agente"
  const handleCreateAgent = async () => {
    if (!isAdmin) {
      triggerSpeechBubble('Apenas administradores ativos podem criar agentes! 🔒');
      return;
    }
    if (!canCreateNew || isCreating || savedAgents.length >= 5) return;
    setIsCreating(true);

    const newAgent: AgentSlotData = {
      ...draftAgent,
      id: `agent-${Date.now()}`,
      slotNumber: savedAgents.length + 1,
      isConfigured: true,
      updatedAt: new Date().toISOString(),
    };

    // PERSIST TO BACKEND SUPABASE FIRST BEFORE UPDATING LOCAL CACHE
    const res = await persistAgentToBackend(newAgent);
    setIsCreating(false);

    if (!res.ok) {
      setErrorToast('Não foi possível salvar o agente. Tente novamente.');
      triggerSpeechBubble('⚠️ Não foi possível salvar o agente. Tente novamente.');
      setTimeout(() => setErrorToast(null), 5000);
      return;
    }

    const savedNewAgent = res.agent || newAgent;
    const updated = [...savedAgents.filter((a) => a.id !== savedNewAgent.id), savedNewAgent];
    setSavedAgents(updated);

    setActiveAgentId(savedNewAgent.id);
    setDraftAgent(createDefaultDraft(updated.length + 1));
    setSuccessToast(`Agente "${savedNewAgent.name}" criado com sucesso!`);
    setTimeout(() => setSuccessToast(null), 3500);

    // Confetti celebratory burst
    try {
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.65 },
        colors: ['#ec4899', '#a855f7', '#3b82f6', '#06b6d4', '#10b981'],
      });
    } catch {}
  };

  // Delete agent handler with confirmation modal
  const handleConfirmDelete = async () => {
    if (!isAdmin || !deleteTarget) return;

    const idToDelete = deleteTarget.id;
    const nameToDelete = deleteTarget.name;

    const res = await removeAgentFromBackend(idToDelete);
    if (!res.ok) {
      setErrorToast('Não foi possível excluir o agente. Tente novamente.');
      setDeleteTarget(null);
      setTimeout(() => setErrorToast(null), 5000);
      return;
    }

    deleteAgentFromStore(idToDelete);
    const remaining = savedAgents.filter((a) => a.id !== idToDelete);
    setSavedAgents(remaining);

    if (activeAgentId === idToDelete) {
      if (remaining.length > 0) {
        setActiveAgentId(remaining[0].id);
      } else {
        setActiveAgentId('new');
        setDraftAgent(createDefaultDraft(1));
      }
    }

    setDeleteTarget(null);
    setSuccessToast(`Agente "${nameToDelete || 'Personalizado'}" excluído com sucesso. Avatar liberado.`);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  return (
    <div className="flex-1 min-h-screen bg-[#141418] text-slate-100 flex flex-col p-4 sm:p-6 lg:p-8 font-['Roboto',sans-serif] selection:bg-pink-500 selection:text-white">
      {/* Success Toast Notification */}
      {successToast && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-slate-900 border border-emerald-500/50 text-white rounded-2xl shadow-2xl animate-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{successToast}</span>
        </div>
      )}

      {/* Error Toast Notification */}
      {errorToast && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-red-950/90 border border-red-500/80 text-white rounded-2xl shadow-2xl animate-in slide-in-from-top-4 duration-200">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span className="text-xs font-semibold">{errorToast}</span>
        </div>
      )}

      {/* Collaborator Read-Only Mode Notice Banner */}
      {!isAdmin && (
        <div className="w-full mb-4 px-4 py-2.5 rounded-2xl bg-sky-950/40 border border-sky-500/30 text-sky-200 text-xs flex items-center justify-between animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shrink-0 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
            <span><strong>Modo de Leitura:</strong> A plataforma possui 5 agentes globais compartilhados. Apenas administradores ativos podem criar, configurar, editar ou excluir agentes.</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 shrink-0">Colaborador</span>
        </div>
      )}

      {/* MAIN BUILDER BODY: Left Sidebar Slots & Center Visual Circuit */}
      <div className="flex-1 w-full min-w-0 flex flex-col lg:flex-row gap-6 lg:gap-8 items-start my-auto">
        {/* Left Slots List: 1. Novo Agente (top), 2. User Agents */}
        <AgentSidebarSlots
          savedAgents={savedAgents}
          activeAgentId={activeAgentId}
          onSelectNew={() => {
            setActiveAgentId('new');
            setDraftAgent(createDefaultDraft(savedAgents.length + 1));
          }}
          onSelectSaved={(id) => setActiveAgentId(id)}
          onRequestDeleteAgent={(id, name) => setDeleteTarget({ id, name })}
          canCreateNew={canCreateNew}
          onCreateAgent={handleCreateAgent}
          isCreating={isCreating}
          isAdmin={isAdmin}
        />

        {/* Center Circuit Area with Neutral/Neon Circle, Empregos, and Gears */}
        <AgentCenterCircuit
          currentSlot={currentSlot}
          onOpenAvatarModal={() => {
            if (!isAdmin) {
              triggerSpeechBubble('Apenas administradores ativos podem alterar o avatar! 🔒');
              return;
            }
            setActiveModal('avatar');
          }}
          onOpenNameModal={() => {
            if (!isAdmin) {
              triggerSpeechBubble('Apenas administradores ativos podem alterar o nome! 🔒');
              return;
            }
            setActiveModal('name');
          }}
          onOpenRoleModal={() => {
            if (!isAdmin) {
              triggerSpeechBubble('Apenas administradores ativos podem alterar a função! 🔒');
              return;
            }
            setActiveModal('role');
          }}
          onOpenPromptModal={() => {
            // Collaborators can view prompt, but editing won't save
            setActiveModal('prompt');
          }}
          onOpenBrainModal={() => {
            if (!isAdmin) {
              triggerSpeechBubble('Apenas administradores ativos podem alterar o perfil de inteligência! 🔒');
              return;
            }
            setActiveModal('brain');
          }}
          onOpenModelModal={() => {
            if (!isAdmin) {
              triggerSpeechBubble('Apenas administradores ativos podem alterar o modelo! 🔒');
              return;
            }
            setActiveModal('model');
          }}
          speechBubbleText={speechBubbleText}
          isAdmin={isAdmin}
        />
      </div>

      {/* POPUP MODALS */}
      <AvatarPickerModal
        isOpen={activeModal === 'avatar'}
        currentAvatarUrl={currentSlot.avatarUrl}
        unavailableAvatarUrls={unavailableAvatarUrls}
        onSelectAvatar={handleSelectAvatar}
        onClose={() => setActiveModal(null)}
      />

      <NameModal
        isOpen={activeModal === 'name'}
        initialValue={currentSlot.name}
        onSave={handleSaveName}
        onClose={() => setActiveModal(null)}
      />

      <RoleModal
        isOpen={activeModal === 'role'}
        initialValue={currentSlot.role}
        initialCapabilities={currentSlot.capabilities}
        readOnly={!isAdmin}
        onSave={handleSaveRole}
        onClose={() => setActiveModal(null)}
      />

      <PromptModal
        isOpen={activeModal === 'prompt'}
        initialValue={currentSlot.prompt}
        onSave={handleSavePrompt}
        onClose={() => setActiveModal(null)}
      />

      <BrainModal
        isOpen={activeModal === 'brain'}
        initialValue={currentSlot.brainProfile}
        onSave={handleSaveBrain}
        onClose={() => setActiveModal(null)}
      />

      <ModelModal
        isOpen={activeModal === 'model'}
        initialValue={currentSlot.modelId || ''}
        capabilities={currentSlot.capabilities}
        onSave={handleSaveModel}
        onClose={() => setActiveModal(null)}
      />

      {/* MINIMALIST DELETE CONFIRMATION MODAL */}
      <DeleteAgentModal
        isOpen={Boolean(deleteTarget)}
        agentName={deleteTarget?.name || ''}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default AgentBuilder;
