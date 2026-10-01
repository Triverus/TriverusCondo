/**
 * Utilities for automatic draft persistence using sessionStorage
 */

export function saveDraft<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (err) {
    console.warn('Failed to save draft to sessionStorage', err);
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed?.data as T) ?? null;
  } catch (err) {
    console.warn('Failed to load draft from sessionStorage', err);
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch (err) {
    console.warn('Failed to clear draft from sessionStorage', err);
  }
}

export function hasDraft(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
