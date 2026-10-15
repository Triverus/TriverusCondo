import { supabase } from './supabase';

export interface GoogleCalendarApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Obtém um token de acesso JWT Supabase válido e atualizado.
 * Se a sessão estiver ausente, expirada ou próxima de expirar (< 60 segundos),
 * força o refreshSession() para garantir que o backend receba um token válido.
 * 
 * SEGURANÇA: Esta função NUNCA imprime nem expõe o token nos logs de console.
 */
export async function getFreshSupabaseAccessToken(): Promise<string | null> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[AUTH_TOKEN] Erro ao obter sessão local:', sessionError.message);
    }

    let session = sessionData?.session;
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Se não há sessão ou se o token expira em menos de 60 segundos, renova a sessão
    const isExpiredOrExpiring = !session || !session.expires_at || (session.expires_at - nowSeconds < 60);

    if (isExpiredOrExpiring) {
      console.log('[AUTH_TOKEN] Sessão ausente ou próxima da expiração. Renovando token Supabase...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.warn('[AUTH_TOKEN] Falha na renovação da sessão:', refreshError.message);
      } else if (refreshData.session?.access_token) {
        session = refreshData.session;
      }
    }

    if (!session?.access_token) {
      console.warn('[AUTH_TOKEN] Nenhuma sessão ativa encontrada.');
      return null;
    }

    return session.access_token;
  } catch (err: any) {
    console.warn('[AUTH_TOKEN] Exceção ao recuperar token Supabase:', err?.message || err);
    return null;
  }
}

/**
 * Executa chamadas autenticadas para o backend do Google Calendar.
 * Inclui:
 * 1. Obtenção de token atualizado (fresh token).
 * 2. Retry automático único em caso de 401 (renovando a sessão via refreshSession).
 * 3. Log seguro (sem expor o token JWT).
 */
export async function callGoogleCalendarApi(
  endpoint: string,
  payload: { interactionId: string; operation?: 'sync' | 'delete' }
): Promise<GoogleCalendarApiResponse> {
  let token = await getFreshSupabaseAccessToken();

  if (!token) {
    console.warn(`[GOOGLE_CALENDAR_CLIENT] Abortando ${endpoint}: token não disponível.`);
    return {
      ok: false,
      status: 401,
      data: null,
      error: 'unauthorized_no_token',
    };
  }

  const makeRequest = async (authToken: string) => {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });
  };

  try {
    let response = await makeRequest(token);

    // Se o backend retornar 401 (token expirou no servidor ou foi invalidado),
    // tenta renovar a sessão imediatamente e repete a chamada 1 vez.
    if (response.status === 401) {
      console.warn(`[GOOGLE_CALENDAR_CLIENT] 401 recebido em ${endpoint}. Renovando sessão Supabase e repetindo...`);
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (!refreshError && refreshData.session?.access_token) {
        token = refreshData.session.access_token;
        console.log(`[GOOGLE_CALENDAR_CLIENT] Sessão renovada com sucesso. Repetindo requisição para ${endpoint}...`);
        response = await makeRequest(token);
      } else {
        console.warn('[GOOGLE_CALENDAR_CLIENT] Falha ao renovar sessão após 401.');
      }
    }

    let responseData: any = null;
    try {
      responseData = await response.json();
    } catch {
      responseData = null;
    }

    console.log('[GOOGLE_CALENDAR_CLIENT_RESULT]', {
      endpoint,
      interactionId: payload.interactionId,
      operation: payload.operation || (endpoint.includes('delete') ? 'delete' : 'sync'),
      status: response.status,
      ok: response.ok,
      action: responseData?.action || null,
      synced: responseData?.synced ?? false,
      deleted: responseData?.deleted ?? false,
      reason: responseData?.reason || responseData?.error || null,
    });

    let errorMessage: string | undefined = undefined;
    if (!response.ok) {
      if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (responseData?.error) {
        errorMessage = responseData.error === 'unauthorized' ? 'Sessão expirada. Por favor, recarregue a página.' : responseData.error;
      } else if (response.status === 401) {
        errorMessage = 'Sessão expirada. Por favor, recarregue a página.';
      } else {
        errorMessage = `HTTP ${response.status}`;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: responseData,
      error: errorMessage,
    };
  } catch (err: any) {
    console.warn(`[GOOGLE_CALENDAR_CLIENT] Exceção de rede em ${endpoint}:`, err?.message || err);
    return {
      ok: false,
      status: 0,
      data: null,
      error: err?.message || 'network_error',
    };
  }
}

/**
 * Função canônica única para sincronizar (criar ou atualizar) evento no Google Calendar.
 * O backend detecta automaticamente se deve executar CREATE (events.insert) ou UPDATE (events.patch).
 */
export async function syncInteractionCalendar(interactionId: string) {
  return callGoogleCalendarApi('/api/google/calendar/interaction', {
    interactionId,
    operation: 'sync',
  });
}

/**
 * Função canônica única para excluir evento do Google Calendar antes da exclusão no banco.
 */
export async function deleteInteractionCalendar(interactionId: string) {
  return callGoogleCalendarApi('/api/google/calendar/interaction', {
    interactionId,
    operation: 'delete',
  });
}

// Aliases para compatibilidade total com os componentes existentes
export const syncGoogleCalendarInteraction = syncInteractionCalendar;
export const updateGoogleCalendarInteraction = syncInteractionCalendar;
export const deleteGoogleCalendarInteraction = deleteInteractionCalendar;
