import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../lib/themeContext.tsx';
import { useCRM } from '../../lib/crmStore.tsx';
import type { UserProfile } from '../../App.tsx';
import type { CondoMessage } from './condoTypes.ts';
import { sendCondoMessage, type ActionContext } from './condoService.ts';
import CondoResultRenderer from './CondoResultRenderer.tsx';
import CondoMarkdown from './CondoMarkdown.tsx';
import { showHelpTarget } from '../../lib/spotlightHelper.ts';

interface CondoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: UserProfile | null;
  onOpenLead?: (leadId: string) => void;
  onOpenFollowUp?: (leadId?: string) => void;
  currentPath?: string;
  navigate?: (path: string) => void;
}

const CONDO_AVATAR_URL = 'http://adm.triveruscondo.com/wp-content/uploads/2026/10/Avatar-condo-webp.webp';

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

  const [messages, setMessages] = useState<CondoMessage[]>(() => {
    return [
      {
        id: 'msg_welcome',
        role: 'assistant',
        content: `Olá **${currentProfile?.full_name?.split(' ')[0] || 'Gestor'}**! Sou o **Condo**, o especialista de consulta do CRM e guia da Triverus.\n\nComo posso te ajudar agora?`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
    ];
  });

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Focus input when opened or when Condo finishes responding
  useEffect(() => {
    if (isOpen && !isLoading) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isLoading]);

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

  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend || inputValue).trim();
    if (!prompt || isLoading) return;

    const userMsg: CondoMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
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
      const response = await sendCondoMessage(prompt, [...messages, userMsg], actionCtx);

      const assistantMsg: CondoMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: response.text,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        actionsExecuted: response.actions,
        results: response.results,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: CondoMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Desculpe, não consegui processar a consulta: ${err?.message || 'Erro de conexão'}.`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: `msg_welcome_${Date.now()}`,
        role: 'assistant',
        content: `Histórico limpo. Como posso te ajudar agora?`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setTimeout(() => inputRef.current?.focus(), 80);
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
      {/* Backdrop overlay: clicking outside the Condo drawer closes it */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-950/30 sm:bg-slate-950/20 transition-opacity animate-in fade-in duration-200 cursor-pointer"
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] flex flex-col shadow-2xl transition-transform duration-300 border-l ${
          isLight
            ? 'bg-white/98 border-slate-200 text-slate-900 backdrop-blur-2xl'
            : 'bg-slate-950/98 border-slate-800 text-slate-100 backdrop-blur-2xl'
        }`}
      >
        {/* Header - Simple, clean and elegant */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-900/90 border-slate-800'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <img
                src={CONDO_AVATAR_URL}
                alt="Condo Avatar"
                className="w-10 h-10 rounded-full object-cover border border-[#FF6600]/40 shadow-xs"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  if (target.nextElementSibling) {
                    (target.nextElementSibling as HTMLElement).style.display = 'flex';
                  }
                }}
              />
              <div className="hidden w-10 h-10 rounded-full bg-[#FF6600] text-white items-center justify-center font-bold text-sm">
                🤖
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900" />
            </div>

            <div className="min-w-0">
              <h2
                className={`font-bold text-base tracking-tight truncate ${
                  isLight ? '!text-slate-900' : '!text-white'
                }`}
              >
                Condo
              </h2>
              <p
                className={`text-xs font-semibold truncate ${
                  isLight ? '!text-slate-600' : '!text-slate-400'
                }`}
              >
                A inteligência da Triverus
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleClearHistory}
              title="Limpar conversa"
              className={`p-2 rounded-xl text-xs transition-colors cursor-pointer ${
                isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Fechar painel"
              className={`p-2 rounded-xl text-xs transition-colors cursor-pointer ${
                isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages List Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs sm:text-sm">
          {messages.map((msg) => {
            const isAssistant = msg.role === 'assistant';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
              >
                <div className="flex items-start gap-2.5 max-w-[92%]">
                  {isAssistant && (
                    <img
                      src={CONDO_AVATAR_URL}
                      alt="Condo"
                      className="w-7 h-7 rounded-full object-cover border border-[#FF6600]/30 shrink-0 mt-0.5"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  )}

                  <div
                    className={`rounded-2xl px-4 py-3 shadow-xs ${
                      isAssistant
                        ? isLight
                          ? 'bg-slate-100/90 text-slate-900 border border-slate-200/90 rounded-tl-sm'
                          : 'bg-slate-800/90 text-slate-100 border border-slate-700/70 rounded-tl-sm'
                        : 'bg-[#FF6600] text-white rounded-tr-sm shadow-[#FF6600]/25'
                    }`}
                  >
                    <CondoMarkdown content={msg.content} className="condo-markdown" />

                    {/* Rich Results Component */}
                    {isAssistant && msg.results && msg.results.length > 0 && (
                      <CondoResultRenderer
                        results={msg.results}
                        onOpenLead={(leadId) => {
                          onClose();
                          if (onOpenLead) onOpenLead(leadId);
                        }}
                        onOpenFollowUp={(leadId) => {
                          onClose();
                          if (onOpenFollowUp) onOpenFollowUp(leadId);
                        }}
                        onShowHelpTarget={handleShowHelpTarget}
                      />
                    )}

                    <div
                      className={`text-[10px] mt-2 text-right select-none ${
                        isAssistant
                          ? isLight
                            ? 'text-slate-500'
                            : 'text-slate-400'
                          : 'text-white/80'
                      }`}
                    >
                      {msg.timestamp}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing Indicator */}
          {isLoading && (
            <div className="flex items-center gap-2.5">
              <img
                src={CONDO_AVATAR_URL}
                alt="Condo"
                className="w-7 h-7 rounded-full object-cover border border-[#FF6600]/30 shrink-0"
              />
              <div
                className={`px-4 py-2.5 rounded-2xl text-xs flex items-center gap-2 ${
                  isLight ? 'bg-slate-100 text-slate-800 border border-slate-200' : 'bg-slate-800 text-slate-200 border border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#FF6600] rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-[#FF6600] rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-[#FF6600] rounded-full animate-bounce" />
                </div>
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  ... Condo está pensando
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input Box */}
        <div
          className={`p-4 border-t shrink-0 ${
            isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-900/90 border-slate-800'
          }`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="relative flex items-center"
          >
            <div
              className={`w-full flex items-center gap-2 rounded-2xl px-3.5 py-1.5 transition-all shadow-sm ${
                isLight
                  ? 'bg-white border border-slate-300 focus-within:border-[#FF6600] focus-within:ring-2 focus-within:ring-[#FF6600]/20'
                  : 'bg-slate-800/90 border border-slate-700 focus-within:border-[#FF6600] focus-within:ring-2 focus-within:ring-[#FF6600]/30'
              }`}
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
                placeholder="Pergunte qualquer coisa..."
                rows={1}
                disabled={isLoading}
                className={`flex-1 max-h-28 min-h-[38px] py-2 text-xs sm:text-sm bg-transparent resize-none focus:outline-hidden leading-relaxed ${
                  isLight
                    ? 'text-slate-900 placeholder:text-slate-400'
                    : 'text-slate-100 placeholder:text-slate-500'
                }`}
              />

              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                aria-label="Enviar mensagem"
                className={`w-9 h-9 rounded-xl font-semibold flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                  inputValue.trim() && !isLoading
                    ? 'bg-[#FF6600] hover:bg-[#e65c00] text-white shadow-md shadow-[#FF6600]/30 active:scale-90'
                    : isLight
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-700/60 text-slate-500 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </form>

          <div className="mt-2 text-center text-[11px] text-slate-400 px-1">
            <span>Pressione <strong className="text-slate-200 font-bold">Enter ↵</strong> para enviar</span>
          </div>
        </div>
      </aside>
    </>
  );
}

export default CondoDrawer;
