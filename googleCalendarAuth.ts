import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

export const EXPIRATION_BUFFER_MS = 5 * 60 * 1000; // 5 minutos de margem de segurança preventiva

export class GoogleCalendarAuthError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, any>;

  constructor(message: string, code: string, statusCode = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'GoogleCalendarAuthError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface GoogleTokenDetails {
  accessToken: string;
  expiresAt: string | null;
  googleEmail: string | null;
  scope: string | null;
  wasRefreshed: boolean;
}

export interface GetValidGoogleAccessTokenOptions {
  supabaseClient?: SupabaseClient | any;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  bufferMs?: number;
  clientId?: string;
  clientSecret?: string;
}

let cachedEnv: Record<string, string> | null = null;
function getEnvValue(key: string): string {
  if (process.env[key]) {
    return process.env[key]!;
  }
  if (!cachedEnv) {
    try {
      cachedEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
    } catch {
      cachedEnv = {};
    }
  }
  return cachedEnv[key] || '';
}

function getAdminClient(): SupabaseClient | null {
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

/**
 * Obtém os detalhes do token válido do Google Calendar para o usuário especificado.
 * Executa o refresh automático de forma transparente caso esteja expirado ou dentro da margem de 5 minutos.
 */
export async function getValidGoogleTokenDetails(
  userId: string,
  options?: GetValidGoogleAccessTokenOptions
): Promise<GoogleTokenDetails> {
  const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!cleanUserId) {
    throw new GoogleCalendarAuthError(
      'Identificador de usuário (userId) obrigatório e não pode ser vazio.',
      'invalid_user_id',
      400
    );
  }

  const nowFn = options?.nowFn || Date.now;
  const bufferMs = typeof options?.bufferMs === 'number' ? options.bufferMs : EXPIRATION_BUFFER_MS;
  const fetchFn = options?.fetchFn || fetch;

  const supabase = options?.supabaseClient || getAdminClient();
  if (!supabase) {
    console.error('[GOOGLE_CALENDAR_AUTH] Cliente admin Supabase indisponível. Verifique SUPABASE_SERVICE_ROLE_KEY e VITE_SUPABASE_URL.');
    throw new GoogleCalendarAuthError(
      'Configuração do banco de dados indisponível no servidor.',
      'missing_oauth_configuration',
      500
    );
  }

  // 1. Buscar conexão existente no banco
  let connection: any = null;
  try {
    const { data, error } = await supabase
      .from('google_calendar_connections')
      .select('id, user_id, google_email, access_token, refresh_token, expires_at, token_type, scope')
      .eq('user_id', cleanUserId)
      .maybeSingle();

    if (error) {
      console.error('[GOOGLE_CALENDAR_AUTH] Erro ao buscar conexão no Supabase para o usuário:', {
        user_id: cleanUserId,
        error_code: error.code,
        error_message: error.message,
      });
      throw new GoogleCalendarAuthError(
        'Falha ao consultar conexão do Google Calendar no banco de dados.',
        'calendar_database_error',
        500,
        { db_error_code: error.code }
      );
    }

    connection = data;
  } catch (err: any) {
    if (err instanceof GoogleCalendarAuthError) throw err;
    console.error('[GOOGLE_CALENDAR_AUTH] Exceção ao consultar conexão:', {
      user_id: cleanUserId,
      error_name: err?.name,
      error_message: err?.message,
    });
    throw new GoogleCalendarAuthError(
      'Erro ao consultar banco de dados.',
      'calendar_database_error',
      500
    );
  }

  if (!connection) {
    throw new GoogleCalendarAuthError(
      'Usuário não possui conta do Google Calendar conectada.',
      'google_calendar_not_connected',
      404
    );
  }

  if (!connection.access_token) {
    throw new GoogleCalendarAuthError(
      'Token de acesso do Google Calendar ausente na conexão do usuário.',
      'missing_access_token',
      400
    );
  }

  // 2. Verificar expiração com margem de segurança (buffer)
  const now = nowFn();
  let isStillValid = false;

  if (connection.expires_at) {
    const expiresAtMs = new Date(connection.expires_at).getTime();
    if (!Number.isNaN(expiresAtMs) && expiresAtMs - now > bufferMs) {
      isStillValid = true;
    }
  }

  if (isStillValid) {
    return {
      accessToken: connection.access_token,
      expiresAt: connection.expires_at,
      googleEmail: connection.google_email || null,
      scope: connection.scope || null,
      wasRefreshed: false,
    };
  }

  // 3. Token expirado ou próximo de expirar: verificar refresh_token
  const refreshToken = connection.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string' || !refreshToken.trim()) {
    console.warn('[GOOGLE_CALENDAR_AUTH] Token expirado mas conexão sem refresh_token disponível para o usuário:', {
      user_id: cleanUserId,
    });
    throw new GoogleCalendarAuthError(
      'Reautorização necessária: conexão sem refresh token disponível.',
      'google_calendar_reauthorization_required',
      401,
      { reason: 'missing_refresh_token' }
    );
  }

  // 4. Obter credenciais do Google OAuth
  const clientId = options?.clientId !== undefined ? options.clientId : getEnvValue('GOOGLE_CLIENT_ID');
  const clientSecret = options?.clientSecret !== undefined ? options.clientSecret : getEnvValue('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientId.trim() || !clientSecret || !clientSecret.trim()) {
    console.error('[GOOGLE_CALENDAR_AUTH] GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET ausentes no ambiente.');
    throw new GoogleCalendarAuthError(
      'Configuração OAuth do servidor incompleta.',
      'missing_oauth_configuration',
      500
    );
  }

  // 5. Renovar token junto à API do Google
  console.log('[GOOGLE_CALENDAR_AUTH] Renovando access_token junto ao Google para user_id:', cleanUserId);

  let tokenData: any = null;
  let responseStatus = 0;

  try {
    const refreshParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken.trim(),
      grant_type: 'refresh_token',
    });

    const tokenResponse = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: refreshParams.toString(),
    });

    responseStatus = tokenResponse.status;
    tokenData = await tokenResponse.json().catch(() => null);

    if (!tokenResponse.ok || !tokenData || !tokenData.access_token) {
      const googleError = tokenData?.error || 'token_refresh_failed';
      const googleErrorDesc = tokenData?.error_description || 'Falha ao renovar token junto ao Google.';

      console.warn('[GOOGLE_CALENDAR_AUTH] Falha na resposta de renovação do Google:', {
        user_id: cleanUserId,
        status: responseStatus,
        google_error: googleError,
      });

      if (googleError === 'invalid_grant') {
        throw new GoogleCalendarAuthError(
          'Reautorização necessária: a permissão do Google Calendar foi revogada ou expirou.',
          'google_calendar_reauthorization_required',
          401,
          { google_error: 'invalid_grant' }
        );
      }

      throw new GoogleCalendarAuthError(
        googleErrorDesc,
        'google_token_refresh_failed',
        responseStatus >= 400 && responseStatus < 600 ? responseStatus : 500,
        { google_error: googleError }
      );
    }
  } catch (netErr: any) {
    if (netErr instanceof GoogleCalendarAuthError) throw netErr;
    console.error('[GOOGLE_CALENDAR_AUTH] Erro de rede ou comunicação durante refresh do Google:', {
      user_id: cleanUserId,
      error_name: netErr?.name,
      error_message: netErr?.message,
    });
    throw new GoogleCalendarAuthError(
      'Falha de comunicação ao renovar token junto ao Google.',
      'google_token_refresh_failed',
      500
    );
  }

  // 6. Atualizar o Supabase com o novo access_token e nova data de expiração
  const newAccessToken: string = tokenData.access_token;
  const expiresInSeconds = Number(tokenData.expires_in) || 3600;
  const newExpiresAt = new Date(nowFn() + expiresInSeconds * 1000).toISOString();

  const updateFields: Record<string, any> = {
    access_token: newAccessToken,
    expires_at: newExpiresAt,
    updated_at: new Date(nowFn()).toISOString(),
  };

  // Se o Google retornar um novo refresh_token na renovação (rotação de refresh token), atualiza
  if (tokenData.refresh_token && typeof tokenData.refresh_token === 'string') {
    updateFields.refresh_token = tokenData.refresh_token.trim();
  }
  if (tokenData.scope && typeof tokenData.scope === 'string') {
    updateFields.scope = tokenData.scope;
  }
  if (tokenData.token_type && typeof tokenData.token_type === 'string') {
    updateFields.token_type = tokenData.token_type;
  }

  try {
    const { error: updateError } = await supabase
      .from('google_calendar_connections')
      .update(updateFields)
      .eq('user_id', cleanUserId);

    if (updateError) {
      console.error('[GOOGLE_CALENDAR_AUTH] Erro ao persistir novo token no Supabase:', {
        user_id: cleanUserId,
        error_code: updateError.code,
        error_message: updateError.message,
      });
      throw new GoogleCalendarAuthError(
        'Falha ao atualizar token renovado no banco de dados.',
        'calendar_database_error',
        500,
        { db_error_code: updateError.code }
      );
    }
  } catch (dbErr: any) {
    if (dbErr instanceof GoogleCalendarAuthError) throw dbErr;
    console.error('[GOOGLE_CALENDAR_AUTH] Exceção ao atualizar token no Supabase:', {
      user_id: cleanUserId,
      error_name: dbErr?.name,
      error_message: dbErr?.message,
    });
    throw new GoogleCalendarAuthError(
      'Falha ao atualizar token renovado no banco de dados.',
      'calendar_database_error',
      500
    );
  }

  console.log('[GOOGLE_CALENDAR_AUTH] Token renovado e persistido com sucesso para user_id:', cleanUserId);

  return {
    accessToken: newAccessToken,
    expiresAt: newExpiresAt,
    googleEmail: connection.google_email || null,
    scope: updateFields.scope || connection.scope || null,
    wasRefreshed: true,
  };
}

/**
 * Função central server-side requerida pela integração.
 * Retorna uma Promise resolvendo para o access_token válido (string).
 *
 * 1. Busca a conexão Google do user_id;
 * 2. Verifica expires_at com margem de segurança de 5 minutos;
 * 3. Se access_token ainda for válido: retorna o access_token atual sem chamadas externas;
 * 4. Se estiver expirado ou próximo de expirar: usa refresh_token para obter novo access_token junto ao Google;
 * 5. Atualiza o banco de dados;
 * 6. Retorna o novo access_token válido.
 */
export async function getValidGoogleAccessToken(
  userId: string,
  options?: GetValidGoogleAccessTokenOptions
): Promise<string> {
  const details = await getValidGoogleTokenDetails(userId, options);
  return details.accessToken;
}

export interface FormattedCalendarEvent {
  id: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  status: string | null;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  } | null;
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  } | null;
  attendees: Array<{
    email: string | null;
    displayName: string | null;
    responseStatus: string | null;
    self: boolean;
  }> | null;
  organizer: {
    email: string | null;
    displayName: string | null;
    self: boolean;
  } | null;
  hangoutLink: string | null;
}

export function formatGoogleCalendarEvent(item: any): FormattedCalendarEvent {
  const start = item?.start
    ? {
        dateTime: item.start.dateTime || undefined,
        date: item.start.date || undefined,
        timeZone: item.start.timeZone || undefined,
      }
    : null;

  const end = item?.end
    ? {
        dateTime: item.end.dateTime || undefined,
        date: item.end.date || undefined,
        timeZone: item.end.timeZone || undefined,
      }
    : null;

  const attendees = Array.isArray(item?.attendees)
    ? item.attendees.map((a: any) => ({
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

export async function fetchUpcomingGoogleCalendarEvents(
  accessToken: string,
  options?: {
    maxResults?: number;
    timeMin?: string;
    fetchFn?: typeof fetch;
  }
): Promise<{ count: number; events: FormattedCalendarEvent[] }> {
  const fetchFn = options?.fetchFn || fetch;
  const maxResults = options?.maxResults ?? 20;
  const timeMin = options?.timeMin || new Date().toISOString();

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
    const errorBody: any = await response.json().catch(() => null);
    const googleErrorCode = errorBody?.error?.code || response.status;
    const googleErrorMessage = errorBody?.error?.message || response.statusText;

    console.error('[GOOGLE_CALENDAR_EVENTS] Falha na resposta da API Google Calendar:', {
      status: response.status,
      code: googleErrorCode,
    });

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

  const data: any = await response.json().catch(() => null);
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const events = items.map(formatGoogleCalendarEvent);

  return {
    count: events.length,
    events,
  };
}

export async function createGoogleCalendarEventForInteraction(interactionId: string) {
  const supabase = getAdminClient();
  if (!supabase) {
    console.warn('[CREATE_CALENDAR_EVENT] Supabase admin client indisponível.');
    return { synced: false, reason: 'database_unavailable' };
  }

  // 1. Load interaction
  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, lead_id, interaction_type, notes, next_follow_up_at, responsible_user_id, google_event_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    console.warn('[CREATE_CALENDAR_EVENT] Interação não encontrada:', interactionId);
    return { synced: false, reason: 'interaction_not_found', status: 404 };
  }

  // 2. Check if next_follow_up_at exists
  if (!interaction.next_follow_up_at) {
    return { synced: false, reason: 'no_next_follow_up_at' };
  }


  // 4. Responsible user ID
  const responsibleUserId = interaction.responsible_user_id;
  if (!responsibleUserId) {
    return { synced: false, reason: 'no_responsible_user_id' };
  }

  // 5. Get valid Google access token for responsible user
  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(responsibleUserId);
  } catch (err: any) {
    console.warn('[CREATE_CALENDAR_EVENT] Responsável sem conexão Google válida:', {
      responsible_user_id: responsibleUserId,
      error_code: err?.code,
      message: err?.message,
    });
    return { synced: false, reason: err?.code || 'google_calendar_not_connected' };
  }

  // 6. Load lead name & contact info
  let leadName = 'Condomínio';
  const { data: leadData } = await supabase
    .from('leads')
    .select('id, name')
    .eq('id', interaction.lead_id)
    .single();
  if (leadData?.name) {
    leadName = leadData.name;
  }

  // Responsible name
  let responsibleName = 'Responsável';
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('id', responsibleUserId)
    .single();
  if (profileData?.name) {
    responsibleName = profileData.name;
  }

  // Contact resolution via lead_contacts -> contacts (deterministic order by created_at ASC)
  let primaryContact: any = null;
  const { data: leadContactsData } = await supabase
    .from('lead_contacts')
    .select('contact_id')
    .eq('lead_id', interaction.lead_id);

  const contactIds = (leadContactsData || []).map((lc: any) => lc.contact_id).filter(Boolean);
  if (contactIds.length > 0) {
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('id, name, role_title, phone, email, created_at')
      .in('id', contactIds)
      .order('created_at', { ascending: true });

    if (contactsData && contactsData.length > 0) {
      primaryContact = contactsData[0]; // Contato mais antigo (menor created_at), determinístico
    }
  }

  // 7. Format title & description using shared builders
  const summary = buildEventSummary(interaction.interaction_type, leadName);
  const description = buildEventDescription(leadName, interaction.interaction_type, responsibleName, primaryContact, interaction.notes);

  // 8. Time calculation (Duration 1 hour)
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

  // 9. Call Google Calendar API (POST events)
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

  // 10. Save google_event_id in public.interactions
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

export function buildEventSummary(interactionType?: string | null, leadName?: string | null): string {
  const typeLabel = (interactionType || 'Compromisso').trim();
  const condoName = (leadName || 'Condomínio').trim();
  return `${typeLabel} — ${condoName}`;
}

export function buildEventDescription(
  leadName?: string | null,
  interactionType?: string | null,
  responsibleName?: string | null,
  primaryContact?: { name?: string | null; role_title?: string | null; phone?: string | null; email?: string | null } | null,
  notes?: string | null
): string {
  const descLines: string[] = [];
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

export async function updateGoogleCalendarEventForInteraction(interactionId: string) {
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

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(responsibleUserId);
  } catch (err: any) {
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

  let primaryContact: any = null;
  const { data: leadContactsData } = await supabase
    .from('lead_contacts')
    .select('contact_id')
    .eq('lead_id', interaction.lead_id);

  const contactIds = (leadContactsData || []).map((lc: any) => lc.contact_id).filter(Boolean);
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

  return { synced: true, googleEventId: googleEventId };
}

export async function syncGoogleCalendarInteraction(interactionId: string) {
  const supabase = getAdminClient();
  if (!supabase) {
    return { synced: false, reason: 'database_unavailable' };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, google_event_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    return { synced: false, reason: 'interaction_not_found', status: 404 };
  }

  console.log('[DEBUG_SYNC_INTERACTION]', { interactionId, google_event_id: interaction.google_event_id });

  const startTime = Date.now();
  
  let result: any;
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

export async function deleteGoogleCalendarEventForInteraction(interactionId: string) {
  const supabase = getAdminClient();
  if (!supabase) {
    return { success: false, reason: 'database_unavailable' };
  }

  const { data: interaction, error: intErr } = await supabase
    .from('interactions')
    .select('id, google_event_id, responsible_user_id')
    .eq('id', interactionId)
    .single();

  if (intErr || !interaction) {
    return { success: false, reason: 'interaction_not_found', status: 404 };
  }

  if (!interaction.google_event_id || !interaction.google_event_id.trim()) {
    return { success: true, deleted: false, reason: 'no_google_event' };
  }

  const startTime = Date.now();
  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(interaction.responsible_user_id);
  } catch (err: any) {
    console.warn('[GOOGLE_CALENDAR_DELETE] Falha ao obter token:', { interaction_id: interactionId, error: err?.code });
    return { success: false, reason: err?.code || 'google_calendar_not_connected' };
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
  const alreadyMissing = googleRes.status === 404;

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

  return { success: true, deleted: !alreadyMissing, reason: alreadyMissing ? 'already_missing' : 'success' };
}



