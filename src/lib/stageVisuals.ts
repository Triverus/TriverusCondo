// Centralized Stage Visual Configuration
// Official 7-Stage Palette:
// INÍCIO: #64748B (Slate)
// REUNIÃO: #3B82F6 (Blue)
// PROPOSTA: #8B5CF6 (Violet)
// NEGOCIAÇÃO: #F59E0B (Amber)
// CONTRATO: #FF6600 (Laranja Triverus)
// CLIENTE: #16A34A (Green)
// PERDIDO: #DC2626 (Red)

export interface StageVisualConfig {
  key: string;
  name: string;
  color: string;
  rgb: string;
  lightBg: string;
  darkBg: string;
  lightBorder: string;
  darkBorder: string;
  lightBadgeBg: string;
  lightBadgeText: string;
  lightBadgeBorder: string;
  darkBadgeBg: string;
  darkBadgeText: string;
  darkBadgeBorder: string;
}

export const OFFICIAL_STAGE_COLORS = {
  inicio: '#64748B',
  reuniao: '#3B82F6',
  proposta: '#8B5CF6',
  negociacao: '#F59E0B',
  contrato: '#FF6600',
  cliente: '#16A34A',
  perdido: '#DC2626',
} as const;

export const STAGE_VISUALS: Record<string, StageVisualConfig> = {
  inicio: {
    key: 'inicio',
    name: 'Início',
    color: '#64748B',
    rgb: '100, 116, 139',
    lightBg: 'linear-gradient(135deg, rgba(100, 116, 139, 0.08) 0%, rgba(100, 116, 139, 0.03) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(100, 116, 139, 0.06) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(100, 116, 139, 0.45)',
    darkBorder: 'rgba(100, 116, 139, 0.35)',
    lightBadgeBg: 'rgba(100, 116, 139, 0.12)',
    lightBadgeText: '#334155',
    lightBadgeBorder: 'rgba(100, 116, 139, 0.35)',
    darkBadgeBg: 'rgba(100, 116, 139, 0.25)',
    darkBadgeText: '#cbd5e1',
    darkBadgeBorder: 'rgba(100, 116, 139, 0.4)',
  },
  reuniao: {
    key: 'reuniao',
    name: 'Reunião',
    color: '#3B82F6',
    rgb: '59, 130, 246',
    lightBg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.09) 0%, rgba(59, 130, 246, 0.035) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.07) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(59, 130, 246, 0.5)',
    darkBorder: 'rgba(59, 130, 246, 0.35)',
    lightBadgeBg: 'rgba(59, 130, 246, 0.12)',
    lightBadgeText: '#1d4ed8',
    lightBadgeBorder: 'rgba(59, 130, 246, 0.35)',
    darkBadgeBg: 'rgba(59, 130, 246, 0.25)',
    darkBadgeText: '#93c5fd',
    darkBadgeBorder: 'rgba(59, 130, 246, 0.4)',
  },
  proposta: {
    key: 'proposta',
    name: 'Proposta',
    color: '#8B5CF6',
    rgb: '139, 92, 246',
    lightBg: 'linear-gradient(135deg, rgba(139, 92, 246, 0.09) 0%, rgba(139, 92, 246, 0.035) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(139, 92, 246, 0.07) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(139, 92, 246, 0.5)',
    darkBorder: 'rgba(139, 92, 246, 0.35)',
    lightBadgeBg: 'rgba(139, 92, 246, 0.12)',
    lightBadgeText: '#6d28d9',
    lightBadgeBorder: 'rgba(139, 92, 246, 0.35)',
    darkBadgeBg: 'rgba(139, 92, 246, 0.25)',
    darkBadgeText: '#c4b5fd',
    darkBadgeBorder: 'rgba(139, 92, 246, 0.4)',
  },
  negociacao: {
    key: 'negociacao',
    name: 'Negociação',
    color: '#F59E0B',
    rgb: '245, 158, 11',
    lightBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.09) 0%, rgba(245, 158, 11, 0.035) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.07) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(245, 158, 11, 0.5)',
    darkBorder: 'rgba(245, 158, 11, 0.35)',
    lightBadgeBg: 'rgba(245, 158, 11, 0.14)',
    lightBadgeText: '#b45309',
    lightBadgeBorder: 'rgba(245, 158, 11, 0.4)',
    darkBadgeBg: 'rgba(245, 158, 11, 0.25)',
    darkBadgeText: '#fde68a',
    darkBadgeBorder: 'rgba(245, 158, 11, 0.4)',
  },
  contrato: {
    key: 'contrato',
    name: 'Contrato',
    color: '#FF6600',
    rgb: '255, 102, 0',
    lightBg: 'linear-gradient(135deg, rgba(255, 102, 0, 0.09) 0%, rgba(255, 102, 0, 0.035) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(255, 102, 0, 0.07) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(255, 102, 0, 0.55)',
    darkBorder: 'rgba(255, 102, 0, 0.35)',
    lightBadgeBg: 'rgba(255, 102, 0, 0.12)',
    lightBadgeText: '#c2410c',
    lightBadgeBorder: 'rgba(255, 102, 0, 0.4)',
    darkBadgeBg: 'rgba(255, 102, 0, 0.25)',
    darkBadgeText: '#fdba74',
    darkBadgeBorder: 'rgba(255, 102, 0, 0.4)',
  },
  cliente: {
    key: 'cliente',
    name: 'Cliente',
    color: '#16A34A',
    rgb: '22, 163, 74',
    lightBg: 'linear-gradient(135deg, rgba(22, 163, 74, 0.09) 0%, rgba(22, 163, 74, 0.035) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(22, 163, 74, 0.07) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(22, 163, 74, 0.5)',
    darkBorder: 'rgba(22, 163, 74, 0.35)',
    lightBadgeBg: 'rgba(22, 163, 74, 0.12)',
    lightBadgeText: '#15803d',
    lightBadgeBorder: 'rgba(22, 163, 74, 0.35)',
    darkBadgeBg: 'rgba(22, 163, 74, 0.25)',
    darkBadgeText: '#86efac',
    darkBadgeBorder: 'rgba(22, 163, 74, 0.4)',
  },
  perdido: {
    key: 'perdido',
    name: 'Perdido',
    color: '#DC2626',
    rgb: '220, 38, 38',
    lightBg: 'linear-gradient(135deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.03) 100%)',
    darkBg: 'linear-gradient(135deg, rgba(220, 38, 38, 0.06) 0%, rgba(15, 23, 42, 0.95) 100%)',
    lightBorder: 'rgba(220, 38, 38, 0.45)',
    darkBorder: 'rgba(220, 38, 38, 0.35)',
    lightBadgeBg: 'rgba(220, 38, 38, 0.12)',
    lightBadgeText: '#b91c1c',
    lightBadgeBorder: 'rgba(220, 38, 38, 0.35)',
    darkBadgeBg: 'rgba(220, 38, 38, 0.25)',
    darkBadgeText: '#fca5a5',
    darkBadgeBorder: 'rgba(220, 38, 38, 0.4)',
  },
};

export function getStageKey(
  stageId?: string | null,
  stageName?: string | null,
  isWon?: boolean | null,
  isLost?: boolean | null
): keyof typeof STAGE_VISUALS {
  if (isWon) return 'cliente';
  if (isLost) return 'perdido';

  const idStr = String(stageId || '').toLowerCase();
  const nameStr = String(stageName || '').toLowerCase();

  if (idStr === 'stg_inicio' || nameStr.includes('início') || nameStr.includes('inicio') || nameStr.includes('primeiro')) return 'inicio';
  if (idStr === 'stg_reuniao' || nameStr.includes('reuni')) return 'reuniao';
  if (idStr === 'stg_proposta' || nameStr.includes('proposta')) return 'proposta';
  if (idStr === 'stg_negociacao' || nameStr.includes('negocia')) return 'negociacao';
  if (idStr === 'stg_contrato' || nameStr.includes('contrato')) return 'contrato';
  if (idStr === 'stg_cliente' || nameStr.includes('cliente')) return 'cliente';
  if (idStr === 'stg_perdido' || nameStr.includes('perdid')) return 'perdido';

  return 'inicio';
}

export function getStageVisualConfig(
  stageId?: string | null,
  stageName?: string | null,
  isWon?: boolean | null,
  isLost?: boolean | null
): StageVisualConfig {
  const key = getStageKey(stageId, stageName, isWon, isLost);
  return STAGE_VISUALS[key];
}

export function getStageColorHex(
  stageId?: string | null,
  stageName?: string | null,
  isWon?: boolean | null,
  isLost?: boolean | null
): string {
  return getStageVisualConfig(stageId, stageName, isWon, isLost).color;
}
