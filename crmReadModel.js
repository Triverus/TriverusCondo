// Centralized Read Model for Condo (100% Read-Only)
// Reads directly from snapshot provided by the frontend UI or fallback Supabase client

export function findLead(snapshot, reference) {
  if (!reference || !snapshot) return null;
  const refStr = String(reference).trim().toLowerCase();
  if (!refStr) return null;

  const leads = snapshot.leads || [];

  // 1. Exact ID match
  const exactId = leads.find((l) => l.id === reference);
  if (exactId) return exactId;

  // 2. Exact Name match
  const exactName = leads.find((l) => (l.name || '').trim().toLowerCase() === refStr);
  if (exactName) return exactName;

  // 3. Partial Name match
  const partial = leads.filter((l) => (l.name || '').toLowerCase().includes(refStr));
  if (partial.length === 1) return partial[0];

  // 4. Letter prefix / suffix match (e.g. "Condomínio A" or "A")
  if (refStr.length <= 2) {
    const letterMatch = leads.find((l) => {
      const name = (l.name || '').toLowerCase();
      return name.endsWith(` ${refStr}`) || name === refStr;
    });
    if (letterMatch) return letterMatch;
  }

  return partial.length > 0 ? partial[0] : null;
}

export function findContact(snapshot, reference) {
  if (!reference || !snapshot) return null;
  const refStr = String(reference).trim().toLowerCase();
  if (!refStr) return null;

  const contacts = snapshot.contacts || [];

  const exactId = contacts.find((c) => c.id === reference);
  if (exactId) return exactId;

  const exactName = contacts.find((c) => (c.name || '').trim().toLowerCase() === refStr);
  if (exactName) return exactName;

  const partial = contacts.filter((c) => (c.name || '').toLowerCase().includes(refStr));
  return partial.length > 0 ? partial[0] : null;
}

export function searchMentions(snapshot, reference) {
  if (!reference || !snapshot) return { found: false, term: reference };
  const refStr = String(reference).trim().toLowerCase();
  if (!refStr) return { found: false, term: reference };

  const contacts = snapshot.contacts || [];
  const leads = snapshot.leads || [];
  const interactions = snapshot.interactions || [];

  const matchedContacts = contacts.filter((c) => (c.name || '').toLowerCase().includes(refStr));
  const matchedLeads = leads.filter(
    (l) => (l.name || '').toLowerCase().includes(refStr) || (l.administrator || '').toLowerCase().includes(refStr)
  );

  const matchedNotes = [];
  const leadMap = new Map((snapshot.leads || []).map((l) => [l.id, l.name]));

  interactions.forEach((i) => {
    const text = i.notes || '';
    if (text.toLowerCase().includes(refStr)) {
      matchedNotes.push({
        id: i.id,
        lead_id: i.lead_id,
        lead_name: leadMap.get(i.lead_id) || 'Condomínio',
        text,
        occurred_at: i.occurred_at,
        interaction_type: i.interaction_type,
      });
    }
  });

  const found = matchedContacts.length > 0 || matchedLeads.length > 0 || matchedNotes.length > 0;

  return {
    found,
    term: reference,
    matchedContacts,
    matchedLeads,
    matchedNotes,
  };
}

export function getLeadContacts(snapshot, leadId) {
  if (!snapshot || !leadId) return [];
  const leadContacts = snapshot.leadContacts || [];
  const contacts = snapshot.contacts || [];

  const targetContactIds = leadContacts
    .filter((lc) => lc.lead_id === leadId)
    .map((lc) => lc.contact_id);

  return contacts.filter((c) => targetContactIds.includes(c.id));
}

export function getLeadNotes(snapshot, leadId) {
  if (!snapshot || !leadId) return [];
  if (snapshot.notesByLeadId && snapshot.notesByLeadId[leadId]) {
    return snapshot.notesByLeadId[leadId];
  }

  const interactions = snapshot.interactions || [];
  return interactions
    .filter((i) => i.lead_id === leadId)
    .sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime());
}

export function getLatestLeadNote(snapshot, leadId) {
  const notes = getLeadNotes(snapshot, leadId);
  return notes.length > 0 ? notes[0] : null;
}

export function getLeadFolderLink(snapshot, leadId) {
  if (!snapshot || !leadId) return null;

  // 1. Primary UI source: folderLinks from snapshot
  if (snapshot.folderLinks && snapshot.folderLinks[leadId]) {
    const url = snapshot.folderLinks[leadId];
    if (url && typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      const lead = (snapshot.leads || []).find((l) => l.id === leadId);
      return {
        found: true,
        url: url.trim(),
        lead_id: leadId,
        lead_name: lead?.name || 'Condomínio',
      };
    }
  }

  // 2. Secondary source: lead address/notes in snapshot
  const lead = (snapshot.leads || []).find((l) => l.id === leadId);
  if (lead) {
    if (lead.address && /^https?:\/\//i.test(lead.address.trim())) {
      return {
        found: true,
        url: lead.address.trim(),
        lead_id: leadId,
        lead_name: lead.name,
      };
    }
    if (lead.notes) {
      const match = lead.notes.match(/(https?:\/\/[^\s<]+)/i);
      if (match) {
        return {
          found: true,
          url: match[0],
          lead_id: leadId,
          lead_name: lead.name,
        };
      }
    }
  }

  // 3. Interactions notes
  const notes = getLeadNotes(snapshot, leadId);
  for (const n of notes) {
    const text = n.text || n.notes || '';
    const match = text.match(/(https?:\/\/[^\s<]+)/i);
    if (match) {
      return {
        found: true,
        url: match[0],
        lead_id: leadId,
        lead_name: lead?.name || 'Condomínio',
      };
    }
  }

  return {
    found: false,
    lead_id: leadId,
    lead_name: lead?.name || 'Condomínio',
  };
}

export function parseDateTime(dateStr) {
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

export function dedupeById(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    if (item && item.id) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
  });
  return Array.from(map.values());
}

export function getLeadFollowups(snapshot, leadId, filter = 'all') {
  if (!snapshot) return [];
  const interactions = snapshot.interactions || [];
  const leads = snapshot.leads || [];
  const leadMap = new Map(leads.map((l) => [l.id, l]));

  const interactionsByLead = new Map();
  interactions.forEach((i) => {
    if (!i || !i.lead_id) return;
    if (leadId && i.lead_id !== leadId) return;
    const existing = interactionsByLead.get(i.lead_id) || [];
    existing.push(i);
    interactionsByLead.set(i.lead_id, existing);
  });

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmrStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const canonical = [];
  interactionsByLead.forEach((leadInts, lid) => {
    const lead = leadMap.get(lid);
    const sorted = [...leadInts].sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime());
    const latest = sorted[0];

    if (latest && latest.next_follow_up_date && String(latest.next_follow_up_date).trim() !== '') {
      const { date, time, timestamp } = parseDateTime(latest.next_follow_up_date);
      const followupDatePrefix = String(latest.next_follow_up_date).trim().slice(0, 10);

      let status = 'upcoming';
      if (followupDatePrefix < todayStr) status = 'overdue';
      else if (followupDatePrefix === todayStr) status = 'today';
      else if (followupDatePrefix === tmrStr) status = 'tomorrow';

      if (filter === 'overdue' && status !== 'overdue') return;
      if (filter === 'today' && status !== 'today') return;
      if (filter === 'tomorrow' && status !== 'tomorrow') return;
      if (filter === 'upcoming' && status === 'overdue') return;

      canonical.push({
        id: latest.id,
        lead_id: lid,
        lead_name: lead?.name || 'Condomínio',
        interaction_type: latest.interaction_type || 'Contato Agendado',
        notes: latest.notes || '',
        date,
        time,
        next_follow_up_date_br: time ? `${date} às ${time}` : date,
        scheduled_at: latest.next_follow_up_date,
        status,
        timestamp,
      });
    }
  });

  return dedupeById(canonical);
}

export function getLeadServices(snapshot, leadId) {
  if (!snapshot || !leadId) return [];
  const leadServices = snapshot.leadServices || [];
  const services = snapshot.services || [];

  const targetServiceIds = leadServices
    .filter((ls) => ls.lead_id === leadId)
    .map((ls) => ls.service_id);

  return services.filter((s) => targetServiceIds.includes(s.id));
}

export function getLeadSummary(snapshot, leadId) {
  const lead = findLead(snapshot, leadId);
  if (!lead) return null;

  const contacts = getLeadContacts(snapshot, lead.id);
  const latestNote = getLatestLeadNote(snapshot, lead.id);
  const folderLink = getLeadFolderLink(snapshot, lead.id);
  const followups = getLeadFollowups(snapshot, lead.id);

  return {
    lead,
    contacts,
    latestNote,
    folderLink,
    activeFollowUp: followups.length > 0 ? followups[0] : null,
  };
}

export function resolveReference(snapshot, reference, contextRefs) {
  if (!reference && contextRefs?.lead?.id) {
    return { found: true, lead: findLead(snapshot, contextRefs.lead.id) };
  }

  if (!reference) return { found: false };

  // 1. Try finding lead
  const lead = findLead(snapshot, reference);
  if (lead) return { found: true, lead, type: 'lead' };

  // 2. Try finding contact
  const contact = findContact(snapshot, reference);
  if (contact) return { found: true, contact, type: 'contact' };

  // 3. Search mentions across notes, leads, contacts
  const mentions = searchMentions(snapshot, reference);
  if (mentions.found) {
    return { found: true, mentions, type: 'mentions' };
  }

  return { found: false };
}

export function getLeadsByStage(snapshot, stageQuery) {
  if (!snapshot || !stageQuery) return [];
  const q = String(stageQuery).trim().toLowerCase();
  const stages = snapshot.stages || [];
  const leads = snapshot.leads || [];

  // Find matching stage
  const matchedStage = stages.find(
    (s) =>
      s.id === stageQuery ||
      (s.name || '').toLowerCase() === q ||
      (s.name || '').toLowerCase().includes(q)
  );

  if (matchedStage) {
    return leads.filter((l) => (l.current_stage_id || stages[0]?.id) === matchedStage.id);
  }

  return [];
}

export function searchCRM(snapshot, query) {
  if (!snapshot) return { leads: [], contacts: [], mentions: [] };
  const q = (query || '').trim().toLowerCase();

  const stages = snapshot.stages || [];
  const stageMap = new Map(stages.map((s) => [s.id, (s.name || '').toLowerCase()]));

  if (!q) {
    return {
      leads: (snapshot.leads || []).slice(0, 10),
      contacts: (snapshot.contacts || []).slice(0, 10),
    };
  }

  const leads = (snapshot.leads || []).filter((l) => {
    const stageName = l.current_stage_id ? stageMap.get(l.current_stage_id) || '' : '';
    return (
      (l.name || '').toLowerCase().includes(q) ||
      (l.city || '').toLowerCase().includes(q) ||
      (l.administrator || '').toLowerCase().includes(q) ||
      stageName.includes(q) ||
      (l.temperature || '').toLowerCase().includes(q)
    );
  });

  const contacts = (snapshot.contacts || []).filter(
    (c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.role_title || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
  );

  const mentions = searchMentions(snapshot, q);

  return {
    leads: leads.slice(0, 10),
    contacts: contacts.slice(0, 10),
    mentions: mentions.found ? mentions : null,
  };
}
