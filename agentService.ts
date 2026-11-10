import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSlotData, BrainProfile } from './src/types/agentBuilder.ts';
import { resolveModelInfo } from './agentExecutionEngine.ts';
import { checkModelCapabilityForAgent } from './modelCatalogService.ts';

const FALLBACK_AGENTS_FILE_PATH = path.join(process.cwd(), 'custom_agents_store.json');
const FALLBACK_ASSIGNMENTS_FILE_PATH = path.join(process.cwd(), 'custom_agent_assignments_store.json');

export interface GlobalAgentAssignment {
  id: string;
  agentId: string;
  target: 'chat' | 'auditoria';
  categoryKey?: string;
  categoryLabel?: string;
  assignedBy?: string;
  assignedAt: string;
}

export function readFallbackAgents(): AgentSlotData[] {
  try {
    if (fs.existsSync(FALLBACK_AGENTS_FILE_PATH)) {
      const raw = fs.readFileSync(FALLBACK_AGENTS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, 5);
    }
  } catch (err) {
    console.warn('[agentService] Failed to read fallback agents store:', err);
  }
  return [];
}

export function writeFallbackAgents(agents: AgentSlotData[]): void {
  try {
    const clean = agents.slice(0, 5);
    fs.writeFileSync(FALLBACK_AGENTS_FILE_PATH, JSON.stringify(clean, null, 2), 'utf8');
  } catch (err) {
    console.warn('[agentService] Failed to write fallback agents store:', err);
  }
}

export function readFallbackAssignments(): GlobalAgentAssignment[] {
  try {
    if (fs.existsSync(FALLBACK_ASSIGNMENTS_FILE_PATH)) {
      const raw = fs.readFileSync(FALLBACK_ASSIGNMENTS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[agentService] Failed to read fallback assignments store:', err);
  }
  return [];
}

export function writeFallbackAssignments(assignments: GlobalAgentAssignment[]): void {
  try {
    fs.writeFileSync(FALLBACK_ASSIGNMENTS_FILE_PATH, JSON.stringify(assignments, null, 2), 'utf8');
  } catch (err) {
    console.warn('[agentService] Failed to write fallback assignments store:', err);
  }
}

const inMemoryCapabilities = new Map<string, Record<string, boolean>>();

export function getDefaultCapabilities(): Record<string, boolean> {
  return {
    crm: false,
    auditoria: false,
    google_drive: false,
    memorias: false,
    agenda: false,
  };
}

export function isLegacyAgent(agentId?: string): boolean {
  if (!agentId) return false;
  const lower = agentId.toLowerCase();
  return lower.includes('condo') || lower.includes('slot_1') || lower === 'agent_1';
}

export async function getAgentCapabilities(
  agentId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<Record<string, boolean>> {
  if (!agentId) return getDefaultCapabilities();

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('agent_capabilities')
        .select('capability_key, enabled')
        .eq('agent_id', agentId);

      if (!error && data && data.length > 0) {
        const result = getDefaultCapabilities();
        for (const row of data) {
          if (row.capability_key === 'crm') {
            result.crm = Boolean(row.enabled);
          } else if (row.capability_key === 'auditoria') {
            result.auditoria = Boolean(row.enabled);
          }
        }
        return result;
      }

      if (error) {
        console.warn('[agentService] Warning fetching agent capabilities from Supabase:', error.message);
      }
    } catch (err: any) {
      console.warn('[agentService] Exception querying agent capabilities:', err?.message || err);
    }
  }

  if (inMemoryCapabilities.has(agentId)) {
    return { ...getDefaultCapabilities(), ...inMemoryCapabilities.get(agentId) };
  }

  if (isLegacyAgent(agentId)) {
    return {
      crm: true,
      auditoria: false,
      google_drive: false,
      memorias: false,
      agenda: false,
    };
  }

  return getDefaultCapabilities();
}

export async function saveAgentCapabilities(
  agentId: string,
  capabilities: Record<string, boolean>,
  _adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<Record<string, boolean>> {
  const sanitized = {
    crm: Boolean(capabilities?.crm ?? false),
    auditoria: Boolean(capabilities?.auditoria ?? false),
    google_drive: false,
    memorias: false,
    agenda: false,
  };

  if (supabaseAdmin) {
    const dbRowCrm = {
      agent_id: agentId,
      capability_key: 'crm',
      enabled: sanitized.crm,
      updated_at: new Date().toISOString(),
    };
    const { error: errCrm } = await supabaseAdmin
      .from('agent_capabilities')
      .upsert(dbRowCrm, { onConflict: 'agent_id,capability_key' });

    if (errCrm) {
      throw new Error(`Falha na persistência de capacidades (CRM) no Supabase: ${errCrm.message}`);
    }

    const dbRowAudit = {
      agent_id: agentId,
      capability_key: 'auditoria',
      enabled: sanitized.auditoria,
      updated_at: new Date().toISOString(),
    };
    const { error: errAudit } = await supabaseAdmin
      .from('agent_capabilities')
      .upsert(dbRowAudit, { onConflict: 'agent_id,capability_key' });

    if (errAudit) {
      throw new Error(`Falha na persistência de capacidades (Auditoria) no Supabase: ${errAudit.message}`);
    }

    return sanitized;
  }

  inMemoryCapabilities.set(agentId, sanitized);
  return sanitized;
}

export async function deleteAgentCapabilities(
  agentId: string,
  _adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin.from('agent_capabilities').delete().eq('agent_id', agentId);
    if (error) {
      console.warn('[agentService] Error deleting agent capabilities in Supabase:', error.message);
    }
  }

  inMemoryCapabilities.delete(agentId);
  return true;
}

export function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const code = String(error.code || '');
  return (
    code === '42P01' ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('table') && msg.includes('does not exist'))
  );
}

export function normalizeBrainProfile(bp?: string): 'economic' | 'balanced' | 'advanced' {
  const clean = String(bp || '').trim().toLowerCase();
  if (clean === 'economico' || clean === 'economic') return 'economic';
  if (clean === 'avancado' || clean === 'advanced') return 'advanced';
  return 'balanced';
}

export function denormalizeBrainProfile(bp?: string): 'economico' | 'equilibrado' | 'avancado' {
  const clean = String(bp || '').trim().toLowerCase();
  if (clean === 'economic' || clean === 'economico') return 'economico';
  if (clean === 'advanced' || clean === 'avancado') return 'avancado';
  return 'equilibrado';
}

export async function checkIsActiveAdmin(
  userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  if (!userId) return false;

  if (!supabaseAdmin) {
    const lower = userId.toLowerCase();
    return lower.includes('admin') || lower === 'user_owner_123';
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('role, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      if (isTableMissingError(error)) {
        const lower = userId.toLowerCase();
        return lower.includes('admin') || lower === 'user_owner_123';
      }
      return false;
    }

    const isActive = data.is_active === true;
    const role = String(data.role || '').toLowerCase().trim();
    return isActive && (role === 'admin' || role === 'administrador');
  } catch {
    return false;
  }
}

export async function checkIsActiveUser(
  userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  if (!userId) return false;

  if (!supabaseAdmin) {
    return !userId.toLowerCase().includes('inactive');
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      if (isTableMissingError(error)) {
        return !userId.toLowerCase().includes('inactive');
      }
      return false;
    }

    return data.is_active === true;
  } catch {
    return false;
  }
}

export const SLOT_AVATARS: Record<number, { url: string; id: string }> = {
  1: {
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/j-coruja-macho.webp',
    id: 'coruja-j',
  },
  2: {
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/f-coruja-macho.webp',
    id: 'coruja-f',
  },
  3: {
    url: 'https://adm.triveruscondo.com/wp-content/uploads/2026/11/d-coruja-femea.webp',
    id: 'coruja-d',
  },
};

export function resolveAvatarForSlot(
  slotNumber?: number,
  rawAvatarUrl?: string,
  rawAvatarId?: string
): { avatarUrl: string; avatarId?: string } {
  const targetSlot = Number(slotNumber);
  const slotAvatar = SLOT_AVATARS[targetSlot];

  if (!rawAvatarUrl || rawAvatarUrl.includes('2026/10') || rawAvatarUrl.startsWith('http:')) {
    if (slotAvatar) {
      return { avatarUrl: slotAvatar.url, avatarId: slotAvatar.id };
    }
  }

  return {
    avatarUrl: rawAvatarUrl || (slotAvatar ? slotAvatar.url : ''),
    avatarId: rawAvatarId || (slotAvatar ? slotAvatar.id : undefined),
  };
}

export async function getGlobalAgents(
  supabaseAdmin: SupabaseClient | null
): Promise<AgentSlotData[]> {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('custom_agents')
      .select('*')
      .order('slot_number', { ascending: true })
      .limit(5);

    if (error) {
      if (isTableMissingError(error)) {
        const fb = readFallbackAgents().slice(0, 5);
        return await Promise.all(fb.map(async (a) => {
          const av = resolveAvatarForSlot(a.slotNumber, a.avatarUrl, a.avatarId);
          return {
            ...a,
            avatarUrl: av.avatarUrl,
            avatarId: av.avatarId,
            capabilities: await getAgentCapabilities(a.id, supabaseAdmin),
          };
        }));
      }
      throw new Error(`Falha ao consultar agentes no Supabase: ${error.message}`);
    }

    return await Promise.all((data || []).map(async (row: any) => {
      const av = resolveAvatarForSlot(row.slot_number, row.avatar_url, row.avatar_id);
      return {
        id: row.id,
        slotNumber: row.slot_number,
        name: row.name,
        role: row.role,
        prompt: row.prompt || '',
        brainProfile: denormalizeBrainProfile(row.brain_profile),
        modelId: row.model_id || '',
        avatarUrl: av.avatarUrl,
        avatarId: av.avatarId,
        isOfficial: row.is_official || false,
        isConfigured: true,
        capabilities: await getAgentCapabilities(row.id, supabaseAdmin),
        updatedAt: row.updated_at,
      };
    }));
  }

  const fb = readFallbackAgents().slice(0, 5);
  return await Promise.all(fb.map(async (a) => {
    const av = resolveAvatarForSlot(a.slotNumber, a.avatarUrl, a.avatarId);
    return {
      ...a,
      avatarUrl: av.avatarUrl,
      avatarId: av.avatarId,
      capabilities: await getAgentCapabilities(a.id, supabaseAdmin),
    };
  }));
}

export async function getGlobalAgentById(
  agentId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<AgentSlotData | null> {
  if (!agentId) return null;

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('custom_agents')
      .select('*')
      .eq('id', agentId)
      .maybeSingle();

    if (error) {
      if (isTableMissingError(error)) {
        const found = readFallbackAgents().find((a) => a.id === agentId);
        if (!found) return null;
        const av = resolveAvatarForSlot(found.slotNumber, found.avatarUrl, found.avatarId);
        return {
          ...found,
          avatarUrl: av.avatarUrl,
          avatarId: av.avatarId,
          capabilities: await getAgentCapabilities(agentId, supabaseAdmin),
        };
      }
      throw new Error(`Falha ao recuperar agente no Supabase: ${error.message}`);
    }

    if (!data) return null;

    const av = resolveAvatarForSlot(data.slot_number, data.avatar_url, data.avatar_id);

    return {
      id: data.id,
      slotNumber: data.slot_number,
      name: data.name,
      role: data.role,
      prompt: data.prompt || '',
      brainProfile: denormalizeBrainProfile(data.brain_profile),
      modelId: data.model_id || '',
      avatarUrl: av.avatarUrl,
      avatarId: av.avatarId,
      isOfficial: data.is_official || false,
      isConfigured: true,
      capabilities: await getAgentCapabilities(data.id, supabaseAdmin),
      updatedAt: data.updated_at,
    };
  }

  const found = readFallbackAgents().find((a) => a.id === agentId);
  if (!found) return null;
  const av = resolveAvatarForSlot(found.slotNumber, found.avatarUrl, found.avatarId);
  return {
    ...found,
    avatarUrl: av.avatarUrl,
    avatarId: av.avatarId,
    capabilities: await getAgentCapabilities(agentId, supabaseAdmin),
  };
}

export async function saveGlobalAgent(
  agentData: Partial<AgentSlotData> & { name: string; role: string; slotNumber?: number },
  adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<AgentSlotData> {
  const isAdmin = await checkIsActiveAdmin(adminUserId, supabaseAdmin);
  if (!isAdmin) {
    throw new Error('Acesso negado: apenas administradores ativos podem criar ou editar agentes globais.');
  }

  if (!agentData.name?.trim()) throw new Error('Nome do agente é obrigatório.');
  if (!agentData.role?.trim()) throw new Error('Função do agente é obrigatória.');

  const cleanRole = agentData.role.trim().slice(0, 34);
  const nowIso = new Date().toISOString();

  // Validação de catálogo de modelo e compatibilidade com capacidades
  const rawModelId = agentData.modelId ? String(agentData.modelId).trim() : null;
  if (rawModelId) {
    const checkModel = resolveModelInfo(rawModelId);
    if (!checkModel.isValid) {
      throw new Error(`Modelo "${rawModelId}" inválido ou não suportado pelo catálogo multiprovedor.`);
    }

    if (agentData.capabilities) {
      const capCheck = checkModelCapabilityForAgent(rawModelId, agentData.capabilities);
      if (!capCheck.isCompatible) {
        throw new Error(`Incompatibilidade de Modelo: ${capCheck.reason}`);
      }
    }
  }

  const currentAgents = await getGlobalAgents(supabaseAdmin);
  const existing = currentAgents.find((a) => a.id === agentData.id);

  let targetSlot = agentData.slotNumber || existing?.slotNumber;

  if (!targetSlot) {
    const usedSlots = new Set(currentAgents.map((a) => a.slotNumber));
    for (let s = 1; s <= 5; s++) {
      if (!usedSlots.has(s)) {
        targetSlot = s;
        break;
      }
    }
  }

  if (!targetSlot || targetSlot < 1 || targetSlot > 5) {
    throw new Error('Limite máximo de 5 agentes globais da plataforma atingido.');
  }

  const agentId = agentData.id && agentData.id !== 'draft' ? agentData.id : `agent_slot_${targetSlot}_${Date.now()}`;
  const canonicalBrainProfile = normalizeBrainProfile(agentData.brainProfile);

  const fullAgent: AgentSlotData = {
    id: agentId,
    slotNumber: targetSlot,
    name: agentData.name.trim(),
    role: cleanRole,
    prompt: agentData.prompt?.trim() || '',
    brainProfile: denormalizeBrainProfile(canonicalBrainProfile),
    modelId: rawModelId || '',
    avatarUrl: agentData.avatarUrl || '',
    avatarId: agentData.avatarId,
    isOfficial: false,
    isConfigured: true,
    capabilities: getDefaultCapabilities(),
    updatedAt: nowIso,
  };

  if (supabaseAdmin) {
    const dbRow = {
      id: fullAgent.id,
      slot_number: fullAgent.slotNumber,
      name: fullAgent.name,
      role: fullAgent.role,
      prompt: fullAgent.prompt,
      brain_profile: canonicalBrainProfile,
      model_id: rawModelId || null,
      avatar_url: fullAgent.avatarUrl,
      avatar_id: fullAgent.avatarId || null,
      is_official: false,
      created_by: adminUserId,
      updated_by: adminUserId,
      updated_at: nowIso,
    };

    const { error } = await supabaseAdmin.from('custom_agents').upsert(dbRow, { onConflict: 'slot_number' });
    if (error) {
      throw new Error(`Falha na persistência no Supabase: ${error.message}`);
    }

    if (agentData.capabilities) {
      await saveAgentCapabilities(agentId, agentData.capabilities, adminUserId, supabaseAdmin);
    }

    const fullCapabilities = await getAgentCapabilities(agentId, supabaseAdmin);
    fullAgent.capabilities = fullCapabilities;

    return fullAgent;
  }

  if (agentData.capabilities) {
    await saveAgentCapabilities(agentId, agentData.capabilities, adminUserId, null);
  }
  fullAgent.capabilities = await getAgentCapabilities(agentId, null);

  const fb = readFallbackAgents();
  const existingIdx = fb.findIndex((a) => a.id === fullAgent.id || a.slotNumber === fullAgent.slotNumber);
  if (existingIdx >= 0) {
    fb[existingIdx] = fullAgent;
  } else {
    fb.push(fullAgent);
  }
  fb.sort((a, b) => a.slotNumber - b.slotNumber);
  writeFallbackAgents(fb);

  return fullAgent;
}

export async function deleteGlobalAgent(
  agentId: string,
  adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  const isAdmin = await checkIsActiveAdmin(adminUserId, supabaseAdmin);
  if (!isAdmin) {
    throw new Error('Acesso negado: apenas administradores ativos podem excluir agentes.');
  }

  if (!agentId) return false;

  await deleteAgentCapabilities(agentId, adminUserId, supabaseAdmin);

  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from('custom_agents')
      .delete()
      .eq('id', agentId);

    if (error) {
      throw new Error(`Falha ao excluir agente no Supabase: ${error.message}`);
    }
    return true;
  }

  const fb = readFallbackAgents();
  const filtered = fb.filter((a) => a.id !== agentId);
  writeFallbackAgents(filtered);

  const assignments = readFallbackAssignments().filter((as) => as.agentId !== agentId);
  writeFallbackAssignments(assignments);
  return true;
}

export async function getGlobalAssignments(
  supabaseAdmin: SupabaseClient | null
): Promise<GlobalAgentAssignment[]> {
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('agent_assignments')
      .select('*')
      .order('assigned_at', { ascending: false });

    if (error) {
      if (isTableMissingError(error)) {
        return readFallbackAssignments();
      }
      throw new Error(`Falha ao consultar atribuições no Supabase: ${error.message}`);
    }

    return (data || []).map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      target: r.target,
      categoryKey: r.category_key,
      categoryLabel: r.category_label,
      assignedBy: r.assigned_by,
      assignedAt: r.assigned_at,
    }));
  }

  return readFallbackAssignments();
}

export async function saveGlobalAssignment(
  assignment: {
    agentId: string;
    target: 'chat' | 'auditoria';
    categoryKey?: string;
    categoryLabel?: string;
  },
  adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<GlobalAgentAssignment> {
  const isAdmin = await checkIsActiveAdmin(adminUserId, supabaseAdmin);
  if (!isAdmin) {
    throw new Error('Acesso negado: apenas administradores ativos podem atribuir agentes.');
  }

  const { agentId, target } = assignment;
  if (!agentId || !target) {
    throw new Error('Dados de atribuição incompletos (agentId e target são obrigatórios).');
  }

  let finalCategoryKey: string | null = null;
  let finalCategoryLabel: string | null = assignment.categoryLabel?.trim() || null;

  if (target === 'chat') {
    finalCategoryKey = null;
    if (!finalCategoryLabel) {
      finalCategoryLabel = 'Chat Triverus';
    }
  } else if (target === 'auditoria') {
    const cleanKey = assignment.categoryKey?.trim();
    if (!cleanKey) {
      throw new Error('A categoria de documento (categoryKey) é obrigatória para atribuições de Auditoria.');
    }
    finalCategoryKey = cleanKey;
  } else {
    throw new Error(`Target de atribuição "${target}" inválido. Permitidos: 'chat' ou 'auditoria'.`);
  }

  const nowIso = new Date().toISOString();
  const assignmentRecord: GlobalAgentAssignment = {
    id: `assign_${target}_${finalCategoryKey || agentId}_${Date.now()}`,
    agentId,
    target,
    categoryKey: finalCategoryKey || undefined,
    categoryLabel: finalCategoryLabel || undefined,
    assignedBy: adminUserId,
    assignedAt: nowIso,
  };

  if (supabaseAdmin) {
    if (target === 'chat') {
      await supabaseAdmin.from('agent_assignments').delete().eq('target', 'chat').eq('agent_id', agentId);
    } else if (target === 'auditoria' && finalCategoryKey) {
      await supabaseAdmin
        .from('agent_assignments')
        .delete()
        .eq('target', 'auditoria')
        .eq('category_key', finalCategoryKey);
    }

    const { data, error } = await supabaseAdmin
      .from('agent_assignments')
      .insert({
        id: assignmentRecord.id,
        agent_id: agentId,
        target,
        category_key: finalCategoryKey,
        category_label: finalCategoryLabel,
        assigned_by: adminUserId,
        assigned_at: nowIso,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Falha ao salvar atribuição no Supabase: ${error.message}`);
    }

    return {
      id: data.id,
      agentId: data.agent_id,
      target: data.target,
      categoryKey: data.category_key,
      categoryLabel: data.category_label,
      assignedBy: data.assigned_by,
      assignedAt: data.assigned_at,
    };
  }

  let current = readFallbackAssignments();
  if (target === 'chat') {
    current = current.filter((a) => !(a.target === 'chat' && a.agentId === agentId));
  } else if (target === 'auditoria' && finalCategoryKey) {
    current = current.filter((a) => !(a.target === 'auditoria' && a.categoryKey === finalCategoryKey));
  }
  current.push(assignmentRecord);
  writeFallbackAssignments(current);

  return assignmentRecord;
}

export async function removeGlobalAssignment(
  target: 'chat' | 'auditoria',
  categoryKey: string | undefined,
  adminUserId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  const isAdmin = await checkIsActiveAdmin(adminUserId, supabaseAdmin);
  if (!isAdmin) {
    throw new Error('Acesso negado: apenas administradores ativos podem remover atribuições.');
  }

  if (supabaseAdmin) {
    let query = supabaseAdmin.from('agent_assignments').delete().eq('target', target);
    if (categoryKey) {
      query = query.eq('category_key', categoryKey);
    }
    const { error } = await query;
    if (error) {
      throw new Error(`Falha ao remover atribuição no Supabase: ${error.message}`);
    }
    return true;
  }

  let current = readFallbackAssignments();
  if (target === 'chat') {
    current = current.filter((a) => a.target !== 'chat');
  } else if (categoryKey) {
    current = current.filter((a) => !(a.target === 'auditoria' && a.categoryKey === categoryKey));
  }
  writeFallbackAssignments(current);
  return true;
}

export async function getCustomAgentsForUser(
  _userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<AgentSlotData[]> {
  return getGlobalAgents(supabaseAdmin);
}

export async function getCustomAgentById(
  agentId: string,
  userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<{ agent: AgentSlotData | null; authorized: boolean; reason?: string }> {
  if (!agentId) {
    return { agent: null, authorized: false, reason: 'ID do agente não fornecido' };
  }

  const isActive = await checkIsActiveUser(userId, supabaseAdmin);
  if (!isActive) {
    return {
      agent: null,
      authorized: false,
      reason: 'Acesso negado: conta de usuário inativa na plataforma.',
    };
  }

  const agent = await getGlobalAgentById(agentId, supabaseAdmin);
  if (!agent) {
    return { agent: null, authorized: true, reason: 'Agente não encontrado.' };
  }

  return { agent, authorized: true };
}

export async function saveCustomAgentForUser(
  agentData: Partial<AgentSlotData> & { id: string; name: string; role: string },
  userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<AgentSlotData> {
  return saveGlobalAgent(agentData, userId, supabaseAdmin);
}

export async function deleteCustomAgentForUser(
  agentId: string,
  userId: string,
  supabaseAdmin: SupabaseClient | null
): Promise<boolean> {
  return deleteGlobalAgent(agentId, userId, supabaseAdmin);
}
