import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGlobalAgents,
  getGlobalAgentById,
  saveGlobalAgent,
  deleteGlobalAgent,
  getGlobalAssignments,
  saveGlobalAssignment,
  removeGlobalAssignment,
  getCustomAgentsForUser,
  getCustomAgentById,
  saveCustomAgentForUser,
  deleteCustomAgentForUser,
  writeFallbackAgents,
  writeFallbackAssignments,
} from '../agentService.js';
import {
  resolveModelInfo,
  resolveBrainParameters,
  buildAgentSystemPrompt,
  executeAgentChat
} from '../agentExecutionEngine.js';
import { resolveAvatarForSlot, SLOT_AVATARS } from '../agentService.js';

describe('Triverus 5 Global Agents Architecture & Security Engine Tests', () => {
  const adminUserId = 'admin_user_principal';
  const collaboratorUserId = 'colaborador_comum_123';
  const inactiveUserId = 'user_inactive_account_999';

  beforeEach(() => {
    // Reset fallback stores to known clean state with 1 test agent in slot 1
    writeFallbackAgents([
      {
        id: 'global_agent_1',
        slotNumber: 1,
        name: 'Auditor Tributário do CRM',
        role: 'Auditor Fiscal Senior',
        prompt: 'Analise notas fiscais e relatórios contábeis com precisão.',
        brainProfile: 'equilibrado',
        modelId: 'gemini-1.5-pro',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
        isConfigured: true,
        isOfficial: false,
        updatedAt: new Date().toISOString(),
      }
    ]);
    writeFallbackAssignments([
      {
        id: 'assign_chat_singleton',
        agentId: 'global_agent_1',
        target: 'chat',
        categoryLabel: 'Chat Triverus',
        assignedBy: adminUserId,
        assignedAt: new Date().toISOString(),
      }
    ]);
  });

  test('1. Administrador cria e configura agente global em slot válido (1..5)', async () => {
    const saved = await saveGlobalAgent(
      {
        id: 'global_agent_2',
        slotNumber: 2,
        name: 'Especialista em Convenção',
        role: 'Consultor Jurídico',
        prompt: 'Interprete cláusulas da convenção condominial.',
        brainProfile: 'avancado',
        modelId: 'gemini-1.5-pro',
      },
      adminUserId,
      null
    );

    assert.equal(saved.id, 'global_agent_2');
    assert.equal(saved.slotNumber, 2);
    assert.equal(saved.name, 'Especialista em Convenção');
    assert.equal(saved.role, 'Consultor Jurídico');
    assert.equal(saved.brainProfile, 'avancado');

    const agents = await getGlobalAgents(null);
    assert.ok(agents.some((a) => a.id === 'global_agent_2'));
  });

  test('2. Limite máximo estrito de 5 agentes globais (rejeita criação além de 5)', async () => {
    // Preenche todos os 5 slots
    for (let slot = 2; slot <= 5; slot++) {
      await saveGlobalAgent(
        {
          id: `global_agent_${slot}`,
          slotNumber: slot,
          name: `Agente Slot ${slot}`,
          role: `Função ${slot}`,
        },
        adminUserId,
        null
      );
    }

    const fullList = await getGlobalAgents(null);
    assert.equal(fullList.length, 5);

    // Tentativa de criar o 6º agente deve ser rejeitada
    await assert.rejects(
      async () => {
        await saveGlobalAgent(
          {
            name: 'Agente Excedente 6',
            role: 'Tentativa Invalida',
          },
          adminUserId,
          null
        );
      },
      /Limite máximo de 5 agentes globais/
    );
  });

  test('3. Colaborador ativo pode listar e consultar os agentes globais', async () => {
    const result = await getCustomAgentById('global_agent_1', collaboratorUserId, null);
    assert.equal(result.authorized, true);
    assert.ok(result.agent);
    assert.equal(result.agent.id, 'global_agent_1');
    assert.equal(result.agent.name, 'Auditor Tributário do CRM');

    const list = await getCustomAgentsForUser(collaboratorUserId, null);
    assert.ok(list.length > 0);
    assert.equal(list[0].id, 'global_agent_1');
  });

  test('4. Colaborador não administrador tem criação e edição bloqueada', async () => {
    await assert.rejects(
      async () => {
        await saveGlobalAgent(
          {
            id: 'unauthorized_agent',
            slotNumber: 3,
            name: 'Agente de Colaborador',
            role: 'Tentativa Proibida',
          },
          collaboratorUserId,
          null
        );
      },
      /apenas administradores ativos podem criar ou editar/
    );
  });

  test('5. Colaborador não administrador tem exclusão bloqueada', async () => {
    await assert.rejects(
      async () => {
        await deleteGlobalAgent('global_agent_1', collaboratorUserId, null);
      },
      /apenas administradores ativos podem excluir/
    );
  });

  test('6. Usuário inativo tem acesso bloqueado (authorized: false)', async () => {
    const result = await getCustomAgentById('global_agent_1', inactiveUserId, null);
    assert.equal(result.authorized, false);
    assert.equal(result.agent, null);
    assert.ok(result.reason.includes('inativa'));
  });

  test('7. Administrador atribui agentes para Chat e múltiplos agentes podem ser habilitados simultaneamente', async () => {
    const assignment1 = await saveGlobalAssignment(
      {
        agentId: 'global_agent_1',
        target: 'chat',
        categoryLabel: 'Chat Triverus',
      },
      adminUserId,
      null
    );

    assert.equal(assignment1.target, 'chat');
    assert.equal(assignment1.agentId, 'global_agent_1');

    // Cria e atribui um segundo agente para o Chat
    await saveGlobalAgent(
      {
        id: 'global_agent_2',
        slotNumber: 2,
        name: 'Especialista em Convenção',
        role: 'Consultor Jurídico',
        prompt: 'Interprete cláusulas da convenção condominial.',
        modelId: 'gemini-1.5-pro',
      },
      adminUserId,
      null
    );

    const assignment2 = await saveGlobalAssignment(
      {
        agentId: 'global_agent_2',
        target: 'chat',
        categoryLabel: 'Consultor Jurídico no Chat',
      },
      adminUserId,
      null
    );
    assert.equal(assignment2.target, 'chat');
    assert.equal(assignment2.agentId, 'global_agent_2');

    const allAssignments = await getGlobalAssignments(null);
    const chatAssignments = allAssignments.filter((a) => a.target === 'chat');
    assert.equal(chatAssignments.length, 2, 'Chat deve permitir múltiplos agentes habilitados para seleção do usuário');
  });

  test('8. Administrador atribui agente para Auditoria com 1 especialista por categoria', async () => {
    const assignment1 = await saveGlobalAssignment(
      {
        agentId: 'global_agent_1',
        target: 'auditoria',
        categoryKey: 'convencao',
        categoryLabel: 'Convenção Condominial',
      },
      adminUserId,
      null
    );

    assert.equal(assignment1.target, 'auditoria');
    assert.equal(assignment1.categoryKey, 'convencao');

    // Atribuir um novo agente para a mesma categoria 'convencao' substitui o anterior
    const assignment2 = await saveGlobalAssignment(
      {
        agentId: 'global_agent_2',
        target: 'auditoria',
        categoryKey: 'convencao',
        categoryLabel: 'Convenção Condominial',
      },
      adminUserId,
      null
    );
    assert.equal(assignment2.target, 'auditoria');
    assert.equal(assignment2.agentId, 'global_agent_2');

    const allAssignments = await getGlobalAssignments(null);
    const convAssignments = allAssignments.filter((a) => a.target === 'auditoria' && a.categoryKey === 'convencao');
    assert.equal(convAssignments.length, 1, 'Auditoria deve manter estritamente 1 especialista por categoria');
    assert.equal(convAssignments[0].agentId, 'global_agent_2');
  });

  test('9. Colaborador tem gestão de atribuições bloqueada', async () => {
    await assert.rejects(
      async () => {
        await saveGlobalAssignment(
          {
            agentId: 'global_agent_1',
            target: 'chat',
          },
          collaboratorUserId,
          null
        );
      },
      /apenas administradores ativos podem atribuir agentes/
    );

    await assert.rejects(
      async () => {
        await removeGlobalAssignment('chat', undefined, collaboratorUserId, null);
      },
      /apenas administradores ativos podem remover atribuições/
    );
  });

  test('10. Roteamento de modelos e injeção do Prompt Personalizado no Sistema', () => {
    const agent = {
      name: 'Auditor Tributário do CRM',
      role: 'Auditor Fiscal Senior',
      prompt: 'Analise notas fiscais e relatórios contábeis com precisão.',
    };

    const sysPrompt = buildAgentSystemPrompt(agent, 'Gemini 1.5 Pro', 'Avançado', 'Google GenAI');

    assert.ok(sysPrompt.includes('Auditor Tributário do CRM'));
    assert.ok(sysPrompt.includes('Auditor Fiscal Senior'));
    assert.ok(sysPrompt.includes('Analise notas fiscais e relatórios contábeis com precisão.'));

    const geminiInfo = resolveModelInfo('gemini-1.5-pro');
    assert.equal(geminiInfo.provider, 'google');

    const brainParams = resolveBrainParameters('advanced');
    assert.equal(brainParams.maxOutputTokens, 4096);
  });

  test('11. Preservação da identidade do agente em fallbacks sem vazar marcas anteriores', async () => {
    const customAgent = {
      id: 'agent_slot_3',
      name: 'Especialista Contábil',
      role: 'Consultor Financeiro',
      prompt: 'Atue analisando balancetes.',
      brainProfile: 'equilibrado',
      modelId: 'gemini-3.8-flash',
    };

    const response = await executeAgentChat({
      agent: customAgent,
      messages: [{ role: 'user', content: 'Quem é você?' }],
    });

    assert.ok(response.text);
    assert.ok(!response.text.includes('Condo'), 'Resposta fallback NÃO pode conter Condo');
    assert.ok(response.text.includes('Especialista Contábil') || response.error);
  });

  test('12. Fallback de contingência mantém compatibilidade e integridade dos 5 slots', async () => {
    const agents = await getGlobalAgents(null);
    assert.ok(Array.isArray(agents));
    assert.ok(agents.length <= 5);

    const deleted = await deleteGlobalAgent('global_agent_1', adminUserId, null);
    assert.equal(deleted, true);

    const postDeleteAgents = await getGlobalAgents(null);
    assert.ok(!postDeleteAgents.some((a) => a.id === 'global_agent_1'));

    const postDeleteAssignments = await getGlobalAssignments(null);
    assert.ok(!postDeleteAssignments.some((a) => a.agentId === 'global_agent_1'));
  });

  test('13. Execução bloqueada quando o agente não possui modelo configurado (sem auto-substituição)', async () => {
    const unconfiguredAgent = {
      id: 'agent_sem_modelo',
      name: 'Agente Sem Modelo Definido',
      role: 'Especialista Neutro',
      prompt: 'Apenas responda se possível.',
      modelId: '',
    };

    const result = await executeAgentChat({
      agent: unconfiguredAgent,
      messages: [{ role: 'user', content: 'Olá, qual é o seu modelo?' }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.modelUsed, 'Não configurado');
    assert.ok(result.text.includes('não possui um modelo de inteligência configurado'));
  });

  test('14. Validação rejeita modelo não cadastrado no catálogo multiprovedor', async () => {
    const checkInvalid = resolveModelInfo('modelo-alienigena-v10');
    assert.equal(checkInvalid.isValid, false);

    await assert.rejects(
      async () => {
        await saveGlobalAgent(
          {
            id: 'agent_invalid_model',
            slotNumber: 3,
            name: 'Agente Modelo Inválido',
            role: 'Teste Catálogo',
            modelId: 'modelo-alienigena-v10',
          },
          adminUserId,
          null
        );
      },
      /Modelo "modelo-alienigena-v10" inválido ou não suportado pelo catálogo multiprovedor/
    );
  });

  test('15. Persistência exclusiva no Supabase: falha na persistência lança erro explícito sem gravar JSON', async () => {
    const mockFailingSupabase = {
      from: (table) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { role: 'admin', is_active: true },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'custom_agents') {
          return {
            select: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
            upsert: async () => ({
              error: { message: 'relation "custom_agents" does not exist or database unreachable' },
            }),
          };
        }
        return {};
      },
    };

    await assert.rejects(
      async () => {
        await saveGlobalAgent(
          {
            id: 'agent_fail_db',
            slotNumber: 1,
            name: 'Agente Teste DB Fail',
            role: 'Auditor Fiscal',
            modelId: 'gemini-1.5-pro',
          },
          adminUserId,
          mockFailingSupabase
        );
      },
      /Falha na persistência no Supabase: relation "custom_agents" does not exist or database unreachable/
    );
  });

  test('16. Validação de integridade de atribuição: Auditoria exige categoryKey e Chat zera categoryKey', async () => {
    // Tentativa de atribuir auditoria sem categoryKey deve falhar
    await assert.rejects(
      async () => {
        await saveGlobalAssignment(
          {
            agentId: 'global_agent_1',
            target: 'auditoria',
            categoryKey: '',
          },
          adminUserId,
          null
        );
      },
      /A categoria de documento \(categoryKey\) é obrigatória para atribuições de Auditoria/
    );

    // Atribuir para chat zera categoryKey para null/undefined, respeitando chk_agent_assignments_target_category
    const chatAssign = await saveGlobalAssignment(
      {
        agentId: 'global_agent_1',
        target: 'chat',
        categoryKey: 'nao_permitido_em_chat',
      },
      adminUserId,
      null
    );
    assert.equal(chatAssign.target, 'chat');
    assert.equal(chatAssign.categoryKey, undefined);
  });

  test('17. Resolução de avatares para os Slots 1, 2 e 3 com URLs HTTPS 2026/11 e transparência mantida', () => {
    const slot1Avatar = resolveAvatarForSlot(1, '', '');
    assert.equal(slot1Avatar.avatarUrl, 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/j-coruja-macho.webp');
    assert.equal(slot1Avatar.avatarId, 'coruja-j');

    const slot2Avatar = resolveAvatarForSlot(2, 'http://adm.triveruscondo.com/wp-content/uploads/2026/10/f-coruja-macho.webp', 'coruja-f');
    assert.equal(slot2Avatar.avatarUrl, 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/f-coruja-macho.webp');
    assert.equal(slot2Avatar.avatarId, 'coruja-f');

    const slot3Avatar = resolveAvatarForSlot(3, '', '');
    assert.equal(slot3Avatar.avatarUrl, 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/d-coruja-femea.webp');
    assert.equal(slot3Avatar.avatarId, 'coruja-d');
  });
});
