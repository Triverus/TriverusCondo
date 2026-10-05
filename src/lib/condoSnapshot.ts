import { loadCRMCache } from './crmCache.ts';
import { dedupeById, selectNotesForLead, selectCanonicalFollowups } from './crmSelectors.ts';

export interface CondoSnapshot {
  version: 1;
  generatedAt: string;
  leads: any[];
  contacts: any[];
  leadContacts: any[];
  interactions: any[];
  pipelineStages: any[];
  profiles: any[];
  services: any[];
  leadServices: any[];
  canonicalNotes: Record<string, any[]>;
  canonicalFollowups: any[];
  folderLinks: Record<string, string>;
}

export function buildCondoSnapshot(crmState?: {
  leads?: any[];
  contacts?: any[];
  leadContacts?: any[];
  interactions?: any[];
  stages?: any[];
  profiles?: any[];
  services?: any[];
  leadServices?: any[];
}): CondoSnapshot {
  const cached = loadCRMCache();

  const leads = dedupeById(crmState?.leads && crmState.leads.length > 0 ? crmState.leads : (cached?.leads || []));
  const contacts = dedupeById(crmState?.contacts && crmState.contacts.length > 0 ? crmState.contacts : (cached?.contacts || []));
  const leadContacts = crmState?.leadContacts && crmState.leadContacts.length > 0 ? crmState.leadContacts : (cached?.leadContacts || []);
  const interactions = dedupeById(crmState?.interactions && crmState.interactions.length > 0 ? crmState.interactions : (cached?.interactions || []));
  const pipelineStages = dedupeById(crmState?.stages && crmState.stages.length > 0 ? crmState.stages : (cached?.stages || []));
  const profiles = dedupeById(crmState?.profiles && crmState.profiles.length > 0 ? crmState.profiles : (cached?.profiles || []));
  const services = dedupeById(crmState?.services && crmState.services.length > 0 ? crmState.services : (cached?.services || []));
  const leadServices = crmState?.leadServices && crmState.leadServices.length > 0 ? crmState.leadServices : (cached?.leadServices || []);

  const folderLinks: Record<string, string> = {};
  try {
    const rawFolderLinks = localStorage.getItem('triverus:lead-folder-links:v1');
    if (rawFolderLinks) {
      const parsed = JSON.parse(rawFolderLinks);
      if (parsed && typeof parsed === 'object') {
        Object.assign(folderLinks, parsed);
      }
    }
  } catch (err) {
    console.warn('[Condo Snapshot] Error reading folder links from localStorage:', err);
  }

  const canonicalNotes: Record<string, any[]> = {};
  leads.forEach((l) => {
    canonicalNotes[l.id] = selectNotesForLead(interactions, l.id);
  });

  const stageMap = new Map(pipelineStages.map((s: any) => [s.id, s.name]));
  const profileMap = new Map(profiles.map((p: any) => [p.id, p.full_name]));
  const canonicalFollowups = selectCanonicalFollowups(interactions, leads, profileMap, stageMap);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    leads,
    contacts,
    leadContacts,
    interactions,
    pipelineStages,
    profiles,
    services,
    leadServices,
    canonicalNotes,
    canonicalFollowups,
    folderLinks,
  };
}
