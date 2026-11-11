import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import {
  CONDO_MODEL_REQUESTED,
  CONDO_TOOLS,
  buildSystemPrompt,
  executeToolCall,
  processCondoLocalFallback,
} from './condoBackend.js';
import {
  getValidGoogleAccessToken,
  getValidGoogleTokenDetails,
  fetchUpcomingGoogleCalendarEvents,
  createGoogleCalendarEventForInteraction,
  updateGoogleCalendarEventForInteraction,
  syncGoogleCalendarInteraction,
  deleteGoogleCalendarEventForInteraction,
  GoogleCalendarAuthError,
  EXPIRATION_BUFFER_MS,
} from './googleCalendarAuth.ts';
import {
  getGoogleDriveConfigStatus,
  diagnoseDriveConnection,
  listImmediateSubfolders,
  verifyRootFolder,
  findCondoSubfolder,
  listPdfFilesInFolder,
  getDriveFileStream,
  normalizeNameForMatching,
  listAvailableFoldersForCondo,
  getFolderContentsAndBreadcrumb,
  verifyFolderAccessibleInDrive,
  searchDriveFolders,
} from './googleDriveService.ts';
import {
  analyzeAuditoriaDocument,
  executeMemoryExtraction,
  executeBatchMemoryExtraction,
} from './auditoriaAiService.ts';
import {
  prepareMemoryCreate,
  prepareMemoryUpdate,
  filterBatchEligibleMemories,
  groupMemoriesByDriveFile,
  executeBatchGroupLoop,
} from './auditoriaMemoryService.ts';
import { registerAuditoriaMemoryRoutes } from './auditoriaMemoryRoutes.ts';
import './auditoriaTools.ts';
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
  getCustomAgentsForUser,
  getCustomAgentById,
  saveCustomAgentForUser,
  deleteCustomAgentForUser,
  getAgentCapabilities,
} from './agentService.ts';
import {
  executeAgentChat,
  resolveModelInfo,
  resolveBrainParameters,
} from './agentExecutionEngine.ts';
import {
  getModelCatalog,
  refreshModelCatalog,
} from './modelCatalogService.ts';

export {
  getValidGoogleAccessToken,
  getValidGoogleTokenDetails,
  fetchUpcomingGoogleCalendarEvents,
  createGoogleCalendarEventForInteraction,
  updateGoogleCalendarEventForInteraction,
  syncGoogleCalendarInteraction,
  deleteGoogleCalendarEventForInteraction,
  GoogleCalendarAuthError,
  EXPIRATION_BUFFER_MS,
  getGoogleDriveConfigStatus,
  diagnoseDriveConnection,
  listImmediateSubfolders,
  verifyRootFolder,
  findCondoSubfolder,
  listPdfFilesInFolder,
  getDriveFileStream,
  normalizeNameForMatching,
  listAvailableFoldersForCondo,
  getFolderContentsAndBreadcrumb,
  verifyFolderAccessibleInDrive,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT_EXCEPTION]', error instanceof Error ? error.message : error);
});

const loadedEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');

const app = express();
app.use(express.json({ limit: '10mb' }));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || loadedEnv.VITE_SUPABASE_PUBLISHABLE_KEY || '';

function getScopedSupabaseClient(token?: string): SupabaseClient {
  const url = (process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL || SUPABASE_URL).trim();
  const anonKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || loadedEnv.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY).trim();
  return createClient(url, anonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getAdminSupabaseClient(): SupabaseClient | null {
  const rawUrl = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(rawUrl && rawUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());

  let urlError: string | null = null;

  if (hasUrl) {
    try {
      new URL(rawUrl!.trim());
    } catch (err: any) {
      urlError = err?.message || 'Invalid URL format';
    }
  }

  if (!hasKey || !hasUrl || urlError) {
    console.warn('[SUPABASE_ADMIN_DIAG] Abortando criação do cliente admin Supabase devido a parâmetros ausentes ou URL inválida.');
    return null;
  }

  return createClient(rawUrl!.trim(), serviceKey!.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY || loadedEnv.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return null;
  }
  return new OpenAI({
    apiKey: apiKey.trim(),
    timeout: 25000,
  });
}

/**
 * Retorna a URL canônica do frontend para redirecionamentos de autenticação (convite, recuperação).
 * Produção: https://triveruscondo.com (ou definida via APP_URL / SITE_URL válida)
 * Não aceita domínios temporários de preview (run.app, ais-dev, etc.)
 * Desenvolvimento local: http://localhost:3000
 */
function getAppBaseUrl(): string {
  const envUrl = (
    process.env.APP_URL ||
    loadedEnv.APP_URL ||
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    ''
  ).trim();

  // Ignorar URLs temporárias de preview injetadas pela infraestrutura do Cloud Run / AI Studio
  const isPreviewUrl =
    envUrl.includes('run.app') ||
    envUrl.includes('ais-dev') ||
    envUrl.includes('ais-pre') ||
    envUrl.includes('aistudio');

  if (envUrl && !isPreviewUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  // Em desenvolvimento local puro (fora de containers Cloud Run)
  if (process.env.NODE_ENV === 'development' && !process.env.K_SERVICE && !isPreviewUrl) {
    return `http://localhost:${PORT || 3000}`;
  }

  // Fallback canônico final de produção
  return 'https://triveruscondo.com';
}

/**
 * Garante que action_links gerados pelo Supabase Auth Admin contenham a URL base de redirecionamento correta,
 * prevenindo que links abram em localhost:3000 ou em domínios temporários de preview (run.app / ais-dev).
 */
function sanitizeActionLink(actionLink: string | null | undefined, targetBaseUrl: string): string | null {
  if (!actionLink) return null;
  try {
    const parsed = new URL(actionLink);
    const currentRedirect = parsed.searchParams.get('redirect_to');
    const isBadRedirect =
      !currentRedirect ||
      currentRedirect.includes('localhost') ||
      currentRedirect.includes('run.app') ||
      currentRedirect.includes('ais-dev') ||
      currentRedirect.includes('ais-pre') ||
      currentRedirect !== targetBaseUrl;

    if (isBadRedirect) {
      parsed.searchParams.set('redirect_to', targetBaseUrl);
    }

    // Garantir formato percent-encoded padronizado: redirect_to=https%3A%2F%2Ftriveruscondo.com
    const encodedTarget = encodeURIComponent(targetBaseUrl);
    let finalUrl = parsed.toString();
    if (finalUrl.includes(`redirect_to=${targetBaseUrl}`)) {
      finalUrl = finalUrl.replace(`redirect_to=${targetBaseUrl}`, `redirect_to=${encodedTarget}`);
    }
    return finalUrl;
  } catch {
    return actionLink;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Endpoint seguro para acionamento pontual via Cron externo (Hostinger / VPS)
// Executa estritamente um lote controlado de tarefas e NÃO inicia loops permanentes em memória.
app.post('/api/internal/auditoria-worker-tick', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET_KEY || loadedEnv.CRON_SECRET || loadedEnv.WORKER_SECRET_KEY;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!cronSecret || token !== cronSecret) {
    return res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: 'Acesso negado: segredo de agendamento ausente ou inválido.',
    });
  }

  const adminClient = getAdminSupabaseClient();
  if (!adminClient) {
    return res.status(503).json({
      ok: false,
      error: 'supabase_not_configured',
      message: 'Supabase Admin não configurado para processar fila de indexação.',
    });
  }

  try {
    const { auditoriaWorker } = await import('./auditoriaWorkerService.ts');
    const batchSize = Math.min(Math.max(Number(req.query.batchSize || req.body?.batchSize || 5), 1), 20);
    const processed = await auditoriaWorker.processPendingBatch(adminClient, batchSize);

    return res.json({
      ok: true,
      processedCount: processed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[AuditoriaWorker Endpoint Error]:', err?.message);
    return res.status(500).json({
      ok: false,
      error: 'worker_execution_error',
      message: err?.message || 'Erro ao processar lote de indexação.',
    });
  }
});

// Endpoint seguro para teste de conectividade do Supabase Admin (sem expor segredos)
app.get('/api/google/oauth/diag-supabase', async (req, res) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(supabaseUrl && supabaseUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());
  const keyLength = serviceKey ? serviceKey.trim().length : 0;

  let parsedHost: string | null = null;
  let parsedProtocol: string | null = null;
  let urlError: string | null = null;

  if (hasUrl) {
    try {
      const parsed = new URL(supabaseUrl!.trim());
      parsedHost = parsed.hostname;
      parsedProtocol = parsed.protocol;
    } catch (err: any) {
      urlError = err?.message || 'Invalid URL format';
    }
  }

  // 1. TESTE HTTP DIRETO usando fetch nativo do Node 22 (sem supabase-js)
  let directResult: any = null;
  if (!hasUrl || !hasKey || urlError) {
    console.warn('[SUPABASE_DIRECT_DIAG] Parâmetros insuficientes para teste direto:', {
      stage: 'validation',
      has_vite_supabase_url: hasUrl,
      has_service_role_key: hasKey,
      url_parse_error: urlError,
    });
    directResult = {
      tested: false,
      error: 'Parâmetros ausentes ou URL inválida',
    };
  } else {
    const cleanBaseUrl = supabaseUrl!.trim().replace(/\/+$/, '');
    const directEndpoint = `${cleanBaseUrl}/rest/v1/google_calendar_connections?select=id&limit=1`;
    console.log('[SUPABASE_DIRECT_DIAG] Iniciando teste direto com fetch nativo:', {
      stage: 'direct_fetch_start',
      hostname: parsedHost,
    });

    try {
      const fetchResponse = await fetch(directEndpoint, {
        method: 'GET',
        headers: {
          apikey: serviceKey!.trim(),
          Authorization: `Bearer ${serviceKey!.trim()}`,
        },
      });

      let responseBody: any = null;
      let errorBodyText: string | null = null;
      const contentType = fetchResponse.headers.get('content-type') || '';
      try {
        if (contentType.includes('application/json')) {
          responseBody = await fetchResponse.json();
          if (!fetchResponse.ok) {
            errorBodyText = JSON.stringify(responseBody);
          }
        } else {
          const text = await fetchResponse.text();
          if (!fetchResponse.ok) {
            errorBodyText = text.slice(0, 500);
          }
        }
      } catch (readErr: any) {
        errorBodyText = `Falha ao ler corpo: ${readErr?.message}`;
      }

      console.log('[SUPABASE_DIRECT_DIAG] Resposta recebida no teste direto:', {
        stage: 'direct_fetch_response',
        hostname: parsedHost,
        http_status: fetchResponse.status,
        response_ok: fetchResponse.ok,
        response_status_text: fetchResponse.statusText,
        error_body: errorBodyText,
      });

      directResult = {
        tested: true,
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        error_body: errorBodyText,
        data_sample_count: Array.isArray(responseBody) ? responseBody.length : null,
      };
    } catch (fetchErr: any) {
      const causeDetails = fetchErr?.cause
        ? {
            name: fetchErr.cause.name,
            message: fetchErr.cause.message,
            code: fetchErr.cause.code,
            syscall: fetchErr.cause.syscall,
            hostname: fetchErr.cause.hostname,
            address: fetchErr.cause.address,
            port: fetchErr.cause.port,
          }
        : null;

      console.error('[SUPABASE_DIRECT_DIAG] Falha no teste direto com fetch nativo:', {
        stage: 'direct_fetch_error',
        hostname: parsedHost,
        error_name: fetchErr?.name,
        error_message: fetchErr?.message,
        cause: causeDetails,
      });

      directResult = {
        tested: true,
        ok: false,
        error_name: fetchErr?.name,
        error_message: fetchErr?.message,
        cause: causeDetails,
      };
    }
  }

  // 2. TESTE COM SUPABASE-JS para fins de comparação
  let supabaseJsResult: any = null;
  const adminClient = getAdminSupabaseClient();
  if (!adminClient) {
    supabaseJsResult = {
      tested: false,
      message: 'Cliente supabase-js não instanciado.',
    };
  } else {
    try {
      console.log('[SUPABASE_JS_DIAG] Iniciando teste com supabase-js:', {
        stage: 'supabase_js_start',
        hostname: parsedHost,
      });
      const { data, error, count } = await adminClient
        .from('google_calendar_connections')
        .select('id', { count: 'exact', head: true });

      if (error) {
        console.warn('[SUPABASE_JS_DIAG] Resposta de erro do supabase-js:', {
          stage: 'supabase_js_error_response',
          hostname: parsedHost,
          message: error.message,
          code: error.code,
        });
        supabaseJsResult = {
          tested: true,
          ok: false,
          supabase_error: {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          },
        };
      } else {
        console.log('[SUPABASE_JS_DIAG] Sucesso no supabase-js:', {
          stage: 'supabase_js_success',
          hostname: parsedHost,
          count: count ?? 0,
        });
        supabaseJsResult = {
          tested: true,
          ok: true,
          count: count ?? 0,
        };
      }
    } catch (jsErr: any) {
      const causeDetails = jsErr?.cause
        ? {
            name: jsErr.cause.name,
            message: jsErr.cause.message,
            code: jsErr.cause.code,
            syscall: jsErr.cause.syscall,
            hostname: jsErr.cause.hostname,
            address: jsErr.cause.address,
            port: jsErr.cause.port,
          }
        : null;

      console.error('[SUPABASE_JS_DIAG] Exceção de rede no supabase-js:', {
        stage: 'supabase_js_network_exception',
        hostname: parsedHost,
        error_name: jsErr?.name,
        error_message: jsErr?.message,
        cause: causeDetails,
      });

      supabaseJsResult = {
        tested: true,
        ok: false,
        network_error: {
          name: jsErr?.name,
          message: jsErr?.message,
          code: jsErr?.code,
          cause: causeDetails,
        },
      };
    }
  }

  const overallOk = Boolean(directResult?.ok || supabaseJsResult?.ok);
  const responseStatus = overallOk ? 200 : directResult?.status ? directResult.status : 502;

  return res.status(responseStatus).json({
    ok: overallOk,
    diagnostics: {
      has_vite_supabase_url: hasUrl,
      url_protocol: parsedProtocol,
      url_hostname: parsedHost,
      url_parse_error: urlError,
      has_service_role_key: hasKey,
      service_role_key_length: keyLength,
    },
    direct_fetch_test: directResult,
    supabase_js_test: supabaseJsResult,
  });
});

function createOAuthState(userId: string, secret: string): string {
  const payloadObj = {
    user_id: userId,
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payloadStr = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64url');
  return `${payloadStr}.${signature}`;
}

function verifyOAuthState(
  state: string,
  secret: string,
  maxAgeMs: number = 10 * 60 * 1000
): { valid: boolean; error?: string; userId?: string } {
  if (!state || typeof state !== 'string' || !state.trim()) {
    return { valid: false, error: 'missing_oauth_state' };
  }

  const parts = state.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'invalid_oauth_state' };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: 'invalid_oauth_state' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'invalid_oauth_state' };
    }
  } catch {
    return { valid: false, error: 'invalid_oauth_state' };
  }

  let payload: { user_id?: string; ts?: number; nonce?: string };
  try {
    const jsonStr = Buffer.from(payloadStr, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, error: 'invalid_oauth_state' };
  }

  if (!payload || !payload.user_id || typeof payload.ts !== 'number' || !payload.nonce) {
    return { valid: false, error: 'invalid_oauth_state' };
  }

  const now = Date.now();
  if (now - payload.ts > maxAgeMs || payload.ts > now + 60 * 1000) {
    return { valid: false, error: 'expired_oauth_state' };
  }

  return { valid: true, userId: payload.user_id };
}

// ==============================================================================
// MIDDLEWARES DE AUTENTICAÇÃO E PERMISSÕES
// ==============================================================================

async function requireAuthUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autorização não fornecido.' });
  }

  const token = authHeader.slice(7).trim();
  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Cliente administrativo Supabase não configurado.' });
  }

  try {
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, is_active, deleted_at, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profile && profile.is_active === false) {
      return res.status(403).json({ error: 'Acesso restrito: usuário desativado no sistema.' });
    }

    (req as any).user = user;
    (req as any).userProfile = profile || { id: user.id, email: user.email, role: 'user' };
    (req as any).authToken = token;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Falha ao validar sessão do usuário: ' + (err?.message || err) });
  }
}

async function requireAdminUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autorização não fornecido.' });
  }

  const token = authHeader.slice(7).trim();
  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Cliente administrativo Supabase não configurado.' });
  }

  try {
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    const adminScopedClient = getScopedSupabaseClient(token);

    let { data: profile, error: profErr } = await adminScopedClient
      .from('profiles')
      .select('id, role, is_active, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profErr || !profile) {
      // Fallback via supabaseAdmin to prevent transient RLS policy blocks for verified administrators
      const { data: adminProf } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, full_name, email')
        .eq('id', user.id)
        .maybeSingle();

      if (adminProf) {
        profile = adminProf;
      } else {
        return res.status(403).json({ error: 'Perfil de usuário não localizado no sistema.' });
      }
    }

    const role = (profile.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'administrador';
    if (!isAdmin || profile.is_active === false) {
      return res.status(403).json({ error: 'Acesso restrito: apenas administradores ativos possuem autorização.' });
    }

    (req as any).adminUser = user;
    (req as any).adminProfile = profile;
    (req as any).adminScopedClient = adminScopedClient;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Falha interna ao validar credenciais administrativas: ' + (err?.message || err) });
  }
}

// 1. Listar todos os usuários com perfis e permissões granulares
app.get('/api/admin/users', requireAdminUser, async (req, res) => {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!supabaseAdmin || !adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  try {
    const [authRes, profilesRes, permRes] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: true }),
      supabaseAdmin.from('user_permissions').select('*'),
    ]);

    const authUsers = authRes.data?.users || [];
    const profiles = profilesRes.data || [];
    const permissions = permRes.data || [];

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const permMap = new Map(permissions.map((pm) => [pm.user_id, pm]));

    // Consolidar todos os IDs
    const allUserIds = new Set<string>();
    authUsers.forEach((u) => allUserIds.add(u.id));
    profiles.forEach((p) => allUserIds.add(p.id));

    const combinedList = Array.from(allUserIds)
      .map((userId) => {
        const authUser = authUsers.find((u) => u.id === userId);
        const profile = profileMap.get(userId);
        const perm = permMap.get(userId);

        // Ocultar usuários excluídos / desligados do painel administrativo
        const isDeletedAuth = Boolean(authUser?.user_metadata?.is_deleted);
        const isDeletedProfile = Boolean((profile as any)?.deleted_at);
        if (isDeletedAuth || isDeletedProfile || (!authUser && profile && profile.is_active === false)) {
          return null;
        }

        const email = profile?.email || authUser?.email || '';
        const fullName = profile?.full_name || authUser?.user_metadata?.full_name || email.split('@')[0] || 'Usuário';
        const role = profile?.role || 'user';
        const isActive = profile?.is_active !== undefined ? Boolean(profile.is_active) : true;

        const isAdmin = role.toLowerCase() === 'admin' || role.toLowerCase() === 'administrador';

        return {
          id: userId,
          email,
          full_name: fullName,
          role: isAdmin ? 'admin' : 'user',
          is_active: isActive,
          created_at: profile?.created_at || authUser?.created_at || new Date().toISOString(),
          last_sign_in_at: authUser?.last_sign_in_at || null,
          permissions: perm ? {
            can_manage_notes: Boolean(perm.can_manage_notes),
            can_delete_notes: Boolean(perm.can_delete_notes),
            can_manage_leads: Boolean(perm.can_manage_leads),
            can_delete_leads: Boolean(perm.can_delete_leads),
            can_change_stage: Boolean(perm.can_change_stage),
            can_manage_contacts: Boolean(perm.can_manage_contacts),
            can_access_auditoria: Boolean(perm.can_access_auditoria),
            can_manage_auditoria: Boolean(perm.can_manage_auditoria),
          } : {
            can_manage_notes: true,
            can_delete_notes: false,
            can_manage_leads: true,
            can_delete_leads: false,
            can_change_stage: true,
            can_manage_contacts: true,
            can_access_auditoria: false,
            can_manage_auditoria: false,
          },
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    return res.json({ users: combinedList });
  } catch (err: any) {
    console.error('[ADMIN_USERS_LIST_ERROR]', err);
    return res.status(500).json({ error: 'Erro ao listar usuários: ' + (err?.message || err) });
  }
});

// Helper interno para convidar usuário sem definição de senha pelo administrador
async function handleInviteUserAdmin(req: express.Request, res: express.Response) {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!supabaseAdmin || !adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const {
    email,
    full_name,
    role = 'user',
    is_active = true,
    permissions = {},
  } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail corporativo inválido.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (full_name || cleanEmail.split('@')[0]).trim();
  const targetRole = role === 'admin' ? 'admin' : 'user';

  try {
    let createdUser: any = null;
    let inviteLink: string | null = null;
    const appBaseUrl = getAppBaseUrl();

    // 1. Tenta enviar convite oficial por e-mail via Supabase Auth Admin (service_role)
    const { data: inviteRes, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
      data: { full_name: cleanName },
      redirectTo: appBaseUrl,
    });

    if (!inviteErr && inviteRes?.user) {
      createdUser = inviteRes.user;
      // Também gera link de primeiro acesso/recuperação para que o administrador possa encaminhar se desejar
      const { data: recData } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: cleanEmail,
        options: {
          redirectTo: appBaseUrl,
        },
      });
      inviteLink = sanitizeActionLink(recData?.properties?.action_link, appBaseUrl);
    } else {
      // 2. Fallback: gera link de convite diretamente via Auth Admin (service_role)
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email: cleanEmail,
        options: {
          data: { full_name: cleanName },
          redirectTo: appBaseUrl,
        },
      });

      if (linkErr) {
        if (linkErr.message.includes('already been registered')) {
          const { data: recData, error: recErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: cleanEmail,
            options: {
              redirectTo: appBaseUrl,
            },
          });
          if (recErr) throw recErr;
          inviteLink = sanitizeActionLink(recData.properties?.action_link, appBaseUrl);
          createdUser = recData.user;
        } else {
          throw linkErr;
        }
      } else {
        inviteLink = sanitizeActionLink(linkData.properties?.action_link, appBaseUrl);
        createdUser = linkData.user;
      }
    }

    if (!createdUser?.id) {
      throw new Error('Falha ao registrar novo usuário no sistema.');
    }

    const userId = createdUser.id;

    // Atualizar perfil em public.profiles usando adminScopedClient (satisfaz auth.uid(), RLS e trigger is_admin())
    const { error: profErr } = await adminScopedClient
      .from('profiles')
      .update({
        full_name: cleanName,
        email: cleanEmail,
        role: targetRole,
        is_active: Boolean(is_active),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (profErr) {
      console.warn('Aviso ao atualizar perfil:', profErr.message);
    }

    // Configurar permissões iniciais em public.user_permissions usando adminScopedClient
    const finalPerms = {
      user_id: userId,
      can_manage_notes: Boolean(permissions.can_manage_notes ?? true),
      can_delete_notes: Boolean(permissions.can_delete_notes ?? false),
      can_manage_leads: Boolean(permissions.can_manage_leads ?? true),
      can_delete_leads: Boolean(permissions.can_delete_leads ?? false),
      can_change_stage: Boolean(permissions.can_change_stage ?? true),
      can_manage_contacts: Boolean(permissions.can_manage_contacts ?? true),
      can_access_auditoria: Boolean(permissions.can_access_auditoria ?? false),
      can_manage_auditoria: Boolean(permissions.can_manage_auditoria ?? false),
      updated_at: new Date().toISOString(),
    };

    const { error: permErr } = await adminScopedClient.from('user_permissions').upsert(finalPerms);
    if (permErr) {
      console.warn('Aviso ao registrar permissões:', permErr.message);
    }

    return res.json({
      success: true,
      user: {
        id: userId,
        email: cleanEmail,
        full_name: cleanName,
        role: targetRole,
        is_active: Boolean(is_active),
        permissions: finalPerms,
      },
      inviteLink,
      message: 'Convite enviado com sucesso!',
    });
  } catch (err: any) {
    console.error('[ADMIN_USERS_INVITE_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Erro ao convidar usuário.' });
  }
}

// 2. Convidar novo usuário (sem senha definida pelo admin)
app.post('/api/admin/users/invite', requireAdminUser, handleInviteUserAdmin);
app.post('/api/admin/invite-user', requireAdminUser, handleInviteUserAdmin);

// 3. PATCH /api/admin/users/:id - Atualizar dados do usuário (nome, função, status ativo)
app.patch('/api/admin/users/:id', requireAdminUser, async (req, res) => {
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id } = req.params;
  const { full_name, role, is_active } = req.body;
  const currentAdmin = (req as any).adminUser;

  if (!id) {
    return res.status(400).json({ error: 'Identificador de usuário não informado.' });
  }

  // Proteção contra bloqueio do próprio administrador
  if (currentAdmin.id === id) {
    if (is_active === false) {
      return res.status(400).json({ error: 'Você não pode desativar seu próprio usuário administrador.' });
    }
    if (role && role !== 'admin') {
      return res.status(400).json({ error: 'Você não pode remover seus próprios privilégios de administrador.' });
    }
  }

  try {
    const updateProfileData: any = {
      updated_at: new Date().toISOString(),
    };
    if (full_name !== undefined) updateProfileData.full_name = full_name.trim();
    if (role !== undefined) updateProfileData.role = role === 'admin' ? 'admin' : 'user';
    if (is_active !== undefined) updateProfileData.is_active = Boolean(is_active);

    const { error: profErr } = await adminScopedClient
      .from('profiles')
      .update(updateProfileData)
      .eq('id', id);

    if (profErr) throw profErr;

    // Garantir que a linha user_permissions existe sem apagar ou sobrescrever permissões existentes ao promover/rebaixar
    const { data: existingPerms } = await adminScopedClient
      .from('user_permissions')
      .select('user_id')
      .eq('user_id', id)
      .maybeSingle();

    if (!existingPerms) {
      await adminScopedClient.from('user_permissions').insert({
        user_id: id,
        can_manage_notes: true,
        can_delete_notes: false,
        can_manage_leads: true,
        can_delete_leads: false,
        can_change_stage: true,
        can_manage_contacts: true,
        can_access_auditoria: false,
        can_manage_auditoria: false,
      });
    }

    return res.json({ success: true, message: 'Usuário atualizado com sucesso.' });
  } catch (err: any) {
    console.error('[ADMIN_PATCH_USER_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar dados do usuário.' });
  }
});

// 4. PATCH /api/admin/users/:id/permissions - Atualizar as permissões granulares
app.patch('/api/admin/users/:id/permissions', requireAdminUser, async (req, res) => {
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id } = req.params;
  const permissions = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'Identificador de usuário não informado.' });
  }

  try {
    const permsPayload: any = {
      user_id: id,
      updated_at: new Date().toISOString(),
    };

    if (permissions.can_manage_notes !== undefined) permsPayload.can_manage_notes = Boolean(permissions.can_manage_notes);
    if (permissions.can_delete_notes !== undefined) permsPayload.can_delete_notes = Boolean(permissions.can_delete_notes);
    if (permissions.can_manage_leads !== undefined) permsPayload.can_manage_leads = Boolean(permissions.can_manage_leads);
    if (permissions.can_delete_leads !== undefined) permsPayload.can_delete_leads = Boolean(permissions.can_delete_leads);
    if (permissions.can_change_stage !== undefined) permsPayload.can_change_stage = Boolean(permissions.can_change_stage);
    if (permissions.can_manage_contacts !== undefined) permsPayload.can_manage_contacts = Boolean(permissions.can_manage_contacts);
    if (permissions.can_access_auditoria !== undefined) permsPayload.can_access_auditoria = Boolean(permissions.can_access_auditoria);
    if (permissions.can_manage_auditoria !== undefined) permsPayload.can_manage_auditoria = Boolean(permissions.can_manage_auditoria);

    const { error: permErr } = await adminScopedClient
      .from('user_permissions')
      .upsert(permsPayload);

    if (permErr) throw permErr;

    return res.json({
      success: true,
      message: 'Permissões salvas com sucesso em public.user_permissions.',
      permissions: permsPayload,
    });
  } catch (err: any) {
    console.error('[ADMIN_PATCH_PERMS_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar permissões.' });
  }
});

// 5. POST /api/admin/update-user - Atualizar perfil + permissões preservando user_permissions ao promover/rebaixar
app.post('/api/admin/update-user', requireAdminUser, async (req, res) => {
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id, full_name, role, is_active, permissions } = req.body;
  const currentAdmin = (req as any).adminUser;

  if (!id) {
    return res.status(400).json({ error: 'Identificador de usuário não informado.' });
  }

  if (currentAdmin.id === id) {
    if (is_active === false) {
      return res.status(400).json({ error: 'Você não pode desativar seu próprio usuário administrador.' });
    }
    if (role && role !== 'admin') {
      return res.status(400).json({ error: 'Você não pode remover seus próprios privilégios de administrador.' });
    }
  }

  try {
    const targetRole = role === 'admin' ? 'admin' : 'user';

    const updateProfileData: any = {
      updated_at: new Date().toISOString(),
    };
    if (full_name !== undefined) updateProfileData.full_name = full_name.trim();
    if (role !== undefined) updateProfileData.role = targetRole;
    if (is_active !== undefined) updateProfileData.is_active = Boolean(is_active);

    const { error: profErr } = await adminScopedClient
      .from('profiles')
      .update(updateProfileData)
      .eq('id', id);

    if (profErr) throw profErr;

    // Garantir que a linha em user_permissions existe; se targetRole === 'user' e permissions foi enviado, atualizar
    const { data: existingPerms } = await adminScopedClient
      .from('user_permissions')
      .select('user_id')
      .eq('user_id', id)
      .maybeSingle();

    if (targetRole === 'user' && permissions) {
      const permsPayload = {
        user_id: id,
        can_manage_notes: Boolean(permissions.can_manage_notes ?? true),
        can_delete_notes: Boolean(permissions.can_delete_notes ?? false),
        can_manage_leads: Boolean(permissions.can_manage_leads ?? true),
        can_delete_leads: Boolean(permissions.can_delete_leads ?? false),
        can_change_stage: Boolean(permissions.can_change_stage ?? true),
        can_manage_contacts: Boolean(permissions.can_manage_contacts ?? true),
        updated_at: new Date().toISOString(),
      };

      const { error: permErr } = await adminScopedClient
        .from('user_permissions')
        .upsert(permsPayload);

      if (permErr) throw permErr;
    } else if (!existingPerms) {
      await adminScopedClient.from('user_permissions').insert({
        user_id: id,
        can_manage_notes: true,
        can_delete_notes: false,
        can_manage_leads: true,
        can_delete_leads: false,
        can_change_stage: true,
        can_manage_contacts: true,
      });
    }

    return res.json({ success: true, message: 'Usuário atualizado com sucesso.' });
  } catch (err: any) {
    console.error('[ADMIN_UPDATE_USER_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar dados do usuário.' });
  }
});

// 6. Gerar link de recuperação de acesso / redefinição de senha pelo próprio usuário
app.post('/api/admin/reset-password', requireAdminUser, async (req, res) => {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  if (!supabaseAdmin || !adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id, email } = req.body || {};
  if (!id && !email) {
    return res.status(400).json({ error: 'Usuário ou e-mail não informado.' });
  }

  try {
    let targetEmail = email;
    if (!targetEmail && id) {
      const { data: prof } = await adminScopedClient.from('profiles').select('email').eq('id', id).maybeSingle();
      targetEmail = prof?.email;
    }

    if (targetEmail) {
      const appBaseUrl = getAppBaseUrl();
      const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: targetEmail.trim().toLowerCase(),
        options: {
          redirectTo: appBaseUrl,
        },
      });
      if (error) throw error;
      return res.json({
        success: true,
        recoveryLink: sanitizeActionLink(linkData?.properties?.action_link, appBaseUrl),
        message: 'Link de recuperação de acesso gerado com sucesso.',
      });
    }

    return res.status(400).json({ error: 'Não foi possível localizar o e-mail do usuário.' });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Falha ao gerar link de recuperação.' });
  }
});

// 7. Exclusão definitiva de usuário e desligamento de funcionário
async function handleDeleteUser(req: express.Request, res: express.Response) {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient: SupabaseClient = (req as any).adminScopedClient;
  const currentAdminUser = (req as any).adminUser;
  if (!supabaseAdmin || !adminScopedClient || !currentAdminUser) {
    return res.status(500).json({ error: 'Serviço administrativo indisponível.' });
  }

  const targetId = (req.params.id || req.body?.id || '').trim();
  if (!targetId) {
    return res.status(400).json({ error: 'ID do usuário não fornecido.' });
  }

  // 1. Impedir exclusão da própria conta autenticada
  if (currentAdminUser.id === targetId) {
    return res.status(400).json({
      error: 'Operação não permitida: não é possível excluir a sua própria conta autenticada.',
    });
  }

  try {
    // 2. Buscar perfil do usuário no banco
    const { data: targetProfile } = await adminScopedClient
      .from('profiles')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();

    // Buscar dados no Auth Admin
    const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(targetId);
    const targetAuthUser = authUserData?.user || null;

    if (!targetProfile && !targetAuthUser) {
      return res.status(404).json({ error: 'Usuário não localizado no sistema.' });
    }

    const targetEmail = (targetProfile?.email || targetAuthUser?.email || '').trim().toLowerCase();
    const confirmationEmail = (req.body?.confirmation_email || req.body?.email || '').trim().toLowerCase();

    // 3. Exigir confirmação digitando o e-mail exato
    if (!confirmationEmail || confirmationEmail !== targetEmail) {
      return res.status(400).json({
        error: `Confirmação inválida. É obrigatório digitar o e-mail exato do usuário (${targetEmail || 'cadastrado'}) para confirmar a exclusão.`,
      });
    }

    // 4. Impedir exclusão do último administrador ativo
    const isTargetAdmin =
      targetProfile?.role === 'admin' ||
      targetProfile?.role === 'administrador';

    if (isTargetAdmin && targetProfile?.is_active !== false) {
      const { data: activeAdmins, error: countErr } = await adminScopedClient
        .from('profiles')
        .select('id, role')
        .in('role', ['admin', 'administrador'])
        .eq('is_active', true);

      if (!countErr && activeAdmins) {
        const remainingAdmins = activeAdmins.filter((a) => a.id !== targetId);
        if (remainingAdmins.length === 0) {
          return res.status(400).json({
            error: 'Operação não permitida: não é possível excluir o único administrador ativo do sistema.',
          });
        }
      }
    }

    // 5. Tratar integração com Google Calendar (revogação e limpeza)
    let googleCalendarRevoked: boolean | null = null;
    let googleCalendarRevokeWarning: string | null = null;
    try {
      const { data: gcalConn } = await supabaseAdmin
        .from('google_calendar_connections')
        .select('*')
        .eq('user_id', targetId)
        .maybeSingle();

      if (gcalConn) {
        // Priorizar refresh_token (invalida a concessão inteira na Google). Se indisponível ou falhar, tenta access_token.
        const candidateTokens: string[] = [];
        if (gcalConn.refresh_token) candidateTokens.push(gcalConn.refresh_token);
        if (gcalConn.access_token && !candidateTokens.includes(gcalConn.access_token)) {
          candidateTokens.push(gcalConn.access_token);
        }

        for (const tokenToRevoke of candidateTokens) {
          try {
            const revokeRes = await fetch('https://oauth2.googleapis.com/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: tokenToRevoke }).toString(),
            });

            if (revokeRes.ok) {
              googleCalendarRevoked = true;
              googleCalendarRevokeWarning = null;
              break; // Revogação confirmada na Google com sucesso
            } else {
              googleCalendarRevoked = false;
              let errorDetail = '';
              try {
                const errData: any = await revokeRes.json();
                if (errData?.error) {
                  errorDetail = errData.error_description
                    ? `${errData.error}: ${errData.error_description}`
                    : errData.error;
                }
              } catch {
                // Corpo da resposta não é JSON
              }
              googleCalendarRevokeWarning = `Status de revogação Google: ${revokeRes.status}${errorDetail ? ` (${errorDetail})` : ''}`;
            }
          } catch (revErr: any) {
            googleCalendarRevoked = false;
            googleCalendarRevokeWarning = revErr?.message || 'Falha ao contatar endpoint de revogação da Google.';
          }
        }

        // Limpeza mandatória das credenciais locais no banco, mesmo se a revogação externa falhar
        await supabaseAdmin.from('google_calendar_connections').delete().eq('user_id', targetId);
      }
    } catch (gcalErr: any) {
      console.warn('[GCAL_DELETE_CLEANUP_WARN]', gcalErr);
    }

    // 6. Desvincular responsabilidade comercial sem apagar dados comerciais
    // Leads: desvincula o responsável mantendo condomínios e dados intactos
    await adminScopedClient
      .from('leads')
      .update({ responsible_user_id: null, updated_at: new Date().toISOString() })
      .eq('responsible_user_id', targetId);

    // Interações: desvincula responsabilidade comercial, preservando created_by_user_id e last_edited_by_user_id
    await adminScopedClient
      .from('interactions')
      .update({ responsible_user_id: null })
      .eq('responsible_user_id', targetId);

    // 7. Remover permissões do usuário
    await adminScopedClient
      .from('user_permissions')
      .delete()
      .eq('user_id', targetId);

    // 8. Atualizar perfil para desativado/arquivado mantendo o nome do autor histórico
    const { error: profArchiveErr } = await adminScopedClient
      .from('profiles')
      .update({
        is_active: false,
        role: 'user',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetId);

    if (profArchiveErr) {
      // Se a coluna deleted_at ainda não existir no banco, atualiza sem ela
      const { error: fallbackErr } = await adminScopedClient
        .from('profiles')
        .update({
          is_active: false,
          role: 'user',
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetId);

      if (fallbackErr) {
        console.error('[ADMIN_DELETE_USER] Falha ao atualizar perfil para inativo:', fallbackErr);
      }
    }

    // 9. Tentar exclusão definitiva no Supabase Auth Admin (service_role)
    let authUserDeleted = false;
    let authErrorMessage: string | null = null;

    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetId);
    if (!authDelErr) {
      authUserDeleted = true;
    } else {
      authErrorMessage = authDelErr.message;
      console.warn('[AUTH_DELETE_CASCADE_BLOCKED]', authDelErr.message);

      // Fallback robusto caso haja notas históricas protegidas por FK (antes da migration):
      // Bloqueia permanentemente a conta, banindo o usuário por 100 anos e invalidando sessões
      await supabaseAdmin.auth.admin.updateUserById(targetId, {
        ban_duration: '876000h',
        user_metadata: { is_deleted: true, deleted_at: new Date().toISOString() },
      });
      try {
        await supabaseAdmin.auth.admin.signOut(targetId);
      } catch {}
    }

    return res.json({
      success: true,
      authUserDeleted,
      googleCalendarRevoked,
      googleCalendarRevokeWarning,
      message: authUserDeleted
        ? 'Usuário excluído definitivamente do CRM com sucesso. Histórico comercial e autoria preservados.'
        : 'Acesso do usuário revogado permanentemente e histórico comercial preservado.',
      details: authErrorMessage
        ? 'A conta foi permanentemente desativada e banida do Auth para salvaguardar a integridade referencial das notas históricas.'
        : undefined,
    });
  } catch (err: any) {
    console.error('[ADMIN_DELETE_USER_ERROR]', err);
    return res.status(500).json({
      error: err?.message || 'Falha ao processar exclusão de usuário.',
    });
  }
}

app.delete('/api/admin/users/:id', requireAdminUser, handleDeleteUser);
app.post('/api/admin/users/:id/delete', requireAdminUser, handleDeleteUser);
app.delete('/api/admin/delete-user', requireAdminUser, handleDeleteUser);
app.post('/api/admin/delete-user', requireAdminUser, handleDeleteUser);

// ==============================================================================
// GOOGLE DRIVE CENTRAL — AUDITORIA (CONTA DE SERVIÇO)
// ==============================================================================

// 1. Status seguro das credenciais configuradas para o Google Drive central
app.get('/api/admin/drive/status', requireAdminUser, (req, res) => {
  try {
    const status = getGoogleDriveConfigStatus();
    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Falha ao consultar status das credenciais do Google Drive: ' + (err?.message || err),
    });
  }
});

// 2. Diagnóstico completo e seguro da conexão e permissões do Google Drive
app.get('/api/admin/drive/diagnose', requireAdminUser, async (req, res) => {
  try {
    const diagnostic = await diagnoseDriveConnection();
    return res.json(diagnostic);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      stage: 'unknown',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno ao diagnosticar Google Drive: ' + (err?.message || err),
        resolution_hint: 'Verifique os logs do servidor para mais detalhes.',
      },
    });
  }
});

// 3. Consulta estruturada de subpastas imediatas pertencentes à pasta raiz
app.get('/api/admin/drive/subfolders', requireAdminUser, async (req, res) => {
  try {
    const result = await listImmediateSubfolders();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Falha ao consultar subpastas no Google Drive: ' + (err?.message || err),
    });
  }
});

// ==============================================================================
// AUDITORIA TRIVERUS — GERENCIAMENTO DE DOCUMENTOS E VÍNCULOS COM O GOOGLE DRIVE
// ==============================================================================

const AUDITORIA_DOCS_FALLBACK_FILE = path.join(__dirname, 'auditoria_documents_store.json');
const AUDITORIA_FOLDERS_FALLBACK_FILE = path.join(__dirname, 'auditoria_folders_store.json');

interface AuditoriaFasePastaRecord {
  id: string;
  condo_id: string;
  category: string;
  drive_folder_id: string;
  drive_folder_name: string;
  linked_by_user_id: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

function readFallbackFolders(): AuditoriaFasePastaRecord[] {
  try {
    if (fs.existsSync(AUDITORIA_FOLDERS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao ler arquivo local:', e);
  }
  return [];
}

function saveFallbackFolder(record: AuditoriaFasePastaRecord): void {
  try {
    const list = readFallbackFolders();
    const idx = list.findIndex((f) => f.condo_id === record.condo_id && f.category === record.category);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao salvar arquivo local:', e);
  }
}

function deleteFallbackFolder(condoId: string, category: string): boolean {
  try {
    const list = readFallbackFolders();
    const filtered = list.filter((f) => !(f.condo_id === condoId && f.category === category));
    if (filtered.length !== list.length) {
      fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return true;
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao remover do arquivo local:', e);
  }
  return false;
}

function deleteFallbackDocumentsByOriginFolder(condoId: string, category: string, folderId: string): number {
  try {
    const list = readFallbackDocuments();
    const remaining = list.filter((d) => {
      if (d.condo_id === condoId && d.category === category && d.origin_folder_id === folderId) {
        return false;
      }
      return true;
    });
    const removedCount = list.length - remaining.length;
    if (removedCount > 0) {
      fs.writeFileSync(AUDITORIA_DOCS_FALLBACK_FILE, JSON.stringify(remaining, null, 2), 'utf8');
    }
    return removedCount;
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao remover documentos por pasta de origem:', e);
    return 0;
  }
}
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

function isTableMissingError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const message = String(err.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('Could not find the table') ||
    message.includes('relation "public.auditoria_documentos" does not exist') ||
    message.includes('relation "auditoria_documentos" does not exist')
  );
}

function isUniqueConstraintViolation(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const message = String(err.message || '').toLowerCase();
  const details = String(err.details || '').toLowerCase();
  return (
    code === '23505' ||
    message.includes('unique constraint') ||
    message.includes('duplicate key') ||
    details.includes('already exists')
  );
}

interface AuditoriaDocumentRecord {
  id: string;
  condo_id: string;
  category: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_file_size: number | null;
  drive_file_modified_at: string | null;
  linked_by_user_id: string | null;
  origin_folder_id?: string | null;
  origin_folder_name?: string | null;
  sync_status?: string | null;
  created_at: string;
  updated_at: string;
}

function readFallbackDocuments(): AuditoriaDocumentRecord[] {
  try {
    if (fs.existsSync(AUDITORIA_DOCS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(AUDITORIA_DOCS_FALLBACK_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao ler arquivo local:', e);
  }
  return [];
}

function saveFallbackDocument(doc: AuditoriaDocumentRecord): void {
  try {
    const list = readFallbackDocuments();
    const idx = list.findIndex(
      (d) => d.condo_id === doc.condo_id && d.category === doc.category && d.drive_file_id === doc.drive_file_id
    );
    if (idx >= 0) {
      list[idx] = doc;
    } else {
      list.push(doc);
    }
    fs.writeFileSync(AUDITORIA_DOCS_FALLBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao salvar arquivo local:', e);
  }
}

function deleteFallbackDocument(
  condoId: string,
  category: string,
  driveFileId?: string | null,
  documentId?: string | null
): boolean {
  try {
    const list = readFallbackDocuments();
    const filtered = list.filter((d) => {
      if (d.condo_id !== condoId || d.category !== category) return true;
      if (documentId && d.id === documentId) return false;
      if (driveFileId && d.drive_file_id === driveFileId) return false;
      if (!documentId && !driveFileId) return false;
      return true;
    });
    if (filtered.length !== list.length) {
      fs.writeFileSync(AUDITORIA_DOCS_FALLBACK_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return true;
    }
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao remover do arquivo local:', e);
  }
  return false;
}

export interface AuditoriaMemoryRecord {
  id: string;
  condo_id: string;
  category: string;
  label: string;
  fill_mode: 'manual' | 'ai';
  manual_value?: string | null;
  instruction?: string | null;
  source_document_id?: string | null;
  source_drive_file_id?: string | null;
  source_drive_file_name?: string | null;
  last_result?: string | null;
  page_reference?: string | null;
  last_result_metadata?: any;
  status: 'never_searched' | 'result_available' | 'outdated' | 'failed';
  last_executed_at?: string | null;
  source_file_modified_at?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

const AUDITORIA_MEMORIAS_FALLBACK_FILE = path.join(process.cwd(), 'data', 'auditoria_memorias_contingency.json');

function readFallbackMemories(): AuditoriaMemoryRecord[] {
  try {
    if (fs.existsSync(AUDITORIA_MEMORIAS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(AUDITORIA_MEMORIAS_FALLBACK_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn('[AUDITORIA_MEMORIAS_FALLBACK] Falha ao ler arquivo local:', e);
  }
  return [];
}

function saveFallbackMemory(mem: AuditoriaMemoryRecord): void {
  try {
    const list = readFallbackMemories();
    const idx = list.findIndex((m) => m.id === mem.id && m.condo_id === mem.condo_id);
    if (idx >= 0) {
      list[idx] = mem;
    } else {
      list.push(mem);
    }
    const dir = path.dirname(AUDITORIA_MEMORIAS_FALLBACK_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AUDITORIA_MEMORIAS_FALLBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[AUDITORIA_MEMORIAS_FALLBACK] Falha ao salvar arquivo local:', e);
  }
}

function deleteFallbackMemory(condoId: string, memoryId: string): boolean {
  try {
    const list = readFallbackMemories();
    const filtered = list.filter((m) => !(m.condo_id === condoId && m.id === memoryId));
    const dir = path.dirname(AUDITORIA_MEMORIAS_FALLBACK_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AUDITORIA_MEMORIAS_FALLBACK_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[AUDITORIA_MEMORIAS_FALLBACK] Falha ao remover arquivo local:', e);
    return false;
  }
}

/**
 * Middleware robusto de autorização e isolamento por condomínio para o módulo de Auditoria.
 * Valida:
 * 1. Token de sessão válido e usuário ativo em public.profiles
 * 2. Bypass irrestrito para administradores ativos (role === 'admin' || 'administrador')
 * 3. Validação granular de permissões em public.user_permissions (can_access_auditoria vs can_manage_auditoria)
 * 4. Validação de existência do condomínio em public.leads
 * 5. Isolamento estrito por condomínio: colaboradores comuns só acessam condomínios onde são o responsible_user_id
 */
function requireAuditoriaAccess(requiredPermission: 'can_access_auditoria' | 'can_manage_auditoria' = 'can_access_auditoria') {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autorização não fornecido.' });
    }

    const token = authHeader.slice(7).trim();
    const supabaseAdmin = getAdminSupabaseClient();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Cliente administrativo Supabase não configurado.' });
    }

    try {
      const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
      if (userErr || !user) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
      }

      // 1. Obter perfil e verificar se o usuário está ativo
      let { data: profile, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, full_name, email')
        .eq('id', user.id)
        .maybeSingle();

      if (profErr || !profile) {
        return res.status(403).json({ error: 'Perfil de usuário não localizado no sistema.' });
      }

      if (profile.is_active !== true || (profile as any).deleted_at) {
        return res.status(403).json({ error: 'Acesso restrito: usuário inativo ou desativado no sistema.' });
      }

      const role = (profile.role || '').toLowerCase();
      const isAdmin = role === 'admin' || role === 'administrador';

      (req as any).user = user;
      (req as any).userProfile = profile;
      (req as any).isAdmin = isAdmin;
      (req as any).authToken = token;

      // 2. Validação de permissões granulares para usuários comuns
      if (!isAdmin) {
        const { data: permData } = await supabaseAdmin
          .from('user_permissions')
          .select('can_access_auditoria, can_manage_auditoria')
          .eq('user_id', user.id)
          .maybeSingle();

        const hasAccess = Boolean(permData?.can_access_auditoria);
        const hasManage = Boolean(permData?.can_manage_auditoria);

        if (requiredPermission === 'can_manage_auditoria' && !hasManage) {
          return res.status(403).json({
            error: 'Acesso negado: seu usuário não possui a permissão "can_manage_auditoria" para gerenciar documentos no módulo de Auditoria.',
          });
        }

        if (requiredPermission === 'can_access_auditoria' && !hasAccess && !hasManage) {
          return res.status(403).json({
            error: 'Acesso negado: seu usuário não possui a permissão "can_access_auditoria" para acessar o módulo de Auditoria.',
          });
        }
      }

      // 3. Validação de condomínio e isolamento estrito por usuário
      const condoId = req.params.condoId || (req.query.condoId as string);
      if (condoId) {
        if (!isValidUUID(condoId)) {
          return res.status(400).json({ error: 'Identificador do condomínio inválido. Deve ser um UUID no formato padrão.' });
        }

        const { data: leadData, error: leadErr } = await supabaseAdmin
          .from('leads')
          .select('id, name, responsible_user_id')
          .eq('id', condoId)
          .maybeSingle();

        if (leadErr) {
          return res.status(500).json({ error: 'Falha ao validar condomínio no CRM: ' + leadErr.message });
        }
        if (!leadData) {
          return res.status(404).json({ error: 'Condomínio não localizado no CRM.' });
        }

        // Se não for admin, verificar se o condomínio está sob responsabilidade do usuário
        if (!isAdmin) {
          if (leadData.responsible_user_id !== user.id) {
            return res.status(403).json({
              error: 'Acesso negado: você não tem permissão para acessar a auditoria deste condomínio (responsável designado diferente no CRM).',
            });
          }
        }

        (req as any).condoLead = leadData;
      }

      next();
    } catch (err: any) {
      console.error('[AUDITORIA_ACCESS_MIDDLEWARE_ERROR]', err);
      return res.status(500).json({ error: 'Falha interna ao validar credenciais de auditoria: ' + (err?.message || err) });
    }
  };
}

// 1. Listar arquivos PDF disponíveis na subpasta do condomínio no Google Drive central
app.get('/api/auditoria/condo/:condoId/drive-files', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = (req as any).condoLead;
  const condoName = leadData?.name;

  try {
    const matchResult = await findCondoSubfolder(condoName);

    if (matchResult.error) {
      return res.status(400).json({
        ok: false,
        found: false,
        condo_id: condoId,
        condo_name: condoName,
        error: matchResult.error,
        files: [],
      });
    }

    if (!matchResult.found || !matchResult.folder) {
      return res.json({
        ok: true,
        found: false,
        condo_id: condoId,
        condo_name: condoName,
        searched_folder_name: matchResult.normalized_searched_name,
        message: `A subpasta do condomínio "${condoName}" não foi encontrada dentro da pasta raiz "Triverus - Documentos dos Condomínios" no Google Drive. Crie a pasta correspondente no Drive e adicione os arquivos PDF.`,
        files: [],
      });
    }

    const pdfFiles = await listPdfFilesInFolder(matchResult.folder.id);

    return res.json({
      ok: true,
      found: true,
      condo_id: condoId,
      condo_name: condoName,
      folder: {
        id: matchResult.folder.id,
        name: matchResult.folder.name,
      },
      files: pdfFiles,
    });
  } catch (err: any) {
    console.error('[AUDITORIA_DRIVE_FILES_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar arquivos no Google Drive: ' + (err?.message || err),
    });
  }
});

// 1.1. Listar pastas disponíveis para seleção no condomínio (pasta principal + subpastas)
// 1.1. Listar pastas disponíveis e navegar hierarquicamente pelas pastas do condomínio
app.get('/api/auditoria/condo/:condoId/drive-folders', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = (req as any).condoLead;
  const condoName = leadData?.name;
  try {
    const reqFolderId = req.query.folderId ? String(req.query.folderId) : null;
    const reqSearch = (req.query.search || req.query.q) ? String(req.query.search || req.query.q).trim() : null;

    if (reqSearch) {
      const searchRes = await searchDriveFolders(reqSearch);
      if (!searchRes.ok) {
        return res.status(400).json({
          ok: false,
          error: searchRes.error || 'Falha ao buscar pastas no Google Drive.',
          currentFolder: null,
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
        });
      }
      return res.json({
        ok: true,
        isSearch: true,
        currentFolder: null,
        breadcrumb: [],
        subfolders: searchRes.folders.map((f: any) => ({
          id: f.id,
          name: f.name,
          path: f.name,
          is_condo_root: false,
          pdf_count: 0,
        })),
        pdfs: [],
        totalPdfsInCurrentFolder: 0,
      });
    }

    const result = await getFolderContentsAndBreadcrumb(condoName, reqFolderId);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error || `A pasta do condomínio "${condoName}" não foi localizada no Google Drive central.`,
        currentFolder: null,
        breadcrumb: [],
        subfolders: [],
        pdfs: [],
      });
    }
    return res.json(result);
  } catch (err: any) {
    console.error('[AUDITORIA_DRIVE_FOLDERS_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Falha ao consultar pastas do Google Drive.',
      currentFolder: null,
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
    });
  }
});

// 1.2. Consultar pastas do Drive vinculadas por fase
app.get('/api/auditoria/condo/:condoId/folder-links', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const supabaseAdmin = getAdminSupabaseClient();

  let folderLinks: any[] = [];
  let dbError: any = null;

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId);

      if (error) {
        dbError = error;
        console.warn('[AUDITORIA_GET_FOLDER_LINKS_SUPABASE_FALLBACK]', error.message || error);
      } else {
        folderLinks = data || [];
      }
    } catch (err: any) {
      dbError = err;
      console.warn('[AUDITORIA_GET_FOLDER_LINKS_EXCEPTION]', err?.message || err);
    }
  }

  const fallbackFolders = readFallbackFolders().filter((f) => f.condo_id === condoId);

  // Mesclar: prioriza Supabase, completa com contingência local
  const existingCategories = new Set(folderLinks.map((f) => f.category));
  const mergedLinks = [
    ...folderLinks.map((f) => ({ ...f, persisted_definitively: true })),
    ...fallbackFolders
      .filter((f) => !existingCategories.has(f.category))
      .map((f) => ({ ...f, persisted_definitively: false })),
  ];

  const hasContingency = mergedLinks.some((f) => f.persisted_definitively === false);

  return res.json({
    ok: true,
    folder_links: mergedLinks,
    folders: mergedLinks,
    source: folderLinks.length > 0 ? (hasContingency ? 'hybrid_supabase_and_contingency' : 'supabase') : (hasContingency ? 'fallback_local' : 'empty'),
    persisted_definitively: !hasContingency && folderLinks.length > 0,
    has_contingency: hasContingency,
    contingency_count: fallbackFolders.length,
    supabase_count: folderLinks.length,
    supabase_error: dbError ? { code: dbError.code, message: dbError.message } : undefined,
  });
});

// 1.3. Vincular uma pasta do Google Drive a uma fase e sincronizar todos os seus PDFs
app.post('/api/auditoria/condo/:condoId/phases/:category/link-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const { drive_folder_id, drive_folder_name } = req.body || {};

  if (!drive_folder_id || typeof drive_folder_id !== 'string' || !drive_folder_id.trim()) {
    return res.status(400).json({ error: 'ID da pasta no Google Drive é obrigatório.' });
  }
  if (!drive_folder_name || typeof drive_folder_name !== 'string' || !drive_folder_name.trim()) {
    return res.status(400).json({ error: 'Nome da pasta no Google Drive é obrigatório.' });
  }

  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  // Validar autorização real de acesso da pasta no Google Drive pela conta de serviço
  const accessCheck = await verifyFolderAccessibleInDrive(drive_folder_id);
  if (!accessCheck.accessible) {
    return res.status(400).json({ error: accessCheck.error || 'A pasta selecionada não está acessível no Google Drive.' });
  }
  const resolvedFolderName = accessCheck.folder?.name || String(drive_folder_name).trim();

  const currentUserId = (req as any).user?.id || null;
  const nowIso = new Date().toISOString();
  const supabaseAdmin = getAdminSupabaseClient();

  const folderRecord: AuditoriaFasePastaRecord = {
    id: crypto.randomUUID(),
    condo_id: condoId,
    category: cleanCategory,
    drive_folder_id: String(drive_folder_id).trim(),
    drive_folder_name: resolvedFolderName,
    linked_by_user_id: currentUserId,
    last_synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // 1. Persistir o vínculo da pasta no Supabase (com contingência)
  let folderPersistedDefinitively = false;
  let folderPersistError: any = null;

  if (supabaseAdmin) {
    try {
      const { data: existingFolder, error: lookupErr } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();

      if (lookupErr) {
        folderPersistError = lookupErr;
        console.warn('[AUDITORIA_LINK_FOLDER_LOOKUP_ERROR] Erro ao consultar auditoria_fase_pastas no Supabase (contingência ativada):', lookupErr.message);
      }

      let folderRes;
      if (existingFolder?.id) {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .update({
            drive_folder_id: folderRecord.drive_folder_id,
            drive_folder_name: folderRecord.drive_folder_name,
            linked_by_user_id: currentUserId,
            last_synced_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', existingFolder.id)
          .select()
          .maybeSingle();
      } else if (!lookupErr) {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .insert(folderRecord)
          .select()
          .maybeSingle();
      }

      if (folderRes && !folderRes.error && folderRes.data) {
        folderPersistedDefinitively = true;
        deleteFallbackFolder(condoId, cleanCategory);
      } else {
        if (folderRes?.error) {
          folderPersistError = folderRes.error;
          console.warn('[AUDITORIA_LINK_FOLDER_PERSIST_ERROR] Falha ao persistir pasta no Supabase (salvando em contingência local):', folderRes.error.message);
        }
        saveFallbackFolder(folderRecord);
      }
    } catch (err: any) {
      folderPersistError = err;
      console.warn('[AUDITORIA_LINK_FOLDER_EXCEPTION] Exceção ao gravar pasta no Supabase (contingência ativada):', err?.message || err);
      saveFallbackFolder(folderRecord);
    }
  } else {
    console.warn('[AUDITORIA_LINK_FOLDER_NO_ADMIN] Cliente Supabase não configurado. Salvando em contingência local.');
    saveFallbackFolder(folderRecord);
  }

  // 2. Ler todos os PDFs contidos diretamente na pasta selecionada
  let pdfFiles: any[] = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderRecord.drive_folder_id);
  } catch (driveErr: any) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar arquivos PDF na pasta do Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  // 3. Registrar ou atualizar cada PDF de forma idempotente
  let importedCount = 0;
  let updatedCount = 0;
  const syncedDocs: any[] = [];

  for (const pdf of pdfFiles) {
    const docRecord: AuditoriaDocumentRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderRecord.drive_folder_id,
      origin_folder_name: folderRecord.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;

    if (supabaseAdmin) {
      try {
        const { data: existingDoc, error: docLookupErr } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (!docLookupErr) {
          if (existingDoc?.id) {
            const updateRes = await supabaseAdmin
              .from('auditoria_documentos')
              .update({
                drive_file_name: docRecord.drive_file_name,
                drive_file_size: docRecord.drive_file_size,
                drive_file_modified_at: docRecord.drive_file_modified_at,
                origin_folder_id: docRecord.origin_folder_id,
                origin_folder_name: docRecord.origin_folder_name,
                sync_status: 'synced',
                updated_at: nowIso,
              })
              .eq('id', existingDoc.id)
              .select()
              .maybeSingle();

            if (!updateRes.error && updateRes.data) {
              docSaved = true;
              updatedCount++;
              syncedDocs.push({ ...updateRes.data, persisted_definitively: true });
            } else if (updateRes.error) {
              console.warn('[AUDITORIA_SYNC_DOC_UPDATE_ERROR] Falha ao atualizar PDF no Supabase (contingência acionada):', updateRes.error.message);
            }
          } else {
            const insertRes = await supabaseAdmin
              .from('auditoria_documentos')
              .insert(docRecord)
              .select()
              .maybeSingle();

            if (!insertRes.error && insertRes.data) {
              docSaved = true;
              importedCount++;
              syncedDocs.push({ ...insertRes.data, persisted_definitively: true });
            } else if (insertRes.error) {
              console.warn('[AUDITORIA_SYNC_DOC_INSERT_ERROR] Falha ao inserir PDF no Supabase (contingência acionada):', insertRes.error.message);
            }
          }
        } else {
          console.warn('[AUDITORIA_SYNC_DOC_LOOKUP_ERROR] Falha ao consultar PDF existente no Supabase:', docLookupErr.message);
        }
      } catch (docErr: any) {
        console.warn('[AUDITORIA_SYNC_DOC_EXCEPTION] Exceção ao gravar PDF no Supabase:', docErr?.message || docErr);
      }
    }

    // Se não salvou no Supabase (restrição legada de unicidade ou tabela ausente), persiste em contingência local
    if (!docSaved) {
      const fallbackList = readFallbackDocuments();
      const existingFbIdx = fallbackList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );

      saveFallbackDocument(docRecord);
      if (existingFbIdx >= 0) {
        updatedCount++;
      } else {
        importedCount++;
      }
      syncedDocs.push({ ...docRecord, persisted_definitively: false });
    }
  }

  return res.json({
    ok: true,
    success: true,
    message: `Pasta "${folderRecord.drive_folder_name}" vinculada com sucesso. ${importedCount} novos documentos registrados, ${updatedCount} atualizados.`,
    folder_link: folderRecord,
    persisted_definitively: folderPersistedDefinitively,
    storage_mode: folderPersistedDefinitively ? 'supabase' : 'contingency_fallback',
    storage_diagnostics: folderPersistedDefinitively
      ? 'Vínculo persistido de forma definitiva no Supabase (tabela public.auditoria_fase_pastas).'
      : 'Vínculo registrado em contingência local temporária (tabela public.auditoria_fase_pastas pendente de criação no Supabase via migração SQL).',
    supabase_error: folderPersistError ? { code: folderPersistError.code, message: folderPersistError.message } : undefined,
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
    documents: syncedDocs,
  });
});

// 1.4. Sincronizar pasta já vinculada (identifica novos PDFs sem excluir arquivos existentes)
app.post('/api/auditoria/condo/:condoId/phases/:category/sync-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();
  const currentUserId = (req as any).user?.id || null;
  const nowIso = new Date().toISOString();

  // 1. Obter vínculo atual da pasta
  let folderLink: AuditoriaFasePastaRecord | null = null;
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data) {
        folderLink = data;
      } else if (error) {
        console.warn('[AUDITORIA_SYNC_FOLDER_LOOKUP_WARN]', error.message || error);
      }
    } catch (err: any) {
      console.warn('[AUDITORIA_SYNC_FOLDER_LOOKUP_EXCEPTION]', err?.message || err);
    }
  }

  if (!folderLink) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) folderLink = fbMatch;
  }

  if (!folderLink) {
    return res.status(404).json({
      ok: false,
      error: 'Nenhuma pasta do Google Drive vinculada a esta fase. Vincule uma pasta primeiro.',
    });
  }

  // 2. Consultar arquivos atuais na pasta do Drive
  let pdfFiles: any[] = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderLink.drive_folder_id);
  } catch (driveErr: any) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar pasta no Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  let importedCount = 0;
  let updatedCount = 0;

  for (const pdf of pdfFiles) {
    const docRecord: AuditoriaDocumentRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderLink.drive_folder_id,
      origin_folder_name: folderLink.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;
    if (supabaseAdmin) {
      try {
        const { data: existingDoc, error: docLookupErr } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (!docLookupErr) {
          if (existingDoc?.id) {
            const updateRes = await supabaseAdmin
              .from('auditoria_documentos')
              .update({
                drive_file_name: docRecord.drive_file_name,
                drive_file_size: docRecord.drive_file_size,
                drive_file_modified_at: docRecord.drive_file_modified_at,
                origin_folder_id: docRecord.origin_folder_id,
                origin_folder_name: docRecord.origin_folder_name,
                sync_status: 'synced',
                updated_at: nowIso,
              })
              .eq('id', existingDoc.id);

            if (!updateRes.error) {
              docSaved = true;
              updatedCount++;
            } else {
              console.warn('[AUDITORIA_SYNC_DOC_UPDATE_WARN]', updateRes.error.message);
            }
          } else {
            const insertRes = await supabaseAdmin
              .from('auditoria_documentos')
              .insert(docRecord)
              .select()
              .maybeSingle();
            if (!insertRes.error && insertRes.data) {
              docSaved = true;
              importedCount++;
            } else if (insertRes.error) {
              console.warn('[AUDITORIA_SYNC_DOC_INSERT_WARN]', insertRes.error.message);
            }
          }
        }
      } catch (err: any) {
        console.warn('[AUDITORIA_SYNC_DOC_EXCEPTION]', err?.message || err);
      }
    }

    if (!docSaved) {
      const fbList = readFallbackDocuments();
      const existsIdx = fbList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );
      saveFallbackDocument(docRecord);
      if (existsIdx >= 0) updatedCount++;
      else importedCount++;
    }
  }

  // Atualizar data da última sincronização
  folderLink.last_synced_at = nowIso;
  let folderSyncSavedInSupabase = false;
  if (supabaseAdmin) {
    try {
      const upRes = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .update({ last_synced_at: nowIso, updated_at: nowIso })
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
      if (!upRes.error) folderSyncSavedInSupabase = true;
    } catch (err: any) {
      console.warn('[AUDITORIA_SYNC_FOLDER_TIMESTAMP_EXCEPTION]', err?.message || err);
    }
  }
  saveFallbackFolder(folderLink);

  return res.json({
    ok: true,
    success: true,
    message: `Sincronização concluída. ${importedCount} novos PDFs encontrados, ${updatedCount} atualizados. Nenhum arquivo foi excluído.`,
    folder_link: folderLink,
    persisted_definitively: folderSyncSavedInSupabase,
    storage_mode: folderSyncSavedInSupabase ? 'supabase' : 'contingency_fallback',
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
  });
});

// 1.5. Desvincular pasta de uma fase (remove SOMENTE vínculos de documentos oriundos desta pasta no CRM)
app.delete('/api/auditoria/condo/:condoId/phases/:category/unlink-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();

  // 1. Localizar vínculo da pasta
  let targetFolderId: string | null = null;
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('drive_folder_id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data?.drive_folder_id) targetFolderId = data.drive_folder_id;
    } catch {}
  }

  if (!targetFolderId) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) targetFolderId = fbMatch.drive_folder_id;
  }

  // 2. Remover vínculo da pasta
  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('auditoria_fase_pastas')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
    } catch {}
  }
  deleteFallbackFolder(condoId, cleanCategory);

  // 3. Remover do CRM apenas os documentos cuja origem foi esta pasta
  let removedFromDbCount = 0;
  if (targetFolderId && supabaseAdmin) {
    try {
      const delRes = await supabaseAdmin
        .from('auditoria_documentos')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .eq('origin_folder_id', targetFolderId);
      if (!delRes.error) {
        removedFromDbCount = 1;
      }
    } catch {}
  }

  let removedFallbackCount = 0;
  if (targetFolderId) {
    removedFallbackCount = deleteFallbackDocumentsByOriginFolder(condoId, cleanCategory, targetFolderId);
  }

  return res.json({
    ok: true,
    success: true,
    drive_file_preserved: true,
    removed_documents_count: removedFromDbCount + removedFallbackCount,
    message: 'Pasta desvinculada com sucesso da fase. Os vínculos correspondentes foram removidos do CRM. Os arquivos originais no Google Drive permanecem intactos.',
  });
});


// 2. Consultar documentos vinculados para o condomínio (suporte a múltiplos documentos por categoria)
app.get('/api/auditoria/condo/:condoId/documents', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;

  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
  }

  // 1. Consulta à fonte oficial de dados: Supabase
  let supabaseDocs: any[] = [];
  let dbError: any = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('auditoria_documentos')
      .select('*')
      .eq('condo_id', condoId)
      .order('created_at', { ascending: false });

    if (error) {
      dbError = error;
    } else {
      supabaseDocs = data || [];
    }
  } catch (err: any) {
    dbError = err;
  }

  const fallbackList = readFallbackDocuments();
  const condoFallbackDocs = fallbackList.filter((d) => d.condo_id === condoId);

  // Se o Supabase respondeu com sucesso:
  if (!dbError) {
    // Mesclar documentos do Supabase com os locais (se houver vínculos adicionais salvos em contingência)
    const existingFileIds = new Set(supabaseDocs.map((d) => d.drive_file_id));
    const mergedDocs = [
      ...supabaseDocs.map((d) => ({ ...d, persisted_definitively: true })),
      ...condoFallbackDocs
        .filter((d) => !existingFileIds.has(d.drive_file_id))
        .map((d) => ({ ...d, persisted_definitively: false })),
    ];

    const hasContingency = mergedDocs.some((d) => d.persisted_definitively === false);

    return res.json({
      ok: true,
      documents: mergedDocs,
      source: hasContingency ? 'hybrid_supabase_and_contingency' : 'supabase',
      persisted_definitively: !hasContingency,
      warning: hasContingency
        ? 'Alguns documentos adicionais estão em contingência local temporária aguardando a aplicação da migração SQL definitiva no Supabase.'
        : undefined,
    });
  }

  // Se o Supabase falhou (tabela ausente ou erro temporário de banco):
  console.warn('[AUDITORIA_GET_DOCS_DB_FALLBACK]', dbError?.message || dbError);
  return res.json({
    ok: true,
    documents: condoFallbackDocs.map((d) => ({ ...d, persisted_definitively: false })),
    source: 'fallback_local',
    persisted_definitively: false,
    warning: 'Banco Supabase indisponível ou tabela ainda não migrada. Exibindo acervo em contingência local temporária.',
  });
});

function resolveCanonicalCategoryId(raw?: string | null): string | null {
  if (!raw) return null;
  const norm = String(raw).trim().toLowerCase();
  if (norm === 'convencao' || norm === 'convencao_condominio') return 'convencao';
  if (norm === 'regimento_interno' || norm === 'regimento') return 'regimento_interno';
  if (norm === 'atas_assembleias' || norm === 'ata_assembleia' || norm === 'atas') return 'atas_assembleias';
  if (['pastas_prestacao_contas', 'prestacao_contas', 'balancetes', 'pastas_contas', 'pasta_prestacao_contas'].includes(norm)) return 'pastas_prestacao_contas';
  if (['extratos_bancarios', 'extratos', 'extrato_bancario', 'banco'].includes(norm)) return 'extratos_bancarios';
  if (['previsao_orcamentaria', 'orcamento', 'previsao_orcamento'].includes(norm)) return 'previsao_orcamentaria';
  if (['contratos_fornecedores', 'contratos', 'contrato_fornecedores'].includes(norm)) return 'contratos_fornecedores';
  if (['inadimplencia', 'inadimplentes', 'inadimplente', 'cobranca'].includes(norm)) return 'inadimplencia';
  return null;
}

// 2.1. Resumo em lote das etapas concluídas de auditoria para todos os condomínios
app.get('/api/auditoria/all-summary', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const supabaseAdmin = getAdminSupabaseClient();
  const summary: Record<string, string[]> = {};

  const addCategory = (condoId: string, categoryRaw: string) => {
    const canonicalId = resolveCanonicalCategoryId(categoryRaw);
    if (!canonicalId || !condoId) return;
    if (!summary[condoId]) summary[condoId] = [];
    if (!summary[condoId].includes(canonicalId)) {
      summary[condoId].push(canonicalId);
    }
  };

  if (supabaseAdmin) {
    try {
      const { data: docs } = await supabaseAdmin.from('auditoria_documentos').select('condo_id, category');
      (docs || []).forEach((d: any) => addCategory(d.condo_id, d.category));
    } catch (e) {}
  }

  // Mesclar com documentos em contingência local
  try {
    const fallbackDocs = readFallbackDocuments();
    fallbackDocs.forEach((d) => addCategory(d.condo_id, d.category));
  } catch (e) {}

  return res.json({
    ok: true,
    summary,
  });
});

// 3. Vincular ou atualizar documento de uma categoria (suporte a múltiplos documentos por categoria)
app.post('/api/auditoria/condo/:condoId/documents', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId } = req.params;

  const {
    category = 'convencao',
    drive_file_id,
    drive_file_name,
    drive_file_size,
    drive_file_modified_at,
  } = req.body || {};

  if (!drive_file_id || typeof drive_file_id !== 'string' || !drive_file_id.trim()) {
    return res.status(400).json({ error: 'ID do arquivo no Google Drive é obrigatório.' });
  }
  if (!drive_file_name || typeof drive_file_name !== 'string' || !drive_file_name.trim()) {
    return res.status(400).json({ error: 'Nome do arquivo no Google Drive é obrigatório.' });
  }

  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
  }

  const currentUserId = (req as any).user?.id || null;
  const nowIso = new Date().toISOString();

  const docRecord = {
    condo_id: condoId,
    category: cleanCategory,
    drive_file_id: String(drive_file_id).trim(),
    drive_file_name: String(drive_file_name).trim(),
    drive_file_size: drive_file_size ? Number(drive_file_size) : null,
    drive_file_modified_at: drive_file_modified_at || null,
    linked_by_user_id: currentUserId,
    origin_folder_id: req.body?.origin_folder_id || null,
    origin_folder_name: req.body?.origin_folder_name || null,
    sync_status: req.body?.sync_status || 'synced',
    updated_at: nowIso,
  };

  const fallbackDoc: AuditoriaDocumentRecord = {
    id: crypto.randomUUID(),
    ...docRecord,
    created_at: nowIso,
  };

  try {
    // 1. Tentar gravação no Supabase: verifica se o arquivo exato já existe para este condomínio e categoria
    const { data: existingDoc, error: checkErr } = await supabaseAdmin
      .from('auditoria_documentos')
      .select('id')
      .eq('condo_id', condoId)
      .eq('category', cleanCategory)
      .eq('drive_file_id', docRecord.drive_file_id)
      .maybeSingle();

    if (!checkErr) {
      let writeRes;
      if (existingDoc?.id) {
        writeRes = await supabaseAdmin
          .from('auditoria_documentos')
          .update(docRecord)
          .eq('id', existingDoc.id)
          .select()
          .maybeSingle();
      } else {
        writeRes = await supabaseAdmin
          .from('auditoria_documentos')
          .insert(docRecord)
          .select()
          .maybeSingle();
      }

      if (!writeRes.error && writeRes.data) {
        deleteFallbackDocument(condoId, cleanCategory, docRecord.drive_file_id);
        return res.json({
          ok: true,
          success: true,
          document: writeRes.data,
          persisted_definitively: true,
          storage_mode: 'supabase',
          message: 'Documento vinculado com sucesso no Supabase.',
        });
      }

      // Se falhou ao gravar no Supabase, inspecionar erro com resiliência:
      const errCode = String(writeRes.error?.code || '');
      const errMsg = String(writeRes.error?.message || '');

      // Caso 1: Restrição única legada no Supabase (uq_auditoria_documentos_condo_category ainda restringe a 1 doc por fase)
      if (isUniqueConstraintViolation(writeRes.error)) {
        console.warn(
          `[AUDITORIA_POST_DOCS_LEGACY_CONSTRAINT] Restrição única legada (condo_id, category) ativa no Supabase para ${condoId}/${cleanCategory}. Registrando em contingência local para garantir suporte a múltiplos arquivos:`,
          errMsg
        );
        saveFallbackDocument(fallbackDoc);
        return res.json({
          ok: true,
          success: true,
          document: fallbackDoc,
          persisted_definitively: false,
          storage_mode: 'fallback_local',
          warning:
            'O banco Supabase remoto ainda possui a restrição legada de 1 documento por fase (uq_auditoria_documentos_condo_category). O vínculo foi registrado com sucesso em contingência local temporária para suportar múltiplos documentos até a aplicação da migração SQL definitiva.',
          message: 'Documento vinculado em contingência local (migração SQL pendente no Supabase).',
        });
      }

      // Caso 2: Coluna divergente/ausente no Supabase (ex: drive_file_size / drive_file_modified_at)
      if (errCode === '42703' || errMsg.toLowerCase().includes('column')) {
        console.warn('[AUDITORIA_POST_DOCS_SCHEMA_MISMATCH] Tentando inserção simplificada no Supabase...', errMsg);
        const simpleRecord = {
          condo_id: condoId,
          category: cleanCategory,
          drive_file_id: docRecord.drive_file_id,
          drive_file_name: docRecord.drive_file_name,
        };
        const retryRes = await supabaseAdmin
          .from('auditoria_documentos')
          .insert(simpleRecord)
          .select()
          .maybeSingle();

        if (!retryRes.error && retryRes.data) {
          deleteFallbackDocument(condoId, cleanCategory, docRecord.drive_file_id);
          return res.json({
            ok: true,
            success: true,
            document: retryRes.data,
            persisted_definitively: true,
            storage_mode: 'supabase',
            warning: 'Documento persistido com esquema simplificado no Supabase.',
            message: 'Documento vinculado com sucesso no Supabase.',
          });
        }
      }

      // Caso 3: Qualquer outro erro de banco (ex: timeout, política, restrição) -> contingência local segura
      console.warn('[AUDITORIA_POST_DOCS_DB_CONTINGENCY] Registrando em contingência local após resposta do Supabase:', errMsg || writeRes.error);
      saveFallbackDocument(fallbackDoc);
      return res.json({
        ok: true,
        success: true,
        document: fallbackDoc,
        persisted_definitively: false,
        storage_mode: 'fallback_local',
        warning:
          'Não foi possível persistir no Supabase no momento (' +
          (errMsg || 'erro de banco') +
          '). O documento foi registrado com sucesso em contingência local.',
        message: 'Documento vinculado com sucesso em contingência local.',
      });
    }

    // Se checkErr ocorreu (ex: tabela auditoria_documentos ausente no Supabase)
    console.warn('[AUDITORIA_POST_DOCS_CHECK_CONTINGENCY] Registrando em contingência local:', checkErr?.message || checkErr);
    saveFallbackDocument(fallbackDoc);
    return res.json({
      ok: true,
      success: true,
      document: fallbackDoc,
      persisted_definitively: false,
      storage_mode: 'fallback_local',
      warning:
        'A tabela public.auditoria_documentos ainda não foi criada ou migrada no Supabase. O vínculo foi registrado em contingência local temporária.',
      message: 'Vínculo registrado em contingência local (migração SQL pendente no Supabase).',
    });
  } catch (unexpectedErr: any) {
    console.warn('[AUDITORIA_POST_DOCS_EXCEPTION] Exceção tratada com contingência local:', unexpectedErr?.message || unexpectedErr);
    saveFallbackDocument(fallbackDoc);
    return res.json({
      ok: true,
      success: true,
      document: fallbackDoc,
      persisted_definitively: false,
      storage_mode: 'fallback_local',
      warning: 'Operação salva em contingência local após exceção temporária: ' + (unexpectedErr?.message || unexpectedErr),
      message: 'Documento vinculado em contingência local.',
    });
  }
});

// 4. Desvincular documento específico (preserva os demais documentos da mesma categoria e NUNCA remove do Google Drive)
app.delete('/api/auditoria/condo/:condoId/documents/:category', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const driveFileId = (req.query.driveFileId || req.query.drive_file_id || '') as string;
  const documentId = (req.query.documentId || req.query.id || '') as string;

  const cleanCategory = String(category || '').trim().toLowerCase();
  if (!cleanCategory) {
    return res.status(400).json({ error: 'Categoria documental obrigatória.' });
  }

  if (!driveFileId && !documentId) {
    return res.status(400).json({
      error: 'Para desvincular um documento específico com segurança e preservar múltiplos arquivos na mesma categoria, informe driveFileId ou documentId como parâmetro.',
    });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
  }

  let delBuilder = supabaseAdmin
    .from('auditoria_documentos')
    .delete()
    .eq('condo_id', condoId)
    .eq('category', cleanCategory);

  if (documentId) {
    delBuilder = delBuilder.eq('id', documentId);
  } else {
    delBuilder = delBuilder.eq('drive_file_id', driveFileId);
  }

  const { error } = await delBuilder;

  if (!error) {
    deleteFallbackDocument(condoId, cleanCategory, driveFileId || null, documentId || null);
    return res.json({
      ok: true,
      success: true,
      persisted_definitively: true,
      storage_mode: 'supabase',
      drive_file_preserved: true,
      message: 'Documento desvinculado com sucesso no Supabase. O arquivo original no Google Drive permanece intacto.',
    });
  }

  if (isTableMissingError(error)) {
    const deleted = deleteFallbackDocument(condoId, cleanCategory, driveFileId || null, documentId || null);
    return res.json({
      ok: true,
      success: true,
      persisted_definitively: false,
      storage_mode: 'fallback_local',
      drive_file_preserved: true,
      message: deleted
        ? 'Vínculo removido da contingência local. O arquivo original no Google Drive permanece intacto.'
        : 'Nenhum documento correspondente encontrado para remover.',
    });
  }

  console.error('[AUDITORIA_DELETE_DOCS_DB_ERROR]', error);
  return res.status(500).json({
    ok: false,
    error: 'Falha ao desvincular documento no Supabase: ' + (error?.message || error),
  });
});

// 5. Visualizar/Stream seguro de arquivo PDF autenticado com controle de isolamento
app.get('/api/auditoria/documents/file/:fileId/stream', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { fileId } = req.params;
  const user = (req as any).user;
  const profile = (req as any).userProfile;
  const isAdmin = (req as any).isAdmin;

  if (!fileId) {
    return res.status(400).json({ error: 'ID do arquivo não informado.' });
  }

  // Validação estrita de conta ativa e não arquivada
  if (!profile || profile.is_active !== true || profile.deleted_at) {
    return res.status(403).json({ error: 'Acesso restrito: usuário inativo ou arquivado no sistema.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
  }

  // 1. Identificar autoritativamente no banco de dados o condomínio deste arquivo
  let trueCondoId: string | null = null;
  const { data: docRecord } = await supabaseAdmin
    .from('auditoria_documentos')
    .select('condo_id, drive_file_id')
    .eq('drive_file_id', fileId)
    .limit(1)
    .maybeSingle();

  if (docRecord?.condo_id) {
    trueCondoId = docRecord.condo_id;
  } else {
    // Em caso de contingência temporária, consultar armazenamento local
    const fallbackDocs = readFallbackDocuments();
    const fallbackMatch = fallbackDocs.find((d: any) => d.drive_file_id === fileId);
    if (fallbackMatch?.condo_id) {
      trueCondoId = fallbackMatch.condo_id;
    }
  }

  if (!trueCondoId) {
    return res.status(404).json({
      error: 'Documento não localizado no acervo da auditoria. O arquivo pode ter sido desvinculado ou não pertencer a nenhum condomínio registrado.',
    });
  }

  // 2. Proteção contra falsificação de contexto: se o cliente enviou condoId na query, deve ser idêntico ao registrado no banco
  const clientCondoId = req.query.condoId as string | undefined;
  if (clientCondoId && clientCondoId.trim() !== trueCondoId) {
    return res.status(403).json({
      error: 'Tentativa de violação de isolamento: o parâmetro condoId informado diverge do condomínio vinculado ao arquivo no acervo.',
    });
  }

  // 3. Se não for administrador, verificar isolamento comercial: o usuário deve ser o responsável pelo condomínio
  if (!isAdmin) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, responsible_user_id, deleted_at')
      .eq('id', trueCondoId)
      .maybeSingle();

    if (!lead || lead.deleted_at || lead.responsible_user_id !== user.id) {
      return res.status(403).json({
        error: 'Acesso negado: você não tem permissão para visualizar documentos deste condomínio.',
      });
    }
  }

  try {
    const driveRes = await getDriveFileStream(fileId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="documento.pdf"');
    // Converter web stream para buffer/stream do Node
    const arrayBuffer = await driveRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.error('[AUDITORIA_STREAM_ERROR]', err);
    return res.status(500).json({ error: 'Falha ao carregar visualização do documento: ' + (err?.message || err) });
  }
});

app.post('/api/auditoria/condo/:condoId/documents/:category/analyze', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category || '').trim().toLowerCase();
  const targetDriveFileId = req.body?.drive_file_id ? String(req.body.drive_file_id).trim() : null;
  const targetDocId = req.body?.document_id ? String(req.body.document_id).trim() : null;

  const supabaseAdmin = getAdminSupabaseClient();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
  }

  const leadData = (req as any).condoLead;

  try {
    // Localizar o documento vinculado (específico ou o mais recente)
    let docRecord: AuditoriaDocumentRecord | null = null;
    let query = supabaseAdmin
      .from('auditoria_documentos')
      .select('*')
      .eq('condo_id', condoId)
      .eq('category', cleanCategory);

    if (targetDocId) {
      query = query.eq('id', targetDocId);
    } else if (targetDriveFileId) {
      query = query.eq('drive_file_id', targetDriveFileId);
    } else {
      query = query.order('created_at', { ascending: false }).limit(1);
    }

    const { data: dbDocs, error: dbErr } = await query;

    if (!dbErr && dbDocs && dbDocs.length > 0) {
      docRecord = dbDocs[0];
    } else if (isTableMissingError(dbErr)) {
      const fallbackList = readFallbackDocuments();
      docRecord = fallbackList.find((d) => {
        if (d.condo_id !== condoId || d.category !== cleanCategory) return false;
        if (targetDocId && d.id !== targetDocId) return false;
        if (targetDriveFileId && d.drive_file_id !== targetDriveFileId) return false;
        return true;
      }) || null;
    } else if (dbErr) {
      return res.status(500).json({ error: 'Erro ao consultar documento no banco de dados: ' + dbErr.message });
    }

    if (!docRecord) {
      return res.status(404).json({
        error: `Nenhum documento vinculado para a categoria "${cleanCategory}" neste condomínio. Vincule um documento antes de solicitar a análise.`,
      });
    }

    // Recuperar o PDF diretamente do Google Drive central via Service Account
    let driveRes: Response;
    try {
      driveRes = await getDriveFileStream(docRecord.drive_file_id);
    } catch (driveErr: any) {
      console.error('[AUDITORIA_ANALYZE_DRIVE_FETCH_ERROR]', driveErr);
      return res.status(502).json({
        error: 'Não foi possível recuperar o arquivo do Google Drive central: ' + (driveErr?.message || driveErr),
      });
    }

    const arrayBuffer = await driveRes.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(400).json({
        error: 'O arquivo PDF recuperado do Google Drive está vazio ou corrompido.',
      });
    }

    // Executar análise com o modelo de IA
    const analysis = await analyzeAuditoriaDocument({
      pdfBuffer,
      fileName: docRecord.drive_file_name,
      category: cleanCategory,
      condoName: leadData.name,
    });

    return res.json({
      ok: true,
      success: true,
      condo_id: condoId,
      condo_name: leadData.name,
      category: cleanCategory,
      file_id: docRecord.drive_file_id,
      file_name: docRecord.drive_file_name,
      document_id: docRecord.id,
      analyzed_at: new Date().toISOString(),
      analysis,
    });
  } catch (err: any) {
    console.error('[AUDITORIA_DOCUMENT_ANALYZE_ENDPOINT_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'Erro durante o processamento da análise com IA: ' + (err?.message || err),
    });
  }
});

// ============================================================================
// 1.5. ROTAS DE GERENCIAMENTO E EXECUÇÃO DE MEMÓRIAS DA AUDITORIA
// (Registradas através do módulo canônico compartilhado com paridade estrita aos testes)
// ============================================================================
registerAuditoriaMemoryRoutes(app, {
  requireAccess: requireAuditoriaAccess('can_access_auditoria'),
  requireManageAccess: requireAuditoriaAccess('can_manage_auditoria'),
  getSupabaseAdmin: getAdminSupabaseClient,
  getDriveFileStream,
  executeSingleExtraction: executeMemoryExtraction,
  executeBatchExtraction: executeBatchMemoryExtraction,
  saveFallbackMemory,
  readFallbackMemories,
  deleteFallbackMemory,
  isTableMissingError,
});

app.post('/api/google/oauth/start', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || loadedEnv.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || loadedEnv.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET || loadedEnv.GOOGLE_OAUTH_STATE_SECRET;

  if (!clientId || !redirectUri || !stateSecret) {
    return res.status(500).json({
      error: 'Configuração OAuth incompleta.',
      message: 'As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI e GOOGLE_OAUTH_STATE_SECRET são obrigatórias.',
    });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  if (!userId) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Usuário não autenticado.',
    });
  }

  const state = createOAuthState(userId, stateSecret);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return res.status(200).json({
    success: true,
    auth_url: authUrl.toString(),
  });
});

app.get('/api/google/oauth/start', (req, res) => {
  return res.status(401).json({
    error: 'unauthorized',
    message: 'Esta rota foi descontinuada. O fluxo de autorização exige autenticação. Utilize POST /api/google/oauth/start com Authorization: Bearer <token>.',
  });
});

app.get('/api/google/oauth/callback', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || loadedEnv.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || loadedEnv.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || loadedEnv.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET || loadedEnv.GOOGLE_OAUTH_STATE_SECRET;

  if (!clientId || !clientSecret || !redirectUri || !stateSecret) {
    return res.status(500).json({
      error: 'Configuração OAuth incompleta.',
      message: 'As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI e GOOGLE_OAUTH_STATE_SECRET são obrigatórias.',
    });
  }

  const { code, state, error, error_description } = req.query;

  if (error) {
    const errorMsg = typeof error === 'string' ? error : 'oauth_error';
    const message = typeof error_description === 'string' ? error_description : 'Autorização recusada ou cancelada pelo usuário.';
    return res.status(400).json({
      error: errorMsg,
      message,
    });
  }

  if (!state || typeof state !== 'string' || !state.trim()) {
    return res.status(400).json({
      error: 'missing_oauth_state',
    });
  }

  const stateValidation = verifyOAuthState(state, stateSecret);
  if (!stateValidation.valid) {
    return res.status(400).json({
      error: stateValidation.error || 'invalid_oauth_state',
    });
  }

  // user_id recuperado de forma autenticada e segura a partir da assinatura do state
  const authenticatedUserId = stateValidation.userId;
  if (!authenticatedUserId) {
    return res.status(400).json({
      error: 'invalid_oauth_state',
    });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'missing_authorization_code',
    });
  }

  try {
    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    const tokenData: any = await tokenResponse.json().catch(() => null);

    if (!tokenResponse.ok || !tokenData) {
      const googleError = tokenData?.error || 'token_exchange_failed';
      const googleErrorDesc = tokenData?.error_description || 'Falha ao trocar código de autorização por tokens junto ao Google.';
      const statusCode = tokenResponse.status >= 400 && tokenResponse.status < 600 ? tokenResponse.status : 500;
      return res.status(statusCode).json({
        error: googleError,
        message: googleErrorDesc,
      });
    }

    // Consultar API de userinfo do Google para obter o e-mail da conta autorizada
    let googleEmail: string | null = null;
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });
      if (userInfoResponse.ok) {
        const userInfo: any = await userInfoResponse.json().catch(() => null);
        if (userInfo && typeof userInfo.email === 'string') {
          googleEmail = userInfo.email.trim();
        }
      }
    } catch {
      // Ignora erro de rede/permissão de userinfo para não travar a autorização
    }

    const adminSupabase = getAdminSupabaseClient();
    if (!adminSupabase) {
      console.error('[GOOGLE_OAUTH] SUPABASE_SERVICE_ROLE_KEY ou VITE_SUPABASE_URL inválidos ou não configurados no servidor.');
      return res.status(500).json({
        success: false,
        error: 'calendar_connection_persist_failed',
      });
    }

    // Regra: se o novo callback não trouxer refresh_token, preservar o refresh_token já existente
    let refreshTokenToPersist = tokenData.refresh_token || null;
    if (!refreshTokenToPersist) {
      try {
        console.log('[GOOGLE_OAUTH] Consultando conexão anterior para preservar refresh_token se existente...');
        const { data: existingConn, error: existingFetchErr } = await adminSupabase
          .from('google_calendar_connections')
          .select('refresh_token')
          .eq('user_id', authenticatedUserId)
          .maybeSingle();

        if (existingFetchErr) {
          console.warn('[GOOGLE_OAUTH] Aviso na consulta de conexão existente:', {
            error_message: existingFetchErr.message,
            error_details: existingFetchErr.details,
            error_hint: existingFetchErr.hint,
            error_code: existingFetchErr.code,
          });
        } else if (existingConn?.refresh_token) {
          refreshTokenToPersist = existingConn.refresh_token;
          console.log('[GOOGLE_OAUTH] refresh_token anterior recuperado com sucesso.');
        }
      } catch (checkErr: any) {
        console.error('[GOOGLE_OAUTH] Exceção ao consultar refresh_token prévio:', {
          name: checkErr?.name,
          message: checkErr?.message,
          code: checkErr?.code,
          cause_message: checkErr?.cause?.message,
          cause_code: checkErr?.cause?.code,
        });
      }
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

    const connectionPayload = {
      user_id: authenticatedUserId,
      google_email: googleEmail,
      access_token: tokenData.access_token,
      refresh_token: refreshTokenToPersist,
      token_type: tokenData.token_type || null,
      scope: tokenData.scope || null,
      expires_at: expiresAt,
    };

    console.log('[GOOGLE_OAUTH] Tentando upsert em google_calendar_connections para user_id:', authenticatedUserId);

    try {
      const { error: upsertError } = await adminSupabase
        .from('google_calendar_connections')
        .upsert(connectionPayload, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('[GOOGLE_OAUTH] Falha no Supabase ao persistir conexão:', {
          stage: 'upsert_google_calendar_connections',
          message: upsertError.message,
          details: upsertError.details,
          hint: upsertError.hint,
          code: upsertError.code,
        });
        return res.status(500).json({
          success: false,
          error: 'calendar_connection_persist_failed',
        });
      }
    } catch (upsertException: any) {
      console.error('[GOOGLE_OAUTH] Falha ao persistir conexão no Supabase (exceção HTTP/rede):', {
        stage: 'upsert_google_calendar_connections_fetch',
        name: upsertException?.name,
        message: upsertException?.message,
        code: upsertException?.code,
        cause_name: upsertException?.cause?.name,
        cause_message: upsertException?.cause?.message,
        cause_code: upsertException?.cause?.code,
      });
      return res.status(500).json({
        success: false,
        error: 'calendar_connection_persist_failed',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Google Calendar conectado com sucesso',
      connected: true,
      google_email: googleEmail,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'token_exchange_error',
      message: 'Erro interno ao comunicar com o servidor de autenticação do Google.',
    });
  }
});

// Endpoint autenticado para listar os próximos eventos da agenda do usuário conectado
app.get('/api/google/calendar/events', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Usuário não autenticado.',
    });
  }

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch (err: any) {
    if (err instanceof GoogleCalendarAuthError) {
      if (err.code === 'google_calendar_not_connected') {
        return res.status(404).json({
          success: false,
          error: 'google_calendar_not_connected',
          message: 'Usuário não possui conta do Google Calendar conectada.',
        });
      }
      if (err.code === 'google_calendar_reauthorization_required') {
        return res.status(401).json({
          success: false,
          error: 'google_calendar_reauthorization_required',
          message: 'Reautorização do Google Calendar necessária.',
        });
      }
    }

    console.error('[GOOGLE_CALENDAR_EVENTS] Erro ao obter access_token para o usuário:', {
      user_id: userId,
      error_code: err?.code,
    });
    return res.status(500).json({
      success: false,
      error: 'google_calendar_events_fetch_failed',
      message: 'Falha ao obter credenciais válidas para o Google Calendar.',
    });
  }

  try {
    const { count, events } = await fetchUpcomingGoogleCalendarEvents(accessToken);
    return res.status(200).json({
      success: true,
      count,
      events,
    });
  } catch (err: any) {
    if (err instanceof GoogleCalendarAuthError) {
      if (err.code === 'google_calendar_reauthorization_required') {
        return res.status(401).json({
          success: false,
          error: 'google_calendar_reauthorization_required',
          message: 'Sessão do Google Calendar expirada. Reautorização necessária.',
        });
      }
      return res.status(err.statusCode || 500).json({
        success: false,
        error: err.code || 'google_calendar_events_fetch_failed',
        message: err.message || 'Falha ao buscar eventos do Google Calendar.',
      });
    }

    console.error('[GOOGLE_CALENDAR_EVENTS] Erro ao buscar eventos:', {
      user_id: userId,
      error_name: err?.name,
    });
    return res.status(500).json({
      success: false,
      error: 'google_calendar_events_fetch_failed',
      message: 'Falha ao comunicar com o Google Calendar.',
    });
  }
});

// Endpoint canônico unificado para todas as mutações no Google Calendar (sync | delete)
app.post('/api/google/calendar/interaction', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  const { interactionId, operation } = req.body || {};
  if (!interactionId) {
    return res.status(400).json({
      success: false,
      error: 'missing_interaction_id',
      message: 'interactionId obrigatório no corpo da requisição.',
    });
  }

  if (operation !== 'sync' && operation !== 'delete') {
    return res.status(400).json({
      success: false,
      error: 'invalid_operation',
      message: 'Operação inválida. Permitido somente "sync" ou "delete".',
    });
  }

  if (operation === 'delete') {
    try {
      const deleteResult = await deleteGoogleCalendarEventForInteraction(interactionId);
      if (!deleteResult.success) {
        return res.status(deleteResult.status || 400).json({
          ...deleteResult,
          success: false,
        });
      }
      return res.status(200).json({
        ...deleteResult,
        success: true,
      });
    } catch (err: any) {
      console.error('[INTERACTION_CALENDAR_ROUTE] Erro ao excluir evento no Google Calendar:', {
        interaction_id: interactionId,
        error: err?.message,
      });
      return res.status(500).json({
        success: false,
        error: err?.code || 'delete_exception',
        message: err?.message || 'Falha na exclusão do evento.',
      });
    }
  }

  // operation === 'sync'
  try {
    const syncResult = await syncGoogleCalendarInteraction(interactionId);
    if (syncResult && (syncResult.reason === 'interaction_not_found' || syncResult.status === 404)) {
      return res.status(404).json({
        success: false,
        error: 'interaction_not_found',
      });
    }
    return res.status(200).json({
      success: true,
      ...syncResult,
    });
  } catch (err: any) {
    console.error('[INTERACTION_CALENDAR_ROUTE] Erro ao sincronizar follow-up com Google Calendar:', {
      interaction_id: interactionId,
      error: err?.message,
    });
    return res.status(200).json({
      success: true,
      synced: false,
      reason: err?.code || 'sync_exception',
      message: err?.message || 'Falha na sincronização, mas interação preservada.',
    });
  }
});

// Endpoint legado para compatibilidade: sincronizar / criar / atualizar evento no Google Calendar
app.post('/api/google/calendar/sync-interaction', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  const { interactionId } = req.body || {};
  if (!interactionId) {
    return res.status(400).json({
      success: false,
      error: 'missing_interaction_id',
      message: 'interactionId obrigatório no corpo da requisição.',
    });
  }

  try {
    const syncResult = await syncGoogleCalendarInteraction(interactionId);
    if (syncResult && (syncResult.reason === 'interaction_not_found' || syncResult.status === 404)) {
      return res.status(404).json({
        success: false,
        error: 'interaction_not_found',
      });
    }
    return res.status(200).json({
      success: true,
      ...syncResult,
    });
  } catch (err: any) {
    console.error('[SYNC_INTERACTION_ROUTE] Erro ao sincronizar follow-up com Google Calendar:', {
      interaction_id: interactionId,
      error: err?.message,
    });
    return res.status(200).json({
      success: true,
      synced: false,
      reason: err?.code || 'sync_exception',
      message: err?.message || 'Falha na sincronização, mas interação preservada.',
    });
  }
});

// Endpoint legado para compatibilidade: atualizar evento no Google Calendar
app.post('/api/google/calendar/update-interaction', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  const { interactionId } = req.body || {};
  if (!interactionId) {
    return res.status(400).json({
      success: false,
      error: 'missing_interaction_id',
      message: 'interactionId obrigatório no corpo da requisição.',
    });
  }

  try {
    const updateResult = await updateGoogleCalendarEventForInteraction(interactionId);
    if (updateResult && (updateResult.reason === 'interaction_not_found' || updateResult.status === 404)) {
      return res.status(404).json({
        success: false,
        error: 'interaction_not_found',
      });
    }
    return res.status(200).json({
      success: true,
      ...updateResult,
    });
  } catch (err: any) {
    console.error('[UPDATE_INTERACTION_ROUTE] Erro ao atualizar follow-up no Google Calendar:', {
      interaction_id: interactionId,
      error: err?.message,
    });
    return res.status(200).json({
      success: true,
      synced: false,
      reason: err?.code || 'update_exception',
      message: err?.message || 'Falha na atualização, mas interação preservada.',
    });
  }
});

// Endpoint autenticado para excluir evento no Google Calendar
app.post('/api/google/calendar/delete-interaction-event', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
    });
  }

  const scopedSupabase = getScopedSupabaseClient(token);
  let userId: string | null = null;
  try {
    const { data: userData, error: userError } = await scopedSupabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      });
    }
    userId = userData.user.id;
  } catch {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Falha ao validar sessão do usuário.',
    });
  }

  const { interactionId } = req.body || {};
  if (!interactionId) {
    return res.status(400).json({
      success: false,
      error: 'missing_interaction_id',
      message: 'interactionId obrigatório no corpo da requisição.',
    });
  }

  try {
    const deleteResult = await deleteGoogleCalendarEventForInteraction(interactionId);
    if (deleteResult && (deleteResult.reason === 'interaction_not_found' || deleteResult.status === 404)) {
      return res.status(404).json({
        success: false,
        error: 'interaction_not_found',
      });
    }
    if (!deleteResult.success) {
      return res.status(deleteResult.status || 500).json({
        ...deleteResult,
        success: false,
      });
    }
    return res.status(200).json({
      ...deleteResult,
      success: true,
    });
  } catch (err: any) {
    console.error('[DELETE_INTERACTION_ROUTE] Erro ao excluir evento no Google Calendar:', {
      interaction_id: interactionId,
      error: err?.message,
    });
    return res.status(500).json({
      success: false,
      error: err?.code || 'delete_exception',
      message: err?.message || 'Falha na exclusão do evento.',
    });
  }
});

app.get('/api/condo/health', async (req, res) => {
  const openai = getOpenAIClient();

  if (!openai) {
    return res.status(200).json({
      configured: true,
      openai: false,
      local_engine: true,
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: 'triverus-condo-local',
      status: 'ok',
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model: CONDO_MODEL_REQUESTED,
      messages: [{ role: 'user', content: 'Responda apenas: OK' }],
      max_completion_tokens: 10,
      temperature: 0,
    });

    const isOk = (response.choices[0]?.message?.content || '').toUpperCase().includes('OK');
    const modelReturned = response.model;

    return res.status(200).json({
      configured: true,
      openai: isOk,
      local_engine: true,
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: modelReturned,
      status: 'ok',
    });
  } catch (err: any) {
    return res.status(200).json({
      configured: true,
      openai: false,
      local_engine: true,
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: 'triverus-condo-local',
      status: 'ok',
    });
  }
});

// ============================================================================
// ROTAS DE GERENCIAMENTO DE AGENTES GLOBAIS COM PERSISTÊNCIA NO SUPABASE E RLS
// ============================================================================

// Obter catálogo dinâmico de modelos (OpenAI + Gemini) com cache de 24h
app.get('/api/agents/models', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const scopedSupabase = getScopedSupabaseClient(token);

    let currentUserId: string | null = null;
    if (token) {
      try {
        const { data: userData } = await scopedSupabase.auth.getUser(token);
        if (userData?.user) currentUserId = userData.user.id;
      } catch {}
    }

    if (!currentUserId) {
      return res.status(401).json({ ok: false, error: 'Sessão inválida ou não autenticada.' });
    }

    const supabaseAdmin = getAdminSupabaseClient();
    const isActive = await checkIsActiveUser(currentUserId, supabaseAdmin);
    if (!isActive) {
      return res.status(403).json({ ok: false, error: 'Conta de usuário inativa.' });
    }

    const catalogState = await getModelCatalog(false);
    return res.json({
      ok: true,
      catalog: Array.isArray(catalogState?.models) ? catalogState.models : [],
      lastFetchedAt: catalogState?.lastFetchedAt ? new Date(catalogState.lastFetchedAt).toISOString() : null,
      isStale: Boolean(catalogState?.isStale),
      providerStatus: catalogState?.providerStatus || {},
      lastError: catalogState?.lastError,
    });
  } catch (err: any) {
    console.error('[GET /api/agents/models Error]:', err?.message || err);
    return res.status(200).json({
      ok: false,
      catalog: [],
      isStale: true,
      lastError: 'Erro temporário ao consultar catálogo: ' + (err?.message || 'Falha de comunicação'),
      providerStatus: {
        openai: {
          provider: 'openai',
          state: 'network_error',
          ok: false,
          rawCount: 0,
          acceptedCount: 0,
          recommendedCount: 0,
          compatibleCount: 0,
          discardedCount: 0,
          discardReasons: {},
          sampleDiscarded: [],
          source: 'not_configured',
          lastCheckedAt: new Date().toISOString(),
          message: 'Falha temporária ao recuperar modelos da OpenAI.',
        },
        google: {
          provider: 'google',
          state: 'network_error',
          ok: false,
          rawCount: 0,
          acceptedCount: 0,
          recommendedCount: 0,
          compatibleCount: 0,
          discardedCount: 0,
          discardReasons: {},
          sampleDiscarded: [],
          source: 'not_configured',
          lastCheckedAt: new Date().toISOString(),
          message: 'Falha temporária ao recuperar modelos do Google Gemini.',
        },
      },
    });
  }
});

// Forçar atualização manual do catálogo de modelos nas APIs oficiais (Apenas Admins)
app.post('/api/agents/models/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const scopedSupabase = getScopedSupabaseClient(token);

    let currentUserId: string | null = null;
    if (token) {
      try {
        const { data: userData } = await scopedSupabase.auth.getUser(token);
        if (userData?.user) currentUserId = userData.user.id;
      } catch {}
    }

    if (!currentUserId) {
      return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
    }

    const supabaseAdmin = getAdminSupabaseClient();
    const isAdmin = await checkIsActiveAdmin(currentUserId, supabaseAdmin);
    if (!isAdmin) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'Apenas administradores ativos podem forçar a atualização do catálogo de modelos.',
      });
    }

    const catalogState = await refreshModelCatalog();
    return res.json({
      ok: true,
      catalog: Array.isArray(catalogState?.models) ? catalogState.models : [],
      lastFetchedAt: catalogState?.lastFetchedAt ? new Date(catalogState.lastFetchedAt).toISOString() : null,
      isStale: Boolean(catalogState?.isStale),
      providerStatus: catalogState?.providerStatus || {},
      lastError: catalogState?.lastError,
    });
  } catch (err: any) {
    console.error('[POST /api/agents/models/refresh Error]:', err?.message || err);
    return res.status(500).json({
      ok: false,
      error: 'refresh_failed',
      message: 'Falha ao forçar atualização do catálogo: ' + (err?.message || 'Erro interno'),
    });
  }
});

// Listar os 5 agentes globais da plataforma (aberto para colaboradores ativos)
app.get('/api/agents', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const clientToUse = supabaseAdmin || scopedSupabase;
  const isActive = await checkIsActiveUser(currentUserId, clientToUse);
  if (!isActive) {
    return res.status(403).json({ error: 'Conta de usuário inativa.' });
  }

  try {
    const agents = await getGlobalAgents(clientToUse);
    return res.json({ ok: true, agents });
  } catch (err: any) {
    console.error('[Agents API Error]:', err?.message || err);
    return res.json({ ok: true, agents: [] });
  }
});

// Buscar agente global específico por ID
app.get('/api/agents/:id', async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const clientToUse = supabaseAdmin || scopedSupabase;
  const isActive = await checkIsActiveUser(currentUserId, clientToUse);
  if (!isActive) {
    return res.status(403).json({ error: 'Conta de usuário inativa.' });
  }

  try {
    const agent = await getGlobalAgentById(id, clientToUse);
    if (!agent) {
      return res.status(404).json({ ok: false, error: 'agent_not_found', message: 'Agente não localizado.' });
    }

    return res.json({ ok: true, agent });
  } catch (err: any) {
    console.error('[Agent By ID API Error]:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao consultar agente.' });
  }
});

// Cadastrar / Atualizar agente global (EXCLUSIVO ADMINISTRADORES ATIVOS)
app.post('/api/agents', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const isAdmin = await checkIsActiveAdmin(currentUserId, supabaseAdmin);
  if (!isAdmin) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Acesso negado: apenas administradores ativos podem criar ou editar agentes globais.',
    });
  }

  const { id, name, role, prompt, brainProfile, modelId, avatarUrl, avatarId, slotNumber, capabilities } = req.body || {};

  if (!name || !role) {
    return res.status(400).json({ error: 'Campos nome e função são obrigatórios.' });
  }

  const cleanRole = String(role).trim();
  if (cleanRole.length > 34) {
    return res.status(400).json({
      error: 'O campo função não pode exceder o limite estrito de 34 caracteres.',
      current_length: cleanRole.length,
      max_length: 34,
    });
  }

  try {
    const savedAgent = await saveGlobalAgent(
      {
        id,
        name,
        role: cleanRole,
        prompt,
        brainProfile,
        modelId,
        avatarUrl,
        avatarId,
        slotNumber,
        capabilities,
      },
      currentUserId,
      supabaseAdmin
    );

    return res.json({ ok: true, success: true, agent: savedAgent });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Erro ao salvar agente.' });
  }
});

// Remover agente global (EXCLUSIVO ADMINISTRADORES ATIVOS)
app.delete('/api/agents/:id', async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const isAdmin = await checkIsActiveAdmin(currentUserId, supabaseAdmin);
  if (!isAdmin) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Acesso negado: apenas administradores ativos podem excluir agentes globais.',
    });
  }

  try {
    const deleted = await deleteGlobalAgent(id, currentUserId, supabaseAdmin);
    return res.json({ ok: true, success: deleted });
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err?.message || 'Erro ao excluir agente.' });
  }
});

// Listar atribuições globais da plataforma
app.get('/api/agents/assignments', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const isActive = await checkIsActiveUser(currentUserId, supabaseAdmin);
  if (!isActive) {
    return res.status(403).json({ error: 'Conta de usuário inativa.' });
  }

  const assignments = await getGlobalAssignments(supabaseAdmin);
  return res.json({ ok: true, assignments });
});

// Atribuir / Desatribuir agente global (EXCLUSIVO ADMINISTRADORES ATIVOS)
app.post('/api/agents/assignments', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) currentUserId = userData.user.id;
    } catch {}
  }

  if (!currentUserId) {
    return res.status(401).json({ error: 'Sessão inválida ou não autenticada.' });
  }

  const supabaseAdmin = getAdminSupabaseClient();
  const isAdmin = await checkIsActiveAdmin(currentUserId, supabaseAdmin);
  if (!isAdmin) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Acesso negado: apenas administradores ativos podem gerenciar atribuições globais.',
    });
  }

  const { action, agentId, target, categoryKey, categoryLabel } = req.body || {};

  try {
    if (action === 'delete' || action === 'remove') {
      const removed = await removeGlobalAssignment(target, categoryKey, currentUserId, supabaseAdmin);
      return res.json({ ok: true, success: removed });
    }

    const savedAssignment = await saveGlobalAssignment(
      { agentId, target, categoryKey, categoryLabel },
      currentUserId,
      supabaseAdmin
    );
    return res.json({ ok: true, success: true, assignment: savedAssignment });
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err?.message || 'Erro ao processar atribuição.' });
  }
});

async function handleAgentChat(req: express.Request, res: express.Response) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) {
        currentUserId = userData.user.id;
      }
    } catch {}
  }

  const { messages, client_context, snapshot, agentId: bodyAgentId, agent: bodyAgent } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'invalid_payload',
      message: 'Mensagens inválidas ou ausentes.',
    });
  }

  const supabaseAdmin = getAdminSupabaseClient();

  let userProfile: any = null;
  let userPermissions: any = null;
  if (currentUserId && supabaseAdmin) {
    try {
      const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('id, role, is_active, deleted_at')
        .eq('id', currentUserId)
        .maybeSingle();
      userProfile = p;

      const { data: up } = await supabaseAdmin
        .from('user_permissions')
        .select('*')
        .eq('user_id', currentUserId)
        .maybeSingle();
      userPermissions = up;
    } catch {}
  }

  if (currentUserId) {
    const isActive = userProfile ? (userProfile.is_active === true && !userProfile.deleted_at) : await checkIsActiveUser(currentUserId, supabaseAdmin);
    if (!isActive) {
      return res.status(403).json({
        ok: false,
        success: false,
        request_id: requestId,
        error_type: 'inactive_user',
        message: 'Acesso negado: sua conta de usuário está inativa na plataforma.',
      });
    }
  }

  const targetAgentId = bodyAgentId || bodyAgent?.id;
  let activeAgent: any = null;

  if (targetAgentId) {
    const recoveredAgent = await getGlobalAgentById(targetAgentId, supabaseAdmin);
    if (recoveredAgent) {
      activeAgent = recoveredAgent;
    }
  }

  // Fallback seguro de recuperação do agente se o payload contiver dados diretos
  if (!activeAgent && bodyAgent && bodyAgent.name && bodyAgent.role) {
    activeAgent = {
      id: bodyAgent.id || `ag_${Date.now()}`,
      name: bodyAgent.name,
      role: bodyAgent.role,
      prompt: bodyAgent.prompt || '',
      brainProfile: bodyAgent.brainProfile || 'balanced',
      modelId: bodyAgent.modelId || '',
    };
  }

  // Se nenhum agente for informado, utiliza padrão neutro
  if (!activeAgent) {
    activeAgent = {
      id: 'default',
      name: 'Agente Triverus',
      role: 'Especialista em Gestão e Auditoria',
      prompt: '',
      brainProfile: 'balanced',
      modelId: '',
    };
  }

  // Consulta autoritativa das capacidades persistidas pelo agent_id (nunca confia em flags enviadas pelo frontend)
  if (activeAgent?.id) {
    activeAgent.capabilities = await getAgentCapabilities(activeAgent.id, supabaseAdmin);
  }

  // Validação estrita do modelo configurado (sem substituição silenciosa)
  if (!activeAgent.modelId || !String(activeAgent.modelId).trim()) {
    return res.status(200).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'missing_model_configuration',
      text: `⚠️ O agente **${activeAgent.name}** ainda não possui um modelo de inteligência configurado. Um administrador precisa selecionar um modelo válido nas configurações do agente.`,
      message: `⚠️ O agente **${activeAgent.name}** ainda não possui um modelo de inteligência configurado. Um administrador precisa selecionar um modelo válido nas configurações do agente.`,
      agent: {
        id: activeAgent.id,
        name: activeAgent.name,
        role: activeAgent.role,
      },
    });
  }

  const modelValidation = resolveModelInfo(activeAgent.modelId);
  if (!modelValidation.isValid) {
    return res.status(200).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'unsupported_model',
      text: `⚠️ O modelo de inteligência **${activeAgent.modelId}** configurado para o agente **${activeAgent.name}** não é compatível com o catálogo do motor. Um administrador precisa selecionar um modelo válido.`,
      message: `⚠️ O modelo de inteligência **${activeAgent.modelId}** configurado para o agente **${activeAgent.name}** não é compatível com o catálogo do motor. Um administrador precisa selecionar um modelo válido.`,
      agent: {
        id: activeAgent.id,
        name: activeAgent.name,
        role: activeAgent.role,
      },
    });
  }

  const formattedMessages = messages.slice(-10).map((m: any) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  try {
    const isUserAdmin = userProfile?.role === 'admin';
    const executionRes = await executeAgentChat({
      agent: activeAgent,
      messages: formattedMessages,
      clientContext: client_context,
      snapshot,
      toolContext: {
        userId: currentUserId || 'anonymous',
        userToken: token,
        isAdmin: isUserAdmin,
        isActive: userProfile?.is_active === true && !userProfile?.deleted_at,
        userRole: userProfile?.role || 'user',
        userPermissions: userPermissions || {},
        scopedSupabase,
        supabaseAdmin,
      },
    });

    return res.status(200).json({
      ok: true,
      success: true,
      request_id: requestId,
      text: executionRes.text,
      message: executionRes.text,
      results: executionRes.results || [],
      model_used: executionRes.modelUsed,
      provider_used: executionRes.providerUsed,
      brain_profile: executionRes.brainProfileUsed,
      agent: {
        id: activeAgent.id,
        name: activeAgent.name,
        role: activeAgent.role,
      },
    });
  } catch (err: any) {
    console.error(`[Agent Chat Execution Error req:${requestId}]:`, err?.message || err);

    return res.status(200).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'agent_execution_error',
      text: `⚠️ O serviço de inteligência para o agente **${activeAgent.name}** está temporariamente indisponível. Por favor, tente novamente em instantes.`,
      message: `⚠️ O serviço de inteligência para o agente **${activeAgent.name}** está temporariamente indisponível. Por favor, tente novamente em instantes.`,
      agent: {
        id: activeAgent.id,
        name: activeAgent.name,
        role: activeAgent.role,
      },
    });
  }
}

// Endpoint principal neutro de chat com suporte a execução multi-provedor por agente
app.post('/api/agents/chat', handleAgentChat);

// Alias de retrocompatibilidade para /api/condo/chat
app.post('/api/condo/chat', handleAgentChat);

// Validação do Construtor de Agentes no Backend: Limite estrito de 34 caracteres para o campo Função
app.post('/api/agents/validate-role', (req, res) => {
  const { role } = req.body || {};
  const trimmed = typeof role === 'string' ? role.trim() : '';
  const isValid = trimmed.length <= 34;
  return res.json({
    ok: true,
    valid: isValid,
    max_length: 34,
    current_length: trimmed.length,
    remaining: Math.max(0, 34 - trimmed.length),
    sanitized: trimmed.slice(0, 34),
  });
});

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      next();
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Triverus Server running on port ${PORT}`);
  });
}

startServer();
