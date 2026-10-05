const FOLLOWUP_TIMES_STORAGE_KEY = 'triverus:followup-times:v1';

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
 * Extracts "YYYY-MM-DD" in local calendar representation from any date string.
 */
export function toDateInputValue(dateStr?: string | null): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
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
  const d = parseCalendarDate(dateStr);
  if (!d) return dateStr || '-';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Persists custom follow-up time (HH:mm) so it survives even if Postgres column is DATE-only.
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
 * Reads the follow-up time (HH:mm) from the date string or local persistence fallback.
 */
export function getFollowUpTime(
  dateStr?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): string {
  if (dateStr) {
    const timeMatch = dateStr.trim().match(/[T\s](\d{2}:\d{2})/);
    if (timeMatch && timeMatch[1] !== '00:00') {
      return timeMatch[1];
    }
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

export function formatTimeBR(
  dateStr?: string | null,
  interactionId?: string | null,
  leadId?: string | null
): string {
  return getFollowUpTime(dateStr, interactionId, leadId);
}
