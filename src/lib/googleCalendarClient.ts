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
      if (responseData?.reason === 'google_calendar_not_connected') {
        errorMessage = responseData?.message || 'Conta do Google Calendar não conectada.';
      } else if (responseData?.reason === 'google_calendar_reauthorization_required') {
        errorMessage = responseData?.message || 'Reautorização do Google Calendar necessária.';
      } else if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (responseData?.error === 'unauthorized') {
        errorMessage = 'Sessão expirada. Por favor, recarregue a página.';
      } else if (responseData?.error) {
        errorMessage = responseData.error;
      } else if (response.status === 401 && !responseData?.reason) {
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

export type CalendarStatus = 'synced' | 'not_connected' | 'reauthorization_required' | 'not_scheduled' | 'failed';

export interface ControlledSyncResult {
  calendar_status: CalendarStatus;
  googleEventId?: string | null;
  reason?: string;
  message?: string;
  raw?: any;
}

/**
 * Sincronização canônica com 1 retry controlado para falhas transitórias.
 * Inspeciona o resultado real e distingue 'synced', 'not_connected', 'reauthorization_required' e 'failed'.
 */
export async function syncInteractionWithControlledRetry(
  interactionId: string
): Promise<ControlledSyncResult> {
  const isSuccessSynced = (r: GoogleCalendarApiResponse) =>
    r.ok === true && r.data?.success === true && r.data?.synced !== false;

  const extractReason = (r: GoogleCalendarApiResponse): string =>
    r.data?.reason || r.data?.error || r.error || '';

  // 1ª tentativa
  let res = await syncInteractionCalendar(interactionId);

  if (isSuccessSynced(res)) {
    return {
      calendar_status: 'synced',
      googleEventId: res.data?.googleEventId || res.data?.google_event_id || null,
      raw: res.data,
    };
  }

  let reason = extractReason(res);

  // Motivos NÃO recuperáveis: não tentar retry inútil
  if (reason === 'google_calendar_not_connected') {
    return {
      calendar_status: 'not_connected',
      reason,
      message: 'Conta do Google Calendar não conectada.',
      raw: res.data,
    };
  }

  if (reason === 'google_calendar_reauthorization_required') {
    return {
      calendar_status: 'reauthorization_required',
      reason,
      message: 'Reautorização do Google Calendar necessária.',
      raw: res.data,
    };
  }

  if (reason === 'no_next_follow_up_at' || reason === 'no_responsible_user_id') {
    return {
      calendar_status: 'not_scheduled',
      reason,
      raw: res.data,
    };
  }

  // Motivo recuperável: permitir NO MÁXIMO 1 retry controlado
  const isRecoverable =
    reason === 'token_expired' ||
    reason === 'token_refresh_required' ||
    reason === 'sync_exception' ||
    reason === 'google_api_error' ||
    reason === 'network_error' ||
    !res.ok ||
    res.status >= 500 ||
    res.status === 401;

  if (isRecoverable) {
    console.log(`[GOOGLE_CALENDAR_CLIENT] Tentando 1 retry controlado para a interaction ${interactionId} (motivo inicial: ${reason})...`);

    // Antes do retry, reler a interaction do Supabase.
    // Se google_event_id já tiver sido preenchido (ex: race condition resolvida), NÃO criar outro evento.
    try {
      const { data: currentInteraction } = await supabase
        .from('interactions')
        .select('id, google_event_id')
        .eq('id', interactionId)
        .single();

      if (currentInteraction?.google_event_id && currentInteraction.google_event_id.trim()) {
        console.log(`[GOOGLE_CALENDAR_CLIENT] google_event_id já existente (${currentInteraction.google_event_id}). Cancelando novo sync.`);
        return {
          calendar_status: 'synced',
          googleEventId: currentInteraction.google_event_id.trim(),
        };
      }
    } catch (checkErr) {
      console.warn('[GOOGLE_CALENDAR_CLIENT] Erro ao inspecionar interaction antes do retry:', checkErr);
    }

    // Se continuar NULL: tentar renovar sessão Supabase se foi 401 e repetir sync UMA única vez
    if (res.status === 401) {
      try {
        await supabase.auth.refreshSession();
      } catch {
        // Ignora falha de refresh
      }
    }

    res = await syncInteractionCalendar(interactionId);

    if (isSuccessSynced(res)) {
      return {
        calendar_status: 'synced',
        googleEventId: res.data?.googleEventId || res.data?.google_event_id || null,
        raw: res.data,
      };
    }

    reason = extractReason(res);
    if (reason === 'google_calendar_not_connected') {
      return {
        calendar_status: 'not_connected',
        reason,
        message: 'Conta do Google Calendar não conectada.',
        raw: res.data,
      };
    }
    if (reason === 'google_calendar_reauthorization_required') {
      return {
        calendar_status: 'reauthorization_required',
        reason,
        message: 'Reautorização do Google Calendar necessária.',
        raw: res.data,
      };
    }
  }

  // Falha definitiva
  return {
    calendar_status: 'failed',
    reason: reason || 'sync_failed',
    message: res.data?.message || res.error || 'A nota foi salva no Triverus, mas o Google Calendar não foi sincronizado.',
    raw: res.data,
  };
}

// Aliases para compatibilidade total com os componentes existentes
export const syncGoogleCalendarInteraction = syncInteractionCalendar;
export const updateGoogleCalendarInteraction = syncInteractionCalendar;
export const deleteGoogleCalendarInteraction = deleteInteractionCalendar;

