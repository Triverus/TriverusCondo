import {
  getValidGoogleAccessToken,
  getValidGoogleTokenDetails,
  GoogleCalendarAuthError,
  EXPIRATION_BUFFER_MS,
} from '../googleCalendarAuth.ts';

interface TestCaseResult {
  testId: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestCaseResult[] = [];

// Helper para mock de Supabase
function createMockSupabase(params: {
  selectData?: any;
  selectError?: any;
  updateError?: any;
  onUpdate?: (fields: any, eqValue: any) => void;
}) {
  return {
    from: (table: string) => {
      return {
        select: (cols: string) => {
          return {
            eq: (col: string, val: string) => {
              return {
                maybeSingle: async () => {
                  if (params.selectError) {
                    return { data: null, error: params.selectError };
                  }
                  return { data: params.selectData || null, error: null };
                },
              };
            },
          };
        },
        update: (fields: any) => {
          return {
            eq: async (col: string, val: string) => {
              if (params.onUpdate) {
                params.onUpdate(fields, val);
              }
              if (params.updateError) {
                return { error: params.updateError };
              }
              return { error: null };
            },
          };
        },
      };
    },
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO BATERIA DE TESTES A–G: getValidGoogleAccessToken');
  console.log('====================================================\n');

  // --------------------------------------------------------------------------
  // TESTE A: Usuário sem conexão cadastrada
  // --------------------------------------------------------------------------
  try {
    let googleCallCount = 0;
    const mockFetch = async () => {
      googleCallCount++;
      return new Response('{}');
    };

    const mockSupabase = createMockSupabase({ selectData: null });

    let thrownError: any = null;
    try {
      await getValidGoogleAccessToken('user_not_connected_123', {
        supabaseClient: mockSupabase,
        fetchFn: mockFetch as any,
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
      });
    } catch (err) {
      thrownError = err;
    }

    const passed =
      thrownError instanceof GoogleCalendarAuthError &&
      thrownError.code === 'google_calendar_not_connected' &&
      thrownError.statusCode === 404 &&
      googleCallCount === 0;

    results.push({
      testId: 'A',
      name: 'Usuário sem conexão cadastrada no Supabase',
      passed,
      details: {
        errorCode: thrownError?.code,
        statusCode: thrownError?.statusCode,
        googleCalls: googleCallCount,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'A', name: 'Usuário sem conexão', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE B: Conexão existente com access_token ainda válido
  // --------------------------------------------------------------------------
  try {
    let googleCallCount = 0;
    const mockFetch = async () => {
      googleCallCount++;
      return new Response('{}');
    };

    const fixedNow = 1700000000000;
    // Expira em 30 minutos (1800s > 300s de buffer)
    const validExpiresAt = new Date(fixedNow + 30 * 60 * 1000).toISOString();

    const mockSupabase = createMockSupabase({
      selectData: {
        id: 'conn-1',
        user_id: 'user_valid_token_456',
        google_email: 'test@triverus.com',
        access_token: 'existing_valid_access_token_xyz',
        refresh_token: 'mock_refresh_token_123',
        expires_at: validExpiresAt,
      },
    });

    const token = await getValidGoogleAccessToken('user_valid_token_456', {
      supabaseClient: mockSupabase,
      fetchFn: mockFetch as any,
      nowFn: () => fixedNow,
      clientId: 'mock_client_id',
      clientSecret: 'mock_client_secret',
    });

    const passed =
      token === 'existing_valid_access_token_xyz' &&
      googleCallCount === 0;

    results.push({
      testId: 'B',
      name: 'Conexão existente com access_token ainda válido (> 5 min)',
      passed,
      details: {
        returnedToken: token,
        googleCalls: googleCallCount,
        refreshed: false,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'B', name: 'Token válido', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE C: Conexão com access_token expirado (ou próximo de expirar) e refresh bem-sucedido
  // --------------------------------------------------------------------------
  try {
    let googleCallCount = 0;
    let receivedRequestBody = '';
    const fixedNow = 1700000000000;
    // Restam apenas 2 minutos (< 5 minutos de buffer de segurança -> deve renovar)
    const nearExpirationDate = new Date(fixedNow + 2 * 60 * 1000).toISOString();

    const mockFetch = async (url: string, opts: any) => {
      googleCallCount++;
      receivedRequestBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'brand_new_refreshed_google_token_999',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar.events',
        }),
      } as any;
    };

    let updatedFieldsInDb: any = null;
    let updatedUserIdInDb: any = null;

    const mockSupabase = createMockSupabase({
      selectData: {
        id: 'conn-2',
        user_id: 'user_near_exp_789',
        google_email: 'user789@triverus.com',
        access_token: 'old_expiring_access_token',
        refresh_token: 'stored_refresh_token_abc',
        expires_at: nearExpirationDate,
      },
      onUpdate: (fields, val) => {
        updatedFieldsInDb = fields;
        updatedUserIdInDb = val;
      },
    });

    const token = await getValidGoogleAccessToken('user_near_exp_789', {
      supabaseClient: mockSupabase,
      fetchFn: mockFetch as any,
      nowFn: () => fixedNow,
      clientId: 'google_client_id_test',
      clientSecret: 'google_client_secret_test',
    });

    const passed =
      token === 'brand_new_refreshed_google_token_999' &&
      googleCallCount === 1 &&
      updatedUserIdInDb === 'user_near_exp_789' &&
      updatedFieldsInDb?.access_token === 'brand_new_refreshed_google_token_999' &&
      Boolean(updatedFieldsInDb?.expires_at) &&
      receivedRequestBody.includes('grant_type=refresh_token') &&
      receivedRequestBody.includes('refresh_token=stored_refresh_token_abc');

    results.push({
      testId: 'C',
      name: 'Token próximo de expirar com refresh bem-sucedido e persistência no banco',
      passed,
      details: {
        returnedToken: token,
        googleCalls: googleCallCount,
        dbUpdatedToken: updatedFieldsInDb?.access_token,
        dbNewExpiresAt: updatedFieldsInDb?.expires_at,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'C', name: 'Refresh bem sucedido', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE D: Conexão existente expirada sem refresh_token no banco
  // --------------------------------------------------------------------------
  try {
    let googleCallCount = 0;
    const mockFetch = async () => {
      googleCallCount++;
      return new Response('{}');
    };

    const fixedNow = 1700000000000;
    // Expirou há 1 hora
    const expiredDate = new Date(fixedNow - 60 * 60 * 1000).toISOString();

    const mockSupabase = createMockSupabase({
      selectData: {
        id: 'conn-3',
        user_id: 'user_without_refresh_token',
        access_token: 'expired_token',
        refresh_token: null, // Sem refresh token
        expires_at: expiredDate,
      },
    });

    let thrownError: any = null;
    try {
      await getValidGoogleAccessToken('user_without_refresh_token', {
        supabaseClient: mockSupabase,
        fetchFn: mockFetch as any,
        nowFn: () => fixedNow,
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
      });
    } catch (err) {
      thrownError = err;
    }

    const passed =
      thrownError instanceof GoogleCalendarAuthError &&
      thrownError.code === 'google_calendar_reauthorization_required' &&
      thrownError.statusCode === 401 &&
      thrownError.details?.reason === 'missing_refresh_token' &&
      googleCallCount === 0;

    results.push({
      testId: 'D',
      name: 'Conexão existente expirada sem refresh_token no banco',
      passed,
      details: {
        errorCode: thrownError?.code,
        statusCode: thrownError?.statusCode,
        reason: thrownError?.details?.reason,
        googleCalls: googleCallCount,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'D', name: 'Sem refresh token', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE E: Falha na resposta do Google (invalid_grant / permissão revogada)
  // --------------------------------------------------------------------------
  try {
    let googleCallCount = 0;
    const fixedNow = 1700000000000;
    const expiredDate = new Date(fixedNow - 1000).toISOString();

    const mockFetch = async () => {
      googleCallCount++;
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        }),
      } as any;
    };

    const mockSupabase = createMockSupabase({
      selectData: {
        id: 'conn-4',
        user_id: 'user_revoked_grant',
        access_token: 'old_token',
        refresh_token: 'revoked_refresh_token',
        expires_at: expiredDate,
      },
    });

    let thrownError: any = null;
    try {
      await getValidGoogleAccessToken('user_revoked_grant', {
        supabaseClient: mockSupabase,
        fetchFn: mockFetch as any,
        nowFn: () => fixedNow,
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
      });
    } catch (err) {
      thrownError = err;
    }

    const passed =
      thrownError instanceof GoogleCalendarAuthError &&
      thrownError.code === 'google_calendar_reauthorization_required' &&
      thrownError.statusCode === 401 &&
      thrownError.details?.google_error === 'invalid_grant' &&
      googleCallCount === 1;

    results.push({
      testId: 'E',
      name: 'Falha na resposta do Google (invalid_grant / permissão revogada)',
      passed,
      details: {
        errorCode: thrownError?.code,
        statusCode: thrownError?.statusCode,
        googleError: thrownError?.details?.google_error,
        googleCalls: googleCallCount,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'E', name: 'Google invalid_grant', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE F: Falha no banco de dados (erro ao consultar ou atualizar Supabase)
  // --------------------------------------------------------------------------
  try {
    const mockSupabase = createMockSupabase({
      selectError: {
        code: 'PGRST500',
        message: 'Database connection timeout',
      },
    });

    let thrownError: any = null;
    try {
      await getValidGoogleAccessToken('user_db_error', {
        supabaseClient: mockSupabase,
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
      });
    } catch (err) {
      thrownError = err;
    }

    const passed =
      thrownError instanceof GoogleCalendarAuthError &&
      thrownError.code === 'calendar_database_error' &&
      thrownError.statusCode === 500 &&
      thrownError.details?.db_error_code === 'PGRST500';

    results.push({
      testId: 'F',
      name: 'Falha no banco de dados (erro no Supabase capturado com log seguro)',
      passed,
      details: {
        errorCode: thrownError?.code,
        statusCode: thrownError?.statusCode,
        dbErrorCode: thrownError?.details?.db_error_code,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'F', name: 'Erro de banco', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // TESTE G: Validação de parâmetros (userId ausente ou inválido) e configuração
  // --------------------------------------------------------------------------
  try {
    let thrownErrorEmptyUser: any = null;
    try {
      await getValidGoogleAccessToken('');
    } catch (err) {
      thrownErrorEmptyUser = err;
    }

    let thrownErrorMissingConfig: any = null;
    const mockSupabase = createMockSupabase({
      selectData: {
        id: 'conn-g',
        user_id: 'user_valid_id',
        access_token: 'old_token',
        refresh_token: 'some_refresh',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    });

    try {
      await getValidGoogleAccessToken('user_valid_id', {
        supabaseClient: mockSupabase,
        clientId: '', // ausente
        clientSecret: '', // ausente
      });
    } catch (err) {
      thrownErrorMissingConfig = err;
    }

    const passedEmptyUser =
      thrownErrorEmptyUser instanceof GoogleCalendarAuthError &&
      thrownErrorEmptyUser.code === 'invalid_user_id' &&
      thrownErrorEmptyUser.statusCode === 400;

    const passedMissingConfig =
      thrownErrorMissingConfig instanceof GoogleCalendarAuthError &&
      thrownErrorMissingConfig.code === 'missing_oauth_configuration' &&
      thrownErrorMissingConfig.statusCode === 500;

    const passed = passedEmptyUser && passedMissingConfig;

    results.push({
      testId: 'G',
      name: 'Validação de parâmetros (userId inválido/vazio e configuração do servidor)',
      passed,
      details: {
        emptyUserCode: thrownErrorEmptyUser?.code,
        missingConfigCode: thrownErrorMissingConfig?.code,
      },
    });
  } catch (err: any) {
    results.push({ testId: 'G', name: 'Validação parâmetros', passed: false, error: err.message });
  }

  // --------------------------------------------------------------------------
  // RESUMO E EXIBIÇÃO
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log('RESULTADO CONSOLIDADO DOS TESTES (A–G)');
  console.log('====================================================\n');

  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`${icon} Teste ${r.testId}: ${r.name}`);
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
    console.log(`STATUS FINAL: TODOS OS ${results.length} TESTES (A–G) PASSARAM COM SUCESSO!`);
  } else {
    console.log('STATUS FINAL: HOUVE FALHA EM UM OU MAIS TESTES.');
    process.exit(1);
  }
  console.log('----------------------------------------------------\n');
}

runTests();
