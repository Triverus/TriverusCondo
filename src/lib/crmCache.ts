import type { Lead, PipelineStage, ServiceItem, LeadServiceRelation, Contact, LeadContactRelation, Interaction } from './crmStore.tsx';
import type { UserProfile } from '../App.tsx';

export const CRM_CACHE_KEY = 'triverus:crm-cache:v1';
export const TEMP_OVERRIDES_KEY = 'triverus:temperature-overrides:v1';
export const STAGE_OVERRIDES_KEY = 'triverus:stage-overrides:v1';
export const LOSS_REASON_OVERRIDES_KEY = 'triverus:loss-reason-overrides:v1';
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
 * Lê os overrides locais de estágio dos leads.
 */
export function getLeadStageOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STAGE_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Salva o override local de estágio do lead no localStorage.
 */
export function saveLeadStageOverride(leadId: string, stageId: string, lossReason?: string | null): void {
  try {
    if (!leadId || !stageId) return;
    const currentStages = getLeadStageOverrides();
    currentStages[leadId] = stageId;
    localStorage.setItem(STAGE_OVERRIDES_KEY, JSON.stringify(currentStages));

    const rawReasons = localStorage.getItem(LOSS_REASON_OVERRIDES_KEY);
    const currentReasons: Record<string, string> = rawReasons ? JSON.parse(rawReasons) : {};
    if (lossReason) {
      currentReasons[leadId] = lossReason;
    } else {
      delete currentReasons[leadId];
    }
    localStorage.setItem(LOSS_REASON_OVERRIDES_KEY, JSON.stringify(currentReasons));
  } catch (err) {
    console.warn('[CRM Cache] Falha ao salvar override de estágio:', err);
  }
}

/**
 * Lê os overrides locais de motivo de perda dos leads.
 */
export function getLeadLossReasonOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOSS_REASON_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Lê os overrides locais de temperatura/status dos leads.
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
    const stageOverrides = getLeadStageOverrides();
    const lossReasonOverrides = getLeadLossReasonOverrides();

    if (parsed.leads && (Object.keys(tempOverrides).length > 0 || Object.keys(stageOverrides).length > 0 || Object.keys(lossReasonOverrides).length > 0)) {
      parsed.leads = parsed.leads.map((l: Lead) => {
        let updated = { ...l };
        if (tempOverrides[l.id]) {
          updated.temperature = tempOverrides[l.id];
        }
        if (stageOverrides[l.id]) {
          updated.current_stage_id = stageOverrides[l.id];
        }
        if (lossReasonOverrides[l.id] !== undefined) {
          updated.loss_reason = lossReasonOverrides[l.id];
        }
        return updated;
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
    localStorage.removeItem(STAGE_OVERRIDES_KEY);
    localStorage.removeItem(LOSS_REASON_OVERRIDES_KEY);
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
