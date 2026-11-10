export type BrainProfile = 'economico' | 'equilibrado' | 'avancado' | 'economic' | 'balanced' | 'advanced' | '';

export interface AgentModelOption {
  id: string;
  name: string;
  provider: string;
  isAvailable: boolean;
  badge?: string;
  description: string;
}

export interface OwlAvatarOption {
  id: string;
  name: string;
  gender: 'masculino' | 'feminino';
  url: string;
  isReserved?: boolean;
}

export interface AgentSlotData {
  id: string; // 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'slot-5'
  slotNumber: number; // 1 to 5
  isOfficial?: boolean;
  name: string;
  role: string;
  avatarUrl: string;
  avatarId?: string;
  prompt: string;
  brainProfile: BrainProfile;
  modelId: string;
  isConfigured: boolean;
  capabilities?: Record<string, boolean>;
  updatedAt?: string;
}

export interface AgentCapabilityItem {
  key: string;
  name: string;
  description: string;
  isImplemented: boolean;
  defaultEnabled: boolean;
}

export const AGENT_CAPABILITIES_CATALOG: AgentCapabilityItem[] = [
  {
    key: 'crm',
    name: 'CRM Triverus',
    description: 'Consultas de condomínios, contatos, interações e reuniões no CRM',
    isImplemented: true,
    defaultEnabled: false,
  },
  {
    key: 'auditoria',
    name: 'Auditoria Documental',
    description: 'Análise e verificação de documentos e pareceres',
    isImplemented: true,
    defaultEnabled: false,
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    description: 'Navegação e leitura de pastas e arquivos no Drive',
    isImplemented: false,
    defaultEnabled: false,
  },
  {
    key: 'memorias',
    name: 'Memórias do Agente',
    description: 'Extração e recuperação de memórias contextuais de longo prazo',
    isImplemented: false,
    defaultEnabled: false,
  },
  {
    key: 'agenda',
    name: 'Agenda Google Calendar',
    description: 'Sincronização e agendamento de eventos e reuniões',
    isImplemented: false,
    defaultEnabled: false,
  },
];


// No official or pre-seeded agents: system begins with 0 agents of 5

export const AVAILABLE_OWL_AVATARS: OwlAvatarOption[] = [
  // Corujas Masculinas (5)
  {
    id: 'coruja-j',
    name: 'Coruja J',
    gender: 'masculino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/j-coruja-macho.webp',
  },
  {
    id: 'coruja-i',
    name: 'Coruja I',
    gender: 'masculino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/i-coruja-macho.webp',
  },
  {
    id: 'coruja-g',
    name: 'Coruja G',
    gender: 'masculino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/g-coruja-macho.webp',
  },
  {
    id: 'coruja-h',
    name: 'Coruja H',
    gender: 'masculino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/h-coruja-macho.webp',
  },
  {
    id: 'coruja-f',
    name: 'Coruja F',
    gender: 'masculino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/f-coruja-macho.webp',
  },
  // Corujas Femininas
  {
    id: 'coruja-a',
    name: 'Coruja A',
    gender: 'feminino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/a-coruja-femea.webp',
  },
  {
    id: 'coruja-b',
    name: 'Coruja B',
    gender: 'feminino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/b-coruja-femea.webp',
  },
  {
    id: 'coruja-c',
    name: 'Coruja C',
    gender: 'feminino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/c-coruja-femea.webp',
  },
  {
    id: 'coruja-d',
    name: 'Coruja D',
    gender: 'feminino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/d-coruja-femea.webp',
  },
  {
    id: 'coruja-e',
    name: 'Coruja E',
    gender: 'feminino',
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/e-coruja-femea.webp',
  },
];

export const AVAILABLE_MODELS: AgentModelOption[] = [
  {
    id: 'gemini-1.5-pro',
    name: 'Google Gemini 1.5 Pro',
    provider: 'Google AI',
    isAvailable: true,
    badge: 'Recomendado',
    description: 'Capacidade máxima de raciocínio lógico, janela de contexto ampliada e alta precisão para documentos longos e auditorias.',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Google Gemini 1.5 Flash',
    provider: 'Google AI',
    isAvailable: true,
    badge: 'Alta Velocidade',
    description: 'Respostas ultrarrápidas com excelente equilíbrio de custo e desempenho para operações ágeis do dia a dia.',
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Anthropic Claude 3.5 Sonnet',
    provider: 'Anthropic',
    isAvailable: false,
    badge: 'Não configurado',
    description: 'Modelo de raciocínio avançado e redação refinada disponível no ecossistema (requer chave dedicada).',
  },
  {
    id: 'gpt-4o',
    name: 'OpenAI GPT-4o',
    provider: 'OpenAI',
    isAvailable: false,
    badge: 'Não configurado',
    description: 'Modelo multimodal de alta performance para processamento geral (requer chave dedicada).',
  },
  {
    id: 'llama-3-3-70b',
    name: 'Meta Llama 3.3 70B',
    provider: 'Meta AI',
    isAvailable: false,
    badge: 'Em breve',
    description: 'Modelo open-weights de última geração para infraestruturas privadas e computação local.',
  },
];

export const MAX_AGENT_ROLE_LENGTH = 34;

export function validateAgentRole(role: string): { valid: boolean; trimmed: string; remaining: number } {
  const trimmed = (role || '').trim().slice(0, MAX_AGENT_ROLE_LENGTH);
  return {
    valid: trimmed.length <= MAX_AGENT_ROLE_LENGTH,
    trimmed,
    remaining: Math.max(0, MAX_AGENT_ROLE_LENGTH - trimmed.length),
  };
}
