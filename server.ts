import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
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
  GoogleCalendarAuthError,
  EXPIRATION_BUFFER_MS,
} from './googleCalendarAuth.ts';

export {
  getValidGoogleAccessToken,
  getValidGoogleTokenDetails,
  fetchUpcomingGoogleCalendarEvents,
  createGoogleCalendarEventForInteraction,
  updateGoogleCalendarEventForInteraction,
  GoogleCalendarAuthError,
  EXPIRATION_BUFFER_MS,
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

function getAdminSupabaseClient(): SupabaseClient | null {
  const rawUrl = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY;

  const hasUrl = Boolean(rawUrl && rawUrl.trim());
  const hasKey = Boolean(serviceKey && serviceKey.trim());
  const keyLength = serviceKey ? serviceKey.trim().length : 0;

  let parsedHost: string | null = null;
  let parsedProtocol: string | null = null;
  let urlError: string | null = null;

  if (hasUrl) {
    try {
      const parsed = new URL(rawUrl!.trim());
      parsedHost = parsed.hostname;
      parsedProtocol = parsed.protocol;
    } catch (err: any) {
      urlError = err?.message || 'Invalid URL format';
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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
    const syncResult = await createGoogleCalendarEventForInteraction(interactionId);
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
  } catch (err: any) {
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

  let currentUserId: string | null = null;
  if (token) {
    try {
      const { data: userData } = await scopedSupabase.auth.getUser(token);
      if (userData?.user) {
        currentUserId = userData.user.id;
      }
    } catch {}
  }

  const { messages, client_context, snapshot } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      ok: false,
      success: false,
      request_id: requestId,
      error_type: 'invalid_payload',
      message: 'Mensagens inválidas ou ausentes.',
    });
  }

  const lastUserMsgObj = [...messages].reverse().find((m: any) => m.role === 'user');
  const lastUserMessage = typeof lastUserMsgObj?.content === 'string' ? lastUserMsgObj.content : '';

  const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: buildSystemPrompt(),
    },
    ...messages.slice(-8).map((m: any) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  ];

  const actionsExecuted: any[] = [];
  const accumulatedRichResults: any[] = [];
  const MAX_TOOL_ITERATIONS = 6;
  let iteration = 0;

  try {
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const response = await openai.chat.completions.create({
        model: CONDO_MODEL_REQUESTED,
        messages: conversationMessages,
        tools: CONDO_TOOLS as any,
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
            let parsedArgs: any = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments || '{}');
            } catch {
              parsedArgs = {};
            }

            const toolRes = await executeToolCall(
              funcName,
              parsedArgs,
              scopedSupabase,
              currentUserId,
              requestId,
              lastUserMessage,
              client_context,
              snapshot
            );

            const { result, richResults } = toolRes;
            if (toolRes.contextRefs) {
              // attach context refs
            }

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

      const hasHelpOrLink = accumulatedRichResults.some((r) => r.type === 'help' || r.type === 'link');
      const presentationMode = hasHelpOrLink ? 'result_only' : 'text_and_results';

      return res.status(200).json({
        ok: true,
        success: true,
        request_id: requestId,
        text: assistantMessage.content || 'Consulta realizada com sucesso.',
        message: assistantMessage.content || 'Consulta realizada com sucesso.',
        presentation_mode: presentationMode,
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
  } catch (chatError: any) {
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
