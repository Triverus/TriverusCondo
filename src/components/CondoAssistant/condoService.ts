import { supabase } from '../../lib/supabase.ts';
import { buildCondoClientContext } from '../../lib/condoClientContext.ts';
import { buildCondoSnapshot } from '../../lib/condoSnapshot.ts';
import type { CondoActionExecuted, CondoMessage } from './condoTypes.ts';
import type { CondoResultItem } from './CondoResultRenderer.tsx';

export interface ActionContext {
  leads?: any[];
  stages?: any[];
  contacts?: any[];
  interactions?: any[];
  stageMap?: Map<string, string>;
  profileMap?: Map<string, string>;
  currentUserFullName?: string;
  refreshAll?: (silent?: boolean) => Promise<void>;
  onNavigateToLead?: (leadId: string) => void;
}

// Send message to Condo backend API (OpenAI Chat Completions Tool-Calling Loop)
export async function sendCondoMessage(
  userText: string,
  history: CondoMessage[],
  ctx: ActionContext,
  uiContext?: any,
  currentFocus?: any,
  recentlyDisplayedResultKeys?: string[]
): Promise<{ text: string; actions?: CondoActionExecuted[]; results?: CondoResultItem[] }> {
  // 1. Obtain current Supabase user session token for authenticated RLS
  let authToken: string | undefined;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[Condo Auth] Error getting session:', error.message);
    }
    authToken = data?.session?.access_token;
  } catch (authErr: any) {
    console.warn('[Condo Auth] Exception getting session:', authErr?.message);
  }

  // 2. Format compact conversation history
  const slicedHistory = history.slice(-8);
  const lastHistoryItem = slicedHistory[slicedHistory.length - 1];
  const isLastAlreadyUserMsg = lastHistoryItem?.role === 'user' && lastHistoryItem?.content === userText;

  const payloadMessages = isLastAlreadyUserMsg
    ? slicedHistory.map((m) => ({ role: m.role, content: m.content }))
    : [
        ...slicedHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userText },
      ];

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch('/api/condo/chat', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messages: payloadMessages,
        client_context: buildCondoClientContext(),
        snapshot: buildCondoSnapshot(),
        ui_context: uiContext,
        current_focus: currentFocus,
        recently_displayed_result_keys: recentlyDisplayedResultKeys,
      }),
    });

    clearTimeout(timeoutId);

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // Diagnostic console logging for debugging stability
    console.info('[Condo Diagnostic]', {
      http_status: res.status,
      request_id: data?.request_id || 'N/A',
      error_type: data?.error_type || (res.ok ? 'none' : 'unknown'),
      message: data?.message || data?.error || data?.text || 'OK',
    });

    if (!res.ok || (data && data.ok === false) || (data && data.success === false)) {
      if (res.status === 401 || data?.error_type === 'auth_expired') {
        return {
          text: '⚠️ Sessão expirada. Por favor, recarregue a página ou faça login novamente no CRM.',
        };
      }
      if (res.status === 403) {
        return {
          text: '⚠️ Acesso negado. Você não tem permissão para esta operação no CRM.',
        };
      }
      if (res.status === 400) {
        return {
          text: `⚠️ Requisição inválida: ${data?.message || 'verifique os dados informados.'}`,
        };
      }

      const serverMsg = data?.message || data?.error || 'Erro interno no servidor.';
      return {
        text: `⚠️ ${serverMsg}`,
      };
    }

    if (data?.actionsExecuted && data.actionsExecuted.length > 0 && ctx.refreshAll) {
      ctx.refreshAll(true).catch(() => {});
    }

    return {
      text: data?.text || data?.message || 'Consulta realizada com sucesso.',
      actions: data?.actionsExecuted,
      results: data?.results,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.warn('[Condo] Request timeout (30s)');
      return {
        text: '⚠️ A resposta demorou muito tempo (timeout). Por favor, tente novamente.',
      };
    }

    console.error('[Condo Network/Client Error]:', err?.message || err);
    return {
      text: `⚠️ Falha ao se comunicar com o backend: ${err?.message || 'Erro de rede'}.`,
    };
  }
}
