import { createClient } from '@supabase/supabase-js';

export const EXPIRATION_BUFFER_MS = 5 * 60 * 1000; // 5 minutos de margem de segurança preventiva

export class GoogleCalendarAuthError extends Error {
  constructor(message, code, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'GoogleCalendarAuthError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }
  return '';
}

function getAdminClient() {
  const rawUrl = getEnvValue('VITE_SUPABASE_URL');
  const serviceKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

  if (!rawUrl || !serviceKey) {
    return null;
  }

  return createClient(rawUrl.trim(), serviceKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getValidGoogleTokenDetails(userId, options = {}) {
  const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!cleanUserId) {
    throw new GoogleCalendarAuthError(
      'Identificador de usuário (userId) obrigatório e não pode ser vazio.',
      'invalid_user_id',
      400
    );
  }

  const nowFn = options.nowFn || Date.now;
  const bufferMs = typeof options.bufferMs === 'number' ? options.bufferMs : EXPIRATION_BUFFER_MS;
  const fetchFn = options.fetchFn || fetch;

  const supabase = options.supabaseClient || getAdminClient();
  if (!supabase) {
    throw new GoogleCalendarAuthError(
      'Configuração do banco de dados indisponível no servidor.',
      'missing_oauth_configuration',
      500
    );
  }

  const { data: conn, error: connErr } = await supabase
    .from('google_calendar_connections')
    .select('*')
    .eq('user_id', cleanUserId)
    .single();

  if (connErr || !conn) {
    throw new GoogleCalendarAuthError(
      'Conta Google Calendar não conectada para este usuário.',
      'google_calendar_not_connected',
      404
    );
  }

  const accessToken = conn.access_token;
  const refreshToken = conn.refresh_token;
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : null;
  const googleEmail = conn.google_email || null;
  const scope = conn.scope || null;

  if (!refreshToken) {
    throw new GoogleCalendarAuthError(
      'Refresh token do Google ausente. Reautorização necessária.',
      'google_calendar_reauthorization_required',
      401
    );
  }

  const now = nowFn();
  const isExpired = expiresAt ? now + bufferMs >= expiresAt : false;

  if (!accessToken || isExpired) {
    const clientId = options.clientId || getEnvValue('GOOGLE_CLIENT_ID');
    const clientSecret = options.clientSecret || getEnvValue('GOOGLE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new GoogleCalendarAuthError(
        'Credenciais do Google OAuth ausentes no servidor.',
        'missing_oauth_configuration',
        500
      );
    }

    const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => null);
      if (tokenRes.status === 400 || tokenRes.status === 401) {
        throw new GoogleCalendarAuthError(
          'Falha ao atualizar token do Google. Reautorização necessária.',
          'google_calendar_reauthorization_required',
          401,
          { google_error: errBody }
        );
      }
      throw new GoogleCalendarAuthError(
        'Falha na comunicação com o servidor OAuth do Google.',
        'google_oauth_refresh_failed',
        502,
        { google_error: errBody }
      );
    }

    const tokenData = await tokenRes.json();
    const newAccessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600;
    const newExpiresAt = new Date(now + expiresIn * 1000).toISOString();
    const newScope = tokenData.scope || scope;

    const updatePayload = {
      access_token: newAccessToken,
      expires_at: newExpiresAt,
      scope: newScope,
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('google_calendar_connections')
      .update(updatePayload)
      .eq('user_id', cleanUserId);

    return {
      accessToken: newAccessToken,
      expiresAt: newExpiresAt,
      googleEmail,
      scope: newScope,
      wasRefreshed: true,
    };
  }

  return {
    accessToken,
    expiresAt: conn.expires_at || null,
    googleEmail,
    scope,
    wasRefreshed: false,
  };
}

export async function getValidGoogleAccessToken(userId, options = {}) {
  const details = await getValidGoogleTokenDetails(userId, options);
  return details.accessToken;
}

export function formatGoogleCalendarEvent(item) {
  const startDateTime = item?.start?.dateTime || item?.start?.date || null;
  const endDateTime = item?.end?.dateTime || item?.end?.date || null;
  const isAllDay = Boolean(item?.start?.date && !item?.start?.dateTime);

  const start = {
    dateTime: startDateTime,
    date: item?.start?.date || null,
    timeZone: item?.start?.timeZone || null,
    isAllDay,
  };

  const end = {
    dateTime: endDateTime,
    date: item?.end?.date || null,
    timeZone: item?.end?.timeZone || null,
    isAllDay,
  };

  const attendees = Array.isArray(item?.attendees)
    ? item.attendees.map((a) => ({
        email: a.email || null,
        displayName: a.displayName || null,
        responseStatus: a.responseStatus || null,
        self: Boolean(a.self),
      }))
    : null;

  const organizer = item?.organizer
    ? {
        email: item.organizer.email || null,
        displayName: item.organizer.displayName || null,
        self: Boolean(item.organizer.self),
      }
    : null;

  const hangoutLink =
    typeof item?.hangoutLink === 'string'
      ? item.hangoutLink
      : typeof item?.conferenceData?.entryPoints?.[0]?.uri === 'string'
      ? item.conferenceData.entryPoints[0].uri
      : null;

  return {
    id: item?.id || '',
    summary: item?.summary ?? null,
    description: item?.description ?? null,
    location: item?.location ?? null,
    htmlLink: item?.htmlLink ?? null,
    status: item?.status ?? null,
    start,
    end,
    attendees,
    organizer,
    hangoutLink,
  };
}

export async function fetchUpcomingGoogleCalendarEvents(accessToken, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const maxResults = options.maxResults ?? 20;
  const timeMin = options.timeMin || new Date().toISOString();

  const googleUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  googleUrl.searchParams.set('singleEvents', 'true');
  googleUrl.searchParams.set('orderBy', 'startTime');
  googleUrl.searchParams.set('timeMin', timeMin);
  googleUrl.searchParams.set('maxResults', String(maxResults));

  const response = await fetchFn(googleUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const googleErrorCode = errorBody?.error?.code || response.status;
    const googleErrorMessage = errorBody?.error?.message || response.statusText;

    if (response.status === 401) {
      throw new GoogleCalendarAuthError(
        'Reautorização do Google Calendar necessária.',
        'google_calendar_reauthorization_required',
        401,
        { google_error_code: googleErrorCode }
      );
    }

    throw new GoogleCalendarAuthError(
      'Falha ao buscar eventos da agenda Google.',
      'google_calendar_events_fetch_failed',
      response.status >= 400 && response.status < 600 ? response.status : 500,
      { google_error_code: googleErrorCode, message: googleErrorMessage }
    );
  }

  const data = await response.json().catch(() => null);
  const items = Array.isArray(data?.items) ? data.items : [];
  const events = items.map(formatGoogleCalendarEvent);

  return {
    count: events.length,
    events,
  };
}

export function buildEventSummary(interactionType, leadName) {
  const typeLabel = (interactionType || 'Compromisso').trim();
  const condoName = (leadName || 'Condomínio').trim();
  return `${typeLabel} — ${condoName}`;
}

export function buildEventDescription(
  leadName = null,
  interactionType = null,
  responsibleName = null,
  primaryContact = null,
  notes = null
) {
  const descLines = [];
  if (leadName) descLines.push(`Condomínio: ${leadName}`);
  if (interactionType) descLines.push(`Tipo: ${interactionType}`);
  if (responsibleName) descLines.push(`Responsável: ${responsibleName}`);
  if (primaryContact?.name) descLines.push(`Contato principal: ${primaryContact.name}`);
  if (primaryContact?.role_title) descLines.push(`Cargo: ${primaryContact.role_title}`);
  if (primaryContact?.phone) descLines.push(`Telefone: ${primaryContact.phone}`);
  if (primaryContact?.email) descLines.push(`E-mail: ${primaryContact.email}`);
  if (notes) descLines.push(`Observações: ${notes}`);

  descLines.push('');
  descLines.push('Abrir na Triverus:');
  descLines.push('https://triveruscondo.com/app/leads');

  return descLines.join('\n');
}

export async function createGoogleCalendarEventForInteraction(interactionId) {
  const supabase = getAdminClient();
  if (!supabase) {
    console.warn('[CREATE_CALENDAR_EVENT] Supabase admin client indisponível.');
    return { synced: false, reason: 'database_unavailable' };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, lead_id, interaction_type, notes, next_follow_up_at, responsible_user_id, google_event_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    console.warn('[CREATE_CALENDAR_EVENT] Interação não encontrada:', interactionId);
    return { synced: false, reason: 'interaction_not_found', status: 404 };
  }

  if (!interaction.next_follow_up_at) {
    return { synced: false, reason: 'no_next_follow_up_at' };
  }

// Lógica de sincronização segue sem early-return.

  const responsibleUserId = interaction.responsible_user_id;
  if (!responsibleUserId) {
    return { synced: false, reason: 'no_responsible_user_id' };
  }

  let accessToken;
  try {
    accessToken = await getValidGoogleAccessToken(responsibleUserId);
  } catch (err) {
    console.warn('[CREATE_CALENDAR_EVENT] Responsável sem conexão Google válida:', {
      responsible_user_id: responsibleUserId,
      error_code: err?.code,
      message: err?.message,
    });
    return { synced: false, reason: err?.code || 'google_calendar_not_connected' };
  }

  let leadName = 'Condomínio';
  const { data: leadData } = await supabase
    .from('leads')
    .select('id, name')
    .eq('id', interaction.lead_id)
    .single();
  if (leadData?.name) {
    leadName = leadData.name;
  }

  let responsibleName = 'Responsável';
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('id', responsibleUserId)
    .single();
  if (profileData?.name) {
    responsibleName = profileData.name;
  }

  let primaryContact = null;
  const { data: leadContactsData } = await supabase
    .from('lead_contacts')
    .select('contact_id')
    .eq('lead_id', interaction.lead_id);

  const contactIds = (leadContactsData || []).map((lc) => lc.contact_id).filter(Boolean);
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('id, name, role_title, phone, email, created_at')
      .in('id', contactIds)
      .order('created_at', { ascending: true });

    if (contactsData && contactsData.length > 0) {
      primaryContact = contactsData[0];
    }
  }

  const summary = buildEventSummary(interaction.interaction_type, leadName);
  const description = buildEventDescription(leadName, interaction.interaction_type, responsibleName, primaryContact, interaction.notes);

  const startDate = new Date(interaction.next_follow_up_at);
  if (Number.isNaN(startDate.getTime())) {
    return { synced: false, reason: 'invalid_next_follow_up_at' };
  }
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const eventPayload = {
    summary,
    description,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
  };

  const googleRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!googleRes.ok) {
    const errBody = await googleRes.json().catch(() => null);
    console.error('[CREATE_CALENDAR_EVENT] Falha ao criar evento no Google:', {
      status: googleRes.status,
      error: errBody,
    });
    return { synced: false, reason: 'google_api_error', status: googleRes.status, details: errBody };
  }

  const eventData = await googleRes.json();
  const googleEventId = eventData?.id;

  if (!googleEventId) {
    return { synced: false, reason: 'no_event_id_returned' };
  }

  const { error: updateErr } = await supabase
    .from('interactions')
    .update({ google_event_id: googleEventId })
    .eq('id', interactionId);

  if (updateErr) {
    console.error('[CREATE_CALENDAR_EVENT] Erro ao salvar google_event_id no Supabase:', updateErr);
    return { synced: false, reason: 'supabase_update_failed' };
  }

  return { synced: true, googleEventId };
}

export async function updateGoogleCalendarEventForInteraction(interactionId) {
  const supabase = getAdminClient();
  if (!supabase) {
    console.warn('[UPDATE_CALENDAR_EVENT] Supabase admin client indisponível.');
    return { synced: false, reason: 'database_unavailable' };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, lead_id, interaction_type, notes, next_follow_up_at, responsible_user_id, google_event_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    console.warn('[UPDATE_CALENDAR_EVENT] Interação não encontrada:', interactionId);
    return { synced: false, reason: 'interaction_not_found', status: 404 };
  }

  const hasGoogleEventId = Boolean(interaction.google_event_id && interaction.google_event_id.trim());
  const hasNextFollowUpAt = Boolean(interaction.next_follow_up_at);

  console.log('[FOLLOWUP_GOOGLE_UPDATE_TRIGGER]', {
    interaction_id: interactionId,
    has_google_event_id: hasGoogleEventId,
    has_next_follow_up_at: hasNextFollowUpAt,
    operation: 'update',
  });

  if (!hasNextFollowUpAt) {
    return { synced: false, reason: 'no_next_follow_up_at' };
  }

  if (!hasGoogleEventId) {
    return await createGoogleCalendarEventForInteraction(interactionId);
  }

  const responsibleUserId = interaction.responsible_user_id;
  if (!responsibleUserId) {
    return { synced: false, reason: 'no_responsible_user_id' };
  }

  let accessToken;
  try {
    accessToken = await getValidGoogleAccessToken(responsibleUserId);
  } catch (err) {
    console.warn('[UPDATE_CALENDAR_EVENT] Responsável sem conexão Google válida:', {
      responsible_user_id: responsibleUserId,
      error_code: err?.code,
      message: err?.message,
    });
    console.log('[FOLLOWUP_GOOGLE_UPDATE_RESULT]', {
      interaction_id: interactionId,
      http_status: 401,
      success: false,
      error_code: err?.code || 'google_calendar_not_connected',
    });
    return { synced: false, reason: err?.code || 'google_calendar_not_connected' };
  }

  let leadName = 'Condomínio';
  const { data: leadData } = await supabase
    .from('leads')
    .select('id, name')
    .eq('id', interaction.lead_id)
    .single();
  if (leadData?.name) {
    leadName = leadData.name;
  }

  let responsibleName = 'Responsável';
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('id', responsibleUserId)
    .single();
  if (profileData?.name) {
    responsibleName = profileData.name;
  }

  let primaryContact = null;
  const { data: leadContactsData } = await supabase
    .from('lead_contacts')
    .select('contact_id')
    .eq('lead_id', interaction.lead_id);

  const contactIds = (leadContactsData || []).map((lc) => lc.contact_id).filter(Boolean);
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('id, name, role_title, phone, email, created_at')
      .in('id', contactIds)
      .order('created_at', { ascending: true });

    if (contactsData && contactsData.length > 0) {
      primaryContact = contactsData[0];
    }
  }

  const summary = buildEventSummary(interaction.interaction_type, leadName);
  const description = buildEventDescription(leadName, interaction.interaction_type, responsibleName, primaryContact, interaction.notes);

  const startDate = new Date(interaction.next_follow_up_at);
  if (Number.isNaN(startDate.getTime())) {
    return { synced: false, reason: 'invalid_next_follow_up_at' };
  }
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const eventPayload = {
    summary,
    description,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
  };

  const googleEventId = interaction.google_event_id.trim();
  const googleUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`;

  const googleRes = await fetch(googleUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!googleRes.ok) {
    const errBody = await googleRes.json().catch(() => null);
    const status = googleRes.status;

    console.error('[UPDATE_CALENDAR_EVENT] Falha ao atualizar evento no Google:', {
      status,
      error: errBody,
      google_event_id: googleEventId,
    });

    console.log('[FOLLOWUP_GOOGLE_UPDATE_RESULT]', {
      interaction_id: interactionId,
      http_status: status,
      success: false,
      error_code: status === 404 ? 'google_event_not_found' : 'google_api_error',
    });

    if (status === 404) {
      return { synced: false, reason: 'google_event_not_found', status: 404, details: errBody };
    }

    return { synced: false, reason: 'google_api_error', status, details: errBody };
  }

  console.log('[FOLLOWUP_GOOGLE_UPDATE_RESULT]', {
    interaction_id: interactionId,
    http_status: googleRes.status,
    success: true,
    error_code: null,
  });

  return { synced: true, googleEventId };
}

export async function syncGoogleCalendarInteraction(interactionId) {
  const supabase = getAdminClient();
  if (!supabase) {
    return { synced: false, reason: 'database_unavailable' };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, google_event_id, next_follow_up_at')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    return { synced: false, reason: 'interaction_not_found', status: 404 };
  }

  console.log('[DEBUG_SYNC_INTERACTION]', { interactionId, google_event_id: interaction.google_event_id });

  const startTime = Date.now();
  
  let result;
  if (interaction.google_event_id && interaction.google_event_id.trim()) {
    result = await updateGoogleCalendarEventForInteraction(interactionId);
    result.action = 'updated';
  } else {
    result = await createGoogleCalendarEventForInteraction(interactionId);
    result.action = 'created';
  }

  const duration = Date.now() - startTime;
  console.log('[GOOGLE_CALENDAR_SYNC]', {
    interaction_id: interactionId,
    action: result.action,
    success: result.synced,
    google_http_status: result.status || (result.synced ? 200 : 500),
    google_duration_ms: duration,
  });

  return result;
}

export async function deleteGoogleCalendarEventForInteraction(interactionId) {
  const supabase = getAdminClient();
  if (!supabase) {
    return { success: false, reason: 'database_unavailable', status: 503 };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, google_event_id, responsible_user_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    // Se a interação já não existe no banco, considera sucesso idempotente
    return { success: true, deleted: false, reason: 'interaction_not_found', already_missing: true, status: 200 };
  }

  if (!interaction.google_event_id || !interaction.google_event_id.trim()) {
    return { success: true, deleted: false, reason: 'no_google_event', status: 200 };
  }

  const startTime = Date.now();
  let accessToken;
  try {
    accessToken = await getValidGoogleAccessToken(interaction.responsible_user_id);
  } catch (err) {
    console.warn('[GOOGLE_CALENDAR_DELETE] Falha ao obter token:', { interaction_id: interactionId, error: err?.code });
    return { success: false, reason: err?.code || 'google_calendar_not_connected', status: 401 };
  }

  const googleEventId = interaction.google_event_id.trim();
  const googleUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`;

  const googleRes = await fetch(googleUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const duration = Date.now() - startTime;
  let alreadyMissing = googleRes.status === 404 || googleRes.status === 410;

  if (!googleRes.ok && !alreadyMissing) {
    try {
      const errBody = await googleRes.json();
      const msg = JSON.stringify(errBody || '').toLowerCase();
      if (msg.includes('deleted') || msg.includes('not found') || msg.includes('notfound') || msg.includes('gone')) {
        alreadyMissing = true;
      }
    } catch {
      // Ignorar erro de parse JSON do corpo de erro
    }
  }

  if (!googleRes.ok && !alreadyMissing) {
    console.error('[GOOGLE_CALENDAR_DELETE] Falha ao excluir no Google:', {
      status: googleRes.status,
      interaction_id: interactionId,
    });
    return { success: false, reason: googleRes.status >= 500 ? 'google_calendar_delete_failed' : 'google_api_error', status: googleRes.status };
  }

  console.log('[GOOGLE_CALENDAR_DELETE]', {
    interaction_id: interactionId,
    success: true,
    google_http_status: googleRes.status,
    already_missing: alreadyMissing,
    google_duration_ms: duration,
  });

  return { success: true, deleted: !alreadyMissing, already_missing: alreadyMissing, reason: alreadyMissing ? 'already_missing' : 'success', status: 200 };
}


