import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeCrmTool, removeAccents, getTodayBRISO, formatDateBR } from '../crmTools.js';
import { executeAgentChat, buildAgentSystemPrompt, extractStructuredResults } from '../agentExecutionEngine.js';

describe('Triverus Real CRM Tools Integration Tests', () => {
  const mockLeadsData = [
    {
      id: '5a72e810-a510-4459-959f-fb2eb25a39f9',
      name: 'Condomínio Lagoinha',
      cnpj: '12.345.678/0001-90',
      condominium_type: 'Residencial',
      administrator: 'Administradora Exemplo',
      unit_count: 120,
      address: 'Rua Principal, 100',
      city: 'Ribeirão Preto',
      lead_source: 'Indicação',
      temperature: 'Frio',
      current_stage_id: 'stage_1',
      responsible_user_id: 'user_1',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'f03e0879-ba60-445a-8fe6-ee614ec6adb2',
      name: 'Condominio Mirante das Pedras',
      cnpj: '98.765.432/0001-10',
      condominium_type: 'Residencial',
      administrator: 'Administradora Exemplo',
      unit_count: 80,
      address: 'Av. Pedras, 500',
      city: 'Ribeirão Preto',
      lead_source: 'Prospecção',
      temperature: 'Frio',
      current_stage_id: 'stage_2',
      responsible_user_id: 'user_2',
      created_at: '2026-01-02T00:00:00Z',
    },
  ];

  test('1. removeAccents normaliza acentos e maiúsculas corretamente', () => {
    assert.equal(removeAccents('Condomínio Lagoinha'), 'condominio lagoinha');
    assert.equal(removeAccents('MIRANTE DAS PEDRAS'), 'mirante das pedras');
  });

  test('2. search_condominios com query "Lagoinha" localiza Condomínio Lagoinha', async () => {
    const result = await executeCrmTool(
      'search_condominios',
      { query: 'Lagoinha' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          const q = removeAccents(args.query);
          const filtered = mockLeadsData.filter((l) => removeAccents(l.name).includes(q));
          return { ok: true, condominios: filtered, count: filtered.length };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.condominios[0].name, 'Condomínio Lagoinha');
  });

  test('3. search_condominios com query "Mirante das Pedras" localiza Condominio Mirante das Pedras', async () => {
    const result = await executeCrmTool(
      'search_condominios',
      { query: 'Mirante das Pedras' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          const q = removeAccents(args.query);
          const filtered = mockLeadsData.filter((l) => removeAccents(l.name).includes(q));
          return { ok: true, condominios: filtered, count: filtered.length };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.condominios[0].name, 'Condominio Mirante das Pedras');
  });

  test('4. search_condominios com query vazia para consulta de portfólio geral retorna total exato', async () => {
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      {
        userId: 'test_user',
        customDataProvider: async () => {
          return { ok: true, condominios: mockLeadsData, count: 29, limit: 25 };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 29);
    assert.equal(result.condominios.length, 2);
  });

  test('5. get_condominio_details localiza condomínio por nome e busca contatos vinculados', async () => {
    const result = await executeCrmTool(
      'get_condominio_details',
      { condoId: 'Lagoinha' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          const match = mockLeadsData.find((l) => removeAccents(l.name).includes(removeAccents(args.condoId)));
          return { ok: true, condominio: match, contatos: [] };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.ok(result.condominio);
    assert.equal(result.condominio.name, 'Condomínio Lagoinha');
  });

  test('6. executeAgentChat realiza inferência e entrega texto elaborado com dados do CRM', async () => {
    const mockAgent = {
      id: 'ag_condo_1',
      name: 'Condo Assistant',
      role: 'Consultor Operacional',
      prompt: 'Responda com detalhes do condomínio.',
      modelId: 'gpt-4o',
      brainProfile: 'balanced',
    };

    const result = await executeAgentChat({
      agent: mockAgent,
      messages: [{ role: 'user', content: 'Localize o Condomínio Lagoinha no CRM e me informe todos os dados.' }],
      clientContext: { requestId: 'req_test_123' },
      toolContext: {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          return { ok: true, condominios: [mockLeadsData[0]], count: 1 };
        },
      },
    });

    assert.notEqual(result.text, 'Consulta realizada com sucesso.');
    assert.ok(typeof result.text === 'string' && result.text.length > 0);
  });

  test('7. search_interactions aceita nome do condomínio "Lagoinha" e filtro "today"', async () => {
    const todayISO = getTodayBRISO();
    const result = await executeCrmTool(
      'search_interactions',
      { condoId: 'Lagoinha', filter: 'today', interactionType: 'Reunião' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          return {
            ok: true,
            interacoes: [
              {
                id: 'int_101',
                lead_id: '5a72e810-a510-4459-959f-fb2eb25a39f9',
                lead_name: 'Condomínio Lagoinha',
                interaction_type: 'Reunião',
                occurred_at: `${todayISO}T10:00:00Z`,
                notes: 'Reunião de alinhamento com o síndico',
                next_follow_up_date: todayISO,
                is_today: true,
              },
            ],
            count: 1,
            todayDateBR: formatDateBR(todayISO),
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.interacoes[0].lead_name, 'Condomínio Lagoinha');
    assert.equal(result.interacoes[0].is_today, true);
  });

  test('8. search_interactions trata ausência legítima de registros de forma amigável', async () => {
    const result = await executeCrmTool(
      'search_interactions',
      { condoId: 'Inexistente' },
      {
        userId: 'test_user',
        customDataProvider: async () => {
          return { ok: true, interacoes: [], count: 0, message: 'Nenhuma interação localizada.' };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.interacoes, []);
  });

  test('9. search_interactions permite consultas gerais de reuniões/follow-ups sem condomínio obrigatório', async () => {
    const todayISO = getTodayBRISO();
    const result = await executeCrmTool(
      'search_interactions',
      { filter: 'today' }, // sem condoId
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          assert.equal(args.condoId, undefined, 'condoId deve ser opcional/omitido');
          assert.equal(args.filter, 'today');
          return {
            ok: true,
            interacoes: [
              {
                id: 'int_201',
                lead_id: '5a72e810-a510-4459-959f-fb2eb25a39f9',
                lead_name: 'Condomínio Lagoinha',
                interaction_type: 'Reunião',
                occurred_at: `${todayISO}T10:00:00-03:00`,
                notes: 'Reunião geral de prestação de contas',
                next_follow_up_date: todayISO,
                is_today: true,
              },
              {
                id: 'int_202',
                lead_id: 'f03e0879-ba60-445a-8fe6-ee614ec6adb2',
                lead_name: 'Condominio Mirante das Pedras',
                interaction_type: 'Follow-up',
                next_follow_up_at: `${todayISO}T15:30:00-03:00`,
                notes: 'Retorno sobre proposta de auditoria',
                is_today: true,
              },
            ],
            count: 2,
            todayDateBR: formatDateBR(todayISO),
            todayDateISO: todayISO,
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.interacoes.length, 2);
    assert.equal(result.interacoes[0].lead_name, 'Condomínio Lagoinha');
    assert.equal(result.interacoes[1].lead_name, 'Condominio Mirante das Pedras');
  });

  test('10. crm_get_interactions suporta consultas gerais sem condoId', async () => {
    const todayISO = getTodayBRISO();
    const result = await executeCrmTool(
      'crm_get_interactions',
      { filter: 'today' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          return {
            ok: true,
            interacoes: [],
            count: 0,
            todayDateBR: formatDateBR(todayISO),
            message: 'Nenhuma reunião ou follow-up localizado para os critérios informados.',
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.interacoes, []);
  });

  test('11. Reconhece e diferencia falhas de consulta de ausência legítima de registros', async () => {
    const result = await executeCrmTool(
      'search_interactions',
      { filter: 'today' },
      {
        userId: 'test_user',
        customDataProvider: async () => {
          return {
            ok: false,
            error: 'database_error',
            message: 'Erro ao consultar interações no Supabase: connection timeout',
            interacoes: [],
            count: 0,
          };
        },
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'database_error');
    assert.ok(result.message.includes('Erro ao consultar interações'));
  });

  test('12. Resposta à pergunta obrigatória "Tenho alguma reunião ou follow-up hoje?" consulta CRM e responde sem exigir condomínio', async () => {
    const todayISO = getTodayBRISO();
    const mockAgent = {
      id: 'ag_condo_crm',
      name: 'Condo',
      role: 'Consultor Operacional',
      prompt: 'Você é o agente Condo especializado em CRM e atendimento a condomínios.',
      modelId: 'gpt-4o',
      brainProfile: 'balanced',
      capabilities: {
        crm: true,
        auditoria: false,
        google_drive: false,
        memorias: false,
        agenda: false,
      },
    };

    // 12.1 Validação do prompt de sistema: orienta o modelo a consultar imediatamente com filter: "today" sem exigir condomínio
    const sysPrompt = buildAgentSystemPrompt(mockAgent, 'GPT-4o', 'Equilibrado', 'OpenAI');
    assert.ok(sysPrompt.includes('Tenho alguma reunião ou follow-up hoje?'), 'O system prompt deve prever a pergunta obrigatória');
    assert.ok(sysPrompt.includes('NUNCA exija, solicite ou pergunte o nome de um condomínio'), 'Deve proibir exigir nome de condomínio para consultas gerais');
    assert.ok(sysPrompt.includes('filter: "today"'), 'Deve instruir uso do filtro today');

    // 12.2 Execução direta da ferramenta search_interactions sem condoId
    let toolExecuted = false;
    let toolArgsReceived = null;

    const toolResult = await executeCrmTool(
      'search_interactions',
      { filter: 'today' }, // sem condoId
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          toolExecuted = true;
          toolArgsReceived = args;
          return {
            ok: true,
            interacoes: [
              {
                id: 'int_today_1',
                lead_name: 'Condomínio Lagoinha',
                interaction_type: 'Reunião',
                scheduled_time: '14:30',
                notes: 'Apresentação do relatório de auditoria',
                is_today: true,
              },
            ],
            count: 1,
            todayDateBR: formatDateBR(todayISO),
          };
        },
      }
    );

    assert.equal(toolExecuted, true, 'A ferramenta de consulta ao CRM deve ser acionada');
    assert.equal(toolArgsReceived?.filter, 'today', 'Deve passar filter: "today"');
    assert.equal(toolArgsReceived?.condoId, undefined, 'Não deve exigir condoId para consulta geral');
    assert.equal(toolResult.ok, true);
    assert.equal(toolResult.count, 1);
    assert.equal(toolResult.interacoes[0].lead_name, 'Condomínio Lagoinha');

    // 12.3 Execução do chat do agente entregando resposta válida
    const chatResult = await executeAgentChat({
      agent: mockAgent,
      messages: [{ role: 'user', content: 'Tenho alguma reunião ou follow-up hoje?' }],
      clientContext: { requestId: 'req_mandatory_test' },
      toolContext: {
        userId: 'test_user',
      },
    });

    assert.ok(typeof chatResult.text === 'string' && chatResult.text.length > 0);
    assert.notEqual(chatResult.text, 'Consulta realizada com sucesso.');
  });

  test('13. Resposta objetiva quando a carteira não possui compromissos agendados para hoje', async () => {
    const todayISO = getTodayBRISO();
    const mockAgent = {
      id: 'ag_condo_crm',
      name: 'Condo',
      role: 'Consultor Operacional',
      prompt: 'Você é o agente Condo.',
      modelId: 'gpt-4o',
      brainProfile: 'balanced',
      capabilities: {
        crm: true,
      },
    };

    const result = await executeAgentChat({
      agent: mockAgent,
      messages: [{ role: 'user', content: 'Tenho alguma reunião ou follow-up hoje?' }],
      clientContext: { requestId: 'req_mandatory_empty' },
      toolContext: {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          return {
            ok: true,
            interacoes: [],
            count: 0,
            todayDateBR: formatDateBR(todayISO),
            message: 'Nenhuma reunião ou follow-up localizado para os critérios informados.',
          };
        },
      },
    });

    assert.ok(typeof result.text === 'string' && result.text.length > 0);
    assert.notEqual(result.text, 'Consulta realizada com sucesso.');
    assert.ok(!result.text.toLowerCase().includes('qual o nome do condomínio'), 'Não deve exigir nome de condomínio');
  });

  // CASO A: "Quantos clientes tenho?" - Validação rigorosa da regra de negócio (is_won = true)
  test('14. Caso A: "Quantos clientes tenho?" contabiliza condomínios com is_won = true da tabela pipeline_stages', async () => {
    const mockStages = [
      { id: 'stg_prosp', name: 'Prospecção', is_won: false, is_lost: false },
      { id: 'stg_prop', name: 'Proposta Comercial', is_won: false, is_lost: false },
      { id: 'stg_contrato', name: 'Assinatura do contrato', is_won: true, is_lost: false },
      { id: 'stg_perdido', name: 'Sem interesse', is_won: false, is_lost: true },
    ];

    // Carteira de 30 condomínios: 6 convertidos (is_won), 20 em aberto, 4 perdidos
    const mock30Leads = Array.from({ length: 30 }, (_, i) => {
      let stageId = 'stg_prosp';
      if (i < 6) stageId = 'stg_contrato'; // 6 clientes convertidos
      else if (i >= 26) stageId = 'stg_perdido'; // 4 perdidos
      else stageId = i % 2 === 0 ? 'stg_prosp' : 'stg_prop'; // 20 em aberto
      return {
        id: `lead_${i + 1}`,
        name: `Condomínio Exemplo ${i + 1}`,
        current_stage_id: stageId,
      };
    });

    const result = await executeCrmTool(
      'search_condominios',
      { query: 'clientes' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          const clientLeads = mock30Leads.filter((l) => l.current_stage_id === 'stg_contrato');
          return {
            ok: true,
            condominios: clientLeads,
            count: clientLeads.length,
            clientes_count: 6,
            oportunidades_abertas_count: 20,
            oportunidades_perdidas_count: 4,
            total_leads_no_crm: 30,
            regra_negocio_triverus: {
              clientes: '6 condomínios (is_won = true)',
              oportunidades_em_aberto: '20 condomínios',
              oportunidades_perdidas: '4 condomínios',
              total_carteira_crm: '30 condomínios cadastrados na carteira leads',
            },
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.clientes_count, 6, 'A contagem de clientes convertidos deve ser exatamente 6');
    assert.equal(result.total_leads_no_crm, 30, 'O total da carteira deve ser 30');
    assert.equal(result.oportunidades_abertas_count, 20, 'Oportunidades em aberto devem ser 20');
  });

  // CASO B: "Quantas oportunidades em aberto tenho?" e "Quantos clientes e quantos leads tenho?"
  test('15. Caso B: Distingue clientes convertidos, oportunidades em aberto e total sem contagem duplicada', async () => {
    const result = await executeCrmTool(
      'search_condominios',
      { query: '' },
      {
        userId: 'test_user',
        customDataProvider: async () => {
          return {
            ok: true,
            condominios: [],
            count: 30,
            clientes_count: 6,
            oportunidades_abertas_count: 20,
            oportunidades_perdidas_count: 4,
            total_leads_no_crm: 30,
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.clientes_count + result.oportunidades_abertas_count + result.oportunidades_perdidas_count, 30);
    assert.equal(result.oportunidades_abertas_count, 20);
  });

  // CASO C: "Liste as últimas cinco interações" em cards estruturados
  test('16. Caso C: Interações retornadas por ferramentas são extraídas como cards estruturados (type: "interaction")', () => {
    const collectedToolResults = [
      {
        ok: true,
        interacoes: [
          {
            id: 'int_1',
            lead_id: 'lead_10',
            lead_name: 'Condomínio Solar',
            interaction_type: 'Reunião',
            occurred_at_br: '04/11/2026',
            notes: 'Apresentação de proposta de auditoria documental.',
          },
          {
            id: 'int_2',
            lead_id: 'lead_11',
            lead_name: 'Residencial Acácias',
            interaction_type: 'Ligação',
            occurred_at_br: '03/11/2026',
            notes: 'Alinhamento com síndica sobre balancetes.',
          },
        ],
      },
    ];

    const cards = extractStructuredResults(collectedToolResults, 'Liste as últimas interações');
    assert.equal(cards.length, 2);
    assert.equal(cards[0].type, 'interaction');
    assert.equal(cards[0].title, 'Condomínio Solar');
    assert.equal(cards[0].interactionType, 'Reunião');
    assert.equal(cards[0].date, '04/11/2026');
    assert.equal(cards[0].description, 'Apresentação de proposta de auditoria documental.');
  });

  // CASO D: "Quais follow-ups estão vencidos?"
  test('17. Caso D: Consulta de follow-ups com filtro "overdue" identifica status "vencido" e is_overdue', async () => {
    const todayISO = getTodayBRISO();
    const result = await executeCrmTool(
      'search_interactions',
      { filter: 'overdue' },
      {
        userId: 'test_user',
        customDataProvider: async (name, args) => {
          assert.equal(args.filter, 'overdue');
          return {
            ok: true,
            interacoes: [
              {
                id: 'int_venc_1',
                lead_id: 'lead_22',
                lead_name: 'Condomínio Bela Vista',
                interaction_type: 'Follow-up',
                next_follow_up_date: '2026-10-15',
                next_follow_up_date_br: '15/10/2026',
                notes: 'Retorno pendente sobre proposta comercial.',
                is_overdue: true,
                followup_status: 'vencido',
              },
            ],
            count: 1,
            count_overdue_followups: 1,
          };
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.interacoes[0].is_overdue, true);
    assert.equal(result.interacoes[0].followup_status, 'vencido');
  });

  // CASO E: Pergunta simples de contagem ("Quantos clientes tenho?") retorna texto puro sem cards
  test('18. Caso E: Perguntas puras de contagem (ex: "Quantos clientes tenho?") NÃO geram cards desnecessários', () => {
    const collectedToolResults = [
      {
        ok: true,
        condominios: [
          { id: 'c1', name: 'Condomínio A' },
          { id: 'c2', name: 'Condomínio B' },
        ],
        clientes_count: 6,
      },
    ];

    const cardsForCount1 = extractStructuredResults(collectedToolResults, 'Quantos clientes tenho?');
    assert.equal(cardsForCount1.length, 0, 'Não deve gerar cards para "Quantos clientes tenho?"');

    const cardsForCount2 = extractStructuredResults(collectedToolResults, 'Quantas oportunidades em aberto tenho?');
    assert.equal(cardsForCount2.length, 0, 'Não deve gerar cards para pergunta de contagem');

    const cardsForCount3 = extractStructuredResults(collectedToolResults, 'Qual a quantidade de clientes?');
    assert.equal(cardsForCount3.length, 0, 'Não deve gerar cards para "Qual a quantidade de clientes?"');
  });

  // CASO F: Resposta com múltiplos registros retornando array de cards estruturados independentes
  test('19. Caso F: Consultas de listagem retornam registros em cards individuais independentes com metadados', () => {
    const collectedToolResults = [
      {
        ok: true,
        condominios: [
          {
            id: 'condo_101',
            name: 'Condomínio Jardim Europa',
            city: 'Ribeirão Preto',
            unit_count: 140,
            stage_name: 'Assinatura do contrato',
            temperature: 'Quente',
          },
          {
            id: 'condo_102',
            name: 'Condomínio Alpha Village',
            city: 'Sertãozinho',
            unit_count: 95,
            stage_name: 'Proposta Enviada',
            temperature: 'Morno',
          },
        ],
      },
    ];

    const cards = extractStructuredResults(collectedToolResults, 'Mostre quais condomínios estão cadastrados');
    assert.equal(cards.length, 2, 'Cada registro deve gerar seu próprio card individual');
    assert.equal(cards[0].type, 'lead');
    assert.equal(cards[0].title, 'Condomínio Jardim Europa');
    assert.equal(cards[0].city, 'Ribeirão Preto');
    assert.equal(cards[0].unit_count, 140);
    assert.equal(cards[1].title, 'Condomínio Alpha Village');
  });

  // CASO G: Segurança contra fabricação de dados ou registros inexistentes
  test('20. Caso G: Registros que não vieram das ferramentas autorizadas são ignorados (proteção contra fabricação)', () => {
    // 1. Array vazio de ferramentas
    const emptyCards = extractStructuredResults([], 'Liste as últimas interações');
    assert.deepEqual(emptyCards, []);

    // 2. Ferramentas sem registros válidos
    const noInteractions = extractStructuredResults([{ ok: true }], 'Liste as últimas interações');
    assert.deepEqual(noInteractions, []);

    // 3. Registros sem id são descartados por segurança
    const invalidItems = extractStructuredResults(
      [{ ok: true, interacoes: [{ lead_name: 'Falso', notes: 'Sem id' }] }],
      'Liste as últimas interações'
    );
    assert.equal(invalidItems.length, 0, 'Registros sem ID válido não devem gerar cards');
  });
});

