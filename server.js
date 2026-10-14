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

function getAdminSupabaseClient() {
  const rawUrl = process.env.VITE_SUPABASE_URL || SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(rawUrl && rawUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());
  const keyLength = serviceKey ? serviceKey.trim().length : 0;

  let parsedHost = null;
  let parsedProtocol = null;
  let urlError = null;

  if (hasUrl) {
    try {
      const parsed = new URL(rawUrl.trim());
      parsedHost = parsed.hostname;
      parsedProtocol = parsed.protocol;
    } catch (err) {
      urlError = err && err.message ? err.message : 'Invalid URL format';
    }
  }

  console.log('[SUPABASE_ADMIN_DIAG] Inicializando getAdminSupabaseClient:', {
    has_vite_supabase_url: hasUrl,
    url_protocol: parsedProtocol,
    url_hostname: parsedHost,
    url_parse_error: urlError,
    has_service_role_key: hasKey,
    service_role_key_length: keyLength,
  });

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
