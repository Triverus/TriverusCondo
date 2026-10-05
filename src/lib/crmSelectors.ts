// Shared CRM Selectors (Shared between UI and Condo)

export function parseDateTime(dateStr?: string | null): { date: string; time: string; timestamp: number } {
  if (!dateStr) return { date: '', time: '', timestamp: 0 };
  const trimmed = String(dateStr).trim();
  let dt = new Date(trimmed);
  if (isNaN(dt.getTime())) {
    dt = new Date();
  }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const date = `${dd}/${mm}/${yyyy}`;

  let time = '';
  const timeMatch = trimmed.match(/T(\d{2}:\d{2})|(\d{2}:\d{2})/);
  if (timeMatch) {
    time = timeMatch[1] || timeMatch[2];
  } else if (!trimmed.includes('T') && trimmed.length > 10) {
    const parts = trimmed.split(' ');
    if (parts[1]) time = parts[1].slice(0, 5);
  }

  return {
    date,
    time: time || '',
    timestamp: dt.getTime(),
  };
}

export function dedupeById<T extends { id?: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  (items || []).forEach((item) => {
    if (item && item.id) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
  });
  return Array.from(map.values());
}

export function selectInteractionsForLead(interactions: any[], leadId: string): any[] {
  if (!interactions || !leadId) return [];
  const filtered = interactions.filter((i) => i && i.lead_id === leadId);
  const deduped = dedupeById(filtered);
  return deduped.sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime());
}

export function selectNotesForLead(interactions: any[], leadId: string): any[] {
  const ints = selectInteractionsForLead(interactions, leadId);
  return ints.map((i) => {
    const { date, time } = parseDateTime(i.occurred_at);
    return {
      id: i.id,
      leadId: i.lead_id,
      text: i.notes || '',
      interactionType: i.interaction_type || 'Nota',
      date,
      time,
      occurredAt: i.occurred_at,
      nextFollowUpDate: i.next_follow_up_date,
      responsibleUserId: i.responsible_user_id,
    };
  });
}

export function selectLatestNoteForLead(interactions: any[], leadId: string) {
  const notes = selectNotesForLead(interactions, leadId);
  return notes.length > 0 ? notes[0] : null;
}

export function selectCanonicalFollowups(interactions: any[], leads: any[], profileMap: Map<string, string>, stageMap: Map<string, string>): any[] {
  const leadMap = new Map((leads || []).map((l) => [l.id, l]));
  const items: any[] = [];

  const interactionsByLead = new Map<string, any[]>();
  (interactions || []).forEach((i) => {
    if (!i || !i.lead_id) return;
    const existing = interactionsByLead.get(i.lead_id) || [];
    existing.push(i);
    interactionsByLead.set(i.lead_id, existing);
  });

  interactionsByLead.forEach((leadInts, leadId) => {
    const lead = leadMap.get(leadId);
    if (!lead) return;

    const sorted = [...leadInts].sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime());
    const latest = sorted[0];

    if (latest && latest.next_follow_up_date && String(latest.next_follow_up_date).trim() !== '') {
      const { date, time, timestamp } = parseDateTime(latest.next_follow_up_date);
      const responsibleId = latest.responsible_user_id || lead.responsible_user_id;
      const responsibleName = responsibleId ? profileMap.get(responsibleId) || 'Não atribuído' : 'Não atribuído';
      const stageName = lead.current_stage_id ? stageMap.get(lead.current_stage_id) || 'Estágio Inicial' : 'Estágio Inicial';

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const followupDatePrefix = String(latest.next_follow_up_date).trim().slice(0, 10);

      let status: 'overdue' | 'today' | 'upcoming' = 'upcoming';
      if (followupDatePrefix < todayStr) status = 'overdue';
      else if (followupDatePrefix === todayStr) status = 'today';

      items.push({
        id: latest.id,
        leadId: lead.id,
        leadName: lead.name,
        date,
        time,
        scheduledAt: latest.next_follow_up_date,
        interactionType: latest.interaction_type || 'Contato Agendado',
        notes: latest.notes || '',
        responsibleUserId: responsibleId,
        responsibleName,
        stageName,
        status,
        timestamp,
      });
    }
  });

  return dedupeById(items);
}

export function selectFolderLink(lead: any, folderLinksMap: Record<string, string>, interactions: any[]): string | null {
  if (!lead) return null;
  if (folderLinksMap && folderLinksMap[lead.id]) {
    const u = folderLinksMap[lead.id];
    if (u && typeof u === 'string' && /^https?:\/\//i.test(u.trim())) return u.trim();
  }
  if (lead.address && /^https?:\/\//i.test(lead.address.trim())) {
    return lead.address.trim();
  }
  if (lead.notes) {
    const match = lead.notes.match(/(https?:\/\/[^\s<]+)/i);
    if (match) return match[0];
  }
  const ints = selectInteractionsForLead(interactions, lead.id);
  for (const i of ints) {
    const text = i.notes || '';
    const match = text.match(/(https?:\/\/[^\s<]+)/i);
    if (match) return match[0];
  }
  return null;
}

export function selectLeadResponsible(lead: any, profiles: any[]): { userId: string; fullName: string; role: string } | null {
  if (!lead || !lead.responsible_user_id) return null;
  const p = (profiles || []).find((pr) => pr.id === lead.responsible_user_id);
  if (!p) return { userId: lead.responsible_user_id, fullName: 'Não atribuído', role: '' };
  return {
    userId: p.id,
    fullName: p.full_name || 'Sem nome',
    role: p.role || '',
  };
}
