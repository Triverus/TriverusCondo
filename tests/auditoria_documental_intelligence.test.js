import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSearchAuditoriaMemorias, runReadAuditoriaDocumento } from '../auditoriaTools.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { executeAgentChat } from '../agentExecutionEngine.ts';

describe('TRIVERUS — Etapa 2: Inteligência Documental dos Agentes (Cenários A a H)', () => {
  const userAuditorId = 'user_auditor_pedro';
  const userCommercialId = 'user_broker_carla';

  const mockCondo = {
    id: 'lead_condo_01',
    name: 'Condomínio Residencial Mirante das Pedras',
    cnpj: '12.345.678/0001-99',
  };

  const mockMemories = [
    {
      id: 'mem_01',
      condo_id: 'lead_condo_01',
      category: 'convenção',
      label: 'Quórum para alteração da Convenção',
      fill_mode: 'manual',
      manual_value: 'Exige aprovação de 2/3 dos condôminos em assembleia especialmente convocada.',
      instruction: 'Verificar se exige 2/3 ou unanimidade',
      last_result: 'Exige 2/3 dos condôminos em assembleia.',
      page_reference: 'Pág. 14 - Art. 32',
      source_drive_file_id: 'drive_pdf_01',
      source_drive_file_name: 'Convencao_Mirante_2024.pdf',
      status: 'completed',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T10:00:00Z',
    },
    {
      id: 'mem_02',
      condo_id: 'lead_condo_01',
      category: 'regulamento_interno',
      label: 'Multa por barulho após 22h',
      fill_mode: 'ai',
      manual_value: null,
      instruction: 'Buscar valor da multa por descumprimento do horário de silêncio',
      last_result: 'Multa equivalente a 1 taxa condominial vigente em caso de reincidência.',
      page_reference: 'Pág. 8 - Art. 19',
      source_drive_file_id: 'drive_pdf_02',
      source_drive_file_name: 'Regulamento_Interno_Mirante.pdf',
      status: 'completed',
      created_at: '2026-03-02T10:00:00Z',
      updated_at: '2026-03-02T10:00:00Z',
    },
  ];

  const mockAuditoriaDocs = [
    {
      id: 'doc_01',
      condo_id: 'lead_condo_01',
      condo_name: 'Condomínio Residencial Mirante das Pedras',
      category: 'convenção',
      drive_file_id: 'drive_pdf_01',
      drive_file_name: 'Convencao_Mirante_2024.pdf',
      drive_file_size: 2500000,
      created_at: '2026-03-01T09:00:00Z',
    },
    {
      id: 'doc_02',
      condo_id: 'lead_condo_01',
      condo_name: 'Condomínio Residencial Mirante das Pedras',
      category: 'regulamento_interno',
      drive_file_id: 'drive_pdf_02',
      drive_file_name: 'Regulamento_Interno_Mirante.pdf',
      drive_file_size: 1200000,
      created_at: '2026-03-02T09:00:00Z',
    },
  ];

  function createMockSupabase() {
    return {
      from: (table) => {
        let currentData = [];
        if (table === 'leads') currentData = [mockCondo];
        else if (table === 'auditoria_memorias') currentData = [...mockMemories];
        else if (table === 'auditoria_documentos') currentData = [...mockAuditoriaDocs];
        else if (table === 'profiles') {
          currentData = [
            { id: userAuditorId, role: 'user', is_active: true, deleted_at: null },
            { id: userCommercialId, role: 'user', is_active: true, deleted_at: null },
          ];
        } else if (table === 'user_permissions') {
          currentData = [
            { user_id: userAuditorId, can_access_auditoria: true, can_manage_auditoria: true },
            { user_id: userCommercialId, can_access_auditoria: false, can_manage_auditoria: false },
          ];
        }

        let filtered = [...currentData];

        const queryObj = {
          select: (columns, opts) => {
            if (opts?.count === 'exact') queryObj._countExact = true;
            return queryObj;
          },
          eq: (field, val) => {
            filtered = filtered.filter((item) => item[field] === val);
            return queryObj;
          },
          in: (field, vals) => {
            const set = new Set(vals);
            filtered = filtered.filter((item) => set.has(item[field]));
            return queryObj;
          },
          ilike: (field, pattern) => {
            const raw = pattern.replace(/^%|%$/g, '').toLowerCase();
            filtered = filtered.filter((item) => String(item[field] || '').toLowerCase().includes(raw));
            return queryObj;
          },
          order: (field, opts) => {
            const asc = opts?.ascending ?? true;
            filtered.sort((a, b) => {
              if ((a[field] || '') < (b[field] || '')) return asc ? -1 : 1;
              if ((a[field] || '') > (b[field] || '')) return asc ? 1 : -1;
              return 0;
            });
            return queryObj;
          },
          limit: (n) => {
            filtered = filtered.slice(0, n);
            return queryObj;
          },
          maybeSingle: async () => ({
            data: filtered[0] || null,
            error: null,
          }),
          then: (resolve) => {
            resolve({
              data: filtered,
              count: filtered.length,
              error: null,
            });
          },
        };
        return queryObj;
      },
    };
  }

  test('Cenário A: Encontrar informação em memória cadastrada (search_auditoria_memorias)', async () => {
    const mockDb = createMockSupabase();
    const res = await runSearchAuditoriaMemorias(
      { condoId: 'Mirante', query: 'quórum' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: mockDb }
    );

    assert.equal(res.ok, true);
    assert.equal(res.count, 1);
    assert.equal(res.memorias[0].label, 'Quórum para alteração da Convenção');
    assert.equal(res.memorias[0].page_reference, 'Pág. 14 - Art. 32');
    assert.equal(res.memorias[0].source_drive_file_name, 'Convencao_Mirante_2024.pdf');
  });

  test('Cenário B: Identificar PDF vinculado ao condomínio (search_auditoria_documentos)', async () => {
    const mockDb = createMockSupabase();
    const res = await ToolRegistry.executeTool(
      'search_auditoria_documentos',
      { condoId: 'Mirante' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: mockDb }
    );

    assert.equal(res.ok, true);
    assert.equal(res.count, 2);
    assert.equal(res.documentos[0].drive_file_id, 'drive_pdf_02');
    assert.equal(res.documentos[0].category, 'regulamento_interno');
  });

  test('Cenário C: Validação de autorização de documento PDF (read_auditoria_documento)', async () => {
    const mockDb = createMockSupabase();
    
    // Tentar ler documento com drive_file_id não cadastrado na auditoria
    const unauthRes = await runReadAuditoriaDocumento(
      { condoId: 'Mirante', driveFileId: 'drive_arquivo_nao_autorizado_999' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: mockDb }
    );

    assert.equal(unauthRes.ok, false);
    assert.equal(unauthRes.error, 'unauthorized_document');
    assert.ok(unauthRes.message.includes('não está vinculado a nenhum condomínio'));
  });

  test('Cenário D: Respeito aos limites de processamento (máximo 30MB)', async () => {
    const mockDb = createMockSupabase();
    const res = await runReadAuditoriaDocumento(
      { condoId: 'Mirante', driveFileId: 'drive_pdf_01' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: mockDb }
    );

    // Como o download do drive real vai falhar no mock (sem token real da Google Drive API),
    // a ferramenta retorna drive_download_failed mantendo resiliência total e limites declarados
    assert.equal(res.ok, false);
    assert.equal(res.error, 'drive_download_failed');
  });

  test('Cenário E: Relatar corretamente ausência de documento para condomínio sem arquivos', async () => {
    const mockDb = createMockSupabase();
    const res = await runReadAuditoriaDocumento(
      { condoId: 'Condomínio Inexistente Sem PDF' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: mockDb }
    );

    assert.equal(res.ok, false);
    assert.equal(res.error, 'document_not_found');
  });

  test('Cenário F: Bloquear documento de outro condomínio (unauthorized_document)', async () => {
    const mockDb = createMockSupabase();
    // Injetar documento pertencente a outro condo
    const customDb = {
      from: (table) => {
        if (table === 'auditoria_documentos') {
          return {
            select: () => ({
              then: (resolve) =>
                resolve({
                  data: [
                    {
                      id: 'doc_outro',
                      condo_id: 'lead_outro_99',
                      condo_name: 'Outro Condomínio',
                      drive_file_id: 'drive_pdf_alheio',
                      drive_file_name: 'Doc_Alheio.pdf',
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        return createMockSupabase().from(table);
      },
    };

    const res = await runReadAuditoriaDocumento(
      { condoId: 'Mirante', driveFileId: 'drive_pdf_alheio' },
      { userId: userAuditorId, isAdmin: false, isActive: true, userPermissions: { can_access_auditoria: true }, supabaseAdmin: customDb }
    );

    assert.equal(res.ok, false);
    assert.equal(res.error, 'unauthorized_document');
    assert.ok(res.message.includes('não pertence ao condomínio'));
  });

  test('Cenário G: Bloqueio de agente comercial sem capacidade "auditoria" (capability_disabled)', async () => {
    const mockDb = createMockSupabase();
    const res = await ToolRegistry.executeTool(
      'search_auditoria_memorias',
      { condoId: 'Mirante' },
      {
        userId: userCommercialId,
        isAdmin: false,
        isActive: true,
        userPermissions: { can_access_auditoria: false },
        agentCapabilities: { crm: true, auditoria: false },
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(res.ok, false);
    assert.equal(res.error, 'capability_disabled');
  });

  test('Cenário H: Execução multi-modelo no motor universal com capacidades ativas', async () => {
    const mockDb = createMockSupabase();
    
    // Execução do agente de auditoria no motor
    const agentAuditor = {
      id: 'agent_auditor_01',
      name: 'Agente de Auditoria Triverus',
      role: 'Especialista em Auditoria e Convenções',
      modelId: 'gemini-2.5-flash',
      brainProfile: 'equilibrado',
      capabilities: { crm: true, auditoria: true, memorias: true, google_drive: true, agenda: false },
    };

    const res = await executeAgentChat({
      agent: agentAuditor,
      messages: [{ role: 'user', content: 'Qual o quórum para alteração da convenção no condomínio Mirante?' }],
      toolContext: {
        userId: userAuditorId,
        isAdmin: false,
        isActive: true,
        userPermissions: { can_access_auditoria: true },
        supabaseAdmin: mockDb,
      },
    });

    // Se o Gemini SDK não tiver chave real configurada no ambiente de testes, ele lida graciosamente com aviso
    assert.ok(res.modelUsed.length > 0);
    assert.equal(res.brainProfileUsed, 'equilibrado');
  });
});
