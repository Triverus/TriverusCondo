import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkModelCapabilityForAgent, resolveModelCapability } from '../modelCatalogService.ts';
import { runReadAuditoriaDocumento } from '../auditoriaTools.ts';
import { executeAgentChat } from '../agentExecutionEngine.ts';
import { saveGlobalAgent } from '../agentService.ts';

// Mock Supabase admin client for testing
function createMockSupabase() {
  const dummyDocs = [
    {
      id: 'doc_01',
      condo_id: 'condo_123',
      condo_name: 'Condomínio Lagoinha',
      drive_file_id: 'drive_pdf_01',
      drive_file_name: 'Convenção_Lagoinha_2024.pdf',
      category: 'convenção',
      created_at: '2026-03-01T10:00:00Z',
    },
  ];

  const dummyProfiles = [
    { id: 'usr_admin', email: 'admin@triverus.com', role: 'admin', is_active: true },
    { id: 'usr_user', email: 'user@triverus.com', role: 'collaborator', is_active: true },
  ];

  const dummyPermissions = [
    { user_id: 'usr_admin', can_access_auditoria: true, can_manage_auditoria: true, can_access_crm: true },
    { user_id: 'usr_user', can_access_auditoria: true, can_access_crm: true },
  ];

  const dummyLeads = [
    { id: 'condo_123', name: 'Condomínio Lagoinha' },
  ];

  const makeChain = (dataPromise) => {
    return {
      eq: (field, val) => makeChain(dataPromise.then((rows) => rows.filter((r) => r && r[field] === val))),
      ilike: (field, val) => makeChain(dataPromise.then((rows) => {
        const normVal = String(val).replace(/%/g, '').toLowerCase();
        return rows.filter((r) => r && String(r[field] || '').toLowerCase().includes(normVal));
      })),
      order: (field, opts) => makeChain(dataPromise),
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
        select: (cols) => makeChain(Promise.resolve([...initialRows])),
        upsert: (record) => Promise.resolve({ data: record, error: null }),
      };
    },
  };
}

describe('TRIVERUS — Model Capabilities & Document Reading Unit Tests', () => {

  it('Scenário A: checkModelCapabilityForAgent identifies OpenAI gpt-4o as fully compatible with Auditoria', () => {
    const check = checkModelCapabilityForAgent('gpt-4o', { auditoria: true, crm: true });
    assert.strictEqual(check.isCompatible, true);
    assert.strictEqual(check.provider, 'openai');
    assert.strictEqual(check.canonicalModel, 'gpt-4o');
    assert.strictEqual(check.model?.supportsPdfReading, true);
  });

  it('Scenário B: checkModelCapabilityForAgent identifies Google gemini-3.8-flash as fully compatible with Auditoria', () => {
    const check = checkModelCapabilityForAgent('gemini-3.8-flash', { auditoria: true });
    assert.strictEqual(check.isCompatible, true);
    assert.strictEqual(check.provider, 'google');
    assert.strictEqual(check.canonicalModel, 'gemini-3.8-flash');
    assert.strictEqual(check.model?.supportsPdfReading, true);
  });

  it('Scenário C: checkModelCapabilityForAgent rejects o1-preview for CRM/Auditoria due to missing tools support', () => {
    const check = checkModelCapabilityForAgent('o1-preview', { auditoria: true });
    assert.strictEqual(check.isCompatible, false);
    assert.strictEqual(check.reason?.includes('chamadas de ferramentas'), true);
  });

  it('Scenário D: checkModelCapabilityForAgent rejects gpt-3.5-turbo for Auditoria due to missing PDF support', () => {
    const check = checkModelCapabilityForAgent('gpt-3.5-turbo', { auditoria: true });
    assert.strictEqual(check.isCompatible, false);
    assert.strictEqual(check.reason?.includes('leitura e interpretação de documentos PDF'), true);
  });

  it('Scenário E: executeAgentChat rejects execution if model is incompatible with agent capabilities without fallback', async () => {
    const mockDb = createMockSupabase();
    const result = await executeAgentChat({
      messages: [{ role: 'user', content: 'Leia a convenção do condomínio' }],
      agent: {
        id: 'agent_test_incompatible',
        name: 'Agente Incompatível',
        modelId: 'o1-preview',
        capabilities: { auditoria: true },
      },
      toolContext: {
        activeProfile: { id: 'usr_admin', email: 'admin@triverus.com', role: 'admin' },
        supabaseAdmin: mockDb,
      },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'model_capability_incompatible');
    assert.strictEqual(result.text?.includes('Incompatibilidade de Modelo'), true);
  });

  it('Scenário F: saveGlobalAgent rejects saving an agent with incompatible model/capabilities', async () => {
    const mockDb = createMockSupabase();
    await assert.rejects(
      async () => {
        await saveGlobalAgent(
          {
            id: 'agent_invalid',
            name: 'Agente Inválido',
            role: 'Auditor',
            modelId: 'gpt-3.5-turbo',
            capabilities: { auditoria: true },
          },
          'usr_admin',
          mockDb
        );
      },
      (err) => {
        assert.strictEqual(err.message.includes('Incompatibilidade de Modelo'), true);
        assert.strictEqual(err.message.includes('gpt-3.5-turbo'), true);
        return true;
      }
    );
  });

  it('Scenário G: runReadAuditoriaDocumento verifies agent model compatibility strictly', async () => {
    const mockDb = createMockSupabase();
    const contextIncompatible = {
      userId: 'usr_admin',
      supabaseAdmin: mockDb,
      activeProfile: { id: 'usr_admin', is_active: true },
      agentModelId: 'gpt-3.5-turbo',
      agent: { modelId: 'gpt-3.5-turbo', capabilities: { auditoria: true } },
    };

    const res = await runReadAuditoriaDocumento(
      { condoId: 'Lagoinha', driveFileId: 'drive_pdf_01', query: 'Qual o quórum de eleição?' },
      contextIncompatible
    );

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'model_capability_incompatible');
    assert.strictEqual(res.message?.includes('Incompatibilidade de modelo'), true);
  });

  it('Scenário H: resolveModelCapability preserves custom model IDs without silent replacement', () => {
    const resolved = resolveModelCapability('gpt-4o');
    assert.strictEqual(resolved.isValid, true);
    assert.strictEqual(resolved.canonicalModel, 'gpt-4o');
    assert.strictEqual(resolved.provider, 'openai');

    const resolvedGemini = resolveModelCapability('gemini-2.5-flash');
    assert.strictEqual(resolvedGemini.isValid, true);
    assert.strictEqual(resolvedGemini.canonicalModel, 'gemini-2.5-flash');
    assert.strictEqual(resolvedGemini.provider, 'google');
  });

});
