export interface CondoClientContext {
  folderLinks: Record<string, string>;
}

export function buildCondoClientContext(): CondoClientContext {
  const folderLinks: Record<string, string> = {};

  try {
    const raw = localStorage.getItem('triverus:lead-folder-links:v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.assign(folderLinks, parsed);
      }
    }
  } catch (err) {
    console.warn('[Condo ClientContext] Error reading folder links:', err);
  }

  return { folderLinks };
}
