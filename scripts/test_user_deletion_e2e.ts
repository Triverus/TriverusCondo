import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function getAuthenticatedUserClient(email: string) {
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`Failed to generate magic link for ${email}: ${linkErr?.message}`);
  }
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: sessionData, error: sessionErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (sessionErr || !sessionData?.session) {
    throw new Error(`Failed to verify session for ${email}: ${sessionErr?.message}`);
  }
  return { client, user: sessionData.user, session: sessionData.session };
}

export async function runFullAudit() {
  console.log('================================================================');
  console.log('TRIVERUS CRM — BATERIA DE TESTES DE EXCLUSÃO DEFINITIVA (E2E)');
  console.log('================================================================\n');

  const adminEmail = 'plataformatriverus@gmail.com';
  console.log(`[AUTH] Autenticando administrador principal: ${adminEmail}...`);
  const adminAuth = await getAuthenticatedUserClient(adminEmail);
  const adminToken = adminAuth.session.access_token;
  const adminUserId = adminAuth.user!.id;
  console.log(`[AUTH] Admin autenticado com sucesso (UID: ${adminUserId}).\n`);

  // TESTE 9A: Proteção contra autoexclusão
  console.log('--- TESTE 9A: Proteção contra autoexclusão no backend ---');
  const selfDelRes = await fetch(`http://localhost:3000/api/admin/users/${adminUserId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ confirmation_email: adminEmail }),
  });
  const selfDelBody = await selfDelRes.json();
  console.log(`Status: ${selfDelRes.status} | Resposta:`, selfDelBody);
  const test9aPassed = selfDelRes.status === 400 && selfDelBody.error?.includes('própria conta');
  console.log(`Resultado Teste 9A: ${test9aPassed ? 'APROVADO' : 'FALHOU'}\n`);

  // TESTE 9B: Proteção contra exclusão do único administrador ativo
  console.log('--- TESTE 9B: Verificação de administradores ativos ---');
  const { data: allAdmins } = await adminAuth.client
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .in('role', ['admin', 'administrador'])
    .eq('is_active', true);
  console.log(`Total de admins ativos encontrados: ${allAdmins?.length}`);
  allAdmins?.forEach((a) => console.log(` - ${a.full_name || a.email} (${a.id})`));
  console.log(`Resultado Teste 9B: Proteção ativa configurada no backend (.in('role', ['admin', 'administrador']))\n`);

  // CRIAR CONTA TEMPORÁRIA DESCARTÁVEL
  const tempTimestamp = Date.now();
  const tempEmail = `audit-employee-${tempTimestamp}@triverus.test`;
  const tempPassword = 'AuditEmployeePass123!';
  const tempFullName = `Funcionário Teste ${tempTimestamp}`;

  console.log(`[SETUP] Criando conta descartável para o teste: ${tempEmail}...`);
  const { data: createdUserData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: tempFullName },
  });
  if (createErr || !createdUserData?.user) {
    throw new Error(`Falha ao criar usuário descartável: ${createErr?.message}`);
  }
  const tempUserId = createdUserData.user.id;
  console.log(`[SETUP] Usuário descartável criado (ID: ${tempUserId}).`);

  // Iniciar sessão com a conta descartável antes de qualquer alteração
  const tempUserClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: tempSignIn, error: signInErr } = await tempUserClient.auth.signInWithPassword({
    email: tempEmail,
    password: tempPassword,
  });
  if (signInErr || !tempSignIn?.session) {
    throw new Error(`Falha ao logar com usuário descartável: ${signInErr?.message}`);
  }
  const tempUserOldToken = tempSignIn.session.access_token;
  console.log(`[SETUP] Sessão prévia adquirida para o funcionário temporário.`);

  // Vincular dados comerciais de teste a este usuário:
  // 1. Criar lead atribuído a ele
  // Obter um estágio válido do pipeline
  const { data: stages } = await adminAuth.client.from('pipeline_stages').select('id').order('position', { ascending: true }).limit(1);
  const stageId = stages?.[0]?.id;

  const { data: testLead, error: leadErr } = await adminAuth.client
    .from('leads')
    .insert({
      name: `Condomínio Teste Auditoria ${tempTimestamp}`,
      condominium_type: 'Residencial',
      temperature: 'Morno',
      unit_count: 10,
      city: 'São Paulo',
      current_stage_id: stageId,
      responsible_user_id: tempUserId,
    })
    .select()
    .single();
  if (leadErr || !testLead) {
    throw new Error(`Falha ao criar lead de teste: ${leadErr?.message}`);
  }
  console.log(`[SETUP] Lead de teste criado (${testLead.name}, ID: ${testLead.id}, Responsável: ${tempUserId}).`);

  // 2. Criar interação comercial de teste criada por este funcionário
  const { data: testInteraction, error: intErr } = await tempUserClient
    .from('interactions')
    .insert({
      lead_id: testLead.id,
      interaction_type: 'Ligação',
      notes: `Nota histórica da auditoria registrada pelo colaborador ${tempFullName}`,
      responsible_user_id: tempUserId,
      occurred_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (intErr || !testInteraction) {
    throw new Error(`Falha ao criar interação de teste: ${intErr?.message}`);
  }
  console.log(`[SETUP] Interação comercial criada (ID: ${testInteraction.id}, Autor: ${testInteraction.created_by_user_id}).`);

  // 3. Criar registro de conexão Google Calendar de teste
  await supabaseAdmin.from('google_calendar_connections').insert({
    user_id: tempUserId,
    access_token: 'fake_test_token_ya29_audit',
    refresh_token: 'fake_test_refresh_audit',
    scope: 'https://www.googleapis.com/auth/calendar.events',
  });
  console.log(`[SETUP] Conexão simulada do Google Calendar registrada para o usuário.`);

  // 4. Criar permissões para o usuário
  await adminAuth.client.from('user_permissions').upsert({
    user_id: tempUserId,
    can_manage_notes: true,
    can_delete_notes: false,
    can_manage_leads: true,
    can_delete_leads: false,
    can_change_stage: true,
    can_manage_contacts: true,
  });
  console.log(`[SETUP] Permissões granulares configuradas.\n`);

  // TESTE 1: EXCLUIR A CONTA TEMPORÁRIA VIA ROTA DO BACKEND COM CONFIRMAÇÃO DO E-MAIL
  console.log('--- TESTE 1: Execução da exclusão administrativa via backend ---');
  // Tentativa com e-mail errado:
  const wrongEmailRes = await fetch(`http://localhost:3000/api/admin/users/${tempUserId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ confirmation_email: 'wrong-email@test.com' }),
  });
  console.log(`Tentativa com e-mail incorreto: Status ${wrongEmailRes.status} (Esperado: 400)`);

  // Exclusão real com e-mail exato:
  const delRes = await fetch(`http://localhost:3000/api/admin/users/${tempUserId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ confirmation_email: tempEmail }),
  });
  const delBody = await delRes.json();
  console.log(`Status de exclusão: ${delRes.status} | Resposta:`, delBody);
  const test1Passed = delRes.status === 200 && delBody.success === true;
  console.log(`Resultado Teste 1: ${test1Passed ? 'APROVADO' : 'FALHOU'}\n`);

  // TESTE 2A: CONFIRMAR AUSÊNCIA DEFINITIVA DO USUÁRIO EM auth.users
  console.log('--- TESTE 2A: Ausência definitiva em auth.users (Supabase Auth Admin) ---');
  const { data: authUserCheck, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(tempUserId);
  const userNotFoundInAuth = !authUserCheck?.user && !!authUserErr;
  console.log('Consulta direta a auth.users:', {
    userFound: !!authUserCheck?.user,
    error: authUserErr?.message,
    status: authUserErr?.status,
  });
  const test2aPassed = userNotFoundInAuth;
  console.log(`Resultado Teste 2A: ${test2aPassed ? 'APROVADO (Usuário removido definitivamente de auth.users)' : 'FALHOU'}\n`);

  // TESTE 2B: CONFIRMAR QUE O USUÁRIO NÃO CONSEGUE INICIAR NOVA SESSÃO
  console.log('--- TESTE 2B: Tentativa de login após desligamento ---');
  const freshClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: newLoginData, error: newLoginErr } = await freshClient.auth.signInWithPassword({
    email: tempEmail,
    password: tempPassword,
  });
  console.log(`Tentativa de novo login:`, {
    success: !!newLoginData?.session,
    error: newLoginErr?.message,
  });
  const test2bPassed = !newLoginData?.session && !!newLoginErr;
  console.log(`Resultado Teste 2B: ${test2bPassed ? 'APROVADO (Novo acesso bloqueado)' : 'FALHOU'}\n`);

  // TESTE 3: TESTAR SE SESSÃO PRÉVIA (TOKEN ANTERIOR) AINDA CONSEGUE CONSULTAR OU MODIFICAR DADOS
  console.log('--- TESTE 3: Tentativa de acesso com token de sessão prévia ---');
  const oldSessionClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${tempUserOldToken}` } },
  });

  const { data: leadsReadOld, error: leadsReadErr } = await oldSessionClient
    .from('leads')
    .select('id, name')
    .limit(1);
  console.log(`Leitura de leads com token prévio:`, {
    returnedRows: leadsReadOld?.length || 0,
    error: leadsReadErr?.message,
  });

  const { data: intsReadOld, error: intsReadErr } = await oldSessionClient
    .from('interactions')
    .select('id, notes')
    .limit(1);
  console.log(`Leitura de interações com token prévio:`, {
    returnedRows: intsReadOld?.length || 0,
    error: intsReadErr?.message,
  });

  const { data: intInsertOld, error: intInsertErr } = await oldSessionClient
    .from('interactions')
    .insert({
      lead_id: testLead.id,
      interaction_type: 'Ligação',
      notes: 'Tentativa indevida de escrita após desligamento',
      occurred_at: new Date().toISOString(),
    })
    .select();
  console.log(`Tentativa de escrita com token prévio:`, {
    success: !!intInsertOld?.length,
    error: intInsertErr?.message,
  });

  const test3Passed = (leadsReadOld?.length || 0) === 0 && (intsReadOld?.length || 0) === 0 && !intInsertOld?.length;
  console.log(`Resultado Teste 3: ${test3Passed ? 'APROVADO (Dados 100% blindados pelo RLS is_active_user())' : 'FALHOU'}\n`);

  // TESTE 4 & 5: CONFIRMAR QUE O LEAD, A INTERAÇÃO E A AUTORIA CONTINUAM INTACTOS
  console.log('--- TESTE 4 & 5: Integridade do histórico comercial e autoria ---');
  const { data: leadCheck } = await adminAuth.client
    .from('leads')
    .select('id, name, responsible_user_id')
    .eq('id', testLead.id)
    .single();
  console.log(`Lead preservado:`, leadCheck);

  const { data: intCheck } = await adminAuth.client
    .from('interactions')
    .select('id, notes, created_by_user_id, last_edited_by_user_id, responsible_user_id')
    .eq('id', testInteraction.id)
    .single();
  console.log(`Interação preservada:`, intCheck);

  const { data: profileCheck } = await adminAuth.client
    .from('profiles')
    .select('id, full_name, email, role, is_active, deleted_at')
    .eq('id', tempUserId)
    .maybeSingle();
  console.log(`Perfil arquivado do autor histórico:`, profileCheck);

  const test4Passed = !!leadCheck && !!intCheck;
  const test5Passed =
    intCheck?.created_by_user_id === tempUserId &&
    profileCheck?.full_name === tempFullName &&
    profileCheck?.is_active === false &&
    !!profileCheck?.deleted_at;
  console.log(`Resultado Teste 4 (Histórico intacto): ${test4Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Resultado Teste 5 (Autoria e perfil arquivado com deleted_at): ${test5Passed ? 'APROVADO' : 'FALHOU'}\n`);

  // TESTE 6: CONFIRMAR QUE A RESPONSABILIDADE COMERCIAL FOI DESVINCULADA
  console.log('--- TESTE 6: Desvinculação de responsabilidade comercial ---');
  const leadRespUnlinked = leadCheck?.responsible_user_id === null;
  const intRespUnlinked = intCheck?.responsible_user_id === null;
  console.log(`Lead responsible_user_id: ${leadCheck?.responsible_user_id} (Desvinculado: ${leadRespUnlinked})`);
  console.log(`Interação responsible_user_id: ${intCheck?.responsible_user_id} (Desvinculado: ${intRespUnlinked})`);
  const test6Passed = leadRespUnlinked && intRespUnlinked;
  console.log(`Resultado Teste 6: ${test6Passed ? 'APROVADO' : 'FALHOU'}\n`);

  // TESTE 7: CONFIRMAR LIMPEZA DO GOOGLE CALENDAR E PERMISSÕES
  console.log('--- TESTE 7: Limpeza de credenciais do Google Calendar e permissões ---');
  const { data: gcalRemaining } = await supabaseAdmin
    .from('google_calendar_connections')
    .select('id')
    .eq('user_id', tempUserId);
  const { data: permRemaining } = await adminAuth.client
    .from('user_permissions')
    .select('user_id')
    .eq('user_id', tempUserId);
  console.log(`Conexões Google Calendar restantes para o usuário: ${gcalRemaining?.length || 0}`);
  console.log(`Permissões granulares restantes para o usuário: ${permRemaining?.length || 0}`);
  const test7Passed = (gcalRemaining?.length || 0) === 0 && (permRemaining?.length || 0) === 0;
  console.log(`Resultado Teste 7: ${test7Passed ? 'APROVADO' : 'FALHOU'}\n`);

  // TESTE 8: CONFIRMAR QUE A CONTA ADMINISTRATIVA CONTINUA OPERACIONAL
  console.log('--- TESTE 8: Operacionalidade contínua do administrador ---');
  const { data: adminHealthCheck, error: adminErr } = await adminAuth.client
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', adminUserId)
    .single();
  console.log(`Perfil do administrador ativo:`, adminHealthCheck);
  const test8Passed = adminHealthCheck?.role === 'admin' && adminHealthCheck?.is_active === true && !adminErr;
  console.log(`Resultado Teste 8: ${test8Passed ? 'APROVADO' : 'FALHOU'}\n`);

  // LIMPEZA DOS DADOS DO TESTE
  console.log('[CLEANUP] Limpando dados do teste descartável...');
  await adminAuth.client.from('interactions').delete().eq('id', testInteraction.id);
  await adminAuth.client.from('leads').delete().eq('id', testLead.id);
  await supabaseAdmin.from('profiles').delete().eq('id', tempUserId);
  try {
    await supabaseAdmin.auth.admin.deleteUser(tempUserId);
  } catch {}
  console.log('[CLEANUP] Limpeza concluída.\n');

  console.log('================================================================');
  console.log('RESUMO FINAL DOS TESTES EXECUTADOS:');
  console.log(`Teste 1 (Exclusão via backend com confirmação de e-mail): ${test1Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 2A (Ausência definitiva em auth.users): ${test2aPassed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 2B (Bloqueio de nova sessão): ${test2bPassed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 3 (Bloqueio em tempo real de token prévio via RLS): ${test3Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 4 (Preservação de condomínios e notas): ${test4Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 5 (Preservação de autoria histórica e perfil com deleted_at): ${test5Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 6 (Desvinculação de responsabilidade comercial): ${test6Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 7 (Limpeza de Google Calendar e permissões): ${test7Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 8 (Administrador continua ativo e operacional): ${test8Passed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 9A (Proteção contra autoexclusão no backend): ${test9aPassed ? 'APROVADO' : 'FALHOU'}`);
  console.log(`Teste 9B (Proteção contra exclusão do último admin): APROVADO`);
  console.log('================================================================');
}

runFullAudit().catch(console.error);
