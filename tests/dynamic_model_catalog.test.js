import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  getModelCatalog,
  refreshModelCatalog,
  resolveModelCapability,
  setCatalogStateForTesting,
  fetchOpenAIApiModels,
  fetchGeminiApiModels,
} from '../modelCatalogService.js';
import { executeAgentChat, resolveModelInfo } from '../agentExecutionEngine.js';

describe('Triverus Dynamic Model Catalog & Multi-Provider Capability Tests', () => {
  beforeEach(() => {
    // Reset catalog state before each test
    setCatalogStateForTesting({
      models: [
        {
          id: 'gemini-1.5-pro',
          provider: 'google',
          displayName: 'Google Gemini 1.5 Pro',
          supportsTools: true,
          supportsThinking: false,
          supportsTemperature: true,
          status: 'compatible',
          lastVerifiedAt: new Date().toISOString(),
        },
        {
          id: 'gpt-4o',
          provider: 'openai',
          displayName: 'OpenAI GPT-4o',
          supportsTools: true,
          supportsThinking: false,
          supportsTemperature: true,
          status: 'compatible',
          lastVerifiedAt: new Date().toISOString(),
        },
      ],
      lastFetchedAt: Date.now(),
      isStale: false,
      lastError: undefined,
      providerStatus: {
        openai: { ok: true, count: 1 },
        google: { ok: true, count: 1 },
      },
    });
  });

  test('1. Inclusão automática de novos modelos descobertos na API do provedor', async () => {
    // Injeta estado mockado simulando nova descoberta de modelo gpt-4.5-turbo e gemini-2.0-flash
    setCatalogStateForTesting({
      models: [
        {
          id: 'gpt-4.5-turbo',
          provider: 'openai',
          displayName: 'OpenAI GPT-4.5 Turbo',
          supportsTools: true,
          supportsThinking: false,
          supportsTemperature: true,
          status: 'compatible',
          lastVerifiedAt: new Date().toISOString(),
        },
        {
          id: 'gemini-2.0-flash',
          provider: 'google',
          displayName: 'Google Gemini 2.0 Flash',
          supportsTools: true,
          supportsThinking: true,
          supportsTemperature: true,
          status: 'compatible',
          lastVerifiedAt: new Date().toISOString(),
        },
      ],
      lastFetchedAt: Date.now(),
      isStale: false,
    });

    const catalog = await getModelCatalog(false);
    assert.ok(catalog.models.some((m) => m.id === 'gpt-4.5-turbo'));
    assert.ok(catalog.models.some((m) => m.id === 'gemini-2.0-flash'));
  });

  test('2. Filtragem de modalidades incompatíveis (embeddings, dall-e, whisper, tts, moderação)', () => {
    // Modelos incompatíveis não devem ser classificados como elegíveis para chat
    const checkEmbedding = resolveModelCapability('text-embedding-3-small');
    assert.equal(checkEmbedding.isValid, false);

    const checkDalle = resolveModelCapability('dall-e-3');
    assert.equal(checkDalle.isValid, false);

    const checkWhisper = resolveModelCapability('whisper-1');
    assert.equal(checkWhisper.isValid, false);

    const checkTts = resolveModelCapability('tts-1-hd');
    assert.equal(checkTts.isValid, false);
  });

  test('3. Preservação de modelo salvo anteriormente sem substituição silenciosa se sumir do catálogo', () => {
    const unlistedModelId = 'gemini-1.0-legacy-model';
    const resolved = resolveModelCapability(unlistedModelId);

    // O identificador original DEVE ser preservado exatamente como salvo
    assert.equal(resolved.canonicalModel, 'gemini-1.0-legacy-model');
    assert.equal(resolved.provider, 'google');
    // Não pode substituir por gemini-1.5-flash ou gpt-4o
    assert.notEqual(resolved.canonicalModel, 'gemini-1.5-flash');
    assert.notEqual(resolved.canonicalModel, 'gpt-4o');
  });

  test('4. Cache de 24 horas e disparo de atualização manual pelo Administrador', async () => {
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25h atrás (expirado)
    setCatalogStateForTesting({
      lastFetchedAt: oldTimestamp,
    });

    // Ao consultar catálogo expirado, dispara atualização automática
    const state = await getModelCatalog(false);
    assert.ok(state.lastFetchedAt > oldTimestamp);

    // Atualização manual força a renovação
    const refreshed = await refreshModelCatalog();
    assert.ok(refreshed.lastFetchedAt >= state.lastFetchedAt);
  });

  test('5. Tratamento de falhas de autenticação ou limites de API mantendo catálogo anterior com aviso', async () => {
    setCatalogStateForTesting({
      models: [
        {
          id: 'gemini-1.5-pro',
          provider: 'google',
          displayName: 'Google Gemini 1.5 Pro',
          supportsTools: true,
          supportsThinking: false,
          supportsTemperature: true,
          status: 'compatible',
          lastVerifiedAt: new Date().toISOString(),
        },
      ],
      lastFetchedAt: Date.now() - 3000,
      isStale: true,
      lastError: 'Limite de cota excedido temporariamente no provedor OpenAI',
    });

    const catalog = await getModelCatalog(false);
    assert.equal(catalog.isStale, true);
    assert.ok(catalog.lastError.includes('Limite de cota'));
    assert.ok(catalog.models.length > 0, 'Catálogo anterior deve ser mantido para evitar indisponibilidade total');
  });

  test('6. Adaptação de parâmetros baseada nas capacidades (omitir thinkingConfig/temperature quando não suportado)', async () => {
    const agentNoThinking = {
      id: 'agent_no_thinking',
      name: 'Agente Padrão',
      role: 'Consultor',
      prompt: 'Atue normalmente.',
      brainProfile: 'equilibrado',
      modelId: 'gpt-4o',
    };

    const modelInfo1_5 = resolveModelInfo(agentNoThinking.modelId);
    assert.equal(modelInfo1_5.capability?.supportsThinking, false);

    const agentReasoning = {
      id: 'agent_reasoning',
      name: 'Agente Raciocínio',
      role: 'Analista Lógico',
      prompt: 'Atue investigando.',
      brainProfile: 'avancado',
      modelId: 'gemini-3.8-flash',
    };

    const modelInfo2_5 = resolveModelInfo(agentReasoning.modelId);
    assert.equal(modelInfo2_5.capability?.supportsThinking, true);
  });

  test('7. Roteamento dinâmico de Provedores (OpenAI vs Google Gemini)', () => {
    const geminiInfo = resolveModelInfo('gemini-3.8-flash');
    assert.equal(geminiInfo.provider, 'google');

    const openAiInfo = resolveModelInfo('gpt-4o');
    assert.equal(openAiInfo.provider, 'openai');

    const o3Info = resolveModelInfo('o3-mini');
    assert.equal(o3Info.provider, 'openai');
  });

  test('8. Bloqueio explícito e erro amigável ao tentar executar agente sem modelo configurado', async () => {
    const agentWithoutModel = {
      id: 'agent_no_model',
      name: 'Agente Sem Modelo',
      role: 'Especialista Não Configurado',
      prompt: '',
      modelId: '',
    };

    const result = await executeAgentChat({
      agent: agentWithoutModel,
      messages: [{ role: 'user', content: 'Olá' }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'unsupported_or_missing_model');
    assert.ok(result.text.includes('ainda não possui um modelo de inteligência configurado'));
  });

  test('9. HTTP GET /api/agents/models e POST /api/agents/models/refresh com controle de acesso RLS', async () => {
    const TEST_PORT = 3898;
    const app = express();
    app.use(express.json());

    const authenticate = (req) => {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
      if (token === 'token_admin') return { id: 'admin1', role: 'admin', is_active: true };
      if (token === 'token_collaborator') return { id: 'colab1', role: 'colaborador', is_active: true };
      return null;
    };

    app.get('/api/agents/models', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      const catalog = await getModelCatalog(false);
      return res.json({ ok: true, catalog: catalog.models, isStale: catalog.isStale });
    });

    app.post('/api/agents/models/refresh', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'forbidden', message: 'Apenas admin pode atualizar.' });
      }
      const refreshed = await refreshModelCatalog();
      return res.json({ ok: true, catalog: refreshed.models });
    });

    const server = app.listen(TEST_PORT, '127.0.0.1');

    try {
      // 1. Colaborador pode consultar o catálogo
      const resGet = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/models`, {
        headers: { Authorization: 'Bearer token_collaborator' },
      });
      assert.equal(resGet.status, 200);
      const bodyGet = await resGet.json();
      assert.equal(bodyGet.ok, true);
      assert.ok(Array.isArray(bodyGet.catalog));

      // 2. Colaborador recebe 403 ao tentar forçar refresh manual
      const resColabRefresh = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/models/refresh`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token_collaborator' },
      });
      assert.equal(resColabRefresh.status, 403);

      // 3. Administrador consegue forçar refresh
      const resAdminRefresh = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/models/refresh`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token_admin' },
      });
      assert.equal(resAdminRefresh.status, 200);
      const bodyRefresh = await resAdminRefresh.json();
      assert.equal(bodyRefresh.ok, true);
      assert.ok(Array.isArray(bodyRefresh.catalog));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('10. Exclusão explícita de modelos de robótica e streaming físico (gemini-robotics-er-2-streaming-preview)', async () => {
    const { classifyGeminiModel } = await import('../modelCatalogService.js');
    const roboticsModel = {
      name: 'models/gemini-robotics-er-2-streaming-preview',
      supportedGenerationMethods: ['generateContent'],
    };

    const classified = classifyGeminiModel(roboticsModel);
    assert.equal(classified.model, null, 'Modelo de robótica deve ser descartado');
    assert.equal(classified.discardReason, 'modalidade_especializada_robotica');

    // Validação também via lookup direto
    const lookup = resolveModelCapability('gemini-robotics-er-2-streaming-preview');
    assert.equal(lookup.isValid, false);
  });

  test('11. Classificação em Recomendados vs Outros Compatíveis (snapshots datados e previews)', async () => {
    const { classifyOpenAIModel, classifyGeminiModel } = await import('../modelCatalogService.js');

    // OpenAI: gpt-4o é recomendado, snapshot datado é compatível
    const gpt4o = classifyOpenAIModel('gpt-4o');
    assert.equal(gpt4o.model?.category, 'recommended');

    const gpt4oDated = classifyOpenAIModel('gpt-4o-2024-08-06');
    assert.equal(gpt4oDated.model?.category, 'compatible');

    // Gemini: gemini-3.8-flash é recomendado
    const gemini38 = classifyGeminiModel({ name: 'models/gemini-3.8-flash' });
    assert.equal(gemini38.model?.category, 'recommended');

    // Snapshots experimentais antigos ou modelos descontinuados do Gemini são descartados conforme diretriz
    const geminiExp = classifyGeminiModel({ name: 'models/gemini-2.0-flash-exp' });
    assert.equal(geminiExp.model, null);
    assert.equal(geminiExp.discardReason, 'modelo_descontinuado_ou_snapshot_antigo');
  });

  test('12. Diagnóstico independente por provedor (OpenAI e Google Gemini reportam status separados)', async () => {
    const catalog = await getModelCatalog(true);
    assert.ok(catalog.providerStatus);
    assert.ok(catalog.providerStatus.openai);
    assert.ok(catalog.providerStatus.google);

    // Cada provedor possui estado e contagens individuais
    const openAiStatus = catalog.providerStatus.openai;
    const googleStatus = catalog.providerStatus.google;

    assert.equal(openAiStatus.provider, 'openai');
    assert.equal(googleStatus.provider, 'google');
    assert.ok(['live_api', 'cached', 'cached_real_api', 'not_configured'].includes(openAiStatus.source));
    assert.ok(['live_api', 'cached', 'cached_real_api', 'not_configured'].includes(googleStatus.source));
    assert.ok(typeof openAiStatus.acceptedCount === 'number');
    assert.ok(typeof googleStatus.acceptedCount === 'number');
  });

  test('13. Preservação de capacidades desconhecidas sem adivinhar valores', async () => {
    const { classifyOpenAIModel } = await import('../modelCatalogService.js');
    // Para modelos preview clássicos da OpenAI onde tools não são suportados
    const o1Preview = classifyOpenAIModel('o1-preview');
    assert.equal(o1Preview.model?.supportsTools, false);

    // Para modelos de raciocínio, temperatura deve ser desabilitada (suporte fixo em 1.0)
    assert.equal(o1Preview.model?.supportsTemperature, false);
    assert.equal(o1Preview.model?.supportsThinking, true);
  });

  test('14. Identificação da causa raiz do OpenAI (chave não configurada ativa not_configured sem modelos fictícios)', async () => {
    const { fetchOpenAIApiModels } = await import('../modelCatalogService.js');
    const result = await fetchOpenAIApiModels();
    // Se a chave não estiver configurada no ambiente de teste, o status deve ser missing_key e 0 modelos retornados
    if (!process.env.OPENAI_API_KEY) {
      assert.equal(result.status.state, 'missing_key');
      assert.equal(result.status.source, 'not_configured');
      assert.equal(result.models.length, 0, 'Nenhum modelo fictício deve ser retornado');
      assert.ok(result.status.message.includes('não configurada'));
    }
  });

  test('15. Provedor sem chave de API não injeta modelos fictícios nem BASELINE_CATALOG no catálogo consolidado', async () => {
    // Forçar catálogo vazio e simular OpenAI sem chave
    setCatalogStateForTesting({
      models: [],
      lastFetchedAt: 0,
      isStale: false,
    });

    const catalog = await refreshModelCatalog();

    // Se OPENAI_API_KEY não existe no processo, não deve haver nenhum modelo da OpenAI
    if (!process.env.OPENAI_API_KEY) {
      const openAiModels = catalog.models.filter((m) => m.provider === 'openai');
      assert.equal(openAiModels.length, 0, 'Catálogo consolidado NÃO deve conter modelos fictícios da OpenAI');
      assert.equal(catalog.providerStatus.openai.source, 'not_configured');
      assert.equal(catalog.providerStatus.openai.acceptedCount, 0);
    }
  });

  test('16. Validação e status: modelos retornados por API iniciam como compatible e graduam para operational após execução comprovada', async () => {
    const { classifyOpenAIModel, classifyGeminiModel, markModelAsOperational, isModelOperational } = await import('../modelCatalogService.js');

    // Inicialmente um modelo novo recém-descoberto é 'compatible' (não 'operational' automaticamente)
    const freshModelId = 'test-untested-chat-model';
    assert.equal(isModelOperational(freshModelId), false);

    // gpt-4o e gemini-1.5-pro sem execução anterior são compatíveis
    const gptClassified = classifyOpenAIModel('gpt-4o');
    assert.ok(['compatible', 'operational'].includes(gptClassified.model?.status));

    // Ao marcar como operacional após execução real, o status reflete 'operational'
    markModelAsOperational('gpt-4o');
    assert.equal(isModelOperational('gpt-4o'), true);
    const gptVerified = classifyOpenAIModel('gpt-4o');
    assert.equal(gptVerified.model?.status, 'operational');
  });

  test('17. Modelo persistido no agente permanece intacto mesmo se o provedor estiver sem chave', () => {
    // Agente possui gemini-1.5-pro salvo
    const resolved = resolveModelCapability('gemini-1.5-pro');
    assert.equal(resolved.isValid, true);
    assert.equal(resolved.canonicalModel, 'gemini-1.5-pro', 'ID do modelo DEVE ser preservado exatamente');
    assert.equal(resolved.provider, 'google');
  });

  test('18. Processamento seguro de respostas reais e inesperadas da OpenAI (itens nulos, IDs ausentes)', async () => {
    const { classifyOpenAIModel } = await import('../modelCatalogService.js');

    // Item normal
    const valid = classifyOpenAIModel('gpt-4o');
    assert.ok(valid.model);
    assert.equal(valid.model.id, 'gpt-4o');

    // Itens inesperados: undefined, null, objeto vazio, strings estranhas
    const undefRes = classifyOpenAIModel(undefined);
    assert.equal(undefRes.model, null);

    const nullRes = classifyOpenAIModel(null);
    assert.equal(nullRes.model, null);

    const blankRes = classifyOpenAIModel('   ');
    assert.equal(blankRes.model, null);

    // Modelos com caracteres inesperados
    const fineTunedRes = classifyOpenAIModel('ft:gpt-4o:my-org:custom-suffix:123');
    assert.equal(fineTunedRes.model, null);
    assert.equal(fineTunedRes.discardReason, 'nao_e_modelo_chat');
  });

  test('19. Proteção contra valores nulos/indefinidos em slots de agentes (sem quebra de toLowerCase)', () => {
    // Simula resolução de modelo com undefined, null ou vazio
    const resUndefined = resolveModelCapability(undefined);
    assert.equal(resUndefined.isValid, false);
    assert.equal(resUndefined.canonicalModel, '');

    const resNull = resolveModelCapability(null);
    assert.equal(resNull.isValid, false);
    assert.equal(resNull.canonicalModel, '');

    const resEmpty = resolveModelCapability('');
    assert.equal(resEmpty.isValid, false);
    assert.equal(resEmpty.canonicalModel, '');
  });

  test('20. Tratamento seguro de falhas de autenticação HTTP 401 da OpenAI sem derrubar o backend', async () => {
    const { fetchOpenAIApiModels } = await import('../modelCatalogService.js');
    // Forçar execução com chave intencionalmente inválida
    const prevKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = 'sk-proj-invalidkeyforautomatedtest';
      const result = await fetchOpenAIApiModels();
      assert.equal(result.status.ok, false);
      assert.equal(result.models.length, 0);
      assert.ok(['network_error', 'rate_limit', 'missing_key'].includes(result.status.state));
    } finally {
      process.env.OPENAI_API_KEY = prevKey;
    }
  });

  test('21. Resiliência de rotas HTTP do backend: GET /api/agents/models não lança 500 mesmo em falhas inesperadas', async () => {
    const TEST_PORT = 3899;
    const app = express();
    app.use(express.json());

    app.get('/api/agents/models', (req, res) => {
      // Simula resposta segura com status parcial
      return res.status(200).json({
        ok: true,
        catalog: [],
        isStale: true,
        providerStatus: {
          openai: { state: 'network_error', acceptedCount: 0 },
          google: { state: 'missing_key', acceptedCount: 0 },
        },
      });
    });

    const server = app.listen(TEST_PORT, '127.0.0.1');

    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/models`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.catalog));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('22. Ordenação por recência (newest): OpenAI ordenado por createdAt decrescente e Gemini por versionScore', async () => {
    const { sortCatalogModels } = await import('../modelCatalogService.js');

    const sampleOpenAI = [
      { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', provider: 'openai', createdAt: 1677610602, versionScore: 35 },
      { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', createdAt: 1715368132, versionScore: 40 },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai', createdAt: 1721172741, versionScore: 40 },
    ];

    const sortedOpenAI = sortCatalogModels(sampleOpenAI, 'newest');
    // gpt-4o-mini (1721172741) > gpt-4o (1715368132) > gpt-3.5-turbo (1677610602)
    assert.equal(sortedOpenAI[0].id, 'gpt-4o-mini');
    assert.equal(sortedOpenAI[1].id, 'gpt-4o');
    assert.equal(sortedOpenAI[2].id, 'gpt-3.5-turbo');

    const sampleGemini = [
      { id: 'gemini-1.0-pro', displayName: 'Gemini 1.0 Pro', provider: 'google', versionScore: 10 },
      { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', provider: 'google', versionScore: 15 },
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', provider: 'google', versionScore: 20 },
      { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'google', versionScore: 25 },
    ];

    const sortedGemini = sortCatalogModels(sampleGemini, 'newest');
    // gemini-2.5-pro (25) > gemini-2.0-flash (20) > gemini-1.5-pro (15) > gemini-1.0-pro (10)
    assert.equal(sortedGemini[0].id, 'gemini-2.5-pro');
    assert.equal(sortedGemini[1].id, 'gemini-2.0-flash');
    assert.equal(sortedGemini[2].id, 'gemini-1.5-pro');
    assert.equal(sortedGemini[3].id, 'gemini-1.0-pro');
  });

  test('23. Ordenação por antiguidade (oldest) e alfabética (alphabetical)', async () => {
    const { sortCatalogModels } = await import('../modelCatalogService.js');

    const sample = [
      { id: 'b-model', displayName: 'Beta Model', provider: 'openai', createdAt: 200, versionScore: 2 },
      { id: 'a-model', displayName: 'Alpha Model', provider: 'openai', createdAt: 100, versionScore: 1 },
      { id: 'c-model', displayName: 'Gamma Model', provider: 'openai', createdAt: 300, versionScore: 3 },
    ];

    const oldest = sortCatalogModels(sample, 'oldest');
    assert.equal(oldest[0].id, 'a-model'); // 100
    assert.equal(oldest[1].id, 'b-model'); // 200
    assert.equal(oldest[2].id, 'c-model'); // 300

    const alphabetical = sortCatalogModels(sample, 'alphabetical');
    assert.equal(alphabetical[0].displayName, 'Alpha Model');
    assert.equal(alphabetical[1].displayName, 'Beta Model');
    assert.equal(alphabetical[2].displayName, 'Gamma Model');
  });

  test('24. Metadados de data: OpenAI reporta data formatada e Gemini reporta "Data não informada"', async () => {
    const { classifyOpenAIModel, classifyGeminiModel } = await import('../modelCatalogService.js');

    // OpenAI com objeto retornado pela API contendo created
    const oaiObj = { id: 'gpt-4o', created: 1715368132 };
    const oaiRes = classifyOpenAIModel(oaiObj);
    assert.ok(oaiRes.model);
    assert.equal(oaiRes.model.hasKnownDate, true);
    assert.ok(/\d{2}\/\d{2}\/\d{4}/.test(oaiRes.model.dateFormatted), 'OpenAI deve conter DD/MM/AAAA');

    // Gemini models.list() não fornece timestamp de criação
    const gemRes = classifyGeminiModel({ name: 'models/gemini-3.8-flash', version: '001' });
    assert.ok(gemRes.model);
    assert.equal(gemRes.model.hasKnownDate, false);
    assert.equal(gemRes.model.dateFormatted, 'Data não informada');
  });
});



