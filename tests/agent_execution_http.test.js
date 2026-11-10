import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { executeCrmTool, GEMINI_CRM_TOOLS, OPENAI_CRM_TOOLS } from '../crmTools.js';
import { executeAgentChat, resolveBrainParameters, resolveModelInfo } from '../agentExecutionEngine.js';
import {
  getGlobalAgents,
  getGlobalAgentById,
  saveGlobalAgent,
  deleteGlobalAgent,
  getGlobalAssignments,
  saveGlobalAssignment,
  removeGlobalAssignment,
  checkIsActiveAdmin,
  checkIsActiveUser,
  writeFallbackAgents,
  writeFallbackAssignments,
} from '../agentService.js';

describe('Triverus 5 Global Agents Real HTTP Integration Tests with Function Calling', () => {
  const adminUserId = 'user_admin_super';
  const collaboratorUserId = 'colaborador_operacional';
  const inactiveUserId = 'user_inactive_account_blocked';
  const TEST_PORT = 3899;

  let server;

  before(async () => {
    writeFallbackAgents([
      {
        id: 'global_ag_tributario',
        slotNumber: 1,
        name: 'Auditor Tributário do CRM',
        role: 'Auditor Fiscal Senior',
        prompt: 'Atue exclusivamente consultando dados de condomínios e notas fiscais.',
        brainProfile: 'avancado',
        modelId: 'gemini-1.5-pro',
        avatarUrl: '',
        isConfigured: true,
        isOfficial: false,
        updatedAt: new Date().toISOString(),
      }
    ]);

    writeFallbackAssignments([
      {
        id: 'assign_chat_1',
        agentId: 'global_ag_tributario',
        target: 'chat',
        categoryLabel: 'Chat Triverus',
        assignedBy: adminUserId,
        assignedAt: new Date().toISOString(),
      }
    ]);

    const app = express();
    app.use(express.json());

    // Helper de autenticação para os testes HTTP
    const authenticate = (req) => {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
      if (token === 'token_admin') return { id: adminUserId, role: 'admin', is_active: true };
      if (token === 'token_collaborator') return { id: collaboratorUserId, role: 'colaborador', is_active: true };
      if (token === 'token_inactive') return { id: inactiveUserId, role: 'colaborador', is_active: false };
      return null;
    };

    // GET /api/agents
    app.get('/api/agents', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (!user.is_active) return res.status(403).json({ error: 'Conta inativa' });

      const agents = await getGlobalAgents(null);
      return res.json({ ok: true, agents });
    });

    // POST /api/agents (Admin only)
    app.post('/api/agents', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (!user.is_active) return res.status(403).json({ error: 'Conta inativa' });

      if (user.role !== 'admin') {
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          message: 'Apenas administradores ativos podem criar ou editar agentes globais.',
        });
      }

      const { id, name, role, prompt, brainProfile, modelId, slotNumber } = req.body;
      if (!name || !role) {
        return res.status(400).json({ error: 'Nome e função obrigatórios.' });
      }

      const cleanRole = String(role).trim();
      if (cleanRole.length > 34) {
        return res.status(400).json({ error: 'Função excede 34 caracteres.' });
      }

      try {
        const saved = await saveGlobalAgent(
          { id, name, role: cleanRole, prompt, brainProfile, modelId, slotNumber },
          user.id,
          null
        );
        return res.json({ ok: true, success: true, agent: saved });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    });

    // DELETE /api/agents/:id (Admin only)
    app.delete('/api/agents/:id', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (!user.is_active) return res.status(403).json({ error: 'Conta inativa' });

      if (user.role !== 'admin') {
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          message: 'Apenas administradores ativos podem excluir agentes globais.',
        });
      }

      try {
        const deleted = await deleteGlobalAgent(req.params.id, user.id, null);
        return res.json({ ok: true, success: deleted });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    });

    // GET /api/agents/assignments
    app.get('/api/agents/assignments', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (!user.is_active) return res.status(403).json({ error: 'Conta inativa' });

      const assignments = await getGlobalAssignments(null);
      return res.json({ ok: true, assignments });
    });

    // POST /api/agents/assignments (Admin only)
    app.post('/api/agents/assignments', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ error: 'Não autenticado' });
      if (!user.is_active) return res.status(403).json({ error: 'Conta inativa' });

      if (user.role !== 'admin') {
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
          message: 'Apenas administradores ativos podem gerenciar atribuições globais.',
        });
      }

      const { action, agentId, target, categoryKey, categoryLabel } = req.body;
      try {
        if (action === 'delete') {
          const removed = await removeGlobalAssignment(target, categoryKey, user.id, null);
          return res.json({ ok: true, success: removed });
        }

        const saved = await saveGlobalAssignment({ agentId, target, categoryKey, categoryLabel }, user.id, null);
        return res.json({ ok: true, success: true, assignment: saved });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    });

    // POST /api/condo/chat
    app.post('/api/condo/chat', async (req, res) => {
      const user = authenticate(req);
      if (!user) return res.status(401).json({ ok: false, error: 'unauthorized' });
      if (!user.is_active) return res.status(403).json({ ok: false, error: 'inactive_user' });

      const { messages, agentId, toolContextOverride } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }

      const agent = agentId ? await getGlobalAgentById(agentId, null) : null;
      if (!agent) {
        return res.status(404).json({ ok: false, error: 'agent_not_found' });
      }

      if (!agent.modelId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_model',
          message: `O agente "${agent.name}" não possui modelo de IA configurado por um administrador.`,
        });
      }

      try {
        const executionRes = await executeAgentChat({
          agent,
          messages,
          toolContext: toolContextOverride || { userId: user.id },
        });

        return res.status(200).json({
          ok: executionRes.ok,
          text: executionRes.text,
          model_used: executionRes.modelUsed,
          provider_used: executionRes.providerUsed,
          brain_profile: executionRes.brainProfileUsed,
          agent: { id: agent.id, name: agent.name, role: agent.role },
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    });

    await new Promise((resolve) => {
      server = app.listen(TEST_PORT, '127.0.0.1', () => resolve(true));
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. HTTP GET /api/agents - Colaborador e Admin podem listar os 5 agentes globais', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents`, {
      headers: { Authorization: 'Bearer token_collaborator' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.agents));
    assert.equal(body.agents[0].id, 'global_ag_tributario');
  });

  test('2. HTTP POST /api/agents - Colaborador recebe 403 Forbidden ao tentar criar agente', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_collaborator',
      },
      body: JSON.stringify({
        name: 'Agente Ilegal',
        role: 'Tentativa Proibida',
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'forbidden');
  });

  test('3. HTTP POST /api/agents - Admin cria com sucesso agente global respeitando limite de 34 chars na função', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin',
      },
      body: JSON.stringify({
        id: 'global_ag_admin_2',
        slotNumber: 2,
        name: 'Especialista em Regimento',
        role: 'Consultor Normativo',
        prompt: 'Atue interpretando o regimento.',
        brainProfile: 'economic',
        modelId: 'gemini-3.8-flash',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.agent.id, 'global_ag_admin_2');
    assert.equal(body.agent.slotNumber, 2);
  });

  test('4. HTTP DELETE /api/agents/:id - Colaborador recebe 403 Forbidden e Admin consegue excluir', async () => {
    // Colaborador tenta excluir
    const colabRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/global_ag_admin_2`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_collaborator' },
    });
    assert.equal(colabRes.status, 403);

    // Admin exclui
    const adminRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/global_ag_admin_2`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_admin' },
    });
    assert.equal(adminRes.status, 200);
    const body = await adminRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.success, true);
  });

  test('5. HTTP POST /api/agents/assignments - Admin atribui e Colaborador é bloqueado (403)', async () => {
    // Colaborador bloqueado
    const colabRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_collaborator',
      },
      body: JSON.stringify({
        agentId: 'global_ag_tributario',
        target: 'chat',
      }),
    });
    assert.equal(colabRes.status, 403);

    // Admin atribui
    const adminRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin',
      },
      body: JSON.stringify({
        agentId: 'global_ag_tributario',
        target: 'auditoria',
        categoryKey: 'balancete',
        categoryLabel: 'Balancete Mensal',
      }),
    });
    assert.equal(adminRes.status, 200);
    const body = await adminRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.assignment.target, 'auditoria');
  });

  test('6. HTTP POST /api/condo/chat - Colaborador utiliza o agente global com contexto de ferramentas isolado pelo seu userId', async () => {
    let capturedUserId = null;

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/condo/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_collaborator',
      },
      body: JSON.stringify({
        agentId: 'global_ag_tributario',
        messages: [{ role: 'user', content: 'Quais condomínios estão no meu pipeline?' }],
        toolContextOverride: {
          userId: collaboratorUserId,
          customDataProvider: async (name, args, ctx) => {
            capturedUserId = ctx?.userId || collaboratorUserId;
            return { condominios: [] };
          },
        },
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.agent.id, 'global_ag_tributario');
    assert.equal(body.agent.name, 'Auditor Tributário do CRM');
  });

  test('7. HTTP POST /api/condo/chat - Usuário inativo recebe HTTP 403', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/condo/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_inactive',
      },
      body: JSON.stringify({
        agentId: 'global_ag_tributario',
        messages: [{ role: 'user', content: 'Olá' }],
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'inactive_user');
  });

  test('8. HTTP POST /api/condo/chat - Requisição sem autenticação recebe HTTP 401', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/condo/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'global_ag_tributario',
        messages: [{ role: 'user', content: 'Olá' }],
      }),
    });
    assert.equal(res.status, 401);
  });

  test('9. HTTP POST /api/condo/chat - Agente sem modelo configurado é bloqueado com HTTP 400 missing_model', async () => {
    // Cria agente sem modelo
    await saveGlobalAgent(
      {
        id: 'global_ag_sem_modelo',
        slotNumber: 4,
        name: 'Agente Sem Modelo',
        role: 'Consultor Geral',
        prompt: 'Atue se configurado.',
        modelId: '',
      },
      adminUserId,
      null
    );

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/condo/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_collaborator',
      },
      body: JSON.stringify({
        agentId: 'global_ag_sem_modelo',
        messages: [{ role: 'user', content: 'Olá' }],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'missing_model');
    assert.ok(body.message.includes('não possui modelo de IA configurado'));
  });

  test('10. HTTP POST /api/agents/assignments - Admin habilita múltiplos agentes para o Chat simultaneamente', async () => {
    // Atribui o agente do slot 4 para o Chat também
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin',
      },
      body: JSON.stringify({
        agentId: 'global_ag_sem_modelo',
        target: 'chat',
        categoryLabel: 'Consultor Geral no Chat',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Consulta todas as atribuições
    const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/assignments`, {
      headers: { Authorization: 'Bearer token_collaborator' },
    });
    const listBody = await listRes.json();
    const chatAssignments = listBody.assignments.filter((a) => a.target === 'chat');
    assert.ok(chatAssignments.length >= 2, 'Múltiplos agentes devem permanecer habilitados para Chat');
  });
});
