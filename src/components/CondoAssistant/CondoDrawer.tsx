import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowLeftRight, Trash2, X, PlusCircle, Bot } from 'lucide-react';
import { useTheme } from '../../lib/themeContext.tsx';
import { useCRM } from '../../lib/crmStore.tsx';
import type { UserProfile } from '../../App.tsx';
import type { CondoMessage } from './condoTypes.ts';
import { sendCondoMessage, type ActionContext } from './condoService.ts';
import CondoResultRenderer from './CondoResultRenderer.tsx';
import CondoMarkdown from './CondoMarkdown.tsx';
import { showHelpTarget } from '../../lib/spotlightHelper.ts';
import {
  getSavedAgents,
  getActiveChatAgentId,
  setActiveChatAgentId,
  getChatHistoryForAgent,
  saveChatHistoryForAgent,
  subscribeToAgents,
} from '../../lib/agentStore.ts';
import type { AgentSlotData } from '../../types/agentBuilder.ts';
import { AgentAvatar } from '../ui/AgentAvatar';

interface CondoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: UserProfile | null;
  onOpenLead?: (leadId: string) => void;
  onOpenFollowUp?: (leadId?: string) => void;
  currentPath?: string;
  navigate?: (path: string) => void;
}

function DrawerProcessingIndicator({ agentName }: { agentName?: string }) {
  const STAGES = [
    'Consultando registros no CRM...',
    'Cruzando informações...',
    'Organizando resposta...',
    'Processando sua solicitação...',
  ];
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div className="w-3.5 h-3.5 border-2 border-pink-400 border-t-transparent rounded-full animate-spin shrink-0" />
      <span className="animate-in fade-in duration-300">
        {agentName ? `${agentName}: ` : ''}{STAGES[stageIndex]}
      </span>
    </div>
  );
}

export function CondoDrawer({
  isOpen,
  onClose,
  currentProfile,
  onOpenLead,
  onOpenFollowUp,
  currentPath,
  navigate,
}: CondoDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const {
    leads,
    stages,
    contacts,
    interactions,
    stageMap,
    profileMap,
    refreshAll,
  } = useCRM();

  // Saved Agents & Active Selected Chat Agent
  const [savedAgents, setSavedAgents] = useState<AgentSlotData[]>(getSavedAgents);
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(getActiveChatAgentId);
  const [isChoosingAgent, setIsChoosingAgent] = useState<boolean>(false);

  // Sync saved agents and active agent from agentStore
  useEffect(() => {
    const handleSync = () => {
      const agents = getSavedAgents();
      setSavedAgents(agents);

      const currentActiveId = getActiveChatAgentId();
      // If current active agent no longer exists among saved agents, clear it
      if (currentActiveId && !agents.some((a) => a.id === currentActiveId)) {
        setActiveChatAgentId(null);
        setActiveAgentIdState(null);
      } else if (currentActiveId) {
        setActiveAgentIdState(currentActiveId);
      }
    };

    handleSync();
    const unsubscribe = subscribeToAgents(handleSync);
    return () => unsubscribe();
  }, []);

  const currentAgent = savedAgents.find((a) => a.id === activeAgentId) || null;

  // Chat conversation state (isolated per agent)
  const [messages, setMessages] = useState<CondoMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Load chat history whenever active agent changes
  useEffect(() => {
    if (!currentAgent) {
      setMessages([]);
      return;
    }

    const savedHistory = getChatHistoryForAgent(currentAgent.id);
    if (savedHistory && savedHistory.length > 0) {
      setMessages(savedHistory);
    } else {
      const greetingMsg: CondoMessage = {
        id: `msg_welcome_${Date.now()}`,
        role: 'assistant',
        content: `Olá **${currentProfile?.full_name?.split(' ')[0] || 'Gestor'}**! Sou **${currentAgent.name}**, ${currentAgent.role}.\n\nComo posso te ajudar hoje?`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages([greetingMsg]);
      saveChatHistoryForAgent(currentAgent.id, [greetingMsg]);
    }
  }, [currentAgent?.id, currentProfile?.full_name]);

  // Auto scroll to bottom
  useEffect(() => {
    if (isOpen && !isChoosingAgent && currentAgent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading, isChoosingAgent, currentAgent]);

  // Focus input when ready
  useEffect(() => {
    if (isOpen && !isLoading && !isChoosingAgent && currentAgent) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isLoading, isChoosingAgent, currentAgent]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelectAgent = (agent: AgentSlotData) => {
    setActiveChatAgentId(agent.id);
    setActiveAgentIdState(agent.id);
    setIsChoosingAgent(false);
  };

  const handleSendMessage = async (textToSend?: string) => {
    if (!currentAgent) return;
    const prompt = (textToSend || inputValue).trim();
    if (!prompt || isLoading) return;

    const userMsg: CondoMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    saveChatHistoryForAgent(currentAgent.id, nextMessages);
    setInputValue('');
    setIsLoading(true);

    const actionCtx: ActionContext = {
      leads,
      stages,
      contacts,
      interactions,
      stageMap,
      profileMap,
      currentUserFullName: currentProfile?.full_name || 'Gestor',
      refreshAll,
      onNavigateToLead: onOpenLead,
    };

    try {
      const response = await sendCondoMessage(
        prompt,
        nextMessages,
        actionCtx,
        undefined,
        undefined,
        undefined,
        {
          id: currentAgent.id,
          name: currentAgent.name,
          role: currentAgent.role,
          prompt: currentAgent.prompt,
          modelId: currentAgent.modelId,
          brainProfile: currentAgent.brainProfile,
        }
      );

      const assistantMsg: CondoMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: response.text,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        actionsExecuted: response.actions,
        results: response.results,
      };

      const finalMessages = [...nextMessages, assistantMsg];
      setMessages(finalMessages);
      saveChatHistoryForAgent(currentAgent.id, finalMessages);
    } catch (err: any) {
      const errorMsg: CondoMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Desculpe, não consegui processar a consulta: ${err?.message || 'Erro de conexão'}.`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
      const finalMessages = [...nextMessages, errorMsg];
      setMessages(finalMessages);
      saveChatHistoryForAgent(currentAgent.id, finalMessages);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  };

  const handleClearHistory = () => {
    if (!currentAgent) return;
    const clean: CondoMessage[] = [
      {
        id: `msg_welcome_${Date.now()}`,
        role: 'assistant',
        content: `Histórico limpo. Como posso te ajudar agora?`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
    ];
    setMessages(clean);
    saveChatHistoryForAgent(currentAgent.id, clean);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleNavigateToAgentBuilder = () => {
    onClose();
    if (navigate) {
      navigate('/app/auditoria/agentes');
    }
  };

  const handleShowHelpTarget = (helpId: string, route?: string, leadId?: string, title?: string) => {
    showHelpTarget({
      helpId,
      route,
      leadId,
      title,
      currentPath,
      navigate,
      closeCondo: onClose,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200 cursor-pointer"
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] flex flex-col shadow-2xl transition-transform duration-300 border-l ${
          isLight
            ? 'bg-white/98 border-slate-200 text-slate-900 backdrop-blur-2xl'
            : 'bg-[#090b14]/98 border-slate-800 text-slate-100 backdrop-blur-2xl'
        }`}
      >
        {/* CASE 1: 0 AGENTS CREATED IN THE PLATFORM */}
        {savedAgents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
            <div className="w-16 h-16 rounded-3xl bg-pink-500/15 border border-pink-500/30 text-pink-400 flex items-center justify-center mb-5 shadow-lg shadow-pink-500/10">
              <Sparkles className="w-8 h-8 stroke-[2]" />
            </div>

            <h3 className="text-lg font-bold text-white mb-2">
              Você ainda não tem agentes criados
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm mb-6">
              Para interagir com o chat inteligente da Triverus, crie e configure o seu primeiro agente especialista no Construtor de Agentes.
            </p>

            <button
              type="button"
              onClick={handleNavigateToAgentBuilder}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold text-xs shadow-xl shadow-pink-500/25 flex items-center gap-2 transition-all cursor-pointer hover:scale-105 active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Criar meu primeiro agente</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="mt-4 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        ) : isChoosingAgent || !currentAgent ? (
          /* CASE 2: AGENT SELECTOR (User chooses which agent to chat with) */
          <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#FF6600]/15 text-[#FF6600] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Escolha um Agente</h3>
                  <p className="text-[11px] text-slate-400">Selecione com quem deseja conversar</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of Created Agents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {savedAgents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent)}
                  className="group p-3.5 rounded-2xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 hover:border-pink-500/60 transition-all cursor-pointer flex items-center gap-3.5 select-none"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-slate-700 group-hover:border-pink-400 shrink-0 transition-transform group-hover:scale-105">
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

                  <div className="flex-1 min-w-0 text-left">
                    <h4 className="text-xs font-bold text-white truncate group-hover:text-pink-300 transition-colors">
                      {agent.name}
                    </h4>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {agent.role}
                    </p>
                  </div>

                  <div className="shrink-0 px-2.5 py-1 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    Conversar
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom link to Construtor de Agentes */}
            <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                {savedAgents.length} de 5 agentes criados
              </span>
              <button
                type="button"
                onClick={handleNavigateToAgentBuilder}
                className="text-xs text-pink-400 hover:text-pink-300 font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Gerenciar Agentes</span>
              </button>
            </div>
          </div>
        ) : (
          /* CASE 3: ACTIVE AGENT CONVERSATION */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Header: Agent Identity + Switch Agent Action */}
            <div
              className={`px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0 ${
                isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-900/90 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full overflow-hidden border border-pink-500/50 shadow-xs">
                    <AgentAvatar
                      src={currentAgent.avatarUrl}
                      alt={currentAgent.name}
                      size="custom"
                      className="w-full h-full"
                      imgClassName="w-full h-full object-cover"
                      theme={isLight ? 'light' : 'dark'}
                      fallbackText="?"
                    />
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
                </div>

                <div className="min-w-0">
                  <h2
                    className={`font-bold text-sm tracking-tight truncate ${
                      isLight ? '!text-slate-900' : '!text-white'
                    }`}
                  >
                    {currentAgent.name}
                  </h2>
                  <p
                    className={`text-[11px] font-medium truncate ${
                      isLight ? '!text-slate-600' : '!text-slate-400'
                    }`}
                  >
                    {currentAgent.role}
                  </p>
                </div>
              </div>

              {/* Action buttons in header */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Switch Agent Button */}
                <button
                  type="button"
                  onClick={() => setIsChoosingAgent(true)}
                  title="Trocar agente"
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Trocar</span>
                </button>

                {/* Clear chat history */}
                <button
                  type="button"
                  onClick={handleClearHistory}
                  title="Limpar conversa deste agente"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 stroke-[1.75]" />
                </button>

                {/* Close drawer */}
                <button
                  type="button"
                  onClick={onClose}
                  title="Fechar"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} animate-in fade-in duration-150`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm break-words whitespace-pre-wrap ${
                        isUser
                          ? 'bg-gradient-to-r from-[#FF6600] to-orange-500 text-white rounded-br-xs'
                          : isLight
                          ? 'bg-slate-100 text-slate-900 rounded-bl-xs border border-slate-200'
                          : 'bg-slate-900 text-slate-100 rounded-bl-xs border border-slate-800'
                      }`}
                    >
                      <CondoMarkdown content={msg.content} />
                    </div>

                    {!isUser && msg.results && msg.results.length > 0 && (
                      <div className="max-w-[85%] w-full">
                        <CondoResultRenderer
                          results={msg.results}
                          onShowHelpTarget={handleShowHelpTarget}
                        />
                      </div>
                    )}
                    <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-slate-300 text-xs w-max shadow-sm">
                  <DrawerProcessingIndicator agentName={currentAgent?.name} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/60">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-2xl px-3 py-1.5 focus-within:border-pink-500/60 transition-colors"
              >
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={1}
                  placeholder={`Converse com ${currentAgent.name}...`}
                  className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 resize-none outline-hidden max-h-24 py-1"
                />
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isLoading}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                >
                  Enviar
                </button>
              </form>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
