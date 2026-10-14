const FOLLOWUP_TIMES_STORAGE_KEY = 'triverus:followup-times:v1';

export const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

/**
 * Parses a date or ISO string safely without UTC-midnight timezone shift.
 * Ensures "YYYY-MM-DD" or "YYYY-MM-DDT00:00:00Z" always represents that exact calendar day in local time.
 */
export function parseCalendarDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // 1. Date-only "YYYY-MM-DD" or UTC midnight "YYYY-MM-DDT00:00:00..."
  const dateOnlyMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s]00:00(?::00(?:\.\d+)?)?(?:Z|[+-]00:?00)?$)/
  );
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  // 2. Local ISO datetime "YYYY-MM-DDTHH:mm(:ss)" without Z or timezone offset
  const localIsoMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (localIsoMatch && !/[Z+-]\d*$/.test(trimmed)) {
    const year = Number(localIsoMatch[1]);
    const month = Number(localIsoMatch[2]);
    const day = Number(localIsoMatch[3]);
    const hour = Number(localIsoMatch[4]);
    const minute = Number(localIsoMatch[5]);
    const second = Number(localIsoMatch[6] || 0);
    return new Date(year, month - 1, day, hour, minute, second);
  }

  // 3. Full ISO timestamp with timezone offset
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Constrói string ISO 8601 com offset explícito para o fuso brasileiro (America/Sao_Paulo: UTC-3).
 * Exemplo: ("2026-10-25", "14:30") -> "2026-10-25T14:30:00-03:00"
 */
export function buildSaoPauloIsoDateTime(dateInput: string, timeInput?: string | null): string {
  const cleanDate = toDateInputValue(dateInput) || dateInput.trim().slice(0, 10);
  const rawTime = (timeInput || '').trim();
  const cleanTime = rawTime && /^\d{2}:\d{2}/.test(rawTime) ? rawTime.slice(0, 5) : '09:00';
  return `${cleanDate}T${cleanTime}:00-03:00`;
}

/**
 * Extrai o horário (HH:mm) formatado no fuso America/Sao_Paulo a partir de um timestamp ISO.
 */
export function extractSaoPauloTime(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Se for apenas data pura "YYYY-MM-DD", não contém horário
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  // Timestamp ISO com fuso (Z ou offset)
  if (trimmed.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('pt-BR', {
          timeZone: BRAZIL_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
      }
    } catch {}
  }

  // Local ISO com "T" ou espaço
  const localMatch = trimmed.match(/[T\s](\d{2}:\d{2})/);
  if (localMatch && localMatch[1] !== '00:00') {
    return localMatch[1];
  }

  return null;
}

/**
 * Extracts "YYYY-MM-DD" in local calendar representation from any date string.
 * Se o valor for um timestamp ISO completo com offset/Z, converte para a data no fuso de São Paulo.
 */
export function toDateInputValue(dateStr?: string | null): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  if (trimmed.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: BRAZIL_TIMEZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(d);
      }
    } catch {}
  }

  const prefixMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefixMatch && (!trimmed.includes('T') || trimmed.includes('T00:00'))) {
    return prefixMatch[1];
  }
  const d = parseCalendarDate(trimmed);
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formats any date string to Brazilian format DD/MM/YYYY without timezone day-shift.
 */
export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const trimmed = dateStr.trim();
  if (!trimmed) return '-';

  if (trimmed.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('pt-BR', {
          timeZone: BRAZIL_TIMEZONE,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(d);
      }
    } catch {}
  }

  const d = parseCalendarDate(trimmed);
  if (!d) return dateStr || '-';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Persists custom follow-up time (HH:mm) so it survives even if Postgres column is DATE-only.
 * Mantido como compatibilidade temporária para follow-ups legados.
 */
export function saveFollowUpTime(interactionId: string | undefined | null, leadId: string | undefined | null, timeStr: string): void {
  if (!timeStr) return;
  try {
    const raw = localStorage.getItem(FOLLOWUP_TIMES_STORAGE_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    if (interactionId) map[`int:${interactionId}`] = timeStr;
    if (leadId) map[`lead:${leadId}`] = timeStr;
    localStorage.setItem(FOLLOWUP_TIMES_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Reads the follow-up time (HH:mm) with priority:
 * 1. Timestamp oficial (com timezone America/Sao_Paulo)
 * 2. Fallback para localStorage legado
 * 3. Fallback final '09:00'
 */
export function getFollowUpTime(
  dateStr?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): string {
  if (dateStr) {
    const spTime = extractSaoPauloTime(dateStr);
    if (spTime) return spTime;
  }
  try {
    const raw = localStorage.getItem(FOLLOWUP_TIMES_STORAGE_KEY);
    if (raw) {
      const map: Record<string, string> = JSON.parse(raw);
      if (interactionId && map[`int:${interactionId}`]) {
        return map[`int:${interactionId}`];
      }
      if (leadId && map[`lead:${leadId}`]) {
        return map[`lead:${leadId}`];
      }
    }
  } catch {}
  return '09:00';
}

/**
 * Resolve data (YYYY-MM-DD) e horário (HH:mm) com hierarquia oficial:
 * 1. next_follow_up_at do banco (oficial timestamptz)
 * 2. next_follow_up_date (banco) + localStorage legado
 * 3. Fallback final
 */
export function resolveFollowUpDateAndTime(
  nextFollowUpAt?: string | null,
  nextFollowUpDate?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): { date: string; time: string; source: 'database' | 'localStorage' | 'fallback' } {
  // 1. Prioridade absoluta: next_follow_up_at do banco
  if (nextFollowUpAt && String(nextFollowUpAt).trim() !== '') {
    const date = toDateInputValue(nextFollowUpAt);
    const time = extractSaoPauloTime(nextFollowUpAt) || '09:00';
    return { date, time, source: 'database' };
  }

  // 2. Fallback legado: next_follow_up_date + localStorage
  if (nextFollowUpDate && String(nextFollowUpDate).trim() !== '') {
    const date = toDateInputValue(nextFollowUpDate);
    const timeFromStorage = (() => {
      try {
        const raw = localStorage.getItem(FOLLOWUP_TIMES_STORAGE_KEY);
        if (raw) {
          const map: Record<string, string> = JSON.parse(raw);
          if (interactionId && map[`int:${interactionId}`]) return map[`int:${interactionId}`];
          if (leadId && map[`lead:${leadId}`]) return map[`lead:${leadId}`];
        }
      } catch {}
      return null;
    })();

    if (timeFromStorage) {
      return { date, time: timeFromStorage, source: 'localStorage' };
    }
    return { date, time: '09:00', source: 'fallback' };
  }

  return { date: '', time: '09:00', source: 'fallback' };
}

export function formatTimeBR(
  dateStr?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): string {
  return getFollowUpTime(dateStr, interactionId, leadId);
}

export interface HasFollowUp {
  id?: string;
  lead_id?: string;
  next_follow_up_at?: string | null;
  next_follow_up_date?: string | null;
  occurred_at?: string | null;
  [key: string]: any;
}

/**
 * Localiza a interação que representa o follow-up ativo do lead:
 * 1. Ordena as interações por occurred_at DESC (mais recente primeiro).
 * 2. Examina exclusivamente a interação mais recente.
 * 3. Se ela possuir next_follow_up_at ou next_follow_up_date, retorna essa interação.
 * 4. Caso contrário, retorna null (não busca interações históricas anteriores).
 */
export function getActiveFollowUpInteraction<T extends HasFollowUp>(interactions: T[]): T | null {
  if (!interactions || interactions.length === 0) return null;

  const sorted = [...interactions].sort((a, b) => {
    const timeOccurredB = new Date(b.occurred_at || 0).getTime();
    const timeOccurredA = new Date(a.occurred_at || 0).getTime();
    return timeOccurredB - timeOccurredA;
  });

  const latest = sorted[0];
  if (!latest) return null;

  const hasFollowUp = (latest.next_follow_up_at && String(latest.next_follow_up_at).trim() !== '') ||
                      (latest.next_follow_up_date && String(latest.next_follow_up_date).trim() !== '');

  if (hasFollowUp) {
    return latest;
  }

  return null;
}
