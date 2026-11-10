import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/registry.js';
import '../crmTools.js'; // Garantir o registro prévio das ferramentas
import {
  saveAgentCapabilities,
  getAgentCapabilities,
  deleteAgentCapabilities,
  saveGlobalAgent,
  deleteGlobalAgent,
  isLegacyAgent,
} from '../agentService.js';
import { buildAgentSystemPrompt } from '../agentExecutionEngine.js';

test('1. Permissões de Administração - Habilitar e desabilitar capacidade por Admin', async () => {
  const adminId = 'user_admin_test_123';

  // Salvar capacidade CRM desabilitada (crm: false)
  const savedCaps = await saveAgentCapabilities('agent_cap_test_1', { crm: false }, adminId, null);
  assert.equal(savedCaps.crm, false, 'CRM deve ser desabilitado quando enviado como false.');

  // Consultar capacidade salva
  const fetchedCaps = await getAgentCapabilities('agent_cap_test_1', null);
  assert.equal(fetchedCaps.crm, false, 'CRM deve persistir desabilitado.');

  // Reabilitar CRM (crm: true)
  const updatedCaps = await saveAgentCapabilities('agent_cap_test_1', { crm: true }, adminId, null);
  assert.equal(updatedCaps.crm, true, 'CRM deve ser reabilitado.');

  const refetchedCaps = await getAgentCapabilities('agent_cap_test_1', null);
  assert.equal(refetchedCaps.crm, true, 'CRM deve persistir habilitado.');
});

test('2. Rejeição de Modificação por Colaborador Sem Privilégio (RLS & Permissões)', async () => {
  const collaboratorId = 'user_collaborator_test_456';

  await assert.rejects(
    async () => {
      await saveGlobalAgent(
        {
          id: 'agent_collab_test',
          name: 'Agente Invasor',
          role: 'Tentativa de Modificacao',
          capabilities: { crm: false },
        },
        collaboratorId,
        null
      );
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Acesso negado'));
      return true;
    },
    'Colaborador não-admin deve ser bloqueado ao tentar salvar agente/capacidades.'
  );
});

test('3. Bloqueio Total de Ferramentas de Escrita no CRM (Somente Leitura)', () => {
  const createTool = ToolRegistry.getTool('crm_create_interaction');
  assert.equal(createTool, undefined, 'A ferramenta de escrita crm_create_interaction NÃO pode estar registrada no Tool Registry.');

  const allTools = ToolRegistry.getAllTools();
  const writeTools = allTools.filter((t) => t.operationType === 'write');
  assert.equal(writeTools.length, 0, 'Nenhuma ferramenta de escrita deve estar presente no catálogo do CRM.');
});

test('4. Agente com CRM Habilitado - Ferramentas de Leitura Incluídas e Compatíveis com OpenAI e Gemini', () => {
  const agentCaps = { crm: true, auditoria: false, google_drive: false, memorias: false, agenda: false };
  const allowedTools = ToolRegistry.getAllTools().filter((tool) => !tool.capabilityKey || Boolean(agentCaps[tool.capabilityKey]));

  assert.ok(allowedTools.length >= 4, 'Ferramentas de leitura de CRM devem estar presentes.');
  const openAiTools = ToolRegistry.toOpenAITools(allowedTools);
  assert.ok(openAiTools.length >= 4, 'OpenAI deve receber as ferramentas de leitura ativas.');
  const geminiTools = ToolRegistry.toGeminiTools(allowedTools);
  assert.ok(geminiTools.length >= 4, 'Gemini deve receber as ferramentas de leitura ativas.');
});

test('5. Agente com CRM Desabilitado - Omissão de Ferramentas e Bloqueio de Execução', async () => {
  const disabledCaps = { crm: false, auditoria: false, google_drive: false, memorias: false, agenda: false };
  const allowedTools = ToolRegistry.getAllTools().filter((tool) => !tool.capabilityKey || Boolean(disabledCaps[tool.capabilityKey]));

  assert.equal(allowedTools.length, 0, 'Nenhuma ferramenta de CRM deve ser permitida quando crm=false.');

  const execRes = await ToolRegistry.executeTool('search_condominios', { query: 'Lagoinha' }, {
    userId: 'user_admin_test_123',
    agentCapabilities: disabledCaps,
    agentName: 'Agente Sem CRM',
  });

  assert.equal(execRes.ok, false);
  assert.equal(execRes.error, 'capability_disabled');
  assert.ok(execRes.message.includes('desabilitada'));
});

test('6. Auditoria Possui Permissão Própria (capabilityKey: auditoria) e Não se Expõe sob CRM', () => {
  const crmOnlyCaps = { crm: true, auditoria: false, google_drive: false, memorias: false, agenda: false };
  const crmToolsOnly = ToolRegistry.getAllTools().filter((tool) => !tool.capabilityKey || Boolean(crmOnlyCaps[tool.capabilityKey]));

  const auditDocTool = crmToolsOnly.find((t) => t.id === 'search_auditoria_documentos');
  assert.equal(auditDocTool, undefined, 'A ferramenta search_auditoria_documentos NÃO deve ser exposta se auditoria=false.');

  const withAuditCaps = { crm: true, auditoria: true, google_drive: false, memorias: false, agenda: false };
  const auditToolsActive = ToolRegistry.getAllTools().filter((tool) => !tool.capabilityKey || Boolean(withAuditCaps[tool.capabilityKey]));

  const auditFound = auditToolsActive.find((t) => t.id === 'search_auditoria_documentos');
  assert.ok(auditFound, 'A ferramenta search_auditoria_documentos só é exposta quando auditoria=true.');
});

test('7. Preservação de Agentes Legados e Transição para Novos Agentes', async () => {
  assert.equal(isLegacyAgent('agent_slot_1_condo'), true, 'Agente slot_1 ou condo deve ser identificado como legado.');
  assert.equal(isLegacyAgent('agent_new_custom_99'), false, 'Novo agente customizado não deve ser considerado legado.');

  const legacyCaps = await getAgentCapabilities('agent_slot_1_condo', null);
  assert.equal(legacyCaps.crm, true, 'Agente legado (ex: Condo) deve manter CRM ativado durante a transição se sem registro no DB.');

  const newAgentCaps = await getAgentCapabilities('agent_new_custom_99999', null);
  assert.equal(newAgentCaps.crm, false, 'Agente novo sem registro no DB deve ter todas as capacidades desabilitadas por padrão.');
});

test('8. Independência dos Nomes dos Agentes no Engine Universal', () => {
  const customAgent1 = {
    id: 'agent_consultor_sales',
    name: 'Consultor Comercial',
    role: 'Especialista em Leads',
    prompt: 'Atenda clientes e consulte status.',
  };

  const customAgent2 = {
    id: 'agent_auditor_fin',
    name: 'Auditor Financeiro',
    role: 'Especialista em Balancetes',
    prompt: 'Analise os balancetes do condomínio.',
  };

  const prompt1 = buildAgentSystemPrompt(customAgent1, 'GPT-4o', 'Equilibrado', 'OpenAI');
  assert.ok(prompt1.includes('Consultor Comercial'), 'System prompt deve refletir a identidade dinâmica do Consultor.');

  const prompt2 = buildAgentSystemPrompt(customAgent2, 'Gemini 2.5 Flash', 'Avançado', 'Google GenAI');
  assert.ok(prompt2.includes('Auditor Financeiro'), 'System prompt deve refletir a identidade dinâmica do Auditor.');
});

test('9. Falha de Gravação no Supabase Lança Exceção Sem Falso Sucesso', async () => {
  const fakeFailingSupabase = {
    from: () => ({
      upsert: async () => ({
        data: null,
        error: { message: 'DB connection error: relation agent_capabilities failing' },
      }),
    }),
  };

  await assert.rejects(
    async () => {
      await saveAgentCapabilities('agent_db_fail_test', { crm: true }, 'admin_123', fakeFailingSupabase);
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Falha na persistência'));
      return true;
    },
    'Falha no Supabase deve lançar exceção e não simular sucesso nem salvar silenciosamente.'
  );
});

test('10. Exclusão em Cascata ao Remover Agente Global', async () => {
  const adminId = 'user_admin_test_123';
  const agentId = 'agent_del_cascade_test';

  await saveAgentCapabilities(agentId, { crm: true }, adminId, null);
  await deleteAgentCapabilities(agentId, adminId, null);

  const afterDel = await getAgentCapabilities(agentId, null);
  assert.equal(afterDel.crm, false, 'Agente excluído deve retornar capacidades desabilitadas sem lixo de estado.');
});
