import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/tools/registry.js';
import { executeCrmTool } from '../crmTools.js';
import { buildAgentSystemPrompt, resolveModelInfo } from '../agentExecutionEngine.js';

test('1. ToolRegistry - Registro e consulta de ferramentas', (t) => {
  const tools = ToolRegistry.getAllTools();
  assert.ok(tools.length >= 5, 'Deve conter pelo menos as 5 ferramentas do CRM Triverus registradas.');

  const searchCondo = ToolRegistry.getTool('search_condominios');
  assert.ok(searchCondo, 'Ferramenta search_condominios deve estar cadastrada.');
  assert.equal(searchCondo.module, 'crm');
  assert.equal(searchCondo.operationType, 'read');
  assert.equal(searchCondo.requiredAuth, 'active_user');

  const getDetails = ToolRegistry.getTool('get_condominio_details');
  assert.ok(getDetails, 'Ferramenta get_condominio_details deve estar cadastrada.');

  const searchContacts = ToolRegistry.getTool('search_contatos');
  assert.ok(searchContacts, 'Ferramenta search_contatos deve estar cadastrada.');

  const searchInteractions = ToolRegistry.getTool('search_interactions');
  assert.ok(searchInteractions, 'Ferramenta search_interactions deve estar cadastrada.');

  const searchDocs = ToolRegistry.getTool('search_auditoria_documentos');
  assert.ok(searchDocs, 'Ferramenta search_auditoria_documentos deve estar cadastrada.');
});

test('2. Schema Converters - Google GenAI e OpenAI Schemas', (t) => {
  const geminiTools = ToolRegistry.toGeminiTools();
  assert.ok(Array.isArray(geminiTools) && geminiTools.length >= 5);
  const geminiSearch = geminiTools.find((t) => t.name === 'search_condominios');
  assert.ok(geminiSearch, 'Schema Gemini para search_condominios deve existir.');
  assert.ok(geminiSearch.parameters, 'Parâmetros Gemini devem ser gerados.');

  const openAiTools = ToolRegistry.toOpenAITools();
  assert.ok(Array.isArray(openAiTools) && openAiTools.length >= 5);
  const openAiSearch = openAiTools.find((t) => t.function.name === 'search_condominios');
  assert.ok(openAiSearch, 'Schema OpenAI para search_condominios deve existir.');
  assert.equal(openAiSearch.type, 'function');
  assert.ok(openAiSearch.function.parameters.properties.query, 'Propriedade query deve constar no schema OpenAI.');
});

test('3. Execução de Ferramentas e Camada de Autorização', async (t) => {
  // Teste 3.1: Rejeitar usuário não autenticado / anônimo
  const anonRes = await ToolRegistry.executeTool('search_condominios', {}, { userId: 'anonymous' });
  assert.equal(anonRes.ok, false);
  assert.equal(anonRes.error, 'unauthorized');

  // Teste 3.2: Ferramenta desconhecida
  const unknownRes = await ToolRegistry.executeTool('ferramenta_inexistente', {}, { userId: 'user_123' });
  assert.equal(unknownRes.ok, false);
  assert.equal(unknownRes.error, 'unknown_tool');

  // Teste 3.3: Execução de ferramenta com customDataProvider para testes unitários
  const customDataRes = await ToolRegistry.executeTool('search_condominios', { query: 'Lagoinha' }, {
    userId: 'user_test',
    customDataProvider: async (name, args) => {
      return { ok: true, custom: true, name, query: args.query };
    },
  });
  assert.equal(customDataRes.ok, true);
  assert.equal(customDataRes.custom, true);
  assert.equal(customDataRes.name, 'search_condominios');
  assert.equal(customDataRes.query, 'Lagoinha');
});

test('4. Bloqueio Rigoroso de Operações Mutation/Write', async (t) => {
  // Registrar temporariamente uma ferramenta de escrita fictícia para validar a trava do registry
  ToolRegistry.registerTool({
    id: 'write_test_tool',
    name: 'write_test_tool',
    description: 'Ferramenta de escrita de teste',
    module: 'crm',
    operationType: 'write',
    requiredAuth: 'active_user',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  });

  const writeRes = await ToolRegistry.executeTool('write_test_tool', {}, { userId: 'user_test', userPermissions: { can_manage_leads: true } });
  assert.equal(writeRes.ok, false);
  assert.equal(writeRes.error, 'read_only_restriction');
});

test('5. Motor de Execução - Prompt do Agente Independente de Nome', (t) => {
  const customAgent = {
    id: 'agent_99',
    name: 'Auditor Fiscal Senior',
    role: 'Especialista em Balancetes e Convenções',
    prompt: 'Analise detalhadamente as contas e informe divergências fiscais.',
    brainProfile: 'advanced',
    modelId: 'gpt-4o-mini',
  };

  const systemPrompt = buildAgentSystemPrompt(customAgent, 'GPT-4o Mini', 'Avançado', 'OpenAI');
  assert.ok(systemPrompt.includes('Auditor Fiscal Senior'), 'O prompt deve incluir o nome do agente customizado.');
  assert.ok(systemPrompt.includes('Especialista em Balancetes e Convenções'), 'O prompt deve incluir a função do agente.');
  assert.ok(systemPrompt.includes('Analise detalhadamente as contas e informe divergências fiscais.'), 'O prompt deve incluir as diretrizes customizadas.');
  assert.ok(systemPrompt.includes('GPT-4o Mini'), 'O prompt deve incluir os metadados do modelo.');
  assert.ok(systemPrompt.includes('100% READ-ONLY'), 'O prompt deve incluir as regras universais Read-Only Triverus.');
});
