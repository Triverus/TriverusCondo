import express from 'express';
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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

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

app.get('/api/google/oauth/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: 'Configuração OAuth incompleta.',
      message: 'As variáveis de ambiente GOOGLE_CLIENT_ID e GOOGLE_REDIRECT_URI são obrigatórias.',
    });
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return res.redirect(authUrl.toString());
});

app.get('/api/google/oauth/callback', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({
      error: 'Configuração OAuth incompleta.',
      message: 'As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI são obrigatórias.',
    });
  }

  const { code, error, error_description } = req.query;

  if (error) {
    const errorMsg = typeof error === 'string' ? error : 'oauth_error';
    const message = typeof error_description === 'string' ? error_description : 'Autorização recusada ou cancelada pelo usuário.';
    return res.status(400).json({
      error: errorMsg,
      message,
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

    return res.status(200).json({
      success: true,
      message: 'Google Calendar autorizado com sucesso',
      has_access_token: Boolean(tokenData.access_token),
      has_refresh_token: Boolean(tokenData.refresh_token),
      expires_in: tokenData.expires_in ?? null,
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
