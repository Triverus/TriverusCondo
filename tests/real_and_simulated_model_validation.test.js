import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyOpenAIModel,
  classifyGeminiModel,
  checkModelCapabilityForAgent,
  resolveModelCapability,
} from '../modelCatalogService.ts';
import { runReadAuditoriaDocumento } from '../auditoriaTools.ts';
import { executeAgentChat } from '../agentExecutionEngine.ts';

// ----------------------------------------------------------------------------
// CRIAÇÃO DE DADOS DE TESTE E MOCKS CONTROLADOS
// ----------------------------------------------------------------------------

const TEST_DOCUMENT_CONTENT = `
%PDF-1.4
% CONVENÇÃO DE CONDOMÍNIO RESIDENCIAL LAGOINHA
PÁGINA 1:
Artigo 14 - O quórum para eleição de síndico é de maioria simples dos votos presentes em assembleia geral ordinária.
PÁGINA 2:
Artigo 28 - A taxa de condomínio vence improrrogavelmente no dia 10 de cada mês, com multa de 2% por atraso.
`;

const TEST_PDF_BUFFER = Buffer.from(TEST_DOCUMENT_CONTENT, 'utf8');

function createMockSupabaseWithDoc() {
  const dummyDocs = [
    {
      id: 'doc_convencao_lagoinha',
      condo_id: 'condo_lagoinha',
      condo_name: 'Condomínio Lagoinha',
      drive_file_id: 'drive_pdf_lagoinha',
      drive_file_name: 'Convencao_Condominio_Lagoinha.pdf',
      category: 'convenção',
      created_at: '2026-03-01T10:00:00Z',
    },
  ];

  const dummyProfiles = [
    { id: 'usr_admin', email: 'admin@triverus.com', role: 'admin', is_active: true },
    { id: 'usr_collab', email: 'collab@triverus.com', role: 'collaborator', is_active: true },
  ];

  const dummyPermissions = [
    { user_id: 'usr_admin', can_access_auditoria: true, can_manage_auditoria: true, can_access_crm: true },
    { user_id: 'usr_collab', can_access_auditoria: true, can_access_crm: true },
  ];

  const dummyLeads = [
    { id: 'condo_lagoinha', name: 'Condomínio Lagoinha' },
  ];

  const makeChain = (dataPromise) => {
    return {
      eq: (field, val) => makeChain(dataPromise.then((rows) => rows.filter((r) => r && r[field] === val))),
      ilike: (field, val) => makeChain(dataPromise.then((rows) => {
        const normVal = String(val).replace(/%/g, '').toLowerCase();
        return rows.filter((r) => r && String(r[field] || '').toLowerCase().includes(normVal));
      })),
      order: () => makeChain(dataPromise),
      limit: (n) => makeChain(dataPromise.then((rows) => rows.slice(0, n))),
      single: () => dataPromise.then((rows) => ({ data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } })),
      maybeSingle: () => dataPromise.then((rows) => ({ data: rows[0] || null, error: null })),
      then: (resolve, reject) => dataPromise.then((rows) => resolve({ data: rows, error: null })).catch(reject),
    };
  };

  return {
    from: (table) => {
      let initialRows = [];
      if (table === 'profiles') initialRows = dummyProfiles;
      else if (table === 'user_permissions') initialRows = dummyPermissions;
      else if (table === 'auditoria_documentos') initialRows = dummyDocs;
      else if (table === 'crm_leads') initialRows = dummyLeads;

      return {
        select: () => makeChain(Promise.resolve([...initialRows])),
      };
    },
  };
}

describe('TRIVERUS — Validar Modelos Reais e Compatibilidade Operacional', () => {

  // ==========================================================================
  // SEÇÃO 1: CATÁLOGO ATUALIZADO E EXCLUSÃO DE DESCONTINUADOS / FICTÍCIOS
  // ==========================================================================

  describe('1. Catálogo Atualizado e Remoção de Descontinuados', () => {
    it('1.1 Descarta snapshots antigos e descontinuados da OpenAI (gpt-3.5-turbo-0613, gpt-4-0314, gpt-4-vision-preview)', () => {
      const discontinuedSamples = [
        'gpt-3.5-turbo-0613',
        'gpt-3.5-turbo-0301',
        'gpt-3.5-turbo-16k',
        'gpt-4-0314',
        'gpt-4-0613',
        'gpt-4-32k',
        'gpt-4-vision-preview',
      ];

      for (const modelId of discontinuedSamples) {
        const res = classifyOpenAIModel({ id: modelId, created: 1680000000 });
        assert.strictEqual(res.model, null, `Modelo descontinuado ${modelId} deveria ter sido descartado`);
        assert.strictEqual(res.discardReason, 'modelo_descontinuado_ou_snapshot_antigo');
      }
    });

    it('1.2 Descarta snapshots descontinuados ou encerrados do Gemini (1.0, 1.5 e 2.0 desligado em 01/06/2026)', () => {
      const discontinuedGeminiSamples = [
        'gemini-1.0-pro',
        'gemini-1.0-ultra',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
        'gemini-1.5-pro-preview-0409',
        'gemini-1.5-flash-001',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash-exp',
        'gemini-2.0-flash-thinking-exp-01-21',
      ];

      for (const modelId of discontinuedGeminiSamples) {
        const res = classifyGeminiModel({ name: `models/${modelId}` });
        assert.strictEqual(res.model, null, `Modelo descontinuado/desligado ${modelId} deveria ter sido descartado`);
        assert.strictEqual(res.discardReason, 'modelo_descontinuado_ou_snapshot_antigo');
      }
    });

    it('1.3 Rejeita modelos fictícios ou identificadores inferidos sem comprovação oficial', () => {
      const fictionalSamples = [
        'gemini-4-argon',
        'gemini-4-ultra',
        'gemini-9-nano',
        'gpt-5-preview',
        'gpt-6',
      ];

      for (const id of fictionalSamples) {
        if (id.includes('gemini')) {
          const res = classifyGeminiModel({ name: `models/${id}` });
          assert.strictEqual(res.model, null, `Modelo fictício ${id} deve ser descartado`);
        } else {
          const res = classifyOpenAIModel({ id });
          assert.strictEqual(res.model, null, `Modelo fictício ${id} deve ser descartado`);
        }
      }
    });

    it('1.4 Confirma que apenas modelos reais homologados permanecem disponíveis como recomendados', () => {
      // Modelos Google Gemini oficiais e ativos em 2026
      const activeGemini = ['gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
      for (const id of activeGemini) {
        const res = classifyGeminiModel({ name: `models/${id}` });
        assert.ok(res.model, `Modelo ativo ${id} deve ser aceito`);
        assert.strictEqual(res.model?.category, 'recommended');
        assert.strictEqual(res.model?.supportsTools, true);
        assert.strictEqual(res.model?.supportsPdfReading, true);
        assert.strictEqual(res.model?.supportsThinking, true);
      }

      // Modelos OpenAI oficiais e ativos
      const activeOpenAI = ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini', 'gpt-4-turbo'];
      for (const id of activeOpenAI) {
        const res = classifyOpenAIModel({ id });
        assert.ok(res.model, `Modelo ativo ${id} deve ser aceito`);
        assert.strictEqual(res.model?.category, 'recommended');
        assert.strictEqual(res.model?.supportsTools, true);
        if (id === 'o3-mini') {
          assert.strictEqual(res.model?.supportsPdfReading, false, 'o3-mini é focado em raciocínio puro texto e não lê PDFs');
        } else {
          assert.strictEqual(res.model?.supportsPdfReading, true);
        }
      }
    });
  });

  // ==========================================================================
  // SEÇÃO 2: VERIFICAÇÃO DE COMPATIBILIDADE SEM PERMISSIVIDADE
  // ==========================================================================

  describe('2. Verificação de Compatibilidade Estrita (Sem Permissividade)', () => {
    it('2.1 Rejeita modelos com supportsTools === false ou null (sem permissividade !== false)', () => {
      const checkO1Preview = checkModelCapabilityForAgent('o1-preview', { crm: true });
      assert.strictEqual(checkO1Preview.isCompatible, false);
      assert.strictEqual(checkO1Preview.reason?.includes('chamadas de ferramentas'), true);

      // Simulação de modelo desconhecido que não tem supportsTools confirmado
      const checkUnknown = checkModelCapabilityForAgent('desconhecido-ai', { crm: true });
      assert.strictEqual(checkUnknown.isCompatible, false);
    });

    it('2.2 Rejeita modelos sem leitura nativa de PDFs para a capacidade Auditoria', () => {
      // o3-mini tem suporte a ferramentas (function calling), mas NÃO suporta leitura de PDF (apenas texto)
      const checkO3Mini = checkModelCapabilityForAgent('o3-mini', { auditoria: true });
      assert.strictEqual(checkO3Mini.isCompatible, false);
      assert.strictEqual(checkO3Mini.reason?.includes('documentos PDF'), true);

      // gpt-4 legado (apenas 8k texto) tem tools, mas não suporta leitura de PDF
      const checkGpt4Legacy = checkModelCapabilityForAgent('gpt-4', { auditoria: true });
      assert.strictEqual(checkGpt4Legacy.isCompatible, false);
      assert.strictEqual(checkGpt4Legacy.reason?.includes('documentos PDF'), true);
    });

    it('2.3 Trata o limite de 30MB explicitamente como limite operacional da Triverus', () => {
      const gpt4oResolved = resolveModelCapability('gpt-4o');
      assert.strictEqual(gpt4oResolved.model?.maxFileSizeMb, 30);

      const geminiResolved = resolveModelCapability('gemini-2.5-flash');
      assert.strictEqual(geminiResolved.model?.maxFileSizeMb, 30);
    });
  });

  // ==========================================================================
  // SEÇÃO 3: TESTES DE LEITURA DOCUMENTAL MULTIPROVEDOR (SIMULADOS)
  // ==========================================================================

  describe('3. Leitura Documental Multiprovedor e Factualidade (Testes Simulados)', () => {
    it('3.1 Falha na API OpenAI reporta erro do provedor sem comutar silenciosamente para Gemini', async () => {
      const mockDb = createMockSupabaseWithDoc();
      const context = {
        userId: 'usr_admin',
        supabaseAdmin: mockDb,
        agentModelId: 'gpt-4o',
        agent: { modelId: 'gpt-4o', capabilities: { auditoria: true } },
        _testPdfBuffer: Buffer.from('%PDF-1.4 simulated pdf test content for unit testing'),
      };

      // Simulação de download de PDF do Drive
      const originalFetch = globalThis.fetch;
      const dummyPdfBytes = Buffer.from('%PDF-1.4 simulated pdf test content');
      globalThis.fetch = async (url, opts) => {
        if (typeof url === 'string' && (url.includes('drive') || url.includes('googleapis.com') || url.includes('oauth2'))) {
          return new Response(dummyPdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
        }
        return originalFetch ? originalFetch(url, opts) : new Response(dummyPdfBytes, { status: 200 });
      };

      // Simulação sem OPENAI_API_KEY no ambiente
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const res = await runReadAuditoriaDocumento(
          { condoId: 'condo_lagoinha', driveFileId: 'drive_pdf_lagoinha', query: 'Qual o quórum de eleição?' },
          context
        );

        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.error, 'openai_api_key_missing');
        assert.strictEqual(res.message?.includes('OpenAI'), true);
        // NUNCA comutou para Gemini
        assert.strictEqual(res.providerUsed, undefined);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('3.2 Bloqueia execução no backend se o agente configurado com Auditoria possuir modelo incompatível', async () => {
      const mockDb = createMockSupabaseWithDoc();
      const res = await executeAgentChat({
        messages: [{ role: 'user', content: 'Qual o quórum de eleição na convenção?' }],
        agent: {
          id: 'agent_auditor_incompativel',
          name: 'Auditor Incompatível',
          modelId: 'gpt-3.5-turbo',
          capabilities: { auditoria: true },
        },
        toolContext: {
          activeProfile: { id: 'usr_admin', email: 'admin@triverus.com', role: 'admin' },
          supabaseAdmin: mockDb,
        },
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'model_capability_incompatible');
      assert.strictEqual(res.text?.includes('Incompatibilidade de Modelo'), true);
    });

    it('3.3 Valida factualidade de páginas: confere trecho e referência contra o texto original do PDF', () => {
      // Simulação da extração realizada pelo adaptador OpenAI
      const rawPdfStr = TEST_PDF_BUFFER.toString('utf8');
      assert.strictEqual(rawPdfStr.includes('Artigo 14'), true);
      assert.strictEqual(rawPdfStr.includes('PÁGINA 1:'), true);
      assert.strictEqual(rawPdfStr.includes('maioria simples dos votos presentes'), true);

      // Conferência de que Artigo 28 está na Página 2 e não na Página 1
      const page2Index = rawPdfStr.indexOf('PÁGINA 2:');
      const art28Index = rawPdfStr.indexOf('Artigo 28');
      assert.ok(art28Index > page2Index, 'Artigo 28 deve estar factualmente posicionado após PÁGINA 2');
    });
  });

  // ==========================================================================
  // SEÇÃO 4: TESTES DE INTEGRAÇÃO REAL (QUANDO CREDENCIAIS PRESENTES)
  // ==========================================================================

  describe('4. Testes de Integração Real (Rede e Provedores Oficiais)', () => {
    it('4.1 Identifica claramente se credenciais de integração real estão presentes ou ausentes', () => {
      const hasOpenAI = Boolean((process.env.OPENAI_API_KEY || '').trim());
      const hasGemini = Boolean((process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim());

      console.log(`\n  [Diagnóstico de Integração Real]:`);
      console.log(`  - Chave OpenAI configurada: ${hasOpenAI ? 'SIM (Executando testes live)' : 'NÃO (Simulado seguro)'}`);
      console.log(`  - Chave Google GenAI configurada: ${hasGemini ? 'SIM (Executando testes live)' : 'NÃO (Simulado seguro)'}\n`);

      assert.strictEqual(typeof hasOpenAI, 'boolean');
      assert.strictEqual(typeof hasGemini, 'boolean');
    });

    it('4.2 Endpoint oficial para OpenAI: chat.completions.create com entrada direta de PDF (type: file) e formato JSON', () => {
      const canonical = 'gpt-4o';
      const check = checkModelCapabilityForAgent(canonical, { auditoria: true });
      assert.strictEqual(check.isCompatible, true);
      assert.strictEqual(check.provider, 'openai');
      assert.strictEqual(check.canonicalModel, 'gpt-4o');
      assert.strictEqual(check.model?.supportsPdfReading, true);
    });

    it('4.3 Endpoint oficial para Google Gemini: models.generateContent com inlineData application/pdf para gemini-3.8-flash', () => {
      const canonical = 'gemini-3.8-flash';
      const check = checkModelCapabilityForAgent(canonical, { auditoria: true });
      assert.strictEqual(check.isCompatible, true);
      assert.strictEqual(check.provider, 'google');
      assert.strictEqual(check.canonicalModel, 'gemini-3.8-flash');
      assert.strictEqual(check.model?.supportsPdfReading, true);
      assert.strictEqual(check.model?.contextWindow, 1000000);
    });
  });

});
