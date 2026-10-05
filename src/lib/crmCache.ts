import type { Lead, PipelineStage, ServiceItem, LeadServiceRelation, Contact, LeadContactRelation, Interaction } from './crmStore.tsx';
import type { UserProfile } from '../App.tsx';

export const CRM_CACHE_KEY = 'triverus:crm-cache:v1';
export const TEMP_OVERRIDES_KEY = 'triverus:temperature-overrides:v1';
export const INTERACTION_TYPE_OVERRIDES_KEY = 'triverus:interaction-type-overrides:v1';
export const CRM_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

export interface CRMPersistentData {
  version: 1;
  cachedAt: number;
  leads: Lead[];
  stages: PipelineStage[];
  profiles: UserProfile[];
  services: ServiceItem[];
  leadServices: LeadServiceRelation[];
  contacts: Contact[];
  leadContacts: LeadContactRelation[];
  interactions: Interaction[];
}

/**
 * Lê os overrides locais de temperatura/status dos leads (ex: 'Cliente').
 */
export function getLeadTemperatureOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TEMP_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Salva o override local de temperatura do lead no localStorage.
 */
export function saveLeadTemperatureOverride(leadId: string, temperature: string): void {
  try {
    if (!leadId || !temperature) return;
    const current = getLeadTemperatureOverrides();
    current[leadId] = temperature;
    localStorage.setItem(TEMP_OVERRIDES_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn('[CRM Cache] Falha ao salvar override de temperatura:', err);
  }
}

/**
 * Lê os overrides locais do tipo de interação (ex: 'Visita', 'Evento', 'Redes Sociais').
 */
export function getInteractionTypeOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(INTERACTION_TYPE_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Salva o override local do tipo de interação no localStorage.
 */
export function saveInteractionTypeOverride(interactionId: string, type: string): void {
  try {
    if (!interactionId || !type) return;
    const current = getInteractionTypeOverrides();
    current[interactionId] = type;
    localStorage.setItem(INTERACTION_TYPE_OVERRIDES_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn('[CRM Cache] Falha ao salvar override de tipo de interação:', err);
  }
}

/**
 * Lê o cache persistente de forma síncrona para permitir hidratação imediata no frame 0.
 */
export function loadCRMCache(): CRMPersistentData | null {
  try {
    const raw = localStorage.getItem(CRM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.leads)) {
      return null;
    }

    const tempOverrides = getLeadTemperatureOverrides();
    if (parsed.leads && Object.keys(tempOverrides).length > 0) {
      parsed.leads = parsed.leads.map((l: Lead) => {
        if (tempOverrides[l.id]) {
          return { ...l, temperature: tempOverrides[l.id] };
        }
        return l;
      });
    }

    const intOverrides = getInteractionTypeOverrides();
    if (parsed.interactions && Object.keys(intOverrides).length > 0) {
      parsed.interactions = parsed.interactions.map((i: Interaction) => {
        if (intOverrides[i.id]) {
          return { ...i, interaction_type: intOverrides[i.id] };
        }
        return i;
      });
    }

    return parsed as CRMPersistentData;
  } catch (err) {
    console.warn('[CRM Cache] Falha ao ler cache local:', err);
    return null;
  }
}

/**
 * Salva os dados no cache persistente com timestamp cachedAt.
 */
export function saveCRMCache(data: Omit<CRMPersistentData, 'version' | 'cachedAt'>): void {
  try {
    const tempOverrides = getLeadTemperatureOverrides();
    const leadsWithOverrides = data.leads.map((l) => {
      if (tempOverrides[l.id]) {
        return { ...l, temperature: tempOverrides[l.id] };
      }
      return l;
    });

    const intOverrides = getInteractionTypeOverrides();
    const interactionsWithOverrides = data.interactions.map((i) => {
      if (intOverrides[i.id]) {
        return { ...i, interaction_type: intOverrides[i.id] };
      }
      return i;
    });

    const payload: CRMPersistentData = {
      version: 1,
      cachedAt: Date.now(),
      ...data,
      leads: leadsWithOverrides,
      interactions: interactionsWithOverrides,
    };
    localStorage.setItem(CRM_CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[CRM Cache] Falha ao persistir cache local:', err);
  }
}

/**
 * Remove completamente o cache (utilizado no logout).
 */
export function clearCRMCache(): void {
  try {
    localStorage.removeItem(CRM_CACHE_KEY);
    localStorage.removeItem(TEMP_OVERRIDES_KEY);
    localStorage.removeItem(INTERACTION_TYPE_OVERRIDES_KEY);
  } catch (err) {
    console.warn('[CRM Cache] Falha ao limpar cache:', err);
  }
}

/**
 * Verifica se o cache expirou (após 15 minutos), para marcar como stale.
 */
export function isCacheExpired(cachedAt: number): boolean {
  return Date.now() - cachedAt > CRM_CACHE_TTL_MS;
}
