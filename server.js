import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import {
  CONDO_MODEL_REQUESTED,
  CONDO_TOOLS,
  buildSystemPrompt,
  executeToolCall,
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
} from './googleCalendarAuth.js';

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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT_EXCEPTION]', error instanceof Error ? error.message : error);
});

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    } catch {}
  }
}
loadEnvFile();

const app = express();
app.use(express.json({ limit: '10mb' }));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

function getScopedSupabaseClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

function getAdminSupabaseClient(bearerToken) {
  const rawUrl = process.env.VITE_SUPABASE_URL || SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(rawUrl && rawUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());

  let urlError = null;

  if (hasUrl) {
    try {
      new URL(rawUrl.trim());
    } catch (err) {
      urlError = err && err.message ? err.message : 'Invalid URL format';
    }
  }

  if (!hasKey || !hasUrl || urlError) {
    console.warn('[SUPABASE_ADMIN_DIAG] Abortando criação do cliente admin Supabase devido a parâmetros ausentes ou URL inválida.');
    return null;
  }

  return createClient(rawUrl.trim(), serviceKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(bearerToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          },
        }
      : {}),
  });
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
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
function getAppBaseUrl() {
  const envUrl = (
    process.env.APP_URL ||
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
function sanitizeActionLink(actionLink, targetBaseUrl) {
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

// Endpoint seguro para teste de conectividade do Supabase Admin (sem expor segredos)
app.get('/api/google/oauth/diag-supabase', async (req, res) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(supabaseUrl && supabaseUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());
  const keyLength = serviceKey ? serviceKey.trim().length : 0;

  let parsedHost = null;
  let parsedProtocol = null;
  let urlError = null;

  if (hasUrl) {
    try {
      const parsed = new URL(supabaseUrl.trim());
      parsedHost = parsed.hostname;
      parsedProtocol = parsed.protocol;
    } catch (err) {
      urlError = err && err.message ? err.message : 'Invalid URL format';
    }
  }

  // 1. TESTE HTTP DIRETO usando fetch nativo do Node 22 (sem supabase-js)
  let directResult = null;
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
    const cleanBaseUrl = supabaseUrl.trim().replace(/\/+$/, '');
    const directEndpoint = `${cleanBaseUrl}/rest/v1/google_calendar_connections?select=id&limit=1`;
    console.log('[SUPABASE_DIRECT_DIAG] Iniciando teste direto com fetch nativo:', {
      stage: 'direct_fetch_start',
      hostname: parsedHost,
    });

    try {
      const fetchResponse = await fetch(directEndpoint, {
        method: 'GET',
        headers: {
          apikey: serviceKey.trim(),
          Authorization: `Bearer ${serviceKey.trim()}`,
        },
      });

      let responseBody = null;
      let errorBodyText = null;
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
      } catch (readErr) {
        errorBodyText = `Falha ao ler corpo: ${readErr && readErr.message}`;
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
    } catch (fetchErr) {
      const causeDetails = fetchErr && fetchErr.cause
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
        error_name: fetchErr && fetchErr.name,
        error_message: fetchErr && fetchErr.message,
        cause: causeDetails,
      });

      directResult = {
        tested: true,
        ok: false,
        error_name: fetchErr && fetchErr.name,
        error_message: fetchErr && fetchErr.message,
        cause: causeDetails,
      };
    }
  }

  // 2. TESTE COM SUPABASE-JS para fins de comparação
  let supabaseJsResult = null;
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
    } catch (jsErr) {
      const causeDetails = jsErr && jsErr.cause
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
        error_name: jsErr && jsErr.name,
        error_message: jsErr && jsErr.message,
        cause: causeDetails,
      });

      supabaseJsResult = {
        tested: true,
        ok: false,
        network_error: {
          name: jsErr && jsErr.name,
          message: jsErr && jsErr.message,
          code: jsErr && jsErr.code,
          cause: causeDetails,
        },
      };
    }
  }

  const overallOk = Boolean((directResult && directResult.ok) || (supabaseJsResult && supabaseJsResult.ok));
  const responseStatus = overallOk ? 200 : directResult && directResult.status ? directResult.status : 502;

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

function createOAuthState(userId, secret) {
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

function verifyOAuthState(state, secret, maxAgeMs = 10 * 60 * 1000) {
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

  let payload;
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
// GESTÃO DE USUÁRIOS E PERMISSÕES GRANULARES (EXCLUSIVO PARA ADMINISTRADORES)
// ==============================================================================

async function requireAdminUser(req, res, next) {
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

    const { data: profile, error: profErr } = await adminScopedClient
      .from('profiles')
      .select('id, role, is_active, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profErr || !profile) {
      return res.status(403).json({ error: 'Perfil de usuário não localizado no sistema.' });
    }

    const role = (profile.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'administrador';
    if (!isAdmin || profile.is_active === false) {
      return res.status(403).json({ error: 'Acesso restrito: apenas administradores ativos possuem autorização.' });
    }

    req.adminUser = user;
    req.adminProfile = profile;
    req.adminScopedClient = adminScopedClient;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Falha interna ao validar credenciais administrativas: ' + (err?.message || err) });
  }
}

// 1. Listar todos os usuários com perfis e permissões granulares
app.get('/api/admin/users', requireAdminUser, async (req, res) => {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient = req.adminScopedClient;
  if (!supabaseAdmin || !adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  try {
    const [authRes, profilesRes, permRes] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      adminScopedClient.from('profiles').select('*').order('created_at', { ascending: true }),
      adminScopedClient.from('user_permissions').select('*'),
    ]);

    const authUsers = authRes.data?.users || [];
    const profiles = profilesRes.data || [];
    const permissions = permRes.data || [];

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const permMap = new Map(permissions.map((pm) => [pm.user_id, pm]));

    const allUserIds = new Set();
    authUsers.forEach((u) => allUserIds.add(u.id));
    profiles.forEach((p) => allUserIds.add(p.id));

    const combinedList = Array.from(allUserIds)
      .map((userId) => {
        const authUser = authUsers.find((u) => u.id === userId);
        const profile = profileMap.get(userId);
        const perm = permMap.get(userId);

        // Ocultar usuários excluídos / desligados do painel administrativo
        const isDeletedAuth = Boolean(authUser?.user_metadata?.is_deleted);
        const isDeletedProfile = Boolean(profile?.deleted_at);
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
          } : {
            can_manage_notes: true,
            can_delete_notes: false,
            can_manage_leads: true,
            can_delete_leads: false,
            can_change_stage: true,
            can_manage_contacts: true,
          },
        };
      })
      .filter((u) => u !== null);

    return res.json({ users: combinedList });
  } catch (err) {
    console.error('[ADMIN_USERS_LIST_ERROR]', err);
    return res.status(500).json({ error: 'Erro ao listar usuários: ' + (err?.message || err) });
  }
});

// Helper interno para convidar usuário sem definição de senha pelo administrador
async function handleInviteUserAdmin(req, res) {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient = req.adminScopedClient;
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
    let createdUser = null;
    let inviteLink = null;
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
  } catch (err) {
    console.error('[ADMIN_USERS_INVITE_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Erro ao convidar usuário.' });
  }
}

// 2. Convidar novo usuário (sem senha definida pelo admin)
app.post('/api/admin/users/invite', requireAdminUser, handleInviteUserAdmin);
app.post('/api/admin/invite-user', requireAdminUser, handleInviteUserAdmin);

// 3. PATCH /api/admin/users/:id
app.patch('/api/admin/users/:id', requireAdminUser, async (req, res) => {
  const adminScopedClient = req.adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id } = req.params;
  const { full_name, role, is_active } = req.body;
  const currentAdmin = req.adminUser;

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
    const updateProfileData = {
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
      });
    }

    return res.json({ success: true, message: 'Usuário atualizado com sucesso.' });
  } catch (err) {
    console.error('[ADMIN_PATCH_USER_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar dados do usuário.' });
  }
});

// 4. PATCH /api/admin/users/:id/permissions
app.patch('/api/admin/users/:id/permissions', requireAdminUser, async (req, res) => {
  const adminScopedClient = req.adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id } = req.params;
  const permissions = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'Identificador de usuário não informado.' });
  }

  try {
    const permsPayload = {
      user_id: id,
      updated_at: new Date().toISOString(),
    };

    if (permissions.can_manage_notes !== undefined) permsPayload.can_manage_notes = Boolean(permissions.can_manage_notes);
    if (permissions.can_delete_notes !== undefined) permsPayload.can_delete_notes = Boolean(permissions.can_delete_notes);
    if (permissions.can_manage_leads !== undefined) permsPayload.can_manage_leads = Boolean(permissions.can_manage_leads);
    if (permissions.can_delete_leads !== undefined) permsPayload.can_delete_leads = Boolean(permissions.can_delete_leads);
    if (permissions.can_change_stage !== undefined) permsPayload.can_change_stage = Boolean(permissions.can_change_stage);
    if (permissions.can_manage_contacts !== undefined) permsPayload.can_manage_contacts = Boolean(permissions.can_manage_contacts);

    const { error: permErr } = await adminScopedClient
      .from('user_permissions')
      .upsert(permsPayload);

    if (permErr) throw permErr;

    return res.json({
      success: true,
      message: 'Permissões salvas com sucesso em public.user_permissions.',
      permissions: permsPayload,
    });
  } catch (err) {
    console.error('[ADMIN_PATCH_PERMS_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar permissões.' });
  }
});

// 5. POST /api/admin/update-user - Atualizar perfil + permissões preservando user_permissions ao promover/rebaixar
app.post('/api/admin/update-user', requireAdminUser, async (req, res) => {
  const adminScopedClient = req.adminScopedClient;
  if (!adminScopedClient) return res.status(500).json({ error: 'Serviço indisponível' });

  const { id, full_name, role, is_active, permissions } = req.body;
  const currentAdmin = req.adminUser;

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

    const updateProfileData = {
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
  } catch (err) {
    console.error('[ADMIN_UPDATE_USER_ERROR]', err);
    return res.status(400).json({ error: err?.message || 'Falha ao atualizar dados do usuário.' });
  }
});

// 6. Gerar link de recuperação de acesso / redefinição de senha pelo próprio usuário
app.post('/api/admin/reset-password', requireAdminUser, async (req, res) => {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient = req.adminScopedClient;
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
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Falha ao gerar link de recuperação.' });
  }
});

// 7. Exclusão definitiva de usuário e desligamento de funcionário
async function handleDeleteUser(req, res) {
  const supabaseAdmin = getAdminSupabaseClient();
  const adminScopedClient = req.adminScopedClient;
  const currentAdminUser = req.adminUser;
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
    let googleCalendarRevoked = null;
    let googleCalendarRevokeWarning = null;
    try {
      const { data: gcalConn } = await supabaseAdmin
        .from('google_calendar_connections')
        .select('*')
        .eq('user_id', targetId)
        .maybeSingle();

      if (gcalConn) {
        // Priorizar refresh_token (invalida a concessão inteira na Google). Se indisponível ou falhar, tenta access_token.
        const candidateTokens = [];
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
                const errData = await revokeRes.json();
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
          } catch (revErr) {
            googleCalendarRevoked = false;
            googleCalendarRevokeWarning = revErr?.message || 'Falha ao contatar endpoint de revogação da Google.';
          }
        }

        // Limpeza mandatória das credenciais locais no banco, mesmo se a revogação externa falhar
        await supabaseAdmin.from('google_calendar_connections').delete().eq('user_id', targetId);
      }
    } catch (gcalErr) {
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
    let authErrorMessage = null;

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
  } catch (err) {
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


app.post('/api/google/oauth/start', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET;

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
  let userId = null;
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
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET;

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

    const tokenData = await tokenResponse.json().catch(() => null);

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
    let googleEmail = null;
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json().catch(() => null);
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
        } else if (existingConn && existingConn.refresh_token) {
          refreshTokenToPersist = existingConn.refresh_token;
          console.log('[GOOGLE_OAUTH] refresh_token anterior recuperado com sucesso.');
        }
      } catch (checkErr) {
        console.error('[GOOGLE_OAUTH] Exceção ao consultar refresh_token prévio:', {
          name: checkErr && checkErr.name,
          message: checkErr && checkErr.message,
          code: checkErr && checkErr.code,
          cause_message: checkErr && checkErr.cause ? checkErr.cause.message : undefined,
          cause_code: checkErr && checkErr.cause ? checkErr.cause.code : undefined,
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
    } catch (upsertException) {
      console.error('[GOOGLE_OAUTH] Falha ao persistir conexão no Supabase (exceção HTTP/rede):', {
        stage: 'upsert_google_calendar_connections_fetch',
        name: upsertException && upsertException.name,
        message: upsertException && upsertException.message,
        code: upsertException && upsertException.code,
        cause_name: upsertException && upsertException.cause ? upsertException.cause.name : undefined,
        cause_message: upsertException && upsertException.cause ? upsertException.cause.message : undefined,
        cause_code: upsertException && upsertException.cause ? upsertException.cause.code : undefined,
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
  } catch (err) {
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
  let userId = null;
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

  let accessToken;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch (err) {
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
  } catch (err) {
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
  let userId = null;
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
    } catch (err) {
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
  } catch (err) {
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

// Endpoint autenticado para sincronizar / criar evento no Google Calendar a partir de um follow-up salvo
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
  let userId = null;
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
  } catch (err) {
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

// Endpoint autenticado para atualizar evento no Google Calendar a partir de um follow-up editado
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
  let userId = null;
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
  } catch (err) {
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
  let userId = null;
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
        success: false,
        ...deleteResult,
      });
    }
    return res.status(200).json({
      success: true,
      ...deleteResult,
    });
  } catch (err) {
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
      configured: false,
      openai: false,
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: null,
      error: 'OPENAI_API_KEY não configurada no backend.',
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
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: modelReturned,
    });
  } catch (err) {
    const sanitizedError = err?.message?.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]') || 'Falha ao conectar com a OpenAI.';
    return res.status(200).json({
      configured: true,
      openai: false,
      model_requested: CONDO_MODEL_REQUESTED,
      model_returned: null,
      error: sanitizedError,
    });
  }
});

app.post('/api/condo/chat', async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const openai = getOpenAIClient();

  if (!openai) {
    return res.status(503).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'openai_not_configured',
      message: 'OPENAI_API_KEY não configurada no backend.',
    });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  const scopedSupabase = getScopedSupabaseClient(token);

  let currentUserId = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) {
        currentUserId = userData.user.id;
      }
    } catch {}
  }

  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'invalid_payload',
      message: 'Mensagens inválidas ou ausentes.',
    });
  }

  const lastUserMsgObj = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserMessage = typeof lastUserMsgObj?.content === 'string' ? lastUserMsgObj.content : '';

  const conversationMessages = [
    {
      role: 'system',
      content: buildSystemPrompt(),
    },
    ...messages.slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  ];

  const accumulatedRichResults = [];
  const MAX_TOOL_ITERATIONS = 6;
  let iteration = 0;

  try {
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const response = await openai.chat.completions.create({
        model: CONDO_MODEL_REQUESTED,
        messages: conversationMessages,
        tools: CONDO_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
      });

      const choice = response.choices?.[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) {
        throw new Error('Nenhuma resposta recebida do modelo.');
      }

      conversationMessages.push(assistantMessage);

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const tc of assistantMessage.tool_calls) {
          if (tc.type === 'function') {
            const funcName = tc.function.name;
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments || '{}');
            } catch {
              parsedArgs = {};
            }

            const { result, richResults } = await executeToolCall(
              funcName,
              parsedArgs,
              scopedSupabase,
              currentUserId,
              requestId,
              lastUserMessage
            );

            if (richResults && Array.isArray(richResults)) {
              accumulatedRichResults.push(...richResults);
            }

            conversationMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          }
        }
        continue;
      }

      return res.status(200).json({
        ok: true,
        success: true,
        request_id: requestId,
        text: assistantMessage.content || 'Consulta realizada com sucesso.',
        message: assistantMessage.content || 'Consulta realizada com sucesso.',
        model: response.model,
        results: accumulatedRichResults.length > 0 ? accumulatedRichResults : undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      success: true,
      request_id: requestId,
      text: 'Finalizei as consultas solicitadas no CRM.',
      message: 'Finalizei as consultas solicitadas no CRM.',
      results: accumulatedRichResults.length > 0 ? accumulatedRichResults : undefined,
    });
  } catch (chatError) {
    console.error(`[Condo Chat Error req:${requestId}]:`, chatError?.message || chatError);
    const sanitized = chatError?.message?.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]') || 'Falha ao processar solicitação com o Condo.';
    return res.status(500).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'openai_chat_error',
      message: sanitized,
    });
  }
});

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Triverus Production Server running on port ${PORT}`);
});
