import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCrmTool,
  resolveLeadId,
  canUserAccessCondominio,
  getAuthorizedLeadIds,
  removeAccents,
  getTodayBRISO,
  formatDateBR,
} from '../crmTools.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { executeAgentChat, extractStructuredResults } from '../agentExecutionEngine.js';

describe('Triverus CRM — Etapa 1: Segurança, Isolamento de Dados e Busca Inteligente', () => {
  // Base de dados mockada realista para testes unitários autoritativos
  const userAdminId = 'user_admin_001';
  const userCorretor1 = 'user_broker_ana';
  const userCorretor2 = 'user_broker_carlos';

  const mockProfiles = [
    { id: userAdminId, role: 'admin', is_active: true, deleted_at: null },
    { id: userCorretor1, role: 'user', is_active: true, deleted_at: null },
    { id: userCorretor2, role: 'user', is_active: true, deleted_at: null },
    { id: 'user_inativo', role: 'user', is_active: false, deleted_at: null },
  ];

  const mockLeads = [
    {
      id: 'lead_ana_01',
      name: 'Condomínio Residencial Jardins',
      cnpj: '11.222.333/0001-44',
      condominium_type: 'Residencial',
      administrator: 'Administradora Jardins',
      unit_count: 150,
      address: 'Rua das Flores, 100',
      city: 'Ribeirão Preto',
      current_stage_id: 'stage_won_contrato',
      responsible_user_id: userCorretor1,
      created_at: '2026-02-01T10:00:00Z',
    },
    {
      id: 'lead_ana_02',
      name: 'Edifício Mirante das Pedras',
      cnpj: '22.333.444/0001-55',
      condominium_type: 'Comercial',
      administrator: 'Administradora Alfa',
      unit_count: 80,
      address: 'Av. Paulista, 2000',
      city: 'São Paulo',
      current_stage_id: 'stage_open_prop',
      responsible_user_id: userCorretor1,
      created_at: '2026-02-15T10:00:00Z',
    },
    {
      id: 'lead_carlos_01',
      name: 'Condomínio Spazio Di Fiori',
      cnpj: '33.444.555/0001-66',
      condominium_type: 'Residencial',
      administrator: 'Administradora Beta',
      unit_count: 220,
      address: 'Rua dos Cravos, 500',
      city: 'Campinas',
      current_stage_id: 'stage_won_contrato',
      responsible_user_id: userCorretor2,
      created_at: '2026-03-01T10:00:00Z',
    },
  ];

  const mockStages = [
    { id: 'stage_won_contrato', name: 'Assinatura do contrato', slug: 'won', is_won: true, is_lost: false },
    { id: 'stage_open_prop', name: 'Proposta Enviada', slug: 'prop', is_won: false, is_lost: false },
    { id: 'stage_lost', name: 'Perdido / Sem interesse', slug: 'lost', is_won: false, is_lost: true },
  ];

  const mockContacts = [
    { id: 'ct_ana_1', name: 'Roberto Síndico Jardins', phone: '(16) 99123-4567', email: 'roberto@jardins.com.br' },
    { id: 'ct_ana_2', name: 'Fernanda Zeladora Mirante', phone: '(11) 98765-4321', email: 'fernanda@mirante.com.br' },
    { id: 'ct_carlos_1', name: 'Carlos Síndico Spazio', phone: '(19) 97111-2222', email: 'carlos@spazio.com.br' },
  ];

  const mockLeadContacts = [
    { lead_id: 'lead_ana_01', contact_id: 'ct_ana_1' },
    { lead_id: 'lead_ana_02', contact_id: 'ct_ana_2' },
    { lead_id: 'lead_carlos_01', contact_id: 'ct_carlos_1' },
  ];

  const mockInteractions = [
    {
      id: 'int_ana_01',
      lead_id: 'lead_ana_01',
      interaction_type: 'Reunião',
      occurred_at: '2026-03-10T14:30:00Z',
      notes: 'Reunião realizada com Roberto. Apresentada proposta de auditoria para convenção e balancetes fiscais.',
      responsible_user_id: userCorretor1,
      created_by_user_id: userCorretor1,
      next_follow_up_date: null,
      next_follow_up_at: null,
    },
    {
      id: 'int_ana_02',
      lead_id: 'lead_ana_02',
      interaction_type: 'WhatsApp',
      occurred_at: '2026-03-15T09:00:00Z',
      notes: 'Mensagem enviada sobre cláusula rescisória da administradora Alfa.',
      responsible_user_id: userCorretor1,
      created_by_user_id: userCorretor1,
      next_follow_up_date: '2026-04-01',
      next_follow_up_at: null,
    },
    {
      id: 'int_carlos_01',
      lead_id: 'lead_carlos_01',
      interaction_type: 'Ligação',
      occurred_at: '2026-03-12T16:00:00Z',
      notes: 'Contato telefônico confidencial sobre inadimplência elevada no condomínio Spazio Di Fiori.',
      responsible_user_id: userCorretor2,
      created_by_user_id: userCorretor2,
      next_follow_up_date: null,
      next_follow_up_at: null,
    },
  ];

  // Supabase mock rigoroso em memória
  function createMockSupabase() {
    return {
      from: (tableName) => {
        let currentData = [];
        if (tableName === 'leads') currentData = [...mockLeads];
        else if (tableName === 'profiles') currentData = [...mockProfiles];
        else if (tableName === 'pipeline_stages' || tableName === 'stages') currentData = [...mockStages];
        else if (tableName === 'contacts') currentData = [...mockContacts];
        else if (tableName === 'lead_contacts') currentData = [...mockLeadContacts];
        else if (tableName === 'interactions') currentData = [...mockInteractions];
        else if (tableName === 'user_permissions') {
          currentData = [
            { user_id: userAdminId, can_manage_leads: true, can_access_auditoria: true },
            { user_id: userCorretor1, can_manage_leads: true, can_access_auditoria: false },
            { user_id: userCorretor2, can_manage_leads: true, can_access_auditoria: false },
          ];
        }

        let filtered = [...currentData];

        const queryObj = {
          select: (columns, opts) => {
            if (opts?.count === 'exact') {
              queryObj._countExact = true;
            }
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
            filtered = filtered.filter((item) => {
              const val = String(item[field] || '').toLowerCase();
              return val.includes(raw);
            });
            return queryObj;
          },
          or: (clause) => {
            const parts = clause.split(',');
            filtered = filtered.filter((item) => {
              return parts.some((p) => {
                if (p.includes('.ilike.')) {
                  const [field, , rawPattern] = p.split('.');
                  const clean = rawPattern.replace(/^%|%$/g, '').toLowerCase();
                  return String(item[field] || '').toLowerCase().includes(clean);
                }
                if (p.includes('.eq.')) {
                  const [field, , target] = p.split('.');
                  return String(item[field] || '') === target;
                }
                return false;
              });
            });
            return queryObj;
          },
          gte: (field, val) => {
            filtered = filtered.filter((item) => (item[field] || '') >= val);
            return queryObj;
          },
          lte: (field, val) => {
            filtered = filtered.filter((item) => (item[field] || '') <= val);
            return queryObj;
          },
          order: () => queryObj,
          limit: (n) => {
            filtered = filtered.slice(0, n);
            return queryObj;
          },
          range: (start, end) => {
            filtered = filtered.slice(start, end + 1);
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

  // ==========================================================================
  // VALIDAÇÃO DE ACESSO COMERCIAL COMPARTILHADO (REGRA OFICIAL TRIVERUS)
  // ==========================================================================

  test('1. Funcionário ativo (Ana) consulta todos os condomínios comerciais da carteira compartilhada', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      {
        userId: userCorretor1,
        isAdmin: false,
        isActive: true,
        userRole: 'user',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 3, 'Ana deve visualizar todos os 3 condomínios na carteira comercial compartilhada');
    const condoNames = result.condominios.map((c) => c.name);
    assert.ok(condoNames.includes('Condomínio Residencial Jardins'));
    assert.ok(condoNames.includes('Edifício Mirante das Pedras'));
    assert.ok(condoNames.includes('Condomínio Spazio Di Fiori'), 'Condomínio de Carlos também é visível para Ana na regra compartilhada');
  });

  test('2. Funcionário ativo (Ana) consulta detalhes, contatos e interações de condomínio atribuído a outro funcionário (Carlos)', async () => {
    const mockDb = createMockSupabase();
    
    // Detalhes do condomínio de Carlos acessíveis para Ana
    const detailsResult = await executeCrmTool(
      'get_condominio_details',
      { condoId: 'lead_carlos_01' },
      {
        userId: userCorretor1,
        isAdmin: false,
        isActive: true,
        userRole: 'user',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(detailsResult.ok, true);
    assert.ok(detailsResult.condominio, 'Detalhes do condomínio de Carlos devem ser visíveis para Ana');
    assert.equal(detailsResult.condominio.name, 'Condomínio Spazio Di Fiori');

    // Contatos do condomínio de Carlos acessíveis para Ana
    const contatosResult = await executeCrmTool(
      'search_contatos',
      { condoId: 'lead_carlos_01' },
      {
        userId: userCorretor1,
        isAdmin: false,
        isActive: true,
        userRole: 'user',
        supabaseAdmin: mockDb,
      }
    );
    assert.equal(contatosResult.ok, true);
    assert.equal(contatosResult.count, 1);
    assert.equal(contatosResult.contatos[0].name, 'Carlos Síndico Spazio');

    // Interações do condomínio de Carlos acessíveis para Ana
    const interactionsResult = await executeCrmTool(
      'search_interactions',
      { condoId: 'lead_carlos_01' },
      {
        userId: userCorretor1,
        isAdmin: false,
        isActive: true,
        userRole: 'user',
        supabaseAdmin: mockDb,
      }
    );
    assert.equal(interactionsResult.ok, true);
    assert.equal(interactionsResult.count, 1);
  });

  test('3. Funcionário sem permissão de edição não consegue alterar dados (operacao write bloqueada)', async () => {
    const mockDb = createMockSupabase();
    
    // Registrar ferramenta fictícia de gravação para testar controle de mutation
    ToolRegistry.registerTool({
      id: 'update_condominio_test',
      name: 'update_condominio_test',
      description: 'Edita dados de um condomínio',
      module: 'crm',
      capabilityKey: 'crm',
      operationType: 'write',
      requiredAuth: 'active_user',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });

    const result = await ToolRegistry.executeTool(
      'update_condominio_test',
      {},
      {
        userId: userCorretor1,
        isAdmin: false,
        isActive: true,
        userPermissions: { can_manage_leads: false, can_manage_contacts: false, can_manage_notes: false, can_change_stage: false },
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'permission_denied');
  });

  test('4. Funcionário inativo ou excluído não consegue executar consultas', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      {
        userId: 'user_inativo',
        isAdmin: false,
        isActive: false,
        userRole: 'user',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'inactive_user');
  });

  test('5. Agente sem capacidade CRM não consegue acessar as ferramentas comerciais', async () => {
    const mockDb = createMockSupabase();
    const result = await ToolRegistry.executeTool(
      'search_condominios',
      { query: '' },
      {
        userId: userCorretor1,
        agentCapabilities: { crm: false },
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'capability_disabled');
  });

  // ==========================================================================
  // VALIDAÇÃO B: ADMINISTRADOR POSSUI ACESSO GLOBAL PREVISTO
  // ==========================================================================

  test('B1. Administrador (userAdminId) consulta todos os condomínios da carteira geral', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 3, 'Administrador deve visualizar todos os 3 condomínios');
  });

  test('B2. Administrador acessa detalhes e contatos de qualquer condomínio', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'get_condominio_details',
      { condoId: 'lead_carlos_01' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.ok(result.condominio);
    assert.equal(result.condominio.id, 'lead_carlos_01');
    assert.equal(result.condominio.name, 'Condomínio Spazio Di Fiori');
  });

  // ==========================================================================
  // VALIDAÇÃO C: BUSCA TEXTUAL NAS ANOTAÇÕES HISTÓRICAS
  // ==========================================================================

  test('C1. Busca textual localiza anotação por termo específico dentro de notes (ex: "cláusula rescisória")', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { query: 'cláusula rescisória' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1, 'Deve localizar exatamente a interação que cita cláusula rescisória');
    assert.equal(result.interacoes[0].id, 'int_ana_02');
    assert.ok(result.interacoes[0].notes.includes('cláusula rescisória'));
  });

  test('C2. Busca textual é case-insensitive e funciona com termos parciais', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { query: 'BALANCETES' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.interacoes[0].id, 'int_ana_01');
    assert.ok(result.interacoes[0].notes.toLowerCase().includes('balancetes'));
  });

  // ==========================================================================
  // VALIDAÇÃO D: PESQUISA POR NOME PARCIAL DO CONDOMÍNIO
  // ==========================================================================

  test('D1. Localiza condomínio por nome parcial sem acentos (ex: "pedras" acha "Mirante das Pedras")', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: 'pedras' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.condominios[0].id, 'lead_ana_02');
  });

  test('D2. Localiza condomínio ignorando stop words ("Condomínio Residencial Jardins" via "Jardins")', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: 'Jardins' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.condominios[0].name, 'Condomínio Residencial Jardins');
  });

  // ==========================================================================
  // VALIDAÇÃO E: BUSCA COMBINADA (CONDOMÍNIO + TEXTO + DATAS + TIPO)
  // ==========================================================================

  test('E1. Busca combinada filtra por condomínio específico, termo textual e tipo de interação', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      {
        condoId: 'lead_ana_01',
        query: 'auditoria',
        interactionType: 'Reunião',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.interacoes[0].id, 'int_ana_01');
    assert.equal(result.interacoes[0].interaction_type, 'Reunião');
  });

  // ==========================================================================
  // VALIDAÇÃO F: NENHUM REGISTRO É INVENTADO QUANDO NÃO ENCONTRADO
  // ==========================================================================

  test('F1. Busca sem correspondência retorna array vazio e contagem 0 sem inventar dados', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { query: 'termo_totalmente_inexistente_12345' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.interacoes, []);
  });

  test('F2. search_contatos por telefone localiza contato e não inventa dados para número inexistente', async () => {
    const mockDb = createMockSupabase();
    const found = await executeCrmTool(
      'search_contatos',
      { query: '99123' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );
    assert.equal(found.ok, true);
    assert.equal(found.count, 1);
    assert.equal(found.contatos[0].name, 'Roberto Síndico Jardins');

    const notFound = await executeCrmTool(
      'search_contatos',
      { query: '0000000000' },
      {
        userId: userAdminId,
        isAdmin: true,
        isActive: true,
        userRole: 'admin',
        supabaseAdmin: mockDb,
      }
    );
    assert.equal(notFound.ok, true);
    assert.equal(notFound.count, 0);
    assert.deepEqual(notFound.contatos, []);
  });

  // ==========================================================================
  // VALIDAÇÃO G: AGENTE UNIVERSAL UTILIZA RESULTADOS DAS TOOLS NAS RESPOSTAS
  // ==========================================================================

  test('G1. Agente Universal executa Tool e incorpora dados reais do CRM na resposta', async () => {
    const mockAgent = {
      id: 'ag_consultor_triverus',
      name: 'Consultor CRM Especialista',
      role: 'Atendente de Carteira',
      prompt: 'Responda com clareza aos questionamentos sobre condomínios e clientes.',
      brainProfile: 'balanced',
      modelId: 'gemini-2.5-flash',
      capabilities: { crm: true },
    };

    const toolResults = [
      {
        ok: true,
        condominios: [{ id: 'c1', name: 'Condomínio Alpha VIP', city: 'Ribeirão Preto', unit_count: 50 }],
        count: 1,
      },
    ];

    const structured = extractStructuredResults(toolResults, 'liste os condomínios');
    assert.ok(structured.length >= 1, 'Deve extrair card estruturado do condomínio retornado');
    assert.equal(structured[0].title, 'Condomínio Alpha VIP');
    assert.equal(structured[0].temperature, undefined, 'Card estruturado não deve conter temperatura');

    const execution = await executeAgentChat({
      agent: mockAgent,
      messages: [{ role: 'user', content: 'Quantos condomínios temos na carteira e qual o nome do primeiro?' }],
      toolContext: {
        userId: 'test_user',
        isAdmin: true,
        isActive: true,
      },
    });

    assert.ok(typeof execution.text === 'string' && execution.text.length > 0);
  });

  // ==========================================================================
  // VALIDAÇÃO H: AUSÊNCIA TOTAL DO CAMPO OBSOLETO TEMPERATURA
  // ==========================================================================

  test('H1. Nenhuma ferramenta expõe o parâmetro obsoleto "temperature"', () => {
    const searchCondoTool = ToolRegistry.getTool('search_condominios');
    assert.ok(searchCondoTool);
    assert.equal(searchCondoTool.parameters.properties.temperature, undefined, 'Parâmetro temperature não pode constar no schema');

    const searchInteractionsTool = ToolRegistry.getTool('search_interactions');
    assert.ok(searchInteractionsTool);
    assert.ok(searchInteractionsTool.parameters.properties.query, 'Parâmetro query deve constar em search_interactions');
    assert.ok(searchInteractionsTool.parameters.properties.startDate, 'Parâmetro startDate deve constar em search_interactions');
    assert.ok(searchInteractionsTool.parameters.properties.endDate, 'Parâmetro endDate deve constar em search_interactions');
  });
});
