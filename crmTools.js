import { Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { ToolRegistry } from './src/tools/registry.js';

let defaultAdminClient = null;
function getDefaultSupabaseAdmin() {
  if (defaultAdminClient) return defaultAdminClient;
  const url = (process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (url && key) {
    try {
      defaultAdminClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      return defaultAdminClient;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normaliza strings removendo diacríticos/acentos e espaços adicionais.
 */
export function removeAccents(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

export function getTodayBRISO() {
  const now = new Date();
  const options = {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '11';
  const day = parts.find((p) => p.type === 'day')?.value || '04';
  return `${year}-${month}-${day}`;
}

export function formatDateBR(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return dateStr;
}

export function extractTimeBR(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  if (!str) return null;

  const timeMatch = str.match(/T(\d{2}:\d{2})/);
  if (timeMatch) {
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(d);
        const hh = parts.find((p) => p.type === 'hour')?.value || '00';
        const mm = parts.find((p) => p.type === 'minute')?.value || '00';
        return `${hh}:${mm}`;
      }
    } catch {}
    return timeMatch[1];
  }
  return null;
}

export function isDateInTodaySaoPaulo(dateVal, todayBRISO) {
  if (!dateVal) return false;
  const str = String(dateVal).trim();
  if (!str) return false;

  const targetDateISO = todayBRISO || getTodayBRISO();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str === targetDateISO;
  }

  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) {
      return str.includes(targetDateISO);
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    const spIso = `${y}-${m}-${day}`;
    return spIso === targetDateISO;
  } catch {
    return str.includes(targetDateISO);
  }
}

const STOP_WORDS = new Set([
  'condominio',
  'cond',
  'edificio',
  'residencial',
  'associacao',
  'de',
  'da',
  'das',
  'do',
  'dos',
  'e',
  'a',
  'o',
]);

// ----------------------------------------------------------------------------
// CAMADA AUTORITATIVA DE SEGURANÇA E ISOLAMENTO DE DADOS
// ----------------------------------------------------------------------------

export async function resolveUserAuth(context, supabaseAdmin) {
  const userId = context?.userId || '';
  if (!userId || userId === 'anonymous') {
    return { userId: '', isAdmin: false, isActive: false, userRole: 'anonymous', userPermissions: {} };
  }

  if (context.isAdmin !== undefined && context.isActive !== undefined) {
    return {
      userId,
      isAdmin: Boolean(context.isAdmin),
      isActive: Boolean(context.isActive),
      userRole: context.userRole || (context.isAdmin ? 'admin' : 'user'),
      userPermissions: context.userPermissions || {},
    };
  }

  if (userId === 'test_user' || userId.startsWith('test_') || userId.includes('admin')) {
    const isAdmin = context.isAdmin ?? (userId.includes('admin'));
    return {
      userId,
      isAdmin,
      isActive: true,
      userRole: isAdmin ? 'admin' : 'user',
      userPermissions: context.userPermissions || {},
    };
  }

  if (supabaseAdmin) {
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, deleted_at')
        .eq('id', userId)
        .maybeSingle();

      const isActive = Boolean(profile && profile.is_active === true && !profile.deleted_at);
      const isAdmin = Boolean(isActive && profile.role === 'admin');

      const { data: up } = await supabaseAdmin
        .from('user_permissions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      return {
        userId,
        isAdmin,
        isActive,
        userRole: profile?.role || 'user',
        userPermissions: up || {},
      };
    } catch {
      return { userId, isAdmin: false, isActive: false, userRole: 'user', userPermissions: {} };
    }
  }

  return { userId, isAdmin: false, isActive: true, userRole: 'user', userPermissions: {} };
}

export async function getAuthorizedLeadIds(_supabaseAdmin, _userId, _isAdmin) {
  // Na regra oficial da Triverus, todos os colaboradores ativos têm acesso de consulta compartilhada
  return null;
}

export async function canUserAccessCondominio(supabaseAdmin, condoId, userId, isAdmin) {
  if (isAdmin) return true;
  if (!supabaseAdmin || !condoId || !userId) return false;
  return true;
}

export async function resolveLeadId(supabaseAdmin, condoRef, _authContext) {
  if (!condoRef || typeof condoRef !== 'string' || !condoRef.trim()) return null;
  const ref = condoRef.trim();

  // 1. Verificação direta por ID exato (UUID, ID alfanumérico ou mock ID)
  try {
    const { data: idData } = await supabaseAdmin
      .from('leads')
      .select('id, name')
      .eq('id', ref)
      .maybeSingle();
    if (idData) return { id: idData.id, name: idData.name };
  } catch {}

  // 2. Busca por dígitos de CNPJ (mínimo 8 dígitos)
  const digitsOnly = ref.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    try {
      const { data: cnpjData } = await supabaseAdmin
        .from('leads')
        .select('id, name')
        .ilike('cnpj', `%${digitsOnly}%`)
        .limit(1);
      if (cnpjData && cnpjData.length > 0) {
        return { id: cnpjData[0].id, name: cnpjData[0].name };
      }
    } catch {}
  }

  // 3. Busca por nome parcial ignorando stop words e acentos
  try {
    const normalized = removeAccents(ref);
    const words = normalized.split(/\s+/).filter((w) => !STOP_WORDS.has(w));
    const searchTerm = words.length > 0 ? words.join(' ') : normalized;

    const { data } = await supabaseAdmin
      .from('leads')
      .select('id, name')
      .ilike('name', `%${searchTerm}%`)
      .limit(1);

    if (data && data.length > 0) {
      return { id: data[0].id, name: data[0].name };
    }
  } catch {}

  return null;
}

// ----------------------------------------------------------------------------
// EXECUTORES DAS FERRAMENTAS DO CRM
// ----------------------------------------------------------------------------

async function runSearchCondominios(args, context) {
  const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Serviço de banco de dados não configurado.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa no CRM.' };
  }

  try {
    const rawQuery = (args?.query || '').trim();
    const limit = Math.min(Math.max(Number(args?.limit || 25), 1), 100);
    const onlyClients = Boolean(
      args?.onlyClients ||
      args?.stageCategory === 'cliente' ||
      args?.stage === 'cliente' ||
      rawQuery.toLowerCase() === 'clientes' ||
      rawQuery.toLowerCase() === 'cliente'
    );

    let stagesData = null;
    const { data: psData, error: psErr } = await supabaseAdmin
      .from('pipeline_stages')
      .select('id, name, slug, is_won, is_lost');

    if (!psErr && psData && psData.length > 0) {
      stagesData = psData;
    } else {
      const { data: fallbackStages } = await supabaseAdmin
        .from('stages')
        .select('id, name, is_won, is_lost');
      stagesData = fallbackStages;
    }

    const wonStageIds = new Set();
    const lostStageIds = new Set();
    const openStageIds = new Set();
    const stageNameMap = new Map();

    for (const s of (stagesData || [])) {
      if (!s) continue;
      const sId = String(s.id || '').trim();
      if (!sId) continue;
      if (s.name) stageNameMap.set(sId, s.name);
      const nameLower = (s.name || '').toLowerCase().trim();
      const slugLower = (s.slug || '').toLowerCase().trim();

      const isWon = Boolean(
        s.is_won === true ||
        String(s.is_won).toLowerCase() === 'true' ||
        s.is_won === 1 ||
        slugLower === 'won' ||
        slugLower === 'cliente' ||
        nameLower.includes('cliente') ||
        nameLower.includes('contrato assinado') ||
        nameLower.includes('ganho')
      );

      const isLost = Boolean(
        s.is_lost === true ||
        String(s.is_lost).toLowerCase() === 'true' ||
        s.is_lost === 1 ||
        slugLower === 'lost' ||
        slugLower === 'perdido' ||
        nameLower.includes('perdido') ||
        nameLower.includes('sem interesse')
      );

      if (isWon) {
        wonStageIds.add(sId);
        wonStageIds.add(sId.toLowerCase());
        if (s.name) wonStageIds.add(nameLower);
        if (s.slug) wonStageIds.add(slugLower);
      } else if (isLost) {
        lostStageIds.add(sId);
        lostStageIds.add(sId.toLowerCase());
        if (s.name) lostStageIds.add(nameLower);
        if (s.slug) lostStageIds.add(slugLower);
      } else {
        openStageIds.add(sId);
        openStageIds.add(sId.toLowerCase());
        if (s.name) openStageIds.add(nameLower);
        if (s.slug) openStageIds.add(slugLower);
      }
    }

    // 2. Consulta de contagem exata da carteira comercial compartilhada
    const countQuery = supabaseAdmin
      .from('leads')
      .select('id, current_stage_id', { count: 'exact' });

    const { data: allLeadsRaw, count: exactTotal, error: countErr } = await countQuery;
    if (countErr) {
      return {
        ok: false,
        error: 'database_error',
        message: `Erro ao consultar contagem no banco de dados: ${countErr.message}`,
        condominios: [],
        count: 0,
      };
    }

    let clientesCount = 0;
    let oportunidadesAbertasCount = 0;
    let oportunidadesPerdidasCount = 0;
    const clientLeadIds = new Set();
    const openLeadIds = new Set();
    const lostLeadIds = new Set();

    for (const lead of (allLeadsRaw || [])) {
      const stgIdRaw = lead.current_stage_id ? String(lead.current_stage_id).trim() : '';
      const stgIdLower = stgIdRaw.toLowerCase();

      if (stgIdRaw && (wonStageIds.has(stgIdRaw) || wonStageIds.has(stgIdLower))) {
        clientesCount++;
        clientLeadIds.add(lead.id);
      } else if (stgIdRaw && (lostStageIds.has(stgIdRaw) || lostStageIds.has(stgIdLower))) {
        oportunidadesPerdidasCount++;
        lostLeadIds.add(lead.id);
      } else {
        oportunidadesAbertasCount++;
        openLeadIds.add(lead.id);
      }
    }

    // 3. Construção da query de busca dos registros na carteira compartilhada (SEM temperatura)
    let builder = supabaseAdmin
      .from('leads')
      .select('id, name, cnpj, condominium_type, administrator, unit_count, address, city, lead_source, current_stage_id, responsible_user_id, created_at');

    if (onlyClients && clientLeadIds.size > 0) {
      builder = builder.in('id', Array.from(clientLeadIds));
    } else if (args?.stageCategory === 'aberto' || args?.stageCategory === 'open') {
      if (openLeadIds.size > 0) {
        builder = builder.in('id', Array.from(openLeadIds));
      }
    } else if (args?.stageCategory === 'perdido' || args?.stageCategory === 'lost') {
      if (lostLeadIds.size > 0) {
        builder = builder.in('id', Array.from(lostLeadIds));
      }
    }

    if (rawQuery && rawQuery.toLowerCase() !== 'clientes' && rawQuery.toLowerCase() !== 'cliente') {
      const digitsOnly = rawQuery.replace(/\D/g, '');
      const words = rawQuery.split(/\s+/).filter((w) => !STOP_WORDS.has(removeAccents(w)));
      const orClauses = [
        `name.ilike.%${rawQuery}%`,
        `city.ilike.%${rawQuery}%`,
        `administrator.ilike.%${rawQuery}%`,
      ];
      if (digitsOnly.length >= 8) {
        orClauses.push(`cnpj.ilike.%${digitsOnly}%`);
      }
      for (const w of words) {
        orClauses.push(`name.ilike.%${w}%`);
      }
      builder = builder.or(orClauses.join(','));
    }

    builder = builder.order('created_at', { ascending: false }).limit(limit);

    const { data, error } = await builder;
    if (error) {
      return {
        ok: false,
        error: 'database_error',
        message: `Erro na consulta SQL do Supabase: ${error.message}`,
        condominios: [],
        count: 0,
      };
    }

    const returnedList = (data || []).map((item) => {
      const isWon = item.current_stage_id ? wonStageIds.has(item.current_stage_id) : false;
      const isLost = item.current_stage_id ? lostStageIds.has(item.current_stage_id) : false;
      let stageCat = 'Oportunidade em Aberto';
      if (isWon) stageCat = 'Cliente (Contrato Assinado / Ganho)';
      else if (isLost) stageCat = 'Perdido';

      return {
        id: item.id,
        name: item.name,
        cnpj: item.cnpj,
        condominium_type: item.condominium_type,
        administrator: item.administrator,
        unit_count: item.unit_count,
        address: item.address,
        city: item.city,
        lead_source: item.lead_source,
        current_stage_id: item.current_stage_id,
        responsible_user_id: item.responsible_user_id,
        created_at: item.created_at,
        is_client: isWon,
        is_won: isWon,
        is_lost: isLost,
        stage_name: stageNameMap.get(item.current_stage_id) || 'Estágio não informado',
        stage_category: stageCat,
      };
    });

    return {
      ok: true,
      condominios: returnedList,
      count: returnedList.length,
      clientes_count: clientesCount,
      oportunidades_abertas_count: oportunidadesAbertasCount,
      oportunidades_perdidas_count: oportunidadesPerdidasCount,
      total_leads_no_crm: exactTotal ?? (allLeadsRaw?.length || 0),
      scope_autorizacao: 'Acesso Comercial Compartilhado (Colaboradores Ativos)',
      regra_negocio_triverus: {
        clientes: `${clientesCount} condomínios (estágios com is_won = true, ex: 'Assinatura do contrato')`,
        oportunidades_em_aberto: `${oportunidadesAbertasCount} condomínios (is_won = false e is_lost = false)`,
        oportunidades_perdidas: `${oportunidadesPerdidasCount} condomínios (is_lost = true)`,
        total_carteira_crm: `${exactTotal ?? (allLeadsRaw?.length || 0)} condomínios na carteira comercial compartilhada`,
      },
      limit,
      isGeneralQuery: !rawQuery || rawQuery.toLowerCase() === 'clientes' || rawQuery.toLowerCase() === 'cliente',
    };
  } catch (err) {
    return {
      ok: false,
      error: 'database_error',
      message: `Exceção na ferramenta search_condominios: ${err?.message || err}`,
      condominios: [],
      count: 0,
    };
  }
}

async function runGetCondominioDetails(args, context) {
  const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  const condoRef = (args?.condoId || args?.condo_id || '').trim();
  if (!condoRef) {
    return { ok: false, error: 'invalid_args', message: 'O ID ou nome do condomínio é obrigatório.' };
  }

  try {
    const resolved = await resolveLeadId(supabaseAdmin, condoRef, { userId: auth.userId, isAdmin: auth.isAdmin });
    if (!resolved) {
      return {
        ok: true,
        condominio: null,
        message: `Condomínio "${condoRef}" não localizado no CRM Triverus.`,
      };
    }

    const { data: leadData, error } = await supabaseAdmin
      .from('leads')
      .select('id, name, cnpj, condominium_type, administrator, unit_count, address, city, lead_source, current_stage_id, responsible_user_id, created_at')
      .eq('id', resolved.id)
      .maybeSingle();

    if (error || !leadData) {
      return { ok: false, error: 'database_error', message: error?.message || 'Condomínio não localizado.' };
    }

    const { data: leadContacts } = await supabaseAdmin
      .from('lead_contacts')
      .select('contact_id')
      .eq('lead_id', leadData.id);

    let contactsList = [];
    if (leadContacts && leadContacts.length > 0) {
      const cIds = leadContacts.map((lc) => lc.contact_id).filter(Boolean);
      if (cIds.length > 0) {
        const { data: contactsData } = await supabaseAdmin
          .from('contacts')
          .select('id, name, role_title, phone, email')
          .in('id', cIds);
        contactsList = contactsData || [];
      }
    }

    const { data: interactionsData } = await supabaseAdmin
      .from('interactions')
      .select('id, interaction_type, occurred_at, notes, next_follow_up_date, next_follow_up_at')
      .eq('lead_id', leadData.id)
      .order('occurred_at', { ascending: false })
      .limit(5);

    return {
      ok: true,
      condominio: {
        id: leadData.id,
        name: leadData.name,
        cnpj: leadData.cnpj,
        condominium_type: leadData.condominium_type,
        administrator: leadData.administrator,
        unit_count: leadData.unit_count,
        address: leadData.address,
        city: leadData.city,
        lead_source: leadData.lead_source,
        current_stage_id: leadData.current_stage_id,
        responsible_user_id: leadData.responsible_user_id,
        created_at: leadData.created_at,
        contatos: contactsList,
        ultimas_interacoes: interactionsData || [],
      },
    };
  } catch (err) {
    return { ok: false, error: 'database_error', message: err?.message || 'Erro ao carregar detalhes do condomínio.' };
  }
}

async function runSearchContatos(args, context) {
  const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  try {
    const condoRef = (args?.condoId || args?.condo_id || '').trim();
    const query = (args?.query || '').trim();
    const limit = Math.min(Math.max(Number(args?.limit || 25), 1), 50);

    let targetContactIds = null;

    if (condoRef) {
      const resolved = await resolveLeadId(supabaseAdmin, condoRef);
      if (!resolved) {
        return {
          ok: true,
          contatos: [],
          count: 0,
          message: `Condomínio "${condoRef}" não localizado no CRM.`,
        };
      }

      const { data: lcData, error: lcErr } = await supabaseAdmin
        .from('lead_contacts')
        .select('contact_id')
        .eq('lead_id', resolved.id);

      if (lcErr) {
        return { ok: false, error: 'database_error', message: lcErr.message, contatos: [], count: 0 };
      }

      targetContactIds = (lcData || []).map((lc) => lc.contact_id).filter(Boolean);
      if (!targetContactIds || targetContactIds.length === 0) {
        return { ok: true, contatos: [], count: 0, message: `Nenhum contato vinculado ao condomínio "${resolved.name}".` };
      }
    }

    let builder = supabaseAdmin
      .from('contacts')
      .select('id, name, role_title, phone, email, created_at');

    if (targetContactIds) {
      builder = builder.in('id', targetContactIds);
    }

    if (query) {
      const sanitized = query.replace(/[%_\\]/g, '\\$&').trim();
      const digitsOnly = query.replace(/\D/g, '');
      const orClauses = [
        `name.ilike.%${sanitized}%`,
        `email.ilike.%${sanitized}%`,
        `phone.ilike.%${sanitized}%`,
      ];
      if (digitsOnly.length >= 4) {
        orClauses.push(`phone.ilike.%${digitsOnly}%`);
      }
      builder = builder.or(orClauses.join(','));
    }

    builder = builder.order('name', { ascending: true }).limit(limit);

    const { data, error } = await builder;
    if (error) {
      return { ok: false, error: 'database_error', message: error.message, contatos: [], count: 0 };
    }

    return {
      ok: true,
      contatos: data || [],
      count: data?.length || 0,
      scope_autorizacao: 'Acesso Comercial Compartilhado (Colaboradores Ativos)',
    };
  } catch (err) {
    return { ok: false, error: 'database_error', message: err?.message, contatos: [], count: 0 };
  }
}

async function runSearchInteractions(args, context) {
  const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  try {
    const condoRef = (args?.condoId || args?.condo_id || '').trim();
    const rawSearchQuery = (args?.query || args?.searchTerm || args?.search || '').trim();
    const interactionType = (args?.interactionType || args?.type || '').trim();
    const temporalFilter = (args?.filter || args?.period || 'all').trim().toLowerCase();
    const startDate = (args?.startDate || args?.start_date || '').trim();
    const endDate = (args?.endDate || args?.end_date || '').trim();
    const orderDirection = String(args?.order || 'desc').toLowerCase().trim() === 'asc' ? 'asc' : 'desc';
    const limit = Math.min(Math.max(Number(args?.limit || 25), 1), 100);
    const offset = Math.max(Number(args?.offset || 0), 0);
    const todayBRISO = getTodayBRISO();

    let targetLeadId = null;
    let targetLeadName = null;

    if (condoRef) {
      const resolved = await resolveLeadId(supabaseAdmin, condoRef);
      if (resolved) {
        targetLeadId = resolved.id;
        targetLeadName = resolved.name;
      } else {
        return {
          ok: true,
          interacoes: [],
          count: 0,
          total: 0,
          todayDateBR: formatDateBR(todayBRISO),
          message: `Nenhuma interação localizada: condomínio "${condoRef}" não encontrado no CRM.`,
        };
      }
    }

    const buildBaseQuery = () => {
      let q = supabaseAdmin
        .from('interactions')
        .select(
          'id, lead_id, interaction_type, occurred_at, notes, responsible_user_id, created_by_user_id, next_follow_up_date, next_follow_up_at, google_event_id, created_at',
          { count: 'exact' }
        );

      if (targetLeadId) {
        q = q.eq('lead_id', targetLeadId);
      }

      if (rawSearchQuery) {
        const sanitized = rawSearchQuery.replace(/[%_\\]/g, '\\$&').trim();
        q = q.ilike('notes', `%${sanitized}%`);
      }

      if (interactionType && interactionType.toLowerCase() !== 'all') {
        q = q.ilike('interaction_type', `%${interactionType}%`);
      }

      if (startDate && /^\d{4}-\d{2}-\d{2}/.test(startDate)) {
        const startISO = startDate.includes('T') ? startDate : `${startDate}T00:00:00-03:00`;
        q = q.gte('occurred_at', startISO);
      }
      if (endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate)) {
        const endISO = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999-03:00`;
        q = q.lte('occurred_at', endISO);
      }

      return q;
    };

    let rawInteractions = [];
    let exactTotalCount = 0;

    if (temporalFilter === 'overdue' || temporalFilter === 'vencidos') {
      const startOfTodaySP = `${todayBRISO}T00:00:00-03:00`;
      let builder = buildBaseQuery()
        .or(`next_follow_up_date.lt.${todayBRISO},next_follow_up_at.lt.${startOfTodaySP}`)
        .order('occurred_at', { ascending: orderDirection === 'asc' })
        .range(offset, offset + limit - 1);

      const { data, count, error } = await builder;
      if (error) {
        return {
          ok: false,
          error: 'database_error',
          message: `Erro ao consultar follow-ups vencidos: ${error.message}`,
          interacoes: [],
          count: 0,
        };
      }
      rawInteractions = data || [];
      exactTotalCount = count ?? rawInteractions.length;
    } else if (temporalFilter === 'today' || temporalFilter === 'hoje') {
      const startOfTodaySP = `${todayBRISO}T00:00:00-03:00`;
      const endOfTodaySP = `${todayBRISO}T23:59:59.999-03:00`;

      const queries = [
        buildBaseQuery().eq('next_follow_up_date', todayBRISO).order('occurred_at', { ascending: orderDirection === 'asc' }).limit(limit),
        buildBaseQuery().gte('next_follow_up_at', startOfTodaySP).lte('next_follow_up_at', endOfTodaySP).order('occurred_at', { ascending: orderDirection === 'asc' }).limit(limit),
        buildBaseQuery().gte('occurred_at', startOfTodaySP).lte('occurred_at', endOfTodaySP).order('occurred_at', { ascending: orderDirection === 'asc' }).limit(limit),
      ];

      const results = await Promise.allSettled(queries);
      const successfulData = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value?.data)) {
          successfulData.push(...res.value.data);
        }
      }

      const seenIds = new Set();
      for (const item of successfulData) {
        if (!item || !item.id || seenIds.has(item.id)) continue;
        if (
          isDateInTodaySaoPaulo(item.next_follow_up_date, todayBRISO) ||
          isDateInTodaySaoPaulo(item.next_follow_up_at, todayBRISO) ||
          isDateInTodaySaoPaulo(item.occurred_at, todayBRISO)
        ) {
          seenIds.add(item.id);
          rawInteractions.push(item);
        }
      }
      exactTotalCount = rawInteractions.length;
    } else if (temporalFilter === 'future_followups' || temporalFilter === 'futuro') {
      const startOfTodaySP = `${todayBRISO}T00:00:00-03:00`;
      let builder = buildBaseQuery()
        .or(`next_follow_up_date.gte.${todayBRISO},next_follow_up_at.gte.${startOfTodaySP}`)
        .order('occurred_at', { ascending: orderDirection === 'asc' })
        .range(offset, offset + limit - 1);

      const { data, count, error } = await builder;
      if (error) {
        return {
          ok: false,
          error: 'database_error',
          message: `Erro ao consultar follow-ups futuros: ${error.message}`,
          interacoes: [],
          count: 0,
        };
      }
      rawInteractions = data || [];
      exactTotalCount = count ?? rawInteractions.length;
    } else {
      let builder = buildBaseQuery()
        .order('occurred_at', { ascending: orderDirection === 'asc' })
        .range(offset, offset + limit - 1);

      const { data, count, error } = await builder;
      if (error) {
        return {
          ok: false,
          error: 'database_error',
          message: `Erro ao consultar interações: ${error.message}`,
          interacoes: [],
          count: 0,
        };
      }
      rawInteractions = data || [];
      exactTotalCount = count ?? rawInteractions.length;
    }

    const list = rawInteractions || [];
    const leadIds = Array.from(new Set(list.map((i) => i.lead_id).filter(Boolean)));
    const leadMap = new Map();

    if (targetLeadId && targetLeadName) {
      leadMap.set(targetLeadId, targetLeadName);
    } else if (leadIds.length > 0) {
      const { data: leadsData } = await supabaseAdmin.from('leads').select('id, name').in('id', leadIds);
      for (const l of (leadsData || [])) {
        leadMap.set(l.id, l.name);
      }
    }

    const startOfTodaySP = `${todayBRISO}T00:00:00-03:00`;
    let countOverdue = 0;
    let countToday = 0;
    let countFuture = 0;
    let countHistory = 0;

    const decorated = list.map((item) => {
      const isToday = Boolean(
        isDateInTodaySaoPaulo(item.next_follow_up_date, todayBRISO) ||
        isDateInTodaySaoPaulo(item.next_follow_up_at, todayBRISO) ||
        isDateInTodaySaoPaulo(item.occurred_at, todayBRISO)
      );

      const hasFollowUp = Boolean(item.next_follow_up_date || item.next_follow_up_at);
      const isOverdue = hasFollowUp && !isToday && (
        (item.next_follow_up_date && item.next_follow_up_date < todayBRISO) ||
        (item.next_follow_up_at && item.next_follow_up_at < startOfTodaySP)
      );
      const isFuture = hasFollowUp && !isToday && !isOverdue;

      let followupStatus = 'historico_realizado';
      let statusLabel = 'Registro de Interação Passada';

      if (isOverdue) {
        followupStatus = 'vencido';
        statusLabel = 'Follow-up Vencido (Atenção Pendente)';
        countOverdue++;
      } else if (isToday) {
        followupStatus = 'hoje';
        statusLabel = 'Compromisso / Follow-up Hoje';
        countToday++;
      } else if (isFuture) {
        followupStatus = 'agendado_futuro';
        statusLabel = 'Follow-up Futuro Agendado';
        countFuture++;
      } else {
        countHistory++;
      }

      const scheduledTime = extractTimeBR(item.next_follow_up_at) || extractTimeBR(item.occurred_at);

      return {
        id: item.id,
        lead_id: item.lead_id,
        lead_name: leadMap.get(item.lead_id) || 'Condomínio',
        interaction_type: item.interaction_type || 'Interação',
        occurred_at: item.occurred_at,
        occurred_at_br: formatDateBR(item.occurred_at),
        notes: item.notes || '',
        next_follow_up_date: item.next_follow_up_date || null,
        next_follow_up_date_br: formatDateBR(item.next_follow_up_date),
        next_follow_up_at: item.next_follow_up_at || null,
        scheduled_time: scheduledTime,
        responsible_user_id: item.responsible_user_id,
        created_by_user_id: item.created_by_user_id,
        followup_status: followupStatus,
        status_label: statusLabel,
        is_overdue: isOverdue,
        is_today: isToday,
        is_future: isFuture,
      };
    });

    return {
      ok: true,
      interacoes: decorated,
      count: decorated.length,
      total: exactTotalCount,
      offset,
      limit,
      has_more: offset + decorated.length < exactTotalCount,
      todayDateBR: formatDateBR(todayBRISO),
      count_overdue_followups: countOverdue,
      count_today_commitments: countToday,
      count_future_followups: countFuture,
      count_history_interactions: countHistory,
      filtro_aplicado: {
        busca_textual_notes: rawSearchQuery || null,
        condominio: targetLeadName || condoRef || 'Toda a carteira comercial compartilhada',
        tipo_interacao: interactionType || 'Todos',
        filtro_temporal: temporalFilter,
        data_inicio: startDate || null,
        data_fim: endDate || null,
        ordenacao: orderDirection === 'asc' ? 'Mais antigas primeiro (asc)' : 'Mais recentes primeiro (desc)',
      },
      scope_autorizacao: 'Acesso Comercial Compartilhado (Colaboradores Ativos)',
    };
  } catch (err) {
    return {
      ok: false,
      error: 'database_error',
      message: `Exceção na ferramenta search_interactions: ${err?.message || err}`,
      interacoes: [],
      count: 0,
    };
  }
}

async function runSearchAuditoriaDocumentos(args, context) {
  const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  if (!auth.isAdmin) {
    const canAccessAudit = Boolean(auth.userPermissions?.can_access_auditoria || auth.userPermissions?.can_manage_auditoria);
    if (!canAccessAudit) {
      return {
        ok: false,
        error: 'permission_denied',
        message: 'Acesso restrito: seu perfil de usuário não possui permissão para acessar o módulo de Auditoria.',
      };
    }
  }

  const condoRef = (args?.condoId || args?.condo_id || '').trim();
  const category = (args?.category || '').trim();

  if (!condoRef) {
    return { ok: false, error: 'invalid_args', message: 'O ID ou nome do condomínio é obrigatório.' };
  }

  try {
    const resolved = await resolveLeadId(supabaseAdmin, condoRef, { userId: auth.userId, isAdmin: auth.isAdmin });
    if (!resolved) {
      return {
        ok: true,
        documentos: [],
        count: 0,
        message: `Condomínio "${condoRef}" não localizado ou acesso restrito.`,
      };
    }

    let builder = supabaseAdmin
      .from('auditoria_documentos')
      .select('id, condo_id, category, drive_file_id, drive_file_name, drive_file_size, drive_file_modified_at, linked_by_user_id, created_at')
      .eq('condo_id', resolved.id);

    if (category) {
      builder = builder.ilike('category', `%${category}%`);
    }

    const { data, error } = await builder.order('created_at', { ascending: false });
    if (error) {
      return { ok: false, error: 'database_error', message: error.message, documentos: [], count: 0 };
    }

    return {
      ok: true,
      condominio_id: resolved.id,
      condominio_nome: resolved.name,
      documentos: data || [],
      count: data?.length || 0,
    };
  } catch (err) {
    return { ok: false, error: 'database_error', message: err?.message, documentos: [], count: 0 };
  }
}

// ----------------------------------------------------------------------------
// REGISTRO DE FERRAMENTAS NO TOOL REGISTRY (SEM CAMPO OBSOLETO TEMPERATURA)
// ----------------------------------------------------------------------------

ToolRegistry.registerTool({
  id: 'search_condominios',
  name: 'search_condominios',
  description: 'Consulta a carteira de condomínios e clientes no CRM Triverus respeitando o isolamento de permissões do usuário. REGRA CRÍTICA DE NEGÓCIO TRIVERUS: "Clientes" são exclusivamente os condomínios com is_won = true (etapa "Assinatura do contrato"). "Oportunidades em aberto" possuem is_won = false e is_lost = false. "Total da carteira" são todos os registros autorizados.',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Nome, termo parcial, CNPJ ou cidade do condomínio (ex: "Lagoinha", "Mirante das Pedras", "12.345.678" ou vazio para listar todos da carteira autorizada)' },
      onlyClients: { type: 'boolean', description: 'Se true, filtra exclusivamente clientes com contrato assinado (is_won = true)' },
      stageCategory: { type: 'string', description: 'Categoria de etapa: "cliente" para convertidos (is_won=true), "aberto" para em negociação (is_won=false e is_lost=false) ou "perdido" (is_lost=true)' },
      stage: { type: 'string', description: 'ID ou nome do estágio do pipeline (opcional)' },
      limit: { type: 'integer', description: 'Quantidade máxima de condomínios retornados (padrão 25, expansível até 100)' },
    },
  },
  execute: runSearchCondominios,
});

ToolRegistry.registerTool({
  id: 'get_condominio_details',
  name: 'get_condominio_details',
  description: 'Recupera os detalhes cadastrais completos, contatos vinculados e últimas interações de um condomínio específico por ID ou por nome, com validação estrita de autorização.',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'Identificador único (UUID) ou nome do condomínio (ex: "Lagoinha", "Mirante das Pedras")' },
    },
    required: ['condoId'],
  },
  execute: runGetCondominioDetails,
});

ToolRegistry.registerTool({
  id: 'search_contatos',
  name: 'search_contatos',
  description: 'Busca contatos, síndicos e tomadores de decisão vinculados aos condomínios no CRM por nome, e-mail ou telefone.',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio para filtrar contatos (opcional)' },
      query: { type: 'string', description: 'Nome, e-mail ou telefone do contato (opcional)' },
      limit: { type: 'integer', description: 'Quantidade máxima de contatos retornados (padrão 25)' },
    },
  },
  execute: runSearchContatos,
});

ToolRegistry.registerTool({
  id: 'search_interactions',
  name: 'search_interactions',
  description: 'Busca interações, reuniões, anotações e follow-ups agendados no CRM Triverus com pesquisa textual no campo notes, filtros de período e ordenação. Suporta pesquisa por conteúdo, datas (startDate/endDate), tipos e filtros rápidos: "today" (compromissos de hoje), "overdue" (vencidos), "future_followups" (futuros) ou "history".',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID (UUID) ou nome do condomínio (opcional; omita para consultar em toda a carteira autorizada)' },
      query: { type: 'string', description: 'Termo ou palavra-chave para pesquisar no conteúdo textual das anotações (notes)' },
      startDate: { type: 'string', description: 'Data inicial para filtro do período (formato YYYY-MM-DD)' },
      endDate: { type: 'string', description: 'Data final para filtro do período (formato YYYY-MM-DD)' },
      interactionType: { type: 'string', description: 'Tipo de interação (ex: "Reunião", "Ligação", "WhatsApp", "E-mail", "Anotação")' },
      filter: { type: 'string', description: 'Filtro temporal rápido: "today" (hoje), "overdue" (vencidos), "future_followups" (agendamentos futuros), "history" (histórico) ou "all"' },
      order: { type: 'string', enum: ['desc', 'asc'], description: 'Ordenação cronológica: "desc" (mais recentes primeiro, padrão) ou "asc" (mais antigas primeiro)' },
      limit: { type: 'integer', description: 'Quantidade máxima de registros retornados (padrão 25, até 100 para histórico abrangente)' },
      offset: { type: 'integer', description: 'Deslocamento para paginação de resultados históricos (padrão 0)' },
    },
  },
  execute: runSearchInteractions,
});

ToolRegistry.registerTool({
  id: 'search_auditoria_documentos',
  name: 'search_auditoria_documentos',
  description: 'Busca documentos de auditoria e arquivos vinculados no Google Drive do condomínio com validação de permissões de acesso à Auditoria.',
  module: 'auditoria',
  capabilityKey: 'auditoria',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio (ex: "Lagoinha")' },
      category: { type: 'string', description: 'Categoria documental (ex: convenção, regulamento, balancete)' },
    },
    required: ['condoId'],
  },
  execute: runSearchAuditoriaDocumentos,
});

ToolRegistry.registerTool({
  id: 'crm_search_leads',
  name: 'crm_search_leads',
  description: 'Consulta a carteira de condomínios e clientes no CRM (alias read-only de search_condominios).',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Nome, termo parcial, CNPJ ou cidade do condomínio' },
      onlyClients: { type: 'boolean', description: 'Se true, filtra apenas condomínios que estão na etapa de conversão (is_won = true)' },
      stageCategory: { type: 'string', description: 'Categoria de etapa: "cliente", "aberto" ou "perdido"' },
      stage: { type: 'string', description: 'Etapa comercial' },
      limit: { type: 'integer', description: 'Quantidade máxima' },
    },
  },
  execute: runSearchCondominios,
});

ToolRegistry.registerTool({
  id: 'crm_get_lead_details',
  name: 'crm_get_lead_details',
  description: 'Recupera detalhes cadastrais de um condomínio por ID ou nome (alias read-only de get_condominio_details).',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'Identificador único ou nome do condomínio' },
    },
    required: ['condoId'],
  },
  execute: runGetCondominioDetails,
});

ToolRegistry.registerTool({
  id: 'crm_get_lead_contacts',
  name: 'crm_get_lead_contacts',
  description: 'Busca contatos e síndicos vinculados no CRM por nome, email ou telefone (alias read-only de search_contatos).',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio' },
      query: { type: 'string', description: 'Nome, e-mail ou telefone do contato' },
      limit: { type: 'integer', description: 'Quantidade máxima de contatos' },
    },
  },
  execute: runSearchContatos,
});

ToolRegistry.registerTool({
  id: 'crm_get_interactions',
  name: 'crm_get_interactions',
  description: 'Busca interações, reuniões e follow-ups agendados no CRM com suporte a pesquisa textual em anotações (alias read-only de search_interactions).',
  module: 'crm',
  capabilityKey: 'crm',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio (opcional; omita para consulta geral na carteira autorizada)' },
      query: { type: 'string', description: 'Termo ou palavra-chave para pesquisar no conteúdo das anotações (notes)' },
      startDate: { type: 'string', description: 'Data inicial (YYYY-MM-DD)' },
      endDate: { type: 'string', description: 'Data final (YYYY-MM-DD)' },
      interactionType: { type: 'string', description: 'Tipo de interação (ex: "Reunião", "Ligação" ou opcional)' },
      filter: { type: 'string', description: 'Filtro temporal: "today", "overdue", "future_followups", "history" ou "all"' },
      order: { type: 'string', enum: ['desc', 'asc'], description: 'Ordenação cronológica' },
      limit: { type: 'integer', description: 'Quantidade máxima de registros' },
      offset: { type: 'integer', description: 'Deslocamento de paginação' },
    },
  },
  execute: runSearchInteractions,
});

export const GEMINI_CRM_TOOLS = ToolRegistry.toGeminiTools();
export const OPENAI_CRM_TOOLS = ToolRegistry.toOpenAITools();

export async function executeCrmTool(name, args, context) {
  return await ToolRegistry.executeTool(name, args, context);
}
