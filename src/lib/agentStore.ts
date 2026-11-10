import type { AgentSlotData, BrainProfile } from '../types/agentBuilder';

export const TRIVERUS_SAVED_AGENTS_KEY = 'triverus:saved-agents:v5';
export const TRIVERUS_AGENT_ASSIGNMENTS_KEY = 'triverus:agent-assignments:v1';
export const TRIVERUS_ACTIVE_CHAT_AGENT_KEY = 'triverus:active-chat-agent-id:v1';
export const TRIVERUS_CHAT_HISTORY_PREFIX = 'triverus:chat:history:v1:';

export interface AgentAssignment {
  id: string;
  agentId: string;
  target: 'chat' | 'auditoria';
  categoryKey?: string; // e.g. 'convencao', 'regimento_interno', etc.
  categoryLabel?: string; // e.g. 'Convenção', 'Regimento Interno', etc.
  assignedAt: string;
}

const AGENTS_CHANGED_EVENT = 'triverus:agents-updated';

function notifyAgentsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AGENTS_CHANGED_EVENT));
  }
}

export function subscribeToAgents(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(AGENTS_CHANGED_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(AGENTS_CHANGED_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function getSavedAgents(): AgentSlotData[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRIVERUS_SAVED_AGENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filter out any stale official Condo instances if any existed in older caches
      return parsed.filter((a) => a && typeof a === 'object' && !a.isOfficial);
    }
  } catch (err) {
    console.warn('[agentStore] Failed to parse agents:', err);
  }
  return [];
}

export function saveAgents(agents: AgentSlotData[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Only save valid, non-official custom agents up to 5
    const cleanAgents = agents.filter((a) => a && !a.isOfficial).slice(0, 5);
    localStorage.setItem(TRIVERUS_SAVED_AGENTS_KEY, JSON.stringify(cleanAgents));
    notifyAgentsChanged();
  } catch (err) {
    console.warn('[agentStore] Failed to save agents:', err);
  }
}

export function saveAgent(agent: AgentSlotData): void {
  const current = getSavedAgents();
  const existingIndex = current.findIndex((a) => a.id === agent.id);
  let updated: AgentSlotData[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = {
      ...agent,
      updatedAt: new Date().toISOString(),
    };
  } else {
    if (current.length >= 5) return;
    updated = [
      ...current,
      {
        ...agent,
        slotNumber: current.length + 1,
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  saveAgents(updated);
}

export function deleteAgent(agentId: string): void {
  const current = getSavedAgents();
  const filtered = current.filter((a) => a.id !== agentId);
  saveAgents(filtered);

  // Remove any assignments for this agent
  const assignments = getAgentAssignments().filter((as) => as.agentId !== agentId);
  saveAgentAssignments(assignments);

  // If this agent was active in chat, clear active chat agent
  if (getActiveChatAgentId() === agentId) {
    setActiveChatAgentId(null);
  }

  // Clear chat history for this agent
  try {
    localStorage.removeItem(`${TRIVERUS_CHAT_HISTORY_PREFIX}${agentId}`);
  } catch {}

  notifyAgentsChanged();
}

export function getAgentAssignments(): AgentAssignment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRIVERUS_AGENT_ASSIGNMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    console.warn('[agentStore] Failed to parse assignments:', err);
  }
  return [];
}

export function saveAgentAssignments(assignments: AgentAssignment[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRIVERUS_AGENT_ASSIGNMENTS_KEY, JSON.stringify(assignments));
    notifyAgentsChanged();
  } catch (err) {
    console.warn('[agentStore] Failed to save assignments:', err);
  }
}

export function getAssignmentsForAgent(agentId: string): AgentAssignment[] {
  const all = getAgentAssignments();
  const list = all.filter((a) => a.agentId === agentId);

  // Check if agent is currently active in Chat Triverus
  const activeChatId = getActiveChatAgentId();
  const hasChat = list.some((a) => a.target === 'chat');
  if (activeChatId === agentId && !hasChat) {
    list.unshift({
      id: `chat-${agentId}`,
      agentId,
      target: 'chat',
      categoryLabel: 'Chat Triverus',
      assignedAt: new Date().toISOString(),
    });
  }

  return list;
}

export function assignAgentToAuditoriaCategory(
  agentId: string,
  categoryKey: string,
  categoryLabel: string
): void {
  const current = getAgentAssignments().filter((a) => !(a.target === 'auditoria' && a.categoryKey === categoryKey));
  current.push({
    id: `auditoria-${categoryKey}-${Date.now()}`,
    agentId,
    target: 'auditoria',
    categoryKey,
    categoryLabel,
    assignedAt: new Date().toISOString(),
  });
  saveAgentAssignments(current);
}

export function removeAgentFromAuditoriaCategory(categoryKey: string): void {
  const current = getAgentAssignments().filter((a) => !(a.target === 'auditoria' && a.categoryKey === categoryKey));
  saveAgentAssignments(current);
}

export function getAssignedAgentForCategory(categoryKey: string): AgentSlotData | null {
  const assignments = getAgentAssignments();
  const found = assignments.find((a) => a.target === 'auditoria' && a.categoryKey === categoryKey);
  if (!found) return null;
  const agents = getSavedAgents();
  return agents.find((a) => a.id === found.agentId) || null;
}

export function getActiveChatAgentId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TRIVERUS_ACTIVE_CHAT_AGENT_KEY);
  } catch {
    return null;
  }
}

export function setActiveChatAgentId(agentId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (agentId) {
      localStorage.setItem(TRIVERUS_ACTIVE_CHAT_AGENT_KEY, agentId);
      // Ensure 'chat' assignment is recorded
      const current = getAgentAssignments().filter((a) => a.target !== 'chat');
      current.push({
        id: `chat-${agentId}`,
        agentId,
        target: 'chat',
        categoryLabel: 'Chat Triverus',
        assignedAt: new Date().toISOString(),
      });
      saveAgentAssignments(current);
    } else {
      localStorage.removeItem(TRIVERUS_ACTIVE_CHAT_AGENT_KEY);
      const current = getAgentAssignments().filter((a) => a.target !== 'chat');
      saveAgentAssignments(current);
    }
    notifyAgentsChanged();
  } catch {}
}

export function getChatHistoryForAgent(agentId: string): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${TRIVERUS_CHAT_HISTORY_PREFIX}${agentId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveChatHistoryForAgent(agentId: string, history: any[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${TRIVERUS_CHAT_HISTORY_PREFIX}${agentId}`, JSON.stringify(history));
  } catch {}
}

import { supabase } from './supabase';

/**
 * Auxiliar para recuperar o token JWT da sessão ativa do Supabase
 */
export async function getAuthToken(providedToken?: string): Promise<string | undefined> {
  if (providedToken) return providedToken;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token;
  } catch {
    return undefined;
  }
}

/**
 * Sincroniza agentes globais com o backend (/api/agents)
 */
export async function syncGlobalAgentsWithBackend(providedToken?: string): Promise<AgentSlotData[]> {
  if (typeof window === 'undefined') return [];
  try {
    const token = await getAuthToken(providedToken);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/agents', { headers });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.agents)) {
        saveAgents(data.agents);
        return data.agents;
      }
    }
  } catch (err) {
    console.warn('[agentStore] Failed to sync agents with server:', err);
  }
  return getSavedAgents();
}

/**
 * Sincroniza atribuições globais com o backend (/api/agents/assignments)
 */
export async function syncGlobalAssignmentsWithBackend(providedToken?: string): Promise<AgentAssignment[]> {
  if (typeof window === 'undefined') return [];
  try {
    const token = await getAuthToken(providedToken);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/agents/assignments', { headers });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.assignments)) {
        saveAgentAssignments(data.assignments);
        return data.assignments;
      }
    }
  } catch (err) {
    console.warn('[agentStore] Failed to sync assignments with server:', err);
  }
  return getAgentAssignments();
}

/**
 * Salva agente no backend exclusivamente no Supabase (apenas admin) e atualiza cache local somente após confirmação autoritativa.
 */
export async function persistAgentToBackend(
  agent: AgentSlotData,
  providedToken?: string
): Promise<{ ok: boolean; error?: string; agent?: AgentSlotData }> {
  const token = await getAuthToken(providedToken);
  if (!token) {
    return { ok: false, error: 'Sessão de usuário não autenticada no Supabase. Faça login para persistir.' };
  }

  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(agent),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const errorMsg = data?.error || data?.message || 'Falha ao salvar agente no Supabase.';
      return { ok: false, error: errorMsg };
    }

    const savedAgent = data.agent || agent;
    saveAgent(savedAgent);
    return { ok: true, agent: savedAgent };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha de comunicação com o servidor Supabase.' };
  }
}

/**
 * Exclui agente no backend exclusivamente no Supabase (apenas admin) e atualiza cache local somente após confirmação autoritativa.
 */
export async function removeAgentFromBackend(
  agentId: string,
  providedToken?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = await getAuthToken(providedToken);
  if (!token) {
    return { ok: false, error: 'Sessão de usuário não autenticada no Supabase. Faça login para excluir.' };
  }

  try {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const errorMsg = data?.error || data?.message || 'Falha ao excluir agente no Supabase.';
      return { ok: false, error: errorMsg };
    }

    deleteAgent(agentId);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha de comunicação com o servidor Supabase.' };
  }
}

/**
 * Persiste atribuição no backend exclusivamente no Supabase.
 */
export async function persistAssignmentToBackend(
  assignment: {
    agentId: string;
    target: 'chat' | 'auditoria';
    categoryKey?: string;
    categoryLabel?: string;
  },
  providedToken?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = await getAuthToken(providedToken);
  if (!token) {
    return { ok: false, error: 'Sessão não autenticada.' };
  }

  try {
    const res = await fetch('/api/agents/assignments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(assignment),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || data?.message || 'Falha ao salvar atribuição no Supabase.' };
    }
    await syncGlobalAssignmentsWithBackend(token);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Erro ao conectar ao servidor.' };
  }
}

/**
 * Consulta o catálogo dinâmico de modelos no backend (/api/agents/models)
 */
export async function fetchDynamicModelCatalog(providedToken?: string): Promise<{
  ok: boolean;
  catalog: any[];
  isStale?: boolean;
  lastError?: string;
  providerStatus?: any;
}> {
  try {
    const token = await getAuthToken(providedToken);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/agents/models', { headers });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      return {
        ok: Boolean(data.ok),
        catalog: Array.isArray(data.catalog) ? data.catalog : [],
        isStale: Boolean(data.isStale),
        lastError: data.lastError,
        providerStatus: data.providerStatus,
      };
    }
    return {
      ok: false,
      catalog: [],
      lastError: data?.message || data?.error || `Erro de conexão HTTP ${res.status}`,
      providerStatus: data?.providerStatus,
    };
  } catch (err: any) {
    console.warn('[agentStore] Error fetching model catalog:', err);
    return { ok: false, catalog: [], lastError: err?.message || 'Falha ao conectar com servidor' };
  }
}

/**
 * Força atualização manual do catálogo de modelos nas APIs oficiais (/api/agents/models/refresh)
 */
export async function refreshDynamicModelCatalog(providedToken?: string): Promise<{
  ok: boolean;
  catalog: any[];
  error?: string;
  isStale?: boolean;
  providerStatus?: any;
}> {
  try {
    const token = await getAuthToken(providedToken);
    if (!token) return { ok: false, catalog: [], error: 'Sessão não autenticada.' };

    const res = await fetch('/api/agents/models/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && Array.isArray(data.catalog)) {
      return {
        ok: true,
        catalog: data.catalog,
        isStale: data.isStale,
        providerStatus: data.providerStatus,
      };
    }
    return { ok: false, catalog: [], error: data?.message || data?.error || 'Falha ao atualizar catálogo' };
  } catch (err: any) {
    return { ok: false, catalog: [], error: err?.message || 'Erro ao conectar com servidor' };
  }
}


