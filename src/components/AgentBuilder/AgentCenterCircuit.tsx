import React, { useRef, useState, useEffect } from 'react';
import {
  Tag,
  Layers,
  Code2,
  Brain,
  Cpu,
  Check,
  RefreshCw,
  MessageSquare,
  FileCheck2,
} from 'lucide-react';
import {
  AgentSlotData,
  AVAILABLE_MODELS,
  AVAILABLE_OWL_AVATARS,
} from '../../types/agentBuilder';
import {
  getAssignmentsForAgent,
  subscribeToAgents,
  type AgentAssignment,
} from '../../lib/agentStore';
import { AgentAvatar } from '../ui/AgentAvatar';

interface AgentCenterCircuitProps {
  currentSlot: AgentSlotData;
  onOpenAvatarModal: () => void;
  onOpenNameModal: () => void;
  onOpenRoleModal: () => void;
  onOpenPromptModal: () => void;
  onOpenBrainModal: () => void;
  onOpenModelModal: () => void;
  speechBubbleText?: string | null;
  isAdmin?: boolean;
  isAvatarChanging?: boolean;
}

interface CircuitCurve {
  id: string;
  path: string;
  color: string;
  glowColor: string;
}

export const AgentCenterCircuit: React.FC<AgentCenterCircuitProps> = ({
  currentSlot,
  onOpenAvatarModal,
  onOpenNameModal,
  onOpenRoleModal,
  onOpenPromptModal,
  onOpenBrainModal,
  onOpenModelModal,
  speechBubbleText = null,
  isAdmin = true,
  isAvatarChanging = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const circleRef = useRef<HTMLDivElement>(null);
  const bottomNodeRef = useRef<HTMLSpanElement>(null);

  const cardRefs = [
    useRef<HTMLButtonElement>(null),
    useRef<HTMLButtonElement>(null),
    useRef<HTMLButtonElement>(null),
    useRef<HTMLButtonElement>(null),
    useRef<HTMLButtonElement>(null),
  ];

  const [circuitCurves, setCircuitCurves] = useState<CircuitCurve[]>([]);
  const [svgDimensions, setSvgDimensions] = useState({ width: 800, height: 620 });
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);

  // Check completion states
  const hasAvatar = Boolean(currentSlot.avatarUrl);
  const isNameDone = Boolean(currentSlot.name?.trim());
  const isRoleDone = Boolean(currentSlot.role?.trim());
  const isPromptDone = Boolean(currentSlot.prompt?.trim());
  const isBrainDone = Boolean(currentSlot.brainProfile);
  const isModelDone = Boolean(currentSlot.modelId);

  // Sync real assignments for this agent
  useEffect(() => {
    const refreshAssignments = () => {
      if (currentSlot.id && currentSlot.id !== 'draft' && currentSlot.id !== 'new') {
        setAssignments(getAssignmentsForAgent(currentSlot.id));
      } else {
        setAssignments([]);
      }
    };

    refreshAssignments();
    const unsubscribe = subscribeToAgents(refreshAssignments);
    return () => unsubscribe();
  }, [currentSlot.id]);

  // Dynamically calculate smooth static cubic Bézier curves (animation cancelled per specs)
  const updateCircuitPaths = () => {
    if (!containerRef.current || !circleRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const circleRect = circleRef.current.getBoundingClientRect();

    // Start point: Center of bottom edge of the central circle
    const startX = circleRect.left + circleRect.width / 2 - containerRect.left;
    const startY = circleRect.bottom - containerRect.top;

    const colors = [
      { id: 'nome', color: '#ec4899', glowColor: 'rgba(236,72,153,0.7)' }, // Nome (Pink/Magenta)
      { id: 'funcao', color: '#a855f7', glowColor: 'rgba(168,85,247,0.7)' }, // Função (Violet/Purple)
      { id: 'prompt', color: '#3b82f6', glowColor: 'rgba(59,130,246,0.7)' }, // Prompt (Electric Blue)
      { id: 'cerebro', color: '#06b6d4', glowColor: 'rgba(6,182,212,0.7)' },  // Cérebro (Neon Cyan)
      { id: 'modelo', color: '#10b981', glowColor: 'rgba(16,185,129,0.7)' }, // Modelo (Aqua/Emerald)
    ];

    const curves: CircuitCurve[] = [];

    cardRefs.forEach((ref, idx) => {
      if (ref.current) {
        const cardRect = ref.current.getBoundingClientRect();
        // End point: Top center of the card where the node dot sits
        const endX = cardRect.left + cardRect.width / 2 - containerRect.left;
        const endY = cardRect.top - containerRect.top;

        const deltaY = endY - startY;

        // Smooth cubic Bézier: Drops down from circle bottom, docks vertically into card top
        const cp1X = startX;
        const cp1Y = startY + deltaY * 0.45;
        const cp2X = endX;
        const cp2Y = endY - deltaY * 0.45;

        const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

        curves.push({
          id: colors[idx].id,
          path,
          color: colors[idx].color,
          glowColor: colors[idx].glowColor,
        });
      }
    });

    setSvgDimensions({
      width: containerRect.width,
      height: containerRect.height,
    });
    setCircuitCurves(curves);
  };

  useEffect(() => {
    updateCircuitPaths();
    window.addEventListener('resize', updateCircuitPaths);
    const t1 = setTimeout(updateCircuitPaths, 60);
    const t2 = setTimeout(updateCircuitPaths, 250);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => {
        updateCircuitPaths();
      });
      ro.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateCircuitPaths);
      if (ro) ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [currentSlot.id]);

  // Selected model display name
  const formatModelDisplayName = (modelId?: string) => {
    if (!modelId) return '';
    const norm = modelId.toLowerCase();
    if (norm === 'gemini-1.5-pro') return 'Gemini 1.5 Pro';
    if (norm === 'gemini-1.5-flash') return 'Gemini 1.5 Flash';
    if (norm === 'gemini-2.0-flash') return 'Gemini 2.0 Flash';
    if (norm === 'gemini-2.5-pro' || norm === 'gemini-4-argon') return 'Gemini 2.5 Pro';
    if (norm === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
    if (norm === 'gpt-4o') return 'GPT-4o';
    if (norm === 'gpt-4o-mini') return 'GPT-4o Mini';
    if (norm === 'o3-mini') return 'o3-mini';
    return modelId;
  };
  const modelDisplayName = formatModelDisplayName(currentSlot.modelId);

  // Brain profile display name
  const brainDisplayMap: Record<string, string> = {
    economico: 'Econômico',
    equilibrado: 'Equilibrado',
    avancado: 'Avançado',
  };
  const brainDisplayName = currentSlot.brainProfile ? brainDisplayMap[currentSlot.brainProfile] || '' : '';

  // The 5 Configuration Cards specifications
  const cardsData = [
    {
      id: 'nome',
      label: 'Nome',
      sublabel: isNameDone ? 'Editar' : 'Definir',
      isDone: isNameDone,
      onOpen: onOpenNameModal,
      Icon: Tag,
      iconClasses: '-rotate-45',
      color: '#ec4899',
    },
    {
      id: 'funcao',
      label: 'Função',
      sublabel: isRoleDone ? 'Editar' : 'Definir',
      isDone: isRoleDone,
      onOpen: onOpenRoleModal,
      Icon: Layers,
      iconClasses: '',
      color: '#a855f7',
    },
    {
      id: 'prompt',
      label: 'Prompt',
      sublabel: isPromptDone ? 'Editar' : 'Instruções',
      isDone: isPromptDone,
      onOpen: onOpenPromptModal,
      Icon: Code2,
      iconClasses: '',
      color: '#3b82f6',
    },
    {
      id: 'cerebro',
      label: 'Cérebro',
      sublabel: isBrainDone ? 'Trocar' : 'Selecionar',
      isDone: isBrainDone,
      onOpen: onOpenBrainModal,
      Icon: Brain,
      iconClasses: '',
      color: '#06b6d4',
    },
    {
      id: 'modelo',
      label: 'Modelo',
      sublabel: isModelDone ? 'Trocar' : 'Selecionar',
      isDone: isModelDone,
      onOpen: onOpenModelModal,
      Icon: Cpu,
      iconClasses: '',
      color: '#10b981',
    },
  ];

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full min-w-0 flex flex-col items-center justify-between min-h-[580px] sm:min-h-[640px] p-4 sm:p-6 lg:p-8 pt-8 sm:pt-10 bg-[#090a14] border border-slate-900/90 rounded-3xl overflow-visible backdrop-blur-md"
    >
      {/* Background ambient lighting (active only when avatar is chosen) */}
      {hasAvatar && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-gradient-to-tr from-pink-500/10 via-purple-500/10 to-cyan-500/10 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 opacity-100" />
      )}

      {/* SVG CONNECTOR BEZIER CURVES LAYER (STATIC NEON GLOW, NO MOVING PARTICLES) */}
      <svg
        className="absolute inset-0 pointer-events-none z-10 hidden sm:block"
        width={svgDimensions.width || '100%'}
        height={svgDimensions.height || '100%'}
        viewBox={`0 0 ${svgDimensions.width || 800} ${svgDimensions.height || 640}`}
        fill="none"
      >
        <defs>
          <filter id="neonBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {circuitCurves.map((curve, idx) => {
          const card = cardsData[idx];
          const isDone = card?.isDone;

          return (
            <g key={curve.id}>
              {/* Outer diffuse glow path: vibrant if done, subtle when off */}
              <path
                d={curve.path}
                stroke={curve.color}
                strokeWidth={isDone ? '6' : '3'}
                strokeOpacity={isDone ? '0.45' : '0.15'}
                strokeLinecap="round"
                filter="url(#neonBlur)"
                fill="none"
              />
              {/* Inner vibrant neon stroke */}
              <path
                d={curve.path}
                stroke={curve.color}
                strokeWidth={isDone ? '2.75' : '1.5'}
                strokeOpacity={isDone ? '1' : '0.4'}
                strokeLinecap="round"
                fill="none"
              />
            </g>
          );
        })}
      </svg>

      {/* CENTRAL COMPOSITION: LEFT PERFIL + CENTRAL AVATAR + RIGHT EMPREGOS */}
      <div className="relative z-20 w-full flex flex-col lg:flex-row items-center lg:items-start justify-between gap-6 sm:gap-8 mt-2 mb-10 sm:mb-16 px-2 sm:px-6">
        {/* LADO ESQUERDO — PERFIL */}
        <div className="w-full lg:w-64 order-2 lg:order-1 flex flex-col items-start min-h-[140px]">
          <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-300 mb-3 text-left">
            Perfil
          </h4>

          {/* As tags que surgem progressivamente conforme os campos são preenchidos */}
          <div className="flex flex-col gap-2 items-start w-full">
            {isNameDone && (
              <div className="animate-in fade-in slide-in-from-left-2 duration-300 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-[11px] font-normal text-pink-200/90 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899] shrink-0" />
                <span className="truncate">
                  Nome: <span className="font-medium text-white">{currentSlot.name}</span>
                </span>
              </div>
            )}

            {isRoleDone && (
              <div className="animate-in fade-in slide-in-from-left-2 duration-300 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[11px] font-normal text-purple-200/90 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] shrink-0" />
                <span className="truncate">
                  Função: <span className="font-medium text-white">{currentSlot.role}</span>
                </span>
              </div>
            )}

            {isPromptDone && (
              <div className="animate-in fade-in slide-in-from-left-2 duration-300 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] font-normal text-blue-200/90 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] shrink-0" />
                <span className="truncate">
                  Prompt: <span className="font-medium text-white">Definido</span>
                </span>
              </div>
            )}

            {isBrainDone && (
              <div className="animate-in fade-in slide-in-from-left-2 duration-300 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-normal text-cyan-200/90 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] shrink-0" />
                <span className="truncate">
                  Cérebro: <span className="font-medium text-white">{brainDisplayName}</span>
                </span>
              </div>
            )}

            {isModelDone && (
              <div className="animate-in fade-in slide-in-from-left-2 duration-300 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-normal text-emerald-200/90 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shrink-0" />
                <span className="truncate">
                  Modelo: <span className="font-medium text-white">{modelDisplayName}</span>
                </span>
              </div>
            )}

            {!isNameDone && !isRoleDone && !isPromptDone && !isBrainDone && !isModelDone && (
              <div className="w-full rounded-xl border border-dashed border-slate-800/80 bg-slate-900/20 p-3 text-left">
                <p className="text-[11px] text-slate-500 font-normal">
                  Configure os atributos abaixo para ativar o perfil do agente.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* CENTRAL CIRCLE (NEUTRAL INITIAL STATE VS VIBRANT NEON MULTICOLOR AFTER AVATAR SELECTION) */}
        <div className="relative order-1 lg:order-2 flex flex-col items-center">
          <div
            ref={circleRef}
            onClick={onOpenAvatarModal}
            className="relative group w-52 h-52 sm:w-64 sm:h-64 rounded-full flex items-center justify-center select-none transition-all cursor-pointer hover:scale-[1.02]"
          >
            {hasAvatar ? (
              /* ACTIVE NEON RING STATE (Only after avatar selection) */
              <>
                {/* Outer diffused glow halo */}
                <div
                  className="absolute -inset-1.5 rounded-full blur-md pointer-events-none opacity-85 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background:
                      'conic-gradient(from 220deg, #ec4899 0%, #a855f7 26%, #3b82f6 48%, #00f0ff 68%, #10b981 85%, #ec4899 100%)',
                  }}
                />

                {/* Sharp multi-color continuous neon ring border */}
                <div
                  className="absolute inset-0 rounded-full p-[3.5px] pointer-events-none"
                  style={{
                    background:
                      'conic-gradient(from 220deg, #ec4899 0%, #a855f7 26%, #3b82f6 48%, #00f0ff 68%, #10b981 85%, #ec4899 100%)',
                    boxShadow:
                      '0 0 25px rgba(0,240,255,0.4), 0 0 35px rgba(236,72,153,0.35)',
                  }}
                >
                  <div className="w-full h-full rounded-full bg-[#090a14]" />
                </div>

                {/* 4 LUMINOUS WHITE DOTS / NODES (Cardinal points) */}
                <span
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white z-30"
                  style={{ boxShadow: '0 0 10px #ffffff, 0 0 18px #a855f7' }}
                />
                <span
                  className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white z-30"
                  style={{ boxShadow: '0 0 10px #ffffff, 0 0 18px #00f0ff' }}
                />
                <span
                  ref={bottomNodeRef}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white z-30"
                  style={{ boxShadow: '0 0 10px #ffffff, 0 0 18px #06b6d4' }}
                />
                <span
                  className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white z-30"
                  style={{ boxShadow: '0 0 10px #ffffff, 0 0 18px #ec4899' }}
                />
              </>
            ) : (
              /* NEUTRAL SUBTLE INITIAL RING (Before avatar selection: no intense glow, no neon colors, no 4 dots) */
              <div className="absolute inset-0 rounded-full border-2 border-slate-700/60 bg-[#141418] group-hover:border-slate-500 transition-colors pointer-events-none" />
            )}

            {/* INNER CIRCLE WITH DASHED LINE AND CONTENT */}
            <div className="relative w-full h-full rounded-full p-4 flex items-center justify-center">
              <div
                className={`relative w-full h-full rounded-full border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-colors ${
                  hasAvatar
                    ? 'border-white/25 bg-[#141418]/90'
                    : 'border-slate-700/70 bg-[#141418]/60 group-hover:border-slate-500'
                }`}
              >
                {hasAvatar ? (
                  /* Selected Avatar Display with Smooth Preloading & Crossfade */
                  <div className="relative w-full h-full rounded-full overflow-hidden p-2">
                    <AgentAvatar
                      src={currentSlot.avatarUrl}
                      isChanging={isAvatarChanging}
                      alt={currentSlot.name || 'Avatar'}
                      size="custom"
                      className="w-full h-full rounded-full"
                      imgClassName="w-full h-full object-cover rounded-full"
                      theme="dark"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex flex-col items-center justify-center p-4 text-center cursor-pointer">
                      <RefreshCw className="w-6 h-6 text-pink-400 mb-1.5" />
                      <span className="text-xs font-bold text-white">Alterar Avatar</span>
                      <span className="text-[10px] text-slate-300 mt-0.5">Toque para trocar</span>
                    </div>
                  </div>
                ) : (
                  /* Neutral Empty Avatar State */
                  <div className="flex flex-col items-center justify-center text-center p-3">
                    <div className="relative mb-2">
                      <svg
                        className="w-14 h-14 sm:w-16 sm:h-16 text-slate-400 group-hover:text-white stroke-[1.6] transition-colors"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                      </svg>
                      <span className="absolute -top-1 -right-2 text-pink-400 group-hover:text-pink-300 font-extrabold text-xl leading-none select-none">
                        +
                      </span>
                    </div>
                    <span className="text-slate-300 group-hover:text-white font-bold text-sm sm:text-base tracking-wide transition-colors">
                      Escolher Avatar
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* SPEECH BUBBLE */}
            {speechBubbleText && (
              <div
                key={speechBubbleText}
                className="absolute -top-14 left-1/2 -translate-x-1/2 lg:translate-x-0 lg:top-2 lg:left-[calc(100%+16px)] z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-200"
              >
                <div className="relative bg-slate-900 border border-pink-500/60 text-white rounded-2xl px-4 py-3 shadow-2xl shadow-pink-500/30 w-max max-w-[85vw] sm:max-w-[270px] whitespace-normal break-words text-xs sm:text-[13px] font-semibold leading-relaxed backdrop-blur-md">
                  {speechBubbleText}
                  <div className="hidden lg:block absolute top-4 -left-2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-slate-900" />
                  <div className="hidden lg:block absolute top-4 -left-2.5 w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-r-[9px] border-r-pink-500/70 -z-10" />
                  <div className="lg:hidden absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-slate-900" />
                  <div className="lg:hidden absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[9px] border-t-pink-500/70 -z-10" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* LADO DIREITO — EMPREGOS (JOB ASSIGNMENTS DINÂMICOS E REAIS) */}
        <div className="w-full lg:w-64 order-3 flex flex-col items-start min-h-[140px]">
          <h4 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-300 mb-3 text-left">
            Empregos
          </h4>

          {assignments.length > 0 ? (
            <div className="flex flex-col gap-2 w-full animate-in fade-in duration-200">
              {assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-200"
                >
                  {assignment.target === 'chat' ? (
                    <div className="w-6 h-6 rounded-lg bg-pink-500/15 text-pink-400 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center shrink-0">
                      <FileCheck2 className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-semibold truncate text-[11px] text-white">
                      {assignment.target === 'chat' ? 'Chat Triverus' : 'Auditoria'}
                    </p>
                    {assignment.categoryLabel && (
                      <p className="text-[10px] text-slate-400 truncate">
                        {assignment.categoryLabel}
                      </p>
                    )}
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full min-h-[90px] rounded-xl border border-dashed border-slate-800/80 bg-slate-900/20 p-3.5 flex flex-col items-start justify-center">
              <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                Nenhum emprego atribuído.
              </p>
              <span className="text-[10px] text-slate-500 mt-1">
                Atribua este agente no Chat ou em etapas da Auditoria.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* THE 5 CONFIGURATION CARDS WITH LABELS OUTSIDE AND BELOW */}
      <div className="relative z-20 w-full max-w-4xl mx-auto pb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 lg:gap-8 justify-items-center">
          {cardsData.map((card, idx) => {
            const isDone = card.isDone;

            const borderGlowStyle = isDone
              ? {
                  borderColor: card.color,
                  boxShadow: `0 0 22px ${card.color}73, inset 0 0 12px ${card.color}2e`,
                }
              : {
                  borderColor: '#3f3f46',
                  boxShadow: 'none',
                };

            return (
              <div key={card.id} className="flex flex-col items-center w-full max-w-[130px]">
                {/* Squarish Card Box / Gear */}
                <button
                  ref={cardRefs[idx]}
                  type="button"
                  onClick={card.onOpen}
                  style={borderGlowStyle}
                  className={`group relative w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 rounded-2xl sm:rounded-3xl bg-[#303034] border-2 transition-all duration-300 flex items-center justify-center select-none cursor-pointer ${
                    isDone
                      ? 'hover:scale-105 active:scale-95'
                      : 'hover:scale-105 hover:border-slate-500 active:scale-95'
                  }`}
                >
                  {/* Node on Top Center where Bézier line docks */}
                  <span
                    className={`absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full transition-all duration-300 z-30 ${
                      isDone ? 'w-3 h-3 bg-white' : 'w-3 h-3 bg-slate-600'
                    }`}
                    style={
                      isDone
                        ? { boxShadow: `0 0 10px #ffffff, 0 0 18px ${card.color}` }
                        : { boxShadow: 'none' }
                    }
                  />

                  {/* Centered Icon */}
                  <card.Icon
                    className={`w-8 h-8 sm:w-10 sm:h-10 transition-transform ${
                      isDone ? 'text-white stroke-[1.75]' : 'text-slate-400 stroke-[1.5]'
                    } ${card.iconClasses}`}
                  />

                  {/* Plus / Check Indicator at bottom-right inside corner */}
                  <div
                    className={`absolute bottom-2 right-2 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold leading-none transition-colors ${
                      isDone
                        ? 'bg-white text-black'
                        : 'border border-white/40 text-slate-400 group-hover:border-white group-hover:text-white'
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 stroke-[3]" />
                    ) : (
                      '+'
                    )}
                  </div>
                </button>

                {/* FIELD NAME OUTSIDE AND BELOW THE CARD */}
                <span className="text-xs sm:text-sm lg:text-base font-bold text-white tracking-wide mt-3 text-center">
                  {card.label}
                </span>

                {/* Subtitle: "Definir"/"Instruções"/"Selecionar" before; "Editar"/"Trocar" after */}
                <span
                  className={`text-[10px] mt-0.5 truncate max-w-[110px] text-center font-medium ${
                    isDone ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {card.sublabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
