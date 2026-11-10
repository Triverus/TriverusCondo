import React, { useRef, useEffect } from 'react';
import type { Lead } from '../lib/crmStore.tsx';
import {
  CANONICAL_CATEGORIES,
  GoogleDriveLogoSvg,
  OwlIcon,
  SparklesIcon,
  BookmarkIcon,
  formatBytes,
  formatDate,
  type LinkedDocument,
  type FolderLink,
  type AuditoriaMemory,
} from './AuditoriaModule.tsx';
import { FolderIcon } from './PipelineComponents.tsx';
import { Sparkles } from 'lucide-react';
import type { AgentSlotData } from '../types/agentBuilder.ts';
import SafeAgentMarkdown from './SafeAgentMarkdown.tsx';
import CondoResultRenderer from './CondoAssistant/CondoResultRenderer.tsx';
import { AgentAvatar } from './ui/AgentAvatar.tsx';

export interface AuditoriaPopupProps {
  selectedCondo: Lead;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  activeStageId: string;
  onSelectStage: (stageId: string) => void;
  activeRightTab: 'ia' | 'documentos' | 'memorias';
  onSelectRightTab: (tab: 'ia' | 'documentos' | 'memorias') => void;
  linkedDocuments: Record<string, LinkedDocument[]>;
  folderLinks: Record<string, FolderLink>;
  analysesMap: Record<string, any>;
  isLoadingDocuments: boolean;
  syncingCategory: string | null;
  isStreamingFile: boolean;
  canManage: boolean;
  onOpenLinkFolderModal: (catId: string) => void;
  onOpenVincularModal: (catId: string) => void;
  onOpenUnlinkFolderModal: (catId: string, folder: FolderLink) => void;
  onRequestUnlinkDoc: (catId: string, doc: LinkedDocument) => void;
  onViewPdf: (fileId: string) => void;
  onSyncFolder: (catId: string, folderId: string) => void;
  onOpenAnalysis: (catId: string, doc?: LinkedDocument) => void;
  chatMessagesByStage: Record<string, Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string; results?: any[] }>>;
  chatInput: string;
  onChatInputChange: (val: string) => void;
  onSendChatMessage: () => void;
  isSendingChatMessage: boolean;
  isPlusMenuOpen: boolean;
  onTogglePlusMenu: () => void;
  onOpenAgentModal: () => void;
  assignedAgent?: AgentSlotData | null;
  memoriesList: AuditoriaMemory[];
  isLoadingMemories: boolean;
  extractingMemoryId: string | null;
  isBatchExecutingMemories?: boolean;
  onBatchExecuteMemories?: () => void;
  onOpenAddMemoryModal: () => void;
  onOpenEditMemoryModal: (memory: AuditoriaMemory) => void;
  onOpenDeleteMemoryModal: (memory: AuditoriaMemory) => void;
  onExecuteMemory: (memoryId: string) => void;
  onSetFeedbackMessage: (msg: string) => void;
}

function AssistantAvatar({
  className = 'w-8 h-8',
  avatarUrl,
  agentName,
}: {
  className?: string;
  avatarUrl?: string;
  agentName?: string;
}) {
  if (avatarUrl) {
    return (
      <AgentAvatar
        src={avatarUrl}
        alt={agentName || 'Agente de IA'}
        size="custom"
        className={`${className} border border-[#FF6600]/40 shrink-0 shadow-xs`}
        imgClassName="w-full h-full object-cover"
        theme="dark"
        fallbackText="AI"
      />
    );
  }
  return (
    <div className={`${className} rounded-full bg-[#242428] border border-[#303034] flex items-center justify-center shrink-0 text-[#FF6600]`}>
      <Sparkles className="w-4 h-4" />
    </div>
  );
}

function DynamicProcessingIndicator({ agentName }: { agentName?: string }) {
  const STAGES = [
    'Consultando registros no CRM...',
    'Cruzando informações...',
    'Organizando resposta...',
    'Processando sua solicitação...',
  ];
  const [stageIndex, setStageIndex] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-2 h-2 rounded-full bg-[#FF6600] animate-ping shrink-0" />
      <span className="animate-in fade-in duration-300">
        {agentName ? `${agentName}: ` : ''}{STAGES[stageIndex]}
      </span>
    </div>
  );
}

export default function AuditoriaPopup({
  selectedCondo,
  isFullscreen,
  onToggleFullscreen,
  onClose,
  activeStageId,
  onSelectStage,
  activeRightTab,
  onSelectRightTab,
  linkedDocuments,
  folderLinks,
  analysesMap,
  isLoadingDocuments,
  syncingCategory,
  isStreamingFile,
  canManage,
  onOpenLinkFolderModal,
  onOpenVincularModal,
  onOpenUnlinkFolderModal,
  onRequestUnlinkDoc,
  onViewPdf,
  onSyncFolder,
  onOpenAnalysis,
  chatMessagesByStage,
  chatInput,
  onChatInputChange,
  onSendChatMessage,
  isSendingChatMessage,
  isPlusMenuOpen,
  onTogglePlusMenu,
  onOpenAgentModal,
  assignedAgent,
  memoriesList,
  isLoadingMemories,
  extractingMemoryId,
  isBatchExecutingMemories = false,
  onBatchExecuteMemories,
  onOpenAddMemoryModal,
  onOpenEditMemoryModal,
  onOpenDeleteMemoryModal,
  onExecuteMemory,
  onSetFeedbackMessage,
}: AuditoriaPopupProps) {
  const activeStage = CANONICAL_CATEGORIES.find((c) => c.id === activeStageId) || CANONICAL_CATEGORIES[0];
  const activeStageDocs = linkedDocuments[activeStageId] || [];
  const activeStageFolder = folderLinks[activeStageId];
  const stageMessages = chatMessagesByStage[activeStageId] || [];
  const hasDocsInStage = activeStageDocs.length > 0;

  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Status visual da etapa (Pendente, Com documento, Não verificada)
  const getStageStatus = (stageId: string): 'pendente' | 'com_documento' | 'nao_verificada' => {
    if (isLoadingDocuments && (!linkedDocuments || Object.keys(linkedDocuments).length === 0)) {
      return 'nao_verificada';
    }
    const docs = linkedDocuments[stageId] || [];
    const folder = folderLinks[stageId];
    if (docs.length > 0 || folder) {
      return 'com_documento';
    }
    return 'pendente';
  };

  return (
    <div
      className={`bg-[#141418] border border-[#303034] shadow-2xl flex flex-col md:flex-row overflow-hidden relative transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none w-full h-full'
          : 'w-full max-w-[1440px] h-[92vh] max-h-[920px] rounded-3xl'
      }`}
    >
      {/* ===================================================================
          COLUNA ESQUERDA: SETE ETAPAS (Aprox. 40% da largura no desktop)
          =================================================================== */}
      <div className="w-full md:w-[380px] lg:w-[420px] shrink-0 border-b md:border-b-0 md:border-r border-[#303034] bg-[#242428] flex flex-col overflow-hidden">
        {/* Lista das 7 Etapas com linha vertical conectora e numeração circular */}
        <div className="p-3.5 md:p-4.5 overflow-y-auto flex-1 flex flex-col justify-between relative">
          {/* Linha vertical conectando os números do primeiro ao último */}
          <div className="absolute left-[30px] md:left-[34px] top-7 bottom-7 w-0.5 bg-[#3f3f46] pointer-events-none z-0" />

          {CANONICAL_CATEGORIES.map((cat, index) => {
            const stepNumber = index + 1;
            const isSelected = activeStageId === cat.id;
            const docs = linkedDocuments[cat.id] || [];
            const status = getStageStatus(cat.id);

            return (
              <div
                key={cat.id}
                onClick={() => onSelectStage(cat.id)}
                className="relative z-10 flex items-center gap-3 cursor-pointer group"
              >
                {/* Numeração circular */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                    isSelected
                      ? 'bg-[#FF6600] text-white shadow-lg shadow-orange-500/35 ring-2 ring-[#FF6600]/40 scale-105'
                      : 'bg-[#303034] border border-[#3f3f46] text-slate-400 group-hover:border-slate-400 group-hover:text-slate-200'
                  }`}
                >
                  {stepNumber}
                </div>

                {/* Card escuro da etapa */}
                <div
                  className={`flex-1 rounded-2xl py-2 px-3 md:py-2.5 md:px-3.5 transition-all duration-150 flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#303034] border border-[#FF6600] ring-1 ring-[#FF6600]/40 shadow-md shadow-orange-500/10'
                      : 'bg-[#303034]/80 border border-[#3f3f46]/80 hover:border-slate-500 hover:bg-[#303034]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`text-xs md:text-sm font-bold truncate transition-colors ${
                        isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
                      }`}
                    >
                      {cat.name}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate leading-tight">
                      {cat.description}
                    </p>
                  </div>

                  {/* Indicador de status alinhado à direita */}
                  <div className="shrink-0 flex items-center pl-1">
                    {status === 'pendente' && (
                      <div title="Pendente: nenhum documento associado">
                        <svg className="w-4 h-4 md:w-5 md:h-5 text-amber-500/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                    )}
                    {status === 'com_documento' && (
                      <div title={`Com documento: ${docs.length} arquivo(s) associado(s)`}>
                        <svg className="w-4 h-4 md:w-5 md:h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {status === 'nao_verificada' && (
                      <div title="Não verificada: dados pendentes de validação">
                        <svg className="w-4 h-4 md:w-5 md:h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================================================================
          PAINEL PRINCIPAL À DIREITA (Aprox. 60% da largura no desktop)
          =================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#141418] overflow-hidden relative">
        {/* CABEÇALHO DO PAINEL DIREITO: ORDEM IA -> MEMÓRIA -> PASTAS */}
        <div className="px-5 py-3.5 border-b border-[#303034] flex items-center justify-between gap-3 bg-[#242428] backdrop-blur-xs shrink-0">
          {/* Botões de Modo: IA, Memória e Pastas */}
          <div className="flex items-center gap-2">
            {/* 1. Botão de IA com ícone de brilho */}
            <button
              type="button"
              disabled={!hasDocsInStage}
              onClick={() => {
                if (hasDocsInStage) onSelectRightTab('ia');
              }}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                activeRightTab === 'ia' && hasDocsInStage
                  ? 'bg-gradient-to-br from-amber-500 to-[#FF6600] text-white shadow-lg shadow-orange-500/25 ring-1 ring-orange-400/40 cursor-pointer'
                  : !hasDocsInStage
                  ? 'bg-[#303034]/50 border border-[#3f3f46]/60 text-slate-600 opacity-40 cursor-not-allowed'
                  : 'bg-[#303034] border border-[#3f3f46] text-slate-400 hover:text-white hover:bg-[#3f3f46] cursor-pointer'
              }`}
              title={hasDocsInStage ? 'Assistente de IA' : 'IA desabilitada: nenhum PDF disponível nesta etapa'}
            >
              <SparklesIcon className="w-5 h-5" />
            </button>

            {/* 2. Botão de Memória com ícone de marcador */}
            <button
              type="button"
              onClick={() => onSelectRightTab('memorias')}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all cursor-pointer ${
                activeRightTab === 'memorias'
                  ? 'bg-gradient-to-br from-amber-500 to-[#FF6600] text-white shadow-lg shadow-orange-500/25 ring-1 ring-orange-400/40'
                  : 'bg-[#303034] border border-[#3f3f46] text-slate-400 hover:text-white hover:bg-[#3f3f46]'
              }`}
              title="Memórias da Auditoria"
            >
              <BookmarkIcon className="w-5 h-5" />
            </button>

            {/* 3. Botão de Pastas com ícone de pasta */}
            <button
              type="button"
              onClick={() => onSelectRightTab('documentos')}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all cursor-pointer ${
                activeRightTab === 'documentos'
                  ? 'bg-gradient-to-br from-amber-500 to-[#FF6600] text-white shadow-lg shadow-orange-500/25 ring-1 ring-orange-400/40'
                  : 'bg-[#303034] border border-[#3f3f46] text-slate-400 hover:text-white hover:bg-[#3f3f46]'
              }`}
              title="Acervo de Documentos e Pastas"
            >
              <FolderIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Controles da direita: Tela Cheia e Fechar */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="w-9 h-9 rounded-2xl text-slate-400 hover:text-white hover:bg-[#303034] flex items-center justify-center transition-colors cursor-pointer"
              title={isFullscreen ? 'Sair da tela cheia' : 'Expandir para tela cheia'}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0h5m-5 0v5m11-5l5 5m0-5h-5m5 0v5m-5 11l5-5m0 5h-5m5 0v-5m-11 5l-5-5m0 5h5m-5 0v-5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-2xl text-slate-400 hover:text-white hover:bg-[#303034] flex items-center justify-center transition-colors cursor-pointer"
              title="Fechar popup e voltar aos condomínios"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* CONTEÚDO PRINCIPAL: MODOS (IA / DOCUMENTOS / MEMÓRIAS) */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* -------------------------------------------------------------
              MODO 1: PAINEL DE IA
              ------------------------------------------------------------- */}
          {activeRightTab === 'ia' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* ESTADO DE IA DESABILITADA (SEM DOCUMENTOS NA ETAPA) */}
              {!hasDocsInStage ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center overflow-y-auto animate-in fade-in duration-150">
                  {/* Ícone do Google Drive em destaque dentro de superfície escura */}
                  <div className="w-24 h-24 rounded-2xl bg-[#242428] border border-[#303034] flex items-center justify-center shadow-xl shadow-black/20 mb-6">
                    <GoogleDriveLogoSvg className="w-12 h-12" />
                  </div>

                  {/* Título */}
                  <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight mb-2.5">
                    {activeStageFolder ? 'Nenhum PDF sincronizado nesta pasta' : 'Vincule a pasta de documentos'}
                  </h2>

                  {/* Texto contextual explicando a etapa selecionada */}
                  <p className="text-xs md:text-sm text-slate-400 max-w-md text-center leading-relaxed mb-7">
                    {activeStageFolder ? (
                      <>
                        A pasta <strong className="text-slate-100 font-semibold">{activeStageFolder.drive_folder_name}</strong> está vinculada, mas não possui documentos PDF sincronizados para análise.
                      </>
                    ) : (
                      <>
                        Para começar a analisar{' '}
                        <strong className="text-slate-100 font-semibold">
                          {activeStage.name === 'Convenção'
                            ? 'a Convenção do condomínio'
                            : activeStage.name === 'Regimento Interno'
                            ? 'o Regimento Interno'
                            : activeStage.name === 'Prestação de contas'
                            ? 'a Prestação de contas'
                            : activeStage.name === 'Previsão Orçamentária'
                            ? 'a Previsão Orçamentária'
                            : `os documentos de ${activeStage.name}`}
                        </strong>
                        , vincule a pasta correspondente no Google Drive.
                      </>
                    )}
                  </p>

                  {/* Botões de Ação para Vincular/Sincronizar */}
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    {activeStageFolder ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onSyncFolder(activeStageId, activeStageFolder.drive_folder_id)}
                          disabled={syncingCategory === activeStageId}
                          className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#FF6600] to-[#ff5000] hover:from-[#ff7711] hover:to-[#ff6600] active:scale-[0.99] text-white font-bold text-sm tracking-wider uppercase transition-all duration-150 cursor-pointer flex items-center gap-3 shadow-lg shadow-orange-500/30 disabled:opacity-50"
                        >
                          <svg className={`w-5 h-5 ${syncingCategory === activeStageId ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>{syncingCategory === activeStageId ? 'SINCRONIZANDO...' : 'SINCRONIZAR PASTA'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenLinkFolderModal(activeStageId)}
                          className="px-6 py-3.5 rounded-2xl bg-[#303034] hover:bg-[#3f3f46] text-slate-200 font-bold text-xs tracking-wider uppercase transition-all cursor-pointer border border-[#3f3f46]"
                        >
                          TROCAR PASTA
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenLinkFolderModal(activeStageId)}
                        className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#FF6600] to-[#ff5000] hover:from-[#ff7711] hover:to-[#ff6600] active:scale-[0.99] text-white font-bold text-sm tracking-wider uppercase transition-all duration-150 cursor-pointer flex items-center gap-3 shadow-lg shadow-orange-500/30"
                      >
                        <GoogleDriveLogoSvg className="w-5 h-5" />
                        <span>VINCULAR DOCUMENTOS</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* ESTADO COM DOCUMENTOS DISPONÍVEIS NA IA */
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* Área com rolagem de mensagens conversacionais */}
                  <div className="flex-1 p-5 overflow-y-auto space-y-4">
                    {/* Mensagem inicial curta e contextual do assistente */}
                    {stageMessages.length === 0 && (
                      <div className="flex items-start gap-3 max-w-[85%]">
                        <AssistantAvatar
                          className="w-8 h-8"
                          avatarUrl={assignedAgent?.avatarUrl}
                          agentName={assignedAgent?.name}
                        />
                        <div className="bg-[#303034] border border-[#3f3f46] rounded-2xl rounded-tl-xs p-4 text-xs md:text-sm text-slate-200 leading-relaxed">
                          <p>
                            {assignedAgent ? (
                              <>
                                Olá! Sou <strong>{assignedAgent.name}</strong> ({assignedAgent.role}). Identifiquei {activeStageDocs.length} {activeStageDocs.length === 1 ? 'documento' : 'documentos'} nesta etapa de <strong>{activeStage.name}</strong>. Como posso te apoiar na auditoria?
                              </>
                            ) : (
                              <>
                                Oi, identifiquei {activeStageDocs.length} {activeStageDocs.length === 1 ? 'documento' : 'documentos'} nessa etapa. Como eu posso te ajudar?
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Histórico de mensagens trocadas */}
                    {stageMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start items-start gap-3'}`}
                      >
                        {msg.role === 'assistant' && (
                          <AssistantAvatar
                            className="w-8 h-8"
                            avatarUrl={assignedAgent?.avatarUrl}
                            agentName={assignedAgent?.name}
                          />
                        )}
                        <div className="flex flex-col max-w-[85%] gap-2">
                          <div
                            className={`p-4 rounded-2xl text-xs md:text-sm leading-relaxed ${
                              msg.role === 'user'
                                ? 'bg-[#242428] border border-[#303034] text-white rounded-tr-xs ml-auto shadow-md'
                                : 'bg-[#303034] border border-[#3f3f46] text-slate-200 rounded-tl-xs'
                            }`}
                          >
                            {msg.role === 'assistant' ? (
                              <SafeAgentMarkdown content={msg.content} />
                            ) : (
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                            <span className="block text-[10px] text-slate-400 text-right mt-1.5">
                              {msg.timestamp}
                            </span>
                          </div>

                          {msg.role === 'assistant' && msg.results && msg.results.length > 0 && (
                            <CondoResultRenderer results={msg.results} />
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Indicador de processamento da IA com etapas dinâmicas */}
                    {isSendingChatMessage && (
                      <div className="flex items-start gap-3">
                        <AssistantAvatar
                          className="w-8 h-8"
                          avatarUrl={assignedAgent?.avatarUrl}
                          agentName={assignedAgent?.name}
                        />
                        <div className="bg-[#303034] border border-[#3f3f46] rounded-2xl rounded-tl-xs p-3.5 text-xs text-slate-300 flex items-center gap-2 shadow-sm">
                          <DynamicProcessingIndicator agentName={assignedAgent?.name} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* BARRA DE MENSAGEM FIXA NA PARTE INFERIOR (Comum a ambos os estados de IA) */}
              <div className="p-4 border-t border-[#303034] bg-[#242428] shrink-0">
                <div className="relative flex items-center gap-2 bg-[#303034] border border-[#3f3f46] rounded-2xl p-2">
                  {/* Backdrop invisível para fechar menu ao clicar fora */}
                  {isPlusMenuOpen && (
                    <div
                      className="fixed inset-0 z-20"
                      onClick={onTogglePlusMenu}
                    />
                  )}

                  {/* Menu suspenso do botão + (Somente "Escolher Agente") */}
                  {isPlusMenuOpen && (
                    <div
                      ref={plusMenuRef}
                      className="absolute bottom-14 left-0 w-52 bg-[#242428] border border-[#303034] rounded-2xl shadow-2xl py-1.5 z-30 animate-in fade-in zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onTogglePlusMenu();
                          onOpenAgentModal();
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-200 hover:text-white hover:bg-[#303034] flex items-center gap-3 transition-colors cursor-pointer rounded-xl"
                      >
                        <Sparkles className="w-4 h-4 text-[#FF6600]" />
                        <span>{assignedAgent ? 'Trocar / Desvincular Agente' : 'Escolher Agente'}</span>
                      </button>
                    </div>
                  )}

                  {/* Botão + */}
                  <button
                    type="button"
                    onClick={onTogglePlusMenu}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                      isPlusMenuOpen
                        ? 'bg-[#FF6600] text-white'
                        : 'bg-[#303034] text-slate-300 hover:text-white hover:bg-[#3f3f46]'
                    }`}
                    title="Opções de Agente"
                  >
                    <span className="text-xl font-medium leading-none">+</span>
                  </button>

                  {/* Campo de texto */}
                  <input
                    type="text"
                    value={chatInput}
                    disabled={!hasDocsInStage}
                    onChange={(e) => onChatInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && hasDocsInStage) {
                        e.preventDefault();
                        onSendChatMessage();
                      }
                    }}
                    placeholder={
                      hasDocsInStage
                        ? "Envie uma mensagem para o assistente..."
                        : "Vincule ao menos um PDF para conversar com o assistente..."
                    }
                    className={`flex-1 bg-transparent text-xs md:text-sm text-slate-100 placeholder-slate-500 focus:outline-none px-2 ${
                      !hasDocsInStage ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  />

                  {/* Botão de envio */}
                  <button
                    type="button"
                    onClick={onSendChatMessage}
                    disabled={!hasDocsInStage || !chatInput.trim() || isSendingChatMessage}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                      hasDocsInStage && chatInput.trim() && !isSendingChatMessage
                        ? 'bg-[#FF6600] text-white hover:bg-[#ff7711] shadow-md shadow-orange-500/20 cursor-pointer'
                        : 'bg-[#303034] text-slate-500 hover:text-slate-400 cursor-not-allowed'
                    }`}
                    title="Enviar mensagem"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------
              MODO 2: PAINEL DE DOCUMENTOS (Acessado via "Ver Pastas")
              ------------------------------------------------------------- */}
          {activeRightTab === 'documentos' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-5 md:p-6 space-y-5 animate-in fade-in duration-150">
              {/* Topo do painel de documentos com retorno à IA */}
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#303034]">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <span>Documentos</span>
                    <span>·</span>
                    <span className="text-[#FF6600]">{activeStage.name}</span>
                  </div>
                  <h2 className="text-base font-bold text-white tracking-tight mt-0.5">
                    Acervo do Google Drive
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectRightTab('ia')}
                  className="px-3 py-1.5 rounded-xl bg-[#303034] hover:bg-[#3f3f46] border border-[#3f3f46] text-slate-200 hover:text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <SparklesIcon className="w-3.5 h-3.5 text-[#FF6600]" />
                  <span>Voltar ao Assistente</span>
                </button>
              </div>

              {/* Vínculo de Pasta da Etapa Atual */}
              {activeStageFolder ? (
                <div className="p-4 bg-[#242428] border border-emerald-500/40 rounded-2xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                        <GoogleDriveLogoSvg className="w-6 h-6" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                          Pasta Vinculada no Google Drive
                        </span>
                        <h3 className="text-sm font-bold text-white truncate max-w-sm">
                          {activeStageFolder.drive_folder_name}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {activeStageDocs.length} PDF(s) sincronizados
                          {activeStageFolder.last_synced_at && ` · Sincronizado em ${formatDate(activeStageFolder.last_synced_at)}`}
                        </p>
                      </div>
                    </div>

                    {/* Ações de gerenciamento da pasta vinculada */}
                    {canManage && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onSyncFolder(activeStageId, activeStageFolder.drive_folder_id)}
                          disabled={syncingCategory === activeStageId}
                          className="px-3 py-1.5 rounded-xl bg-[#303034] hover:bg-[#3f3f46] text-slate-200 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 border border-[#3f3f46] disabled:opacity-50"
                        >
                          <svg className={`w-3.5 h-3.5 text-[#FF6600] ${syncingCategory === activeStageId ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>{syncingCategory === activeStageId ? 'Sincronizando...' : 'Sincronizar'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenLinkFolderModal(activeStageId)}
                          className="px-3 py-1.5 rounded-xl bg-[#303034] hover:bg-[#3f3f46] text-slate-200 text-xs font-semibold cursor-pointer transition-colors border border-[#3f3f46]"
                        >
                          Trocar pasta
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenUnlinkFolderModal(activeStageId, activeStageFolder)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold cursor-pointer transition-colors"
                        >
                          Desvincular
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Estado sem pasta vinculada na aba documentos */
                <div className="p-5 bg-[#242428] border border-[#303034] rounded-2xl flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#303034] text-[#FF6600] flex items-center justify-center shrink-0">
                      <GoogleDriveLogoSvg className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Nenhuma pasta vinculada a esta etapa</h3>
                      <p className="text-xs text-slate-400">
                        Vincule uma pasta do Google Drive para sincronizar automaticamente os PDFs da fase {activeStage.name}.
                      </p>
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onOpenLinkFolderModal(activeStageId)}
                      className="px-4 py-2 rounded-xl bg-[#FF6600] hover:bg-[#ff7711] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-2 shadow-md shadow-orange-500/20"
                    >
                      <GoogleDriveLogoSvg className="w-4 h-4" />
                      <span>Vincular Pasta</span>
                    </button>
                  )}
                </div>
              )}

              {/* Lista dos Documentos PDFs da Etapa */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Documentos da Etapa ({activeStageDocs.length})
                  </h3>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onOpenVincularModal(activeStageId)}
                      className="text-xs font-semibold text-[#FF6600] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <span>+ Vincular PDF avulso</span>
                    </button>
                  )}
                </div>

                {activeStageDocs.length === 0 ? (
                  <div className="p-8 text-center bg-[#242428]/80 border border-[#303034] rounded-2xl text-xs text-slate-400">
                    Nenhum documento PDF vinculado a esta etapa.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeStageDocs.map((doc) => (
                      <div
                        key={doc.id || doc.drive_file_id}
                        className="p-3.5 bg-[#303034] border border-[#3f3f46] rounded-2xl flex items-center justify-between gap-3 hover:border-slate-500 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                            PDF
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-semibold text-white truncate" title={doc.drive_file_name}>
                              {doc.drive_file_name}
                            </h4>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {formatBytes(doc.drive_file_size)}
                              {doc.drive_file_modified_at && ` · ${formatDate(doc.drive_file_modified_at)}`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onViewPdf(doc.drive_file_id)}
                            disabled={isStreamingFile}
                            className="px-2.5 py-1.5 rounded-lg bg-[#242428] hover:bg-[#3f3f46] border border-[#3f3f46] text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                            title="Visualizar documento PDF"
                          >
                            Visualizar
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenAnalysis(activeStageId, doc)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <SparklesIcon className="w-3 h-3" />
                            <span>{analysesMap[activeStageId] ? 'Ver Análise' : 'Analisar'}</span>
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => onRequestUnlinkDoc(activeStageId, doc)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-[#242428] transition-colors cursor-pointer"
                              title="Desvincular este documento"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------
              MODO 3: PAINEL DE MEMÓRIAS FUNCIONAIS
              ------------------------------------------------------------- */}
          {activeRightTab === 'memorias' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-5 md:p-6 space-y-5 animate-in fade-in duration-150">
              {/* Cabeçalho do Painel de Memórias */}
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#303034]">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <span>Memórias da Auditoria</span>
                    <span>·</span>
                    <span className="text-[#FF6600]">{activeStage.name}</span>
                  </div>
                  <h2 className="text-base font-bold text-white tracking-tight mt-0.5">
                    Critérios e Inputs Personalizados
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  {canManage && (
                    <button
                      type="button"
                      onClick={onOpenAddMemoryModal}
                      className="px-3 py-1.5 rounded-xl bg-[#FF6600] hover:bg-[#ff7711] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-orange-500/20"
                    >
                      <span className="text-sm leading-none">+</span>
                      <span>Nova Memória</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectRightTab('ia')}
                    className="px-3 py-1.5 rounded-xl bg-[#303034] hover:bg-[#3f3f46] border border-[#3f3f46] text-slate-200 hover:text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <SparklesIcon className="w-3.5 h-3.5 text-[#FF6600]" />
                    <span>Voltar ao Chat</span>
                  </button>
                </div>
              </div>

              {/* Lista das Memórias da Etapa */}
              {isLoadingMemories ? (
                <div className="py-12 text-center space-y-3">
                  <div className="inline-block animate-spin w-7 h-7 border-2 border-[#FF6600] border-t-transparent rounded-full" />
                  <p className="text-xs text-slate-400">Carregando memórias da auditoria...</p>
                </div>
              ) : (() => {
                const stageMems = memoriesList.filter((m) => m.stage_id === activeStageId || m.stageId === activeStageId || m.category === activeStageId);
                const pendingAiMems = stageMems.filter(
                  (m) =>
                    (m.fill_mode === 'ai' || (!m.fill_mode && Boolean(m.instruction))) &&
                    m.status !== 'result_available' &&
                    Boolean(m.source_drive_file_id)
                );
                const uniquePendingDocs = Array.from(new Set(pendingAiMems.map((m) => m.source_drive_file_id))).length;

                if (stageMems.length === 0) {
                  return (
                    <div className="p-10 text-center bg-[#242428]/80 border border-[#303034] rounded-2xl space-y-4">
                      <div className="w-14 h-14 rounded-2xl bg-[#303034] border border-[#3f3f46] text-[#FF6600] flex items-center justify-center mx-auto shadow-md">
                        <BookmarkIcon className="w-7 h-7" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-sm font-bold text-white">Nenhuma memória cadastrada nesta etapa</h3>
                        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                          Crie um campo informando manualmente o valor desejado ou selecione um PDF para que a IA realize buscas sob demanda e registre o resultado para consultas futuras.
                        </p>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          onClick={onOpenAddMemoryModal}
                          className="px-5 py-2.5 rounded-xl bg-[#FF6600] hover:bg-[#ff7711] text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-2 shadow-lg shadow-orange-500/25"
                        >
                          <span className="text-base font-bold leading-none">+</span>
                          <span>Adicionar primeira memória</span>
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {/* Banner de Busca Agrupada por Documento (Batch Search) */}
                    {pendingAiMems.length > 0 && (
                      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-[#FF6600]/10 to-transparent border border-orange-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-orange-500/5 animate-in fade-in duration-200">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#FF6600]/15 border border-[#FF6600]/30 text-[#FF6600] flex items-center justify-center shrink-0 mt-0.5">
                            <SparklesIcon className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                                Busca Agrupada por Documento
                              </h3>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30">
                                {pendingAiMems.length} pendente{pendingAiMems.length > 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                              Você possui <strong className="text-white">{pendingAiMems.length}</strong> memórias pendentes, vinculadas a <strong className="text-white">{uniquePendingDocs}</strong> documento{uniquePendingDocs > 1 ? 's' : ''}. A IA fará <strong className="text-[#FF6600]">{uniquePendingDocs}</strong> execução{uniquePendingDocs > 1 ? 'ões' : ''} agrupada{uniquePendingDocs > 1 ? 's' : ''}.
                            </p>
                          </div>
                        </div>

                        {canManage && onBatchExecuteMemories && (
                          <button
                            type="button"
                            onClick={onBatchExecuteMemories}
                            disabled={isBatchExecutingMemories}
                            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-[#FF6600] hover:from-amber-400 hover:to-[#ff7711] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 shadow-md shadow-orange-500/20"
                          >
                            {isBatchExecutingMemories ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Executando busca agrupada...</span>
                              </>
                            ) : (
                              <>
                                <SparklesIcon className="w-3.5 h-3.5" />
                                <span>Buscar memórias pendentes</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {stageMems.map((mem) => {
                      const isManual = mem.fill_mode === 'manual';
                      const isExtracting = extractingMemoryId === mem.id;
                      const hasSourceFile = Boolean(mem.source_drive_file_id);
                      const sourceDoc = activeStageDocs.find((d) => d.drive_file_id === mem.source_drive_file_id);

                      return (
                        <div
                          key={mem.id}
                          className="p-4 bg-[#242428] border border-[#303034] rounded-2xl flex flex-col space-y-3 hover:border-slate-500/80 transition-all duration-150"
                        >
                          {/* Topo do Card de Memória */}
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Tag de Identificação de Modo */}
                                {isManual ? (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-400 border border-sky-500/30">
                                    Manual
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#FF6600]/15 text-[#FF6600] border border-[#FF6600]/30">
                                    IA
                                  </span>
                                )}

                                <h4 className="text-sm font-bold text-white tracking-tight truncate">
                                  {mem.label}
                                </h4>

                                {/* Badge de Status */}
                                {isManual ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                    <span>Preenchimento manual</span>
                                  </span>
                                ) : (
                                  <>
                                    {mem.status === 'never_searched' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#303034] text-slate-400 border border-[#3f3f46]">
                                        Nunca pesquisada
                                      </span>
                                    )}
                                    {mem.status === 'result_available' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span>Resultado disponível</span>
                                      </span>
                                    )}
                                    {mem.status === 'outdated' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                        Pode estar desatualizada
                                      </span>
                                    )}
                                    {mem.status === 'failed' && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                                        Falha na última busca
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* Instrução da IA (Apenas no modo IA) */}
                              {!isManual && mem.instruction && (
                                <p className="text-xs text-slate-300 leading-relaxed bg-[#303034] border border-[#3f3f46] rounded-xl p-2.5">
                                  <strong className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider mb-0.5">
                                    Instrução da IA:
                                  </strong>
                                  {mem.instruction}
                                </p>
                              )}
                            </div>

                            {/* Ações do Card */}
                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                              {/* Botão de Buscar com IA (Exclusivo do Modo IA) */}
                              {!isManual && canManage && (
                                <button
                                  type="button"
                                  onClick={() => onExecuteMemory(mem.id)}
                                  disabled={!hasSourceFile || isExtracting}
                                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                    !hasSourceFile
                                      ? 'bg-[#303034]/60 text-slate-500 border border-[#3f3f46]/60 cursor-not-allowed'
                                      : isExtracting
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 cursor-wait'
                                      : 'bg-gradient-to-r from-amber-500 to-[#FF6600] text-white shadow-md shadow-orange-500/20 hover:from-amber-400 hover:to-[#ff7711]'
                                  }`}
                                  title={
                                    hasSourceFile
                                      ? mem.status === 'result_available'
                                        ? 'Reanalisar com IA sob demanda'
                                        : 'Executar busca sob demanda por IA neste PDF'
                                      : 'Selecione um PDF de origem para buscar'
                                  }
                                >
                                  {isExtracting ? (
                                    <>
                                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      <span>Extraindo...</span>
                                    </>
                                  ) : (
                                    <>
                                      <SparklesIcon className="w-3.5 h-3.5" />
                                      <span>{mem.status === 'result_available' ? 'Reanalisar com IA' : 'Buscar com IA'}</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => onOpenEditMemoryModal(mem)}
                                  disabled={isExtracting}
                                  className="px-2.5 py-2 rounded-xl bg-[#303034] hover:bg-[#3f3f46] text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer border border-[#3f3f46]"
                                  title="Editar memória"
                                >
                                  Editar
                                </button>
                              )}

                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => onOpenDeleteMemoryModal(mem)}
                                  disabled={isExtracting}
                                  className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-[#303034] transition-colors cursor-pointer"
                                  title="Excluir memória"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Seção de Exibição do Valor / Resultado */}
                          {isManual ? (
                            <div className="pt-2 border-t border-[#303034] space-y-2">
                              <div className="bg-[#303034] border border-sky-900/30 rounded-xl p-3.5 space-y-1.5 text-xs text-slate-200">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 block">
                                    Valor Gravado Manualmente
                                  </span>
                                  {mem.updated_at && (
                                    <span className="text-[10px] text-slate-500">
                                      Atualizado em {formatDate(mem.updated_at)}
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap font-mono text-slate-100 text-xs leading-relaxed">
                                  {mem.manual_value || mem.last_result || 'Nenhum valor informado.'}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-2 border-t border-[#303034] space-y-2">
                              <div className="flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-400">Documento de Origem:</span>
                                  {mem.source_drive_file_name ? (
                                    <span className={`font-medium ${sourceDoc ? 'text-slate-200' : 'text-amber-400'} flex items-center gap-1`}>
                                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                      </svg>
                                      <span>{mem.source_drive_file_name}</span>
                                      {!sourceDoc && <span className="text-[10px] text-amber-400/90">(PDF desvinculado)</span>}
                                    </span>
                                  ) : (
                                    <span className="text-amber-400 font-medium">Nenhum PDF selecionado</span>
                                  )}
                                </div>

                                {mem.last_executed_at && (
                                  <span className="text-[10px] text-slate-500">
                                    Última busca: {formatDate(mem.last_executed_at)} às {new Date(mem.last_executed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>

                              {/* Superfície do Resultado Armazenado da IA */}
                              <div className="bg-[#303034] border border-[#3f3f46] rounded-xl p-3.5 space-y-1.5 text-xs text-slate-200">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                  Resultado Armazenado (Persistido)
                                </span>
                                {mem.last_result ? (
                                  <div className="space-y-1.5 leading-relaxed">
                                    <p className="whitespace-pre-wrap font-mono text-slate-100 text-xs">
                                      {mem.last_result}
                                    </p>
                                    {(mem.page_reference || mem.last_result_metadata?.page_reference) && (
                                      <div className="pt-1 flex items-center gap-2 text-[10px] text-slate-400">
                                        <span className="px-2 py-0.5 rounded bg-[#242428] border border-[#303034] text-slate-300 font-medium">
                                          {mem.page_reference || mem.last_result_metadata?.page_reference}
                                        </span>
                                        {mem.last_result_metadata?.quoted_excerpt && (
                                          <span className="italic truncate max-w-md text-slate-400" title={mem.last_result_metadata.quoted_excerpt}>
                                            "{mem.last_result_metadata.quoted_excerpt}"
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-slate-500 italic text-[11px]">
                                    Ainda não pesquisada. Clique em <strong className="text-slate-300 font-semibold">"Buscar com IA"</strong> ou use <strong className="text-[#FF6600] font-semibold">"Buscar memórias pendentes"</strong> para que a IA analise o documento e grave a resposta aqui.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
