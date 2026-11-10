import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { loadEnv } from 'vite';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Registro de modelos que comprovaram execução operacional bem-sucedida no motor
const operationalVerifiedModelIds = new Set();

/**
 * Marca um modelo como operacional após uma execução comprovada com sucesso.
 */
export function markModelAsOperational(modelId) {
  if (!modelId) return;
  const norm = modelId.trim().toLowerCase();
  operationalVerifiedModelIds.add(norm);

  // Atualiza em memória os modelos do catálogo ativo
  if (globalCatalogState && Array.isArray(globalCatalogState.models)) {
    for (const m of globalCatalogState.models) {
      if (m && m.id && m.id.toLowerCase() === norm) {
        m.status = 'operational';
      }
    }
  }
}

/**
 * Verifica se um modelo tem comprovação de execução operacional.
 */
export function isModelOperational(modelId) {
  if (!modelId) return false;
  return operationalVerifiedModelIds.has(modelId.trim().toLowerCase());
}

/**
 * Helper para carregar variáveis de ambiente com segurança
 */
export function getRuntimeEnv(key) {
  let val = (process.env[key] || '').trim();
  if (!val) {
    try {
      const loaded = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
      val = (loaded[key] || '').trim();
    } catch {}
  }
  return val;
}

/**
 * Catálogo base oficial de modelos ativos (OpenAI e Google Gemini 2026).
 * Garante disponibilidade permanente para seleção no construtor mesmo sem API key no servidor.
 */
export const BASELINE_MODELS = [
  // Google Gemini (Ativos 2026)
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    displayName: 'Google Gemini 3.8 Flash',
    description: 'Modelo multimodal de última geração do Google para raciocínio complexo, agentes autônomos e auditoria.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: true,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 1000000,
    maxFileSizeMb: 30,
    maxOutputTokens: 64000,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: false,
    dateFormatted: 'Data não informada',
    versionScore: 38000,
    versionLabel: '3.8',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    displayName: 'Google Gemini 2.5 Pro',
    description: 'Modelo Google Gemini 2.5 Pro multimodal avançado para conversação e ferramentas.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: true,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 1000000,
    maxFileSizeMb: 30,
    maxOutputTokens: 8192,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: false,
    dateFormatted: 'Data não informada',
    versionScore: 25000,
    versionLabel: '2.5',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    displayName: 'Google Gemini 2.5 Flash',
    description: 'Modelo Google Gemini 2.5 Flash multimodal ultra-rápido para conversação e ferramentas.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: false,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 1000000,
    maxFileSizeMb: 30,
    maxOutputTokens: 8192,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: false,
    dateFormatted: 'Data não informada',
    versionScore: 25000,
    versionLabel: '2.5',
  },
  // OpenAI (Ativos 2026)
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'OpenAI GPT-4o',
    description: 'Modelo multimodal de alta precisão da OpenAI para raciocínio, ferramentas e documentos.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: false,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 128000,
    maxFileSizeMb: 30,
    maxOutputTokens: 16384,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: true,
    dateFormatted: '13/05/2024',
    versionScore: 40000,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'OpenAI GPT-4o Mini',
    description: 'Modelo leve e eficiente da OpenAI com suporte a ferramentas e visão.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: false,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 128000,
    maxFileSizeMb: 30,
    maxOutputTokens: 16384,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: true,
    dateFormatted: '18/07/2024',
    versionScore: 40000,
  },
  {
    id: 'o1',
    provider: 'openai',
    displayName: 'OpenAI o1',
    description: 'Modelo de raciocínio avançado da OpenAI para tarefas complexas.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: true,
    supportsTemperature: false,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 200000,
    maxFileSizeMb: 30,
    maxOutputTokens: 100000,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: true,
    dateFormatted: '17/12/2024',
    versionScore: 40000,
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    displayName: 'OpenAI o3-mini',
    description: 'Modelo de raciocínio rápido para código e lógica (sem visão).',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: true,
    supportsTemperature: false,
    supportsVision: false,
    supportsPdfReading: false,
    supportsStructuredOutput: true,
    contextWindow: 200000,
    maxFileSizeMb: 30,
    maxOutputTokens: 100000,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: true,
    dateFormatted: '31/01/2025',
    versionScore: 30000,
  },
  {
    id: 'gpt-4-turbo',
    provider: 'openai',
    displayName: 'OpenAI GPT-4 Turbo',
    description: 'Modelo GPT-4 Turbo com suporte a visão e ferramentas.',
    category: 'recommended',
    supportsTools: true,
    supportsThinking: false,
    supportsTemperature: true,
    supportsVision: true,
    supportsPdfReading: true,
    supportsStructuredOutput: true,
    contextWindow: 128000,
    maxFileSizeMb: 30,
    maxOutputTokens: 4096,
    status: 'compatible',
    lastVerifiedAt: new Date().toISOString(),
    hasKnownDate: true,
    dateFormatted: '09/04/2024',
    versionScore: 40000,
  },
];

// Estado inicial: Pré-populado com os modelos base oficiais para nunca resultar em catálogo vazio
let globalCatalogState = {
  models: [...BASELINE_MODELS],
  lastFetchedAt: 0,
  isStale: false,
  providerStatus: {
    openai: {
      provider: 'openai',
      state: 'not_checked',
      ok: true,
      rawCount: BASELINE_MODELS.filter((m) => m.provider === 'openai').length,
      acceptedCount: BASELINE_MODELS.filter((m) => m.provider === 'openai').length,
      recommendedCount: BASELINE_MODELS.filter((m) => m.provider === 'openai' && m.category === 'recommended').length,
      compatibleCount: BASELINE_MODELS.filter((m) => m.provider === 'openai' && m.category === 'compatible').length,
      discardedCount: 0,
      discardReasons: {},
      sampleDiscarded: [],
      source: 'cached_real_api',
      lastCheckedAt: new Date().toISOString(),
      message: 'Catálogo de modelos OpenAI inicializado.',
    },
    google: {
      provider: 'google',
      state: 'not_checked',
      ok: true,
      rawCount: BASELINE_MODELS.filter((m) => m.provider === 'google').length,
      acceptedCount: BASELINE_MODELS.filter((m) => m.provider === 'google').length,
      recommendedCount: BASELINE_MODELS.filter((m) => m.provider === 'google' && m.category === 'recommended').length,
      compatibleCount: BASELINE_MODELS.filter((m) => m.provider === 'google' && m.category === 'compatible').length,
      discardedCount: 0,
      discardReasons: {},
      sampleDiscarded: [],
      source: 'cached_real_api',
      lastCheckedAt: new Date().toISOString(),
      message: 'Catálogo de modelos Google Gemini inicializado.',
    },
  },
};

let activeFetchPromise = null;

/**
 * Calcula score ordinal para modelos Gemini baseado na geração/versão conhecida
 */
export function parseGeminiVersionScore(canonicalId) {
  const lower = String(canonicalId || '').toLowerCase();
  let score = 0;

  if (lower.includes('3.8')) score += 38000;
  else if (lower.includes('3.7')) score += 37000;
  else if (lower.includes('3.5')) score += 35000;
  else if (lower.includes('3.0') || lower.includes('gemini-3')) score += 30000;
  else if (lower.includes('2.5')) score += 25000;
  else if (lower.includes('2.0') || lower.includes('2-')) score += 20000;
  else if (lower.includes('1.5')) score += 15000;
  else if (lower.includes('1.0') || lower.includes('1-')) score += 10000;

  if (lower.includes('pro')) score += 500;
  else if (lower.includes('flash')) score += 250;

  if (lower.includes('latest')) score += 100;
  if (!lower.includes('preview') && !lower.includes('exp')) score += 50;

  return score;
}

/**
 * Classifica e valida um modelo retornado pela API da OpenAI.
 * Não inventa status operacional: define 'compatible' a menos que já tenha execução comprovada.
 */
export function classifyOpenAIModel(rawItem) {
  const isObj = rawItem && typeof rawItem === 'object';
  const id = isObj ? String(rawItem.id || '').trim() : String(rawItem || '').trim();
  const lower = id.toLowerCase();

  if (!id) {
    return { model: null, discardReason: 'id_ausente' };
  }

  // 1. Exclusão de modalidades incompatíveis com chat textual/CRM
  if (lower.includes('embedding') || lower.includes('embed')) {
    return { model: null, discardReason: 'modalidade_embeddings' };
  }
  if (lower.includes('dall-e') || lower.includes('image')) {
    return { model: null, discardReason: 'modalidade_geracao_imagem' };
  }
  if (lower.includes('whisper')) {
    return { model: null, discardReason: 'modalidade_transcricao_audio' };
  }
  if (lower.includes('tts')) {
    return { model: null, discardReason: 'modalidade_text_to_speech' };
  }
  if (lower.includes('audio')) {
    return { model: null, discardReason: 'modalidade_audio' };
  }
  if (lower.includes('realtime')) {
    return { model: null, discardReason: 'modalidade_realtime_voice' };
  }
  if (lower.includes('moderation')) {
    return { model: null, discardReason: 'modalidade_moderacao' };
  }
  if (lower.includes('babbage') || lower.includes('davinci') || lower.includes('curie') || lower.includes('ada')) {
    return { model: null, discardReason: 'modelo_legado_completion' };
  }
  if (lower.includes('similarity') || lower.includes('search') || lower.includes('canary')) {
    return { model: null, discardReason: 'modelo_especializado_interno' };
  }

  // 2. Exclusão de snapshots antigos descontinuados da OpenAI e modelos fictícios
  if (lower.startsWith('gpt-5') || lower.startsWith('gpt-6') || lower.includes('ficticio')) {
    return { model: null, discardReason: 'modelo_ficticio_ou_nao_homologado' };
  }

  if (
    lower.includes('-0301') ||
    lower.includes('-0613') ||
    lower.includes('-16k') ||
    lower.includes('-0314') ||
    lower.includes('-32k') ||
    lower.includes('vision-preview') ||
    lower.includes('preview-0')
  ) {
    return { model: null, discardReason: 'modelo_descontinuado_ou_snapshot_antigo' };
  }

  // 3. Filtragem de modelos elegíveis para conversação / chat
  const isGpt = lower.startsWith('gpt-4') || lower.startsWith('gpt-3.5') || lower.startsWith('chatgpt-4');
  const isO1 = lower.startsWith('o1');
  const isO3 = lower.startsWith('o3');
  const isChatGpt = lower.includes('chatgpt');

  if (!isGpt && !isO1 && !isO3 && !isChatGpt) {
    return { model: null, discardReason: 'nao_e_modelo_chat' };
  }

  const isReasoningModel = isO1 || isO3;

  // Capacidades conhecidas com confirmação estrita (sem inferência vaga)
  const isToolsConfirmed =
    id === 'gpt-4o' ||
    id === 'gpt-4o-mini' ||
    id === 'o1' ||
    id === 'o3-mini' ||
    id === 'gpt-4-turbo' ||
    id === 'gpt-4' ||
    id === 'gpt-3.5-turbo' ||
    id === 'chatgpt-4o-latest';

  const supportsTools = isToolsConfirmed ? true : false;
  const supportsThinking = isReasoningModel;
  const supportsTemperature = !isReasoningModel;
  const supportsVision = id === 'gpt-4o' || id === 'gpt-4o-mini' || id === 'o1' || id === 'gpt-4-turbo';
  // o3-mini é focado em raciocínio de código e lógica em texto; NÃO possui visão multimodal ou leitura de PDFs
  const supportsPdfReading = supportsVision;
  const supportsStructuredOutput = id === 'gpt-4o' || id === 'gpt-4o-mini' || id === 'o1' || id === 'o3-mini';
  const contextWindow = (id === 'gpt-4o' || id === 'gpt-4o-mini' || id === 'o1' || id === 'o3-mini' || id === 'gpt-4-turbo') ? 128000 : 8192;
  const maxFileSizeMb = 30; // Limite operacional da plataforma Triverus

  // Classificação em Recomendados vs Outros Compatíveis
  const isSnapshotDated = /-\d{4}-\d{2}-\d{2}$/.test(lower) || /-\d{4,6}$/.test(lower);
  const isPreview = lower.includes('preview');

  let category = 'compatible';
  if (!isSnapshotDated && !isPreview) {
    if (
      id === 'gpt-4o' ||
      id === 'gpt-4o-mini' ||
      id === 'o3-mini' ||
      id === 'o1' ||
      id === 'gpt-4-turbo'
    ) {
      category = 'recommended';
    }
  }

  let displayName = `OpenAI ${id}`;
  if (id === 'gpt-4o') displayName = 'OpenAI GPT-4o';
  else if (id === 'gpt-4o-mini') displayName = 'OpenAI GPT-4o Mini';
  else if (id === 'gpt-4-turbo') displayName = 'OpenAI GPT-4 Turbo';
  else if (id === 'gpt-4') displayName = 'OpenAI GPT-4';
  else if (id === 'gpt-3.5-turbo') displayName = 'OpenAI GPT-3.5 Turbo';
  else if (id === 'o1') displayName = 'OpenAI o1';
  else if (id === 'o3-mini') displayName = 'OpenAI o3-mini';
  else if (id === 'chatgpt-4o-latest') displayName = 'ChatGPT 4o Latest';

  // Recência: Campo created retornado pela API da OpenAI (timestamp em segundos)
  const createdRaw = isObj && typeof rawItem.created === 'number' ? rawItem.created : undefined;
  const hasKnownDate = typeof createdRaw === 'number' && createdRaw > 0;
  const dateFormatted = hasKnownDate
    ? new Date(createdRaw * 1000).toLocaleDateString('pt-BR')
    : 'Data não informada';

  // Status: Somente operacional se houver comprovação de execução no motor
  const status = isModelOperational(id) ? 'operational' : 'compatible';

  return {
    model: {
      id,
      provider: 'openai',
      displayName,
      description: isReasoningModel
        ? 'Modelo OpenAI com raciocínio lógico profundo.'
        : 'Modelo OpenAI multimodal para conversação e ferramentas.',
      category,
      supportsTools,
      supportsThinking,
      supportsTemperature,
      supportsVision,
      supportsPdfReading,
      supportsStructuredOutput,
      contextWindow,
      maxFileSizeMb,
      maxOutputTokens: isReasoningModel ? 8192 : 4096,
      status,
      lastVerifiedAt: new Date().toISOString(),
      createdAt: createdRaw,
      hasKnownDate,
      dateFormatted,
      versionScore: createdRaw || 0,
      versionLabel: isObj && rawItem.object ? String(rawItem.object) : undefined,
    },
  };
}

/**
 * Classifica e valida um modelo retornado pela API do Google Gemini.
 * Não inventa timestamps: mantém 'Data não informada' e utiliza versionScore oficial.
 * Não inventa status operacional: define 'compatible' a menos que já tenha execução comprovada.
 */
export function classifyGeminiModel(rawModel) {
  const rawName = String(rawModel?.name || rawModel?.id || '').trim();
  const canonicalId = rawName.startsWith('models/') ? rawName.slice(7) : rawName;
  const lower = canonicalId.toLowerCase();

  if (!canonicalId) {
    return { model: null, discardReason: 'id_ausente' };
  }

  // 1. Exclusão expressa de modelos de robótica e streaming físico
  if (lower.includes('robotics') || lower.includes('robot')) {
    return { model: null, discardReason: 'modalidade_especializada_robotica' };
  }

  // 2. Exclusão de outras modalidades incompatíveis
  if (lower.includes('embedding') || lower.includes('embed')) {
    return { model: null, discardReason: 'modalidade_embeddings' };
  }
  if (lower.includes('imagen') || lower.includes('imagegeneration')) {
    return { model: null, discardReason: 'modalidade_geracao_imagem' };
  }
  if (lower.includes('aqa')) {
    return { model: null, discardReason: 'modalidade_aqa' };
  }
  if (lower.includes('tts') || lower.includes('audio') || lower.includes('bidi') || lower.includes('live-streaming') || lower.includes('realtime')) {
    return { model: null, discardReason: 'modalidade_audio_realtime' };
  }
  if (lower.includes('computer-use')) {
    return { model: null, discardReason: 'modalidade_computer_use' };
  }
  if (lower.includes('medlm') || lower.includes('med-')) {
    return { model: null, discardReason: 'modalidade_medica_fechada' };
  }

  // 3. Validação de métodos suportados
  const methods = Array.isArray(rawModel?.supportedGenerationMethods)
    ? rawModel.supportedGenerationMethods
    : Array.isArray(rawModel?.supportedActions)
    ? rawModel.supportedActions
    : ['generateContent'];

  if (methods.length > 0 && !methods.includes('generateContent')) {
    return { model: null, discardReason: 'nao_suporta_generate_content' };
  }

  // 4. Verificação de família compatível (Gemini)
  if (!lower.includes('gemini')) {
    return { model: null, discardReason: 'nao_e_familia_gemini' };
  }

  // 5. Exclusão de modelos fictícios ou não homologados
  if (/gemini-[4-9]/.test(lower) || lower.includes('argon') || lower.includes('ficticio')) {
    return { model: null, discardReason: 'modelo_ficticio_ou_nao_homologado' };
  }

  // 6. Exclusão de modelos descontinuados ou encerrados (Gemini 1.0, 1.5, 2.0 encerrado em 01/06/2026)
  const isDeprecatedOrShutdown =
    lower.includes('gemini-1.0') ||
    lower.includes('gemini-1.5') ||
    lower.includes('gemini-2.0') ||
    lower.includes('ultra') ||
    lower.includes('-exp') ||
    lower.includes('-preview-') ||
    lower.includes('preview-0') ||
    lower.includes('-001') ||
    lower.includes('thinking-exp');

  if (isDeprecatedOrShutdown) {
    return { model: null, discardReason: 'modelo_descontinuado_ou_snapshot_antigo' };
  }

  const supportsThinking =
    lower.includes('3.') ||
    lower.includes('2.5') ||
    lower.includes('thinking') ||
    lower.includes('pro');

  const isExperimentalOrDated = lower.includes('-exp') || lower.includes('-preview') || /-\d{4}/.test(lower);

  let category = 'compatible';
  if (!isExperimentalOrDated) {
    if (
      canonicalId === 'gemini-3.8-flash' ||
      canonicalId === 'gemini-2.5-pro' ||
      canonicalId === 'gemini-2.5-flash'
    ) {
      category = 'recommended';
    }
  }

  let displayName = `Google ${canonicalId}`;
  if (canonicalId === 'gemini-3.8-flash') displayName = 'Google Gemini 3.8 Flash';
  else if (canonicalId === 'gemini-2.5-pro') displayName = 'Google Gemini 2.5 Pro';
  else if (canonicalId === 'gemini-2.5-flash') displayName = 'Google Gemini 2.5 Flash';

  // VersionScore baseado na identificação e versão oficial do modelo
  const versionScore = parseGeminiVersionScore(canonicalId);
  const versionLabel = rawModel?.version ? String(rawModel.version) : undefined;

  // Status: Somente operacional se houver comprovação de execução no motor
  const status = isModelOperational(canonicalId) ? 'operational' : 'compatible';
  const isG38 = canonicalId === 'gemini-3.8-flash' || lower.includes('3.8');

  return {
    model: {
      id: canonicalId,
      provider: 'google',
      displayName,
      description: isG38
        ? 'Modelo multimodal de última geração do Google para raciocínio complexo, agentes autônomos e auditoria.'
        : 'Modelo Google Gemini multimodal oficial para conversação e ferramentas.',
      category,
      supportsTools: true,
      supportsThinking,
      supportsTemperature: true,
      supportsVision: true,
      supportsPdfReading: true,
      supportsStructuredOutput: true,
      contextWindow: 1000000,
      maxFileSizeMb: 30, // Limite operacional da plataforma Triverus
      maxOutputTokens: isG38 ? 64000 : 8192,
      status,
      lastVerifiedAt: new Date().toISOString(),
      createdAt: undefined,
      hasKnownDate: false,
      dateFormatted: 'Data não informada',
      versionScore,
      versionLabel,
    },
  };
}

/**
 * Ordena modelos respeitando as diretrizes:
 * - 'newest': Mais recentes primeiro (por timestamp created da OpenAI, e por versionScore para Gemini)
 * - 'oldest': Mais antigos primeiro
 * - 'alphabetical': Ordem alfabética por displayName
 */
export function sortCatalogModels(models, order = 'newest') {
  const list = [...models];

  list.sort((a, b) => {
    if (order === 'alphabetical') {
      return (a.displayName || a.id).localeCompare(b.displayName || b.id);
    }

    if (order === 'newest') {
      if (typeof a.createdAt === 'number' && typeof b.createdAt === 'number') {
        if (b.createdAt !== a.createdAt) {
          return b.createdAt - a.createdAt;
        }
      }

      if (a.provider === 'google' && b.provider === 'google') {
        if (b.versionScore !== a.versionScore) {
          return b.versionScore - a.versionScore;
        }
      }

      if (typeof a.createdAt === 'number' && typeof b.createdAt !== 'number') return -1;
      if (typeof a.createdAt !== 'number' && typeof b.createdAt === 'number') return 1;

      if (b.versionScore !== a.versionScore) {
        return b.versionScore - a.versionScore;
      }
      return (a.displayName || a.id).localeCompare(b.displayName || b.id);
    }

    if (order === 'oldest') {
      if (typeof a.createdAt === 'number' && typeof b.createdAt === 'number') {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
      }

      if (a.provider === 'google' && b.provider === 'google') {
        if (a.versionScore !== b.versionScore) {
          return a.versionScore - b.versionScore;
        }
      }

      if (typeof a.createdAt === 'number' && typeof b.createdAt !== 'number') return 1;
      if (typeof a.createdAt !== 'number' && typeof b.createdAt === 'number') return -1;

      if (a.versionScore !== b.versionScore) {
        return a.versionScore - b.versionScore;
      }
      return (a.displayName || a.id).localeCompare(b.displayName || b.id);
    }

    return 0;
  });

  return list;
}

/**
 * Consulta a API oficial da OpenAI com credenciais reais.
 */
export async function fetchOpenAIApiModels() {
  const apiKey = getRuntimeEnv('OPENAI_API_KEY');
  const nowIso = new Date().toISOString();

  if (!apiKey) {
    return {
      models: [],
      status: {
        provider: 'openai',
        state: 'missing_key',
        ok: false,
        rawCount: 0,
        acceptedCount: 0,
        recommendedCount: 0,
        compatibleCount: 0,
        discardedCount: 0,
        discardReasons: {},
        sampleDiscarded: [],
        source: 'not_configured',
        lastCheckedAt: nowIso,
        message: 'OpenAI não configurada (OPENAI_API_KEY ausente no servidor).',
        errorDetail: 'Chave de API da OpenAI não configurada nas variáveis de ambiente.',
      },
    };
  }

  try {
    const openai = new OpenAI({ apiKey, timeout: 15000 });
    const response = await openai.models.list();
    const rawList = response && Array.isArray(response.data) ? response.data : [];

    const parsed = [];
    const discardReasons = {};
    const sampleDiscarded = [];

    for (const item of rawList) {
      const { model, discardReason } = classifyOpenAIModel(item);
      if (model) {
        if (!parsed.some((m) => m.id === model.id)) {
          parsed.push(model);
        }
      } else if (discardReason) {
        discardReasons[discardReason] = (discardReasons[discardReason] || 0) + 1;
        if (sampleDiscarded.length < 10) {
          sampleDiscarded.push({ id: item?.id || 'desconhecido', reason: discardReason });
        }
      }
    }

    const sorted = sortCatalogModels(parsed, 'newest');

    const recommendedCount = sorted.filter((m) => m.category === 'recommended').length;
    const compatibleCount = sorted.filter((m) => m.category === 'compatible').length;

    return {
      models: sorted,
      status: {
        provider: 'openai',
        state: 'success',
        ok: true,
        rawCount: rawList.length,
        acceptedCount: sorted.length,
        recommendedCount,
        compatibleCount,
        discardedCount: rawList.length - sorted.length,
        discardReasons,
        sampleDiscarded,
        httpStatus: 200,
        source: 'live_api',
        lastSuccessAt: nowIso,
        lastCheckedAt: nowIso,
        message: `API OpenAI consultada com sucesso (${sorted.length} modelos compatíveis).`,
      },
    };
  } catch (err) {
    const isRateLimit = err?.status === 429 || String(err?.message || '').includes('rate');
    const state = isRateLimit ? 'rate_limit' : 'network_error';
    const message = isRateLimit
      ? 'Limite de requisições excedido na API da OpenAI (HTTP 429).'
      : `Falha ao consultar API OpenAI: ${err?.message || 'Erro de conexão'}`;

    return {
      models: [],
      status: {
        provider: 'openai',
        state,
        ok: false,
        rawCount: 0,
        acceptedCount: 0,
        recommendedCount: 0,
        compatibleCount: 0,
        discardedCount: 0,
        discardReasons: {},
        sampleDiscarded: [],
        httpStatus: err?.status,
        source: 'not_configured',
        lastCheckedAt: nowIso,
        message,
        errorDetail: err?.message,
      },
    };
  }
}

/**
 * Consulta a API oficial do Google Gemini com credenciais reais.
 */
export async function fetchGeminiApiModels() {
  const apiKey = getRuntimeEnv('GEMINI_API_KEY') || getRuntimeEnv('API_KEY');
  const nowIso = new Date().toISOString();

  if (!apiKey) {
    return {
      models: [],
      status: {
        provider: 'google',
        state: 'missing_key',
        ok: false,
        rawCount: 0,
        acceptedCount: 0,
        recommendedCount: 0,
        compatibleCount: 0,
        discardedCount: 0,
        discardReasons: {},
        sampleDiscarded: [],
        source: 'not_configured',
        lastCheckedAt: nowIso,
        message: 'Google Gemini não configurado (GEMINI_API_KEY ausente no servidor).',
        errorDetail: 'Chave de API do Google GenAI não configurada nas variáveis de ambiente.',
      },
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.list();
    const rawList = [];

    if (response && typeof response[Symbol.asyncIterator] === 'function') {
      for await (const m of response) {
        rawList.push(m);
      }
    } else if (Array.isArray(response)) {
      rawList.push(...response);
    } else if (response?.models && Array.isArray(response.models)) {
      rawList.push(...response.models);
    }

    const parsed = [];
    const discardReasons = {};
    const sampleDiscarded = [];

    for (const item of rawList) {
      const { model, discardReason } = classifyGeminiModel(item);
      if (model) {
        if (!parsed.some((m) => m.id === model.id)) {
          parsed.push(model);
        }
      } else if (discardReason) {
        discardReasons[discardReason] = (discardReasons[discardReason] || 0) + 1;
        if (sampleDiscarded.length < 10) {
          sampleDiscarded.push({ id: item?.name || item?.id || 'desconhecido', reason: discardReason });
        }
      }
    }

    const sorted = sortCatalogModels(parsed, 'newest');

    const recommendedCount = sorted.filter((m) => m.category === 'recommended').length;
    const compatibleCount = sorted.filter((m) => m.category === 'compatible').length;

    return {
      models: sorted,
      status: {
        provider: 'google',
        state: 'success',
        ok: true,
        rawCount: rawList.length,
        acceptedCount: sorted.length,
        recommendedCount,
        compatibleCount,
        discardedCount: rawList.length - sorted.length,
        discardReasons,
        sampleDiscarded,
        httpStatus: 200,
        source: 'live_api',
        lastSuccessAt: nowIso,
        lastCheckedAt: nowIso,
        message: `API Google Gemini consultada com sucesso (${sorted.length} modelos compatíveis).`,
      },
    };
  } catch (err) {
    const isRateLimit = err?.status === 429 || String(err?.message || '').includes('rate');
    const state = isRateLimit ? 'rate_limit' : 'network_error';
    const message = isRateLimit
      ? 'Limite de cota excedido na API Google GenAI (HTTP 429).'
      : `Falha ao consultar API Google Gemini: ${err?.message || 'Erro de conexão'}`;

    return {
      models: [],
      status: {
        provider: 'google',
        state,
        ok: false,
        rawCount: 0,
        acceptedCount: 0,
        recommendedCount: 0,
        compatibleCount: 0,
        discardedCount: 0,
        discardReasons: {},
        sampleDiscarded: [],
        httpStatus: err?.status,
        source: 'not_configured',
        lastCheckedAt: nowIso,
        message,
        errorDetail: err?.message,
      },
    };
  }
}

/**
 * Atualiza o catálogo dinâmico consultando exclusivamente as APIs dos provedores.
 */
export async function refreshModelCatalog() {
  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    const now = Date.now();

    const [openAiResult, geminiResult] = await Promise.all([
      fetchOpenAIApiModels(),
      fetchGeminiApiModels(),
    ]);

    const existingModels = globalCatalogState.models || [];
    const updatedModels = [];

    // 1. Processar OpenAI
    let openAiStatus = openAiResult.status;
    if (openAiResult.status.ok) {
      updatedModels.push(...openAiResult.models);
    } else {
      const prevRealOpenAi = existingModels.filter((m) => m && m.provider === 'openai');
      if (prevRealOpenAi.length > 0) {
        updatedModels.push(...prevRealOpenAi);
        openAiStatus = {
          ...openAiStatus,
          acceptedCount: prevRealOpenAi.length,
          recommendedCount: prevRealOpenAi.filter((m) => m.category === 'recommended').length,
          compatibleCount: prevRealOpenAi.filter((m) => m.category === 'compatible').length,
          source: 'cached_real_api',
          message: `${openAiStatus.message} (Exibindo ${prevRealOpenAi.length} modelos reais em cache).`,
        };
      } else {
        openAiStatus = {
          ...openAiStatus,
          acceptedCount: 0,
          recommendedCount: 0,
          compatibleCount: 0,
          source: 'not_configured',
          message: openAiResult.status.state === 'missing_key'
            ? 'OpenAI não configurada (OPENAI_API_KEY ausente).'
            : `${openAiResult.status.message} (Nenhum modelo em cache).`,
        };
      }
    }

    // 2. Processar Google Gemini
    let googleStatus = geminiResult.status;
    if (geminiResult.status.ok) {
      updatedModels.push(...geminiResult.models);
    } else {
      const prevRealGoogle = existingModels.filter((m) => m && m.provider === 'google');
      if (prevRealGoogle.length > 0) {
        updatedModels.push(...prevRealGoogle);
        googleStatus = {
          ...googleStatus,
          acceptedCount: prevRealGoogle.length,
          recommendedCount: prevRealGoogle.filter((m) => m.category === 'recommended').length,
          compatibleCount: prevRealGoogle.filter((m) => m.category === 'compatible').length,
          source: 'cached_real_api',
          message: `${googleStatus.message} (Exibindo ${prevRealGoogle.length} modelos reais em cache).`,
        };
      } else {
        googleStatus = {
          ...googleStatus,
          acceptedCount: 0,
          recommendedCount: 0,
          compatibleCount: 0,
          source: 'not_configured',
          message: geminiResult.status.state === 'missing_key'
            ? 'Google Gemini não configurado (GEMINI_API_KEY ausente).'
            : `${geminiResult.status.message} (Nenhum modelo em cache).`,
        };
      }
    }

    const recs = sortCatalogModels(updatedModels.filter((m) => m.category === 'recommended'), 'newest');
    const comps = sortCatalogModels(updatedModels.filter((m) => m.category !== 'recommended'), 'newest');
    const finalSorted = [...recs, ...comps];

    const isStale = !openAiResult.status.ok || !geminiResult.status.ok;
    const lastError = !openAiResult.status.ok && openAiResult.status.state !== 'missing_key'
      ? openAiResult.status.message
      : !geminiResult.status.ok && geminiResult.status.state !== 'missing_key'
      ? geminiResult.status.message
      : undefined;

    globalCatalogState = {
      models: finalSorted,
      lastFetchedAt: now,
      isStale,
      lastError,
      providerStatus: {
        openai: openAiStatus,
        google: googleStatus,
      },
    };

    activeFetchPromise = null;
    return globalCatalogState;
  })();

  return activeFetchPromise;
}

/**
 * Obtém o catálogo dinâmico de modelos com cache de 24 horas.
 */
export async function getModelCatalog(forceRefresh = false) {
  const isExpired = Date.now() - globalCatalogState.lastFetchedAt > CACHE_TTL_MS;
  if (forceRefresh || isExpired || globalCatalogState.lastFetchedAt === 0) {
    return refreshModelCatalog();
  }
  return globalCatalogState;
}

/**
 * Resolve as capacidades dinâmicas de um modelo a partir de seu ID canônico.
 */
export function resolveModelCapability(modelId) {
  const rawId = (modelId || '').trim();
  if (!rawId) {
    return {
      isValid: false,
      model: null,
      provider: null,
      canonicalModel: '',
      displayName: 'Não configurado',
    };
  }

  const norm = rawId.toLowerCase();
  const currentList = globalCatalogState.models || [];

  const match = currentList.find((m) => m && m.id && m.id.toLowerCase() === norm);
  if (match) {
    return {
      isValid: true,
      model: match,
      provider: match.provider,
      canonicalModel: match.id,
      displayName: match.displayName,
    };
  }

  const isGoogle = norm.includes('gemini');
  const isOpenAI = norm.includes('gpt') || norm.startsWith('o1') || norm.startsWith('o3');

  // Rejeitar modalidades manifestamente incompatíveis ou descontinuadas
  const isDiscontinuedGemini =
    norm.includes('gemini-1.0') ||
    norm.includes('gemini-1.5') ||
    norm.includes('gemini-2.0') ||
    norm.includes('ultra') ||
    norm.includes('argon') ||
    norm.includes('gemini-4');

  const isDiscontinuedOpenAI =
    norm.includes('-0301') ||
    norm.includes('-0613') ||
    norm.includes('-16k') ||
    norm.includes('-0314') ||
    norm.includes('-32k') ||
    norm.includes('vision-preview') ||
    norm.includes('preview-0') ||
    norm.startsWith('gpt-5') ||
    norm.startsWith('gpt-6');

  if (
    norm.includes('robotics') ||
    norm.includes('robot') ||
    norm.includes('embedding') ||
    norm.includes('dall-e') ||
    norm.includes('whisper') ||
    isDiscontinuedGemini ||
    isDiscontinuedOpenAI
  ) {
    const prov = isGoogle ? 'google' : isOpenAI ? 'openai' : null;
    return {
      isValid: false,
      model: null,
      provider: prov,
      canonicalModel: rawId,
      displayName: rawId ? `${rawId} (Descontinuado/Inativo)` : 'Modelo não suportado',
    };
  }

  if (isGoogle) {
    const isG38 = norm === 'gemini-3.8-flash' || norm.includes('3.8');
    const isG25Pro = norm === 'gemini-2.5-pro' || (norm.includes('2.5') && norm.includes('pro'));
    const isG25Flash = norm === 'gemini-2.5-flash' || (norm.includes('2.5') && norm.includes('flash'));
    const isRecommended = isG38 || isG25Pro || isG25Flash;

    return {
      isValid: true,
      model: {
        id: rawId,
        provider: 'google',
        displayName: isG38
          ? 'Google Gemini 3.8 Flash'
          : isG25Pro
          ? 'Google Gemini 2.5 Pro'
          : isG25Flash
          ? 'Google Gemini 2.5 Flash'
          : `Google ${rawId}`,
        category: isRecommended ? 'recommended' : 'compatible',
        supportsTools: true,
        supportsThinking: true,
        supportsTemperature: true,
        supportsVision: true,
        supportsPdfReading: true,
        supportsStructuredOutput: true,
        contextWindow: 1000000,
        maxFileSizeMb: 30,
        maxOutputTokens: isG38 ? 64000 : 8192,
        status: isModelOperational(rawId) ? 'operational' : 'compatible',
        lastVerifiedAt: new Date().toISOString(),
        hasKnownDate: false,
        dateFormatted: 'Data não informada',
        versionScore: parseGeminiVersionScore(rawId),
      },
      provider: 'google',
      canonicalModel: rawId,
      displayName: isG38 ? 'Google Gemini 3.8 Flash' : `Google ${rawId}`,
    };
  }

  if (isOpenAI) {
    const isReasoning = norm.startsWith('o1') || norm.startsWith('o3');
    const isToolsConfirmed =
      norm === 'gpt-4o' ||
      norm === 'gpt-4o-mini' ||
      norm === 'o1' ||
      norm === 'o3-mini' ||
      norm === 'gpt-4-turbo' ||
      norm === 'gpt-4' ||
      norm === 'gpt-3.5-turbo' ||
      norm === 'chatgpt-4o-latest';

    const supportsVision = norm.includes('gpt-4o') || norm.includes('gpt-4-turbo') || norm === 'o1';
    // o3-mini é modelo apenas texto para raciocínio, sem visão ou leitura de PDF
    const supportsPdfReading = supportsVision;
    const supportsStructuredOutput = norm.includes('gpt-4o') || norm === 'o1' || norm === 'o3-mini';

    const isRecommendedOpenAI =
      norm === 'gpt-4o' ||
      norm === 'gpt-4o-mini' ||
      norm === 'o1' ||
      norm === 'o3-mini' ||
      norm === 'gpt-4-turbo';

    return {
      isValid: true,
      model: {
        id: rawId,
        provider: 'openai',
        displayName: `OpenAI ${rawId}`,
        category: isRecommendedOpenAI ? 'recommended' : 'compatible',
        supportsTools: isToolsConfirmed ? true : false,
        supportsThinking: isReasoning,
        supportsTemperature: !isReasoning,
        supportsVision,
        supportsPdfReading,
        supportsStructuredOutput,
        contextWindow: (norm.includes('gpt-4o') || norm === 'o1' || norm === 'o3-mini') ? 128000 : 8192,
        maxFileSizeMb: 30,
        maxOutputTokens: isReasoning ? 8192 : 4096,
        status: isModelOperational(rawId) ? 'operational' : 'compatible',
        lastVerifiedAt: new Date().toISOString(),
        hasKnownDate: false,
        dateFormatted: 'Data não informada',
        versionScore: 0,
      },
      provider: 'openai',
      canonicalModel: rawId,
      displayName: `OpenAI ${rawId}`,
    };
  }

  return {
    isValid: false,
    model: null,
    provider: null,
    canonicalModel: rawId,
    displayName: rawId || 'Modelo não suportado',
  };
}

/**
 * Valida se o modelo selecionado satisfaz tecnicamente todas as capacidades ativas do agente com rigor absoluto.
 */
export function checkModelCapabilityForAgent(modelId, agentCapabilities) {
  const resolved = resolveModelCapability(modelId);
  if (!resolved.isValid || !resolved.model) {
    return {
      isCompatible: false,
      reason: !modelId || !modelId.trim()
        ? 'Nenhum modelo de inteligência está selecionado para o agente.'
        : `O modelo "${modelId}" não é reconhecido ou foi descontinuado pelo provedor.`,
      model: null,
      canonicalModel: resolved.canonicalModel,
      displayName: resolved.displayName,
      provider: resolved.provider,
    };
  }

  const model = resolved.model;
  const caps = agentCapabilities || {};

  const reqCrm = Boolean(caps.crm || caps.google_drive || caps.memorias || caps.agenda);
  const reqAuditoria = Boolean(caps.auditoria);

  // 1. Requisito de Chamada de Ferramentas (Function Calling) - Verificação ESTRITA
  if ((reqCrm || reqAuditoria) && model.supportsTools !== true) {
    return {
      isCompatible: false,
      reason: `O modelo ${model.displayName} não possui suporte explicitamente confirmado a chamadas de ferramentas (Function Calling) exigidas pelas capacidades ativas.`,
      model,
      canonicalModel: resolved.canonicalModel,
      displayName: resolved.displayName,
      provider: resolved.provider,
    };
  }

  // 2. Requisito de Leitura e Interpretação de PDFs (Auditoria) - Verificação ESTRITA
  if (reqAuditoria && model.supportsPdfReading !== true) {
    return {
      isCompatible: false,
      reason: `O modelo ${model.displayName} não possui suporte explicitamente confirmado à leitura e interpretação de documentos PDF exigida para a capacidade Auditoria.`,
      model,
      canonicalModel: resolved.canonicalModel,
      displayName: resolved.displayName,
      provider: resolved.provider,
    };
  }

  return {
    isCompatible: true,
    model,
    canonicalModel: resolved.canonicalModel,
    displayName: resolved.displayName,
    provider: resolved.provider,
  };
}

/**
 * Permite redefinir ou injetar estado para testes automatizados
 */
export function setCatalogStateForTesting(state) {
  globalCatalogState = {
    ...globalCatalogState,
    ...state,
  };
}
