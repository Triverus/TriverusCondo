import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeCrmTool } from '../crmTools.js';
import { executeAgentChat, extractStructuredResults } from '../agentExecutionEngine.js';

describe('TRIVERUS — Validação Real da Inteligência de Busca do CRM (Fluxos A a F)', () => {
  const userAnaId = 'user_broker_ana';
  const userCarlosId = 'user_broker_carlos';

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
      responsible_user_id: userAnaId,
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
      responsible_user_id: userAnaId,
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
      responsible_user_id: userCarlosId,
      created_at: '2026-03-01T10:00:00Z',
    },
  ];

  const mockStages = [
    { id: 'stage_won_contrato', name: 'Assinatura do contrato', slug: 'won', is_won: true, is_lost: false },
    { id: 'stage_open_prop', name: 'Proposta Enviada', slug: 'prop', is_won: false, is_lost: false },
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
      id: 'int_01',
      lead_id: 'lead_ana_01',
      interaction_type: 'Reunião',
      occurred_at: '2026-03-10T14:30:00Z',
      notes: 'Reunião realizada com Roberto. Apresentada proposta de auditoria para convenção e balancetes fiscais.',
      responsible_user_id: userAnaId,
      created_by_user_id: userAnaId,
    },
    {
      id: 'int_02',
      lead_id: 'lead_ana_02',
      interaction_type: 'Ligação',
      occurred_at: '2026-03-12T09:00:00Z',
      notes: 'Contato com Fernanda zeladora. Discutida cláusula rescisória da administradora anterior e renovação do seguro predial obrigatório.',
      responsible_user_id: userAnaId,
      created_by_user_id: userAnaId,
    },
    {
      id: 'int_03',
      lead_id: 'lead_carlos_01',
      interaction_type: 'Reunião',
      occurred_at: '2026-03-15T16:00:00Z',
      notes: 'Reunião presencial no Spazio Di Fiori com alinhamento da apólice de seguro contra incêndio e renovação contratual.',
      responsible_user_id: userCarlosId,
      created_by_user_id: userCarlosId,
    },
    {
      id: 'int_04',
      lead_id: 'lead_carlos_01',
      interaction_type: 'WhatsApp',
      occurred_at: '2026-03-18T11:20:00Z',
      notes: 'Mensagem via WhatsApp com o síndico para envio dos balancetes e cotação da apólice de seguro.',
      responsible_user_id: userCarlosId,
      created_by_user_id: userCarlosId,
    },
    {
      id: 'int_05',
      lead_id: 'lead_ana_01',
      interaction_type: 'E-mail',
      occurred_at: '2026-03-20T17:45:00Z',
      notes: 'E-mail enviado para Roberto confirmando a apresentação do relatório de auditoria na assembleia do condomínio.',
      responsible_user_id: userAnaId,
      created_by_user_id: userAnaId,
    },
  ];

  function createMockSupabase() {
    return {
      from: (table) => {
        let currentData = [];
        if (table === 'leads') currentData = [...mockLeads];
        else if (table === 'pipeline_stages' || table === 'stages' || table === 'stage_history') currentData = [...mockStages];
        else if (table === 'contacts') currentData = [...mockContacts];
        else if (table === 'lead_contacts') currentData = [...mockLeadContacts];
        else if (table === 'interactions') currentData = [...mockInteractions];
        else if (table === 'profiles') {
          currentData = [
            { id: userAnaId, role: 'user', is_active: true, deleted_at: null },
            { id: userCarlosId, role: 'user', is_active: true, deleted_at: null },
          ];
        } else if (table === 'user_permissions') {
          currentData = [
            { user_id: userAnaId, can_manage_leads: true, can_manage_contacts: true, can_manage_notes: true, can_access_auditoria: true },
            { user_id: userCarlosId, can_manage_leads: true, can_manage_contacts: true, can_manage_notes: true, can_access_auditoria: false },
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

  test('Caso A: "Quantos condomínios existem no CRM?"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
    assert.equal(result.total_leads_no_crm, 3);
    assert.equal(result.clientes_count, 2);
    assert.equal(result.oportunidades_abertas_count, 1);
  });

  test('Caso B: "Encontre o condomínio pelo nome parcial (ex: pedras)"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_condominios',
      { query: 'pedras' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.condominios[0].id, 'lead_ana_02');
    assert.equal(result.condominios[0].name, 'Edifício Mirante das Pedras');
  });

  test('Caso C: "Quais foram as últimas cinco interações registradas?"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { limit: 5, order: 'desc' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 5);
    // Verificando que a ordenação cronológica decrescente coloca a interação de 2026-03-20 primeiro
    assert.equal(result.interacoes[0].id, 'int_05');
    assert.equal(result.interacoes[4].id, 'int_01');
  });

  test('Caso D: "Encontre interações em que mencionamos seguro"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { query: 'seguro' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 3, 'Deve localizar as 3 interações (int_02, int_03, int_04) que mencionam seguro em notes');
    const ids = result.interacoes.map((i) => i.id);
    assert.ok(ids.includes('int_02'));
    assert.ok(ids.includes('int_03'));
    assert.ok(ids.includes('int_04'));
  });

  test('Caso E: "Mostre os contatos vinculados a determinado condomínio (Spazio Di Fiori)"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_contatos',
      { condoId: 'Spazio' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.contatos[0].name, 'Carlos Síndico Spazio');
    assert.equal(result.contatos[0].phone, '(19) 97111-2222');
  });

  test('Caso F: "O que foi conversado com determinado condomínio (Residencial Jardins)?"', async () => {
    const mockDb = createMockSupabase();
    const result = await executeCrmTool(
      'search_interactions',
      { condoId: 'Jardins' },
      { userId: userAnaId, isAdmin: false, isActive: true, supabaseAdmin: mockDb }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    const notesStr = result.interacoes.map((i) => i.notes).join(' ');
    assert.ok(notesStr.includes('balancetes fiscais'));
    assert.ok(notesStr.includes('relatório de auditoria'));
  });
});
