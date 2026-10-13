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

  const adminClient = getAdminSupabaseClient();
  if (!adminClient) {
    return res.status(500).json({
      ok: false,
      diagnostics: {
        has_vite_supabase_url: hasUrl,
        url_protocol: parsedProtocol,
        url_hostname: parsedHost,
        url_parse_error: urlError,
        has_service_role_key: hasKey,
        service_role_key_length: keyLength,
      },
      message: 'Cliente admin não pôde ser instanciado devido a URL inválida ou chave ausente.',
    });
  }

  try {
    const { data, error, count } = await adminClient
      .from('google_calendar_connections')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return res.status(502).json({
        ok: false,
        diagnostics: {
          has_vite_supabase_url: hasUrl,
          url_protocol: parsedProtocol,
          url_hostname: parsedHost,
          url_parse_error: urlError,
          has_service_role_key: hasKey,
          service_role_key_length: keyLength,
        },
        supabase_error: {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      });
    }

    return res.status(200).json({
      ok: true,
      diagnostics: {
        has_vite_supabase_url: hasUrl,
        url_protocol: parsedProtocol,
        url_hostname: parsedHost,
        url_parse_error: urlError,
        has_service_role_key: hasKey,
        service_role_key_length: keyLength,
      },
      connectivity: 'success',
      total_connections_count: count ?? 0,
    });
  } catch (err) {
    console.error('[SUPABASE_ADMIN_DIAG] Exceção durante teste de conectividade:', {
      name: err && err.name,
      message: err && err.message,
      code: err && err.code,
      cause_name: err && err.cause ? err.cause.name : undefined,
      cause_message: err && err.cause ? err.cause.message : undefined,
      cause_code: err && err.cause ? err.cause.code : undefined,
    });

    return res.status(502).json({
      ok: false,
      diagnostics: {
        has_vite_supabase_url: hasUrl,
        url_protocol: parsedProtocol,
        url_hostname: parsedHost,
        url_parse_error: urlError,
        has_service_role_key: hasKey,
        service_role_key_length: keyLength,
      },
      network_error: {
        name: err && err.name,
        message: err && err.message,
        code: err && err.code,
        cause: err && err.cause ? {
          name: err.cause.name,
          message: err.cause.message,
          code: err.cause.code,
        } : null,
      },
    });
  }
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
