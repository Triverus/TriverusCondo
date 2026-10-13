import {
  getValidGoogleAccessToken,
  fetchUpcomingGoogleCalendarEvents,
  formatGoogleCalendarEvent,
  GoogleCalendarAuthError,
} from '../googleCalendarAuth.ts';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

// Mock do Supabase para simulação da rota
function createMockSupabase(params: {
  user?: any;
  authError?: any;
  selectData?: any;
  selectError?: any;
  onUpdate?: (fields: any, eqValue: any) => void;
}) {
  return {
    auth: {
      getUser: async (token: string) => {
        if (params.authError) return { data: { user: null }, error: params.authError };
        if (token === 'valid_token' || params.user) {
          return { data: { user: params.user || { id: 'usr_abc_123' } }, error: null };
        }
        return { data: { user: null }, error: new Error('Invalid token') };
      },
    },
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (params.selectError) return { data: null, error: params.selectError };
            return { data: params.selectData || null, error: null };
          },
        }),
      }),
      update: (fields: any) => ({
        eq: async (col: string, val: string) => {
          if (params.onUpdate) params.onUpdate(fields, val);
          return { error: null };
        },
      }),
    }),
  };
}

// Simulador simplificado do handler da rota GET /api/google/calendar/events
async function simulateCalendarEventsRoute(
  req: { headers: { authorization?: string } },
  deps: {
    mockSupabase: any;
    fetchGoogleFn?: typeof fetch;
    nowFn?: () => number;
    clientId?: string;
    clientSecret?: string;
  }
) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (!token) {
    return {
      status: 401,
      body: {
        success: false,
        error: 'unauthorized',
        message: 'Cabeçalho Authorization: Bearer <token> obrigatório.',
      },
    };
  }

  const { data: userData, error: userError } = await deps.mockSupabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return {
      status: 401,
      body: {
        success: false,
        error: 'unauthorized',
        message: 'Token de autenticação inválido ou expirado.',
      },
    };
  }

  const userId = userData.user.id;

  let accessToken: string;
  try {
    accessToken = await getValidGoogleAccessToken(userId, {
      supabaseClient: deps.mockSupabase,
      fetchFn: deps.fetchGoogleFn,
      nowFn: deps.nowFn,
      clientId: deps.clientId || 'mock_client_id',
      clientSecret: deps.clientSecret || 'mock_client_secret',
    });
  } catch (err: any) {
    if (err instanceof GoogleCalendarAuthError) {
      if (err.code === 'google_calendar_not_connected') {
        return {
          status: 404,
          body: {
            success: false,
            error: 'google_calendar_not_connected',
            message: 'Usuário não possui conta do Google Calendar conectada.',
          },
        };
      }
      if (err.code === 'google_calendar_reauthorization_required') {
        return {
          status: 401,
          body: {
            success: false,
            error: 'google_calendar_reauthorization_required',
            message: 'Reautorização do Google Calendar necessária.',
          },
        };
      }
    }
    return {
      status: 500,
      body: {
        success: false,
        error: 'google_calendar_events_fetch_failed',
      },
    };
  }

  try {
    const { count, events } = await fetchUpcomingGoogleCalendarEvents(accessToken, {
      fetchFn: deps.fetchGoogleFn,
    });
    return {
      status: 200,
      body: {
        success: true,
        count,
        events,
      },
    };
  } catch (err: any) {
    if (err instanceof GoogleCalendarAuthError && err.code === 'google_calendar_reauthorization_required') {
      return {
        status: 401,
        body: {
          success: false,
          error: 'google_calendar_reauthorization_required',
        },
      };
    }
    return {
      status: 500,
      body: {
        success: false,
        error: 'google_calendar_events_fetch_failed',
      },
    };
  }
}

async function runAllTests() {
  console.log('====================================================');
  console.log('BATERIA DE TESTES A–G: GET /api/google/calendar/events');
  console.log('====================================================\n');

  // --------------------------------------------------------------------------
  // TESTE A: Sem Authorization -> 401
  // --------------------------------------------------------------------------
  try {
    const mockSupabase = createMockSupabase({});
    const response = await simulateCalendarEventsRoute(
      { headers: {} },
      { mockSupabase }
    );

    const passed = response.status === 401 && response.body.error === 'unauthorized';
    results.push({
      id: 'A',
      name: 'Sem Authorization header retorna 401 unauthorized',
      passed,
      details: { status: response.status, body: response.body },
    });
  } catch (err: any) {
    results.push({ id: 'A', name: 'Sem Authorization', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE B: Usuário autenticado sem conexão Google -> 404 google_calendar_not_connected
  // --------------------------------------------------------------------------
  try {
    const mockSupabase = createMockSupabase({
      user: { id: 'user_sem_google' },
      selectData: null, // sem registro em google_calendar_connections
    });

    const response = await simulateCalendarEventsRoute(
      { headers: { authorization: 'Bearer valid_token' } },
      { mockSupabase }
    );

    const passed =
      response.status === 404 &&
      response.body.success === false &&
      response.body.error === 'google_calendar_not_connected';

    results.push({
      id: 'B',
      name: 'Usuário autenticado sem conexão Google retorna 404 google_calendar_not_connected',
      passed,
      details: { status: response.status, body: response.body },
    });
  } catch (err: any) {
    results.push({ id: 'B', name: 'Usuário sem conexão', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE C: Usuário conectado com token válido -> 200 com events
  // --------------------------------------------------------------------------
  try {
    const fixedNow = 1700000000000;
    const expiresFuture = new Date(fixedNow + 3600 * 1000).toISOString();

    const mockCalendarItems = [
      {
        id: 'evt_1',
        summary: 'Reunião de Condomínio',
        description: 'Pauta assembleia',
        location: 'Salão de Festas',
        htmlLink: 'https://calendar.google.com/event?id=evt_1',
        status: 'confirmed',
        start: { dateTime: '2026-10-15T14:00:00-03:00', timeZone: 'America/Sao_Paulo' },
        end: { dateTime: '2026-10-15T15:00:00-03:00', timeZone: 'America/Sao_Paulo' },
        attendees: [{ email: 'sindico@triverus.com', displayName: 'Síndico', responseStatus: 'accepted' }],
        organizer: { email: 'admin@triverus.com', displayName: 'Admin' },
        hangoutLink: 'https://meet.google.com/abc-def-ghi',
      },
    ];

    const mockFetch = async (url: string) => {
      if (url.includes('calendars/primary/events')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: mockCalendarItems }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };

    const mockSupabase = createMockSupabase({
      user: { id: 'user_com_google' },
      selectData: {
        id: 'conn_1',
        user_id: 'user_com_google',
        access_token: 'valid_access_token_abc',
        refresh_token: 'refresh_abc',
        expires_at: expiresFuture,
      },
    });

    const response = await simulateCalendarEventsRoute(
      { headers: { authorization: 'Bearer valid_token' } },
      {
        mockSupabase,
        fetchGoogleFn: mockFetch as any,
        nowFn: () => fixedNow,
      }
    );

    const passed =
      response.status === 200 &&
      response.body.success === true &&
      response.body.count === 1 &&
      Array.isArray(response.body.events) &&
      response.body.events[0].id === 'evt_1' &&
      response.body.events[0].summary === 'Reunião de Condomínio' &&
      response.body.events[0].hangoutLink === 'https://meet.google.com/abc-def-ghi';

    results.push({
      id: 'C',
      name: 'Usuário conectado retorna 200 com array de events formatados',
      passed,
      details: { status: response.status, count: response.body.count },
    });
  } catch (err: any) {
    results.push({ id: 'C', name: 'Usuário conectado', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE D: Token expirado mas refresh válido -> refresh automático e 200 com events
  // --------------------------------------------------------------------------
  try {
    const fixedNow = 1700000000000;
    const expiresPast = new Date(fixedNow - 10 * 60 * 1000).toISOString();
    const tracker = {
      refreshCalled: false,
      calendarCalled: false,
    };

    const mockFetch = async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        tracker.refreshCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'fresh_new_token_xyz',
            expires_in: 3600,
          }),
        } as any;
      }
      if (url.includes('calendars/primary/events')) {
        tracker.calendarCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'evt_2',
                summary: 'Visita Técnica',
                start: { dateTime: '2026-10-16T09:00:00-03:00' },
                end: { dateTime: '2026-10-16T10:00:00-03:00' },
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 500 } as any;
    };

    let updatedTokenInDb = '';
    const mockSupabase = createMockSupabase({
      user: { id: 'user_expired_token' },
      selectData: {
        id: 'conn_exp',
        user_id: 'user_expired_token',
        access_token: 'old_expired_token',
        refresh_token: 'valid_refresh_token_123',
        expires_at: expiresPast,
      },
      onUpdate: (fields) => {
        updatedTokenInDb = fields.access_token;
      },
    });

    const response = await simulateCalendarEventsRoute(
      { headers: { authorization: 'Bearer valid_token' } },
      {
        mockSupabase,
        fetchGoogleFn: mockFetch as any,
        nowFn: () => fixedNow,
      }
    );

    const passed =
      response.status === 200 &&
      response.body.success === true &&
      response.body.count === 1 &&
      tracker.refreshCalled === true &&
      tracker.calendarCalled === true &&
      updatedTokenInDb === 'fresh_new_token_xyz';

    results.push({
      id: 'D',
      name: 'Token expirado executa refresh automático e retorna events com status 200',
      passed,
      details: {
        status: response.status,
        refreshExecuted: tracker.refreshCalled,
        calendarCalled: tracker.calendarCalled,
        newDbToken: updatedTokenInDb,
      },
    });
  } catch (err: any) {
    results.push({ id: 'D', name: 'Refresh automático', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE E: Refresh inválido -> 401 google_calendar_reauthorization_required
  // --------------------------------------------------------------------------
  try {
    const fixedNow = 1700000000000;
    const expiresPast = new Date(fixedNow - 1000).toISOString();

    const mockFetch = async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token revoked or expired',
          }),
        } as any;
      }
      return { ok: false, status: 500 } as any;
    };

    const mockSupabase = createMockSupabase({
      user: { id: 'user_revoked' },
      selectData: {
        id: 'conn_revoked',
        user_id: 'user_revoked',
        access_token: 'old_token',
        refresh_token: 'revoked_token',
        expires_at: expiresPast,
      },
    });

    const response = await simulateCalendarEventsRoute(
      { headers: { authorization: 'Bearer valid_token' } },
      {
        mockSupabase,
        fetchGoogleFn: mockFetch as any,
        nowFn: () => fixedNow,
      }
    );

    const passed =
      response.status === 401 &&
      response.body.success === false &&
      response.body.error === 'google_calendar_reauthorization_required';

    results.push({
      id: 'E',
      name: 'Refresh inválido no Google retorna 401 google_calendar_reauthorization_required',
      passed,
      details: { status: response.status, body: response.body },
    });
  } catch (err: any) {
    results.push({ id: 'E', name: 'Refresh inválido', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE F: Evento com dateTime retornado corretamente
  // --------------------------------------------------------------------------
  try {
    const rawGoogleItem = {
      id: 'evt_timed',
      summary: 'Vistoria Predial',
      description: 'Vistoria nas garagens',
      location: 'Subsolo 1',
      htmlLink: 'https://calendar.google.com/event?id=evt_timed',
      status: 'confirmed',
      start: {
        dateTime: '2026-10-20T10:30:00-03:00',
        timeZone: 'America/Sao_Paulo',
      },
      end: {
        dateTime: '2026-10-20T12:00:00-03:00',
        timeZone: 'America/Sao_Paulo',
      },
      attendees: [
        { email: 'engenheiro@triverus.com', displayName: 'Engenheiro', responseStatus: 'accepted', self: false },
      ],
      organizer: { email: 'contato@triverus.com', displayName: 'Triverus', self: true },
      hangoutLink: null,
    };

    const formatted = formatGoogleCalendarEvent(rawGoogleItem);

    const passed =
      formatted.id === 'evt_timed' &&
      formatted.start?.dateTime === '2026-10-20T10:30:00-03:00' &&
      formatted.start?.timeZone === 'America/Sao_Paulo' &&
      formatted.start?.date === undefined &&
      formatted.end?.dateTime === '2026-10-20T12:00:00-03:00' &&
      formatted.end?.timeZone === 'America/Sao_Paulo' &&
      formatted.summary === 'Vistoria Predial';

    results.push({
      id: 'F',
      name: 'Evento com dateTime e timeZone preservados corretamente',
      passed,
      details: {
        start: formatted.start,
        end: formatted.end,
        summary: formatted.summary,
      },
    });
  } catch (err: any) {
    results.push({ id: 'F', name: 'Evento com dateTime', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE G: Evento de dia inteiro com date retornado corretamente
  // --------------------------------------------------------------------------
  try {
    const rawAllDayItem = {
      id: 'evt_all_day',
      summary: 'Feriado Municipal',
      description: 'Aniversário da cidade',
      location: null,
      htmlLink: 'https://calendar.google.com/event?id=evt_all_day',
      status: 'confirmed',
      start: {
        date: '2026-11-02',
      },
      end: {
        date: '2026-11-03',
      },
    };

    const formatted = formatGoogleCalendarEvent(rawAllDayItem);

    const passed =
      formatted.id === 'evt_all_day' &&
      formatted.start?.date === '2026-11-02' &&
      formatted.start?.dateTime === undefined &&
      formatted.end?.date === '2026-11-03' &&
      formatted.end?.dateTime === undefined &&
      formatted.summary === 'Feriado Municipal';

    results.push({
      id: 'G',
      name: 'Evento de dia inteiro com date (sem dateTime) tratado e retornado corretamente',
      passed,
      details: {
        start: formatted.start,
        end: formatted.end,
        summary: formatted.summary,
      },
    });
  } catch (err: any) {
    results.push({ id: 'G', name: 'Evento all-day com date', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // EXIBIÇÃO FINAL
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log('RESULTADO DOS TESTES A–G (GET /api/google/calendar/events)');
  console.log('====================================================\n');

  let allPassed = true;
  for (const r of results) {
    const tag = r.passed ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`${tag} Teste ${r.id}: ${r.name}`);
    if (r.details) {
      console.log(`   Detalhes: ${JSON.stringify(r.details)}`);
    }
    if (r.error) {
      console.log(`   Erro: ${r.error}`);
    }
    if (!r.passed) {
      allPassed = false;
    }
  }

  console.log('\n----------------------------------------------------');
  if (allPassed) {
    console.log(`STATUS: TODOS OS ${results.length} TESTES (A–G) PASSARAM COM SUCESSO!`);
  } else {
    console.log('STATUS: HOUVE FALHA EM UM OU MAIS TESTES.');
    process.exit(1);
  }
  console.log('----------------------------------------------------\n');
}

runAllTests();
