import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function getUserClient(email: string) {
  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`Failed to generate link for ${email}: ${linkErr?.message}`);
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: sessionData, error: sessionErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (sessionErr || !sessionData?.user) {
    throw new Error(`Failed to verify session for ${email}: ${sessionErr?.message}`);
  }
  return { client, user: sessionData.user };
}

export async function runAllTests() {
  console.log('====================================================');
  console.log('1. VERIFICANDO PRESENÇA DA MIGRATION NO BANCO REAL');
  console.log('====================================================');

  const { data: upTest, error: upErr } = await adminClient.from('user_permissions').select('*').limit(1);
  if (upErr) {
    console.log('[MIGRATION STATUS]: A migration AINDA NÃO FOI EXECUTADA no banco.');
    console.log('[ERRO DETECTADO]:', upErr.message);
    console.log('\nPor favor, execute o script sql/user_permissions_and_authorship.sql no Supabase SQL Editor e execute o teste novamente.');
    return { executed: false };
  }

  console.log('[MIGRATION STATUS]: Migration detectada com sucesso!\n');

  console.log('====================================================');
  console.log('2. AUDITORIA DE PROFILES E USER_PERMISSIONS');
  console.log('====================================================');

  const { data: profiles } = await adminClient.from('profiles').select('*').order('role');
  console.log('Profiles existentes:', profiles?.map(p => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role,
    email: p.email,
    is_active: p.is_active
  })));

  const { data: permissions } = await adminClient.from('user_permissions').select('*');
  console.log('User Permissions existentes:', permissions?.map(up => ({
    user_id: up.user_id,
    can_manage_notes: up.can_manage_notes,
    can_delete_notes: up.can_delete_notes,
    can_manage_leads: up.can_manage_leads,
    can_delete_leads: up.can_delete_leads,
    can_change_stage: up.can_change_stage,
    can_manage_contacts: up.can_manage_contacts
  })));

  // Obter clientes autenticados
  const adminEmail = 'plataformatriverus@gmail.com';
  const normalUserEmail = 'edson@triverus.com.br';

  console.log('\nAutenticando clientes de teste...');
  const { client: adminUserClient, user: adminUser } = await getUserClient(adminEmail);
  const { client: normalClient, user: normalUser } = await getUserClient(normalUserEmail);

  console.log(`Admin logado: ${adminUser.email} (${adminUser.id})`);
  console.log(`Usuário logado: ${normalUser.email} (${normalUser.id})\n`);

  console.log('====================================================');
  console.log('3. EXECUÇÃO DOS TESTES A - J (RLS & TRIGGERS)');
  console.log('====================================================');

  // Obter um lead de teste para os testes de interação e estágio
  const { data: testLeads } = await adminClient.from('leads').select('*').limit(2);
  if (!testLeads || testLeads.length === 0) {
    throw new Error('Nenhum lead encontrado para teste');
  }
  const testLead = testLeads[0];

  // Obter estágios
  const { data: stages } = await adminClient.from('pipeline_stages').select('*');
  const stageA = stages?.[0]?.id;
  const stageB = stages?.[1]?.id || stageA;

  // TESTE A: Admin continua operando normalmente
  console.log('\n--- TESTE A: Admin operando normalmente ---');
  const { data: adminSelectNotes, error: adminSelectErr } = await adminUserClient.from('interactions').select('id').limit(1);
  console.log('A1. Admin SELECT interactions:', !adminSelectErr ? 'OK' : adminSelectErr.message);

  const { data: adminLeadList, error: adminLeadErr } = await adminUserClient.from('leads').select('id').limit(1);
  console.log('A2. Admin SELECT leads:', !adminLeadErr ? 'OK' : adminLeadErr.message);

  // TESTE B: Usuário normal consegue criar/editar nota
  console.log('\n--- TESTE B: Usuário normal cria e edita nota ---');
  const { data: newNote, error: newNoteErr } = await normalClient.from('interactions').insert({
    lead_id: testLead.id,
    interaction_type: 'call',
    notes: 'Nota de teste automatizado B',
    occurred_at: new Date().toISOString()
  }).select().single();

  if (newNoteErr) {
    console.error('B1. ERRO ao criar nota por usuário normal:', newNoteErr.message);
  } else {
    console.log('B1. Usuário normal criou nota com ID:', newNote.id);
  }

  let noteIdToTest = newNote?.id;

  if (noteIdToTest) {
    const { error: editNoteErr } = await normalClient.from('interactions').update({
      notes: 'Nota editada pelo teste B'
    }).eq('id', noteIdToTest);
    console.log('B2. Usuário normal editou nota:', !editNoteErr ? 'OK' : editNoteErr.message);
  }

  // TESTE C: Usuário normal NÃO consegue excluir nota quando can_delete_notes=false
  console.log('\n--- TESTE C: Usuário normal bloqueado de excluir nota ---');
  if (noteIdToTest) {
    const { data: deleteRes, error: deleteErr } = await normalClient
      .from('interactions')
      .delete()
      .eq('id', noteIdToTest)
      .select();

    // RLS DELETE silenciosamente exclui 0 linhas ou retorna erro
    const stillExists = await adminClient.from('interactions').select('id').eq('id', noteIdToTest).single();
    if (stillExists.data) {
      console.log('C. SUCESSO: A nota NÃO foi excluída pelo usuário normal (protegida por can_delete_notes=false).');
    } else {
      console.error('C. FALHA: A nota foi excluída indevidamente!');
    }
  }

  // TESTE D: Usuário normal NÃO consegue excluir lead quando can_delete_leads=false
  console.log('\n--- TESTE D: Usuário normal bloqueado de excluir lead ---');
  const { data: deleteLeadRes, error: deleteLeadErr } = await normalClient
    .from('leads')
    .delete()
    .eq('id', testLead.id)
    .select();

  const leadStillExists = await adminClient.from('leads').select('id').eq('id', testLead.id).single();
  if (leadStillExists.data) {
    console.log('D. SUCESSO: O condomínio NÃO foi excluído pelo usuário normal (protegido por can_delete_leads=false).');
  } else {
    console.error('D. FALHA: O condomínio foi excluído indevidamente!');
  }

  // TESTE E: Usuário normal consegue alterar estágio se can_change_stage=true
  console.log('\n--- TESTE E: Usuário normal altera estágio ---');
  const targetStage = testLead.current_stage_id === stageA ? stageB : stageA;
  const { error: stageChangeErr } = await normalClient.from('leads').update({
    current_stage_id: targetStage,
    updated_at: new Date().toISOString()
  }).eq('id', testLead.id);

  console.log('E. Usuário normal alterou estágio:', !stageChangeErr ? 'OK' : stageChangeErr.message);

  // TESTE F: Usuário normal NÃO consegue alterar outro campo do lead usando apenas can_change_stage
  console.log('\n--- TESTE F: Usuário com apenas can_change_stage bloqueado de alterar outros campos ---');
  // Temporariamente remover can_manage_leads de edson para testar isoladamente o guard de estágio
  await adminClient.from('user_permissions').update({ can_manage_leads: false }).eq('user_id', normalUser.id);

  const { error: illicitChangeErr } = await normalClient.from('leads').update({
    name: 'Nome hackeado pelo teste F'
  }).eq('id', testLead.id);

  if (illicitChangeErr) {
    console.log('F. SUCESSO: Alteração de campo não-estágio foi rejeitada pelo trigger guard:', illicitChangeErr.message);
  } else {
    console.error('F. FALHA: Usuário sem can_manage_leads conseguiu alterar o nome do condomínio!');
  }

  // Restaurar can_manage_leads de edson
  await adminClient.from('user_permissions').update({ can_manage_leads: true }).eq('user_id', normalUser.id);

  // TESTE G: Usuário normal NÃO consegue alterar próprio role para admin
  console.log('\n--- TESTE G: Usuário normal bloqueado de alterar próprio role ---');
  const { error: roleChangeErr } = await normalClient.from('profiles').update({
    role: 'admin'
  }).eq('id', normalUser.id);

  const { data: refreshedProfile } = await adminClient.from('profiles').select('role').eq('id', normalUser.id).single();
  if (refreshedProfile?.role === 'user') {
    console.log('G. SUCESSO: Tentativa de auto-promoção para admin foi bloqueada pelo trigger guard (permaneceu "user").');
  } else {
    console.error('G. FALHA: O usuário conseguiu alterar o próprio role para:', refreshedProfile?.role);
  }

  // TESTE H: Usuário inativo fica bloqueado
  console.log('\n--- TESTE H: Usuário inativo bloqueado no banco ---');
  // Desativar temporariamente
  await adminClient.from('profiles').update({ is_active: false }).eq('id', normalUser.id);

  const { data: inactiveSelect, error: inactiveErr } = await normalClient.from('interactions').select('id').limit(1);
  const isBlocked = inactiveErr || !inactiveSelect || inactiveSelect.length === 0;
  console.log('H. Usuário inativo bloqueado por is_active_user():', isBlocked ? 'SUCESSO (0 linhas / rejeitado)' : 'FALHA');

  // Reativar usuário
  await adminClient.from('profiles').update({ is_active: true }).eq('id', normalUser.id);

  // TESTE I: Autoria de nova nota grava created_by_user_id corretamente
  console.log('\n--- TESTE I: Autoria de nova nota grava created_by_user_id ---');
  const { data: noteWithAuthor } = await normalClient.from('interactions').insert({
    lead_id: testLead.id,
    interaction_type: 'whatsapp',
    notes: 'Nota com validação de autoria I',
    occurred_at: new Date().toISOString()
  }).select().single();

  if (noteWithAuthor) {
    console.log('I. created_by_user_id gravado:', noteWithAuthor.created_by_user_id);
    console.log('I. esperado:', normalUser.id);
    console.log('I. Resultado:', noteWithAuthor.created_by_user_id === normalUser.id ? 'SUCESSO' : 'FALHA');
  }

  // TESTE J: Sincronização Google Calendar não altera last_edited_*
  console.log('\n--- TESTE J: Gravação de google_event_id NÃO altera last_edited_* ---');
  if (noteWithAuthor) {
    const beforeEditBy = noteWithAuthor.last_edited_by_user_id;
    const beforeEditAt = noteWithAuthor.last_edited_at;

    // Atualização de google_event_id (simulando sync automática)
    const { data: syncedNote, error: syncErr } = await adminClient.from('interactions').update({
      google_event_id: 'google_test_event_12345'
    }).eq('id', noteWithAuthor.id).select().single();

    if (syncedNote) {
      console.log('J. last_edited_by_user_id antes/depois:', beforeEditBy, '->', syncedNote.last_edited_by_user_id);
      console.log('J. last_edited_at antes/depois:', beforeEditAt, '->', syncedNote.last_edited_at);
      const preserved = syncedNote.last_edited_by_user_id === beforeEditBy && syncedNote.last_edited_at === beforeEditAt;
      console.log('J. Resultado:', preserved ? 'SUCESSO (preservado sem falsa edição humana)' : 'FALHA');
    }

    // Limpar nota de teste
    await adminClient.from('interactions').delete().eq('id', noteWithAuthor.id);
  }
  if (noteIdToTest) {
    await adminClient.from('interactions').delete().eq('id', noteIdToTest);
  }

  // TESTE K: Fallback de profile cria automaticamente user_permissions
  console.log('\n--- TESTE K: Fallback de profile gera user_permissions automaticamente ---');
  const tempUserId = '00000000-0000-0000-0000-000000000099';
  const { error: insProfErr } = await adminClient.from('profiles').insert({
    id: tempUserId,
    full_name: 'Usuário Teste Fallback',
    role: 'user',
    email: 'fallback_test@triverus.com.br',
    is_active: true
  });
  if (insProfErr) {
    console.log('K. Aviso ao inserir profile de teste:', insProfErr.message);
  } else {
    const { data: autoPerms } = await adminClient.from('user_permissions').select('*').eq('user_id', tempUserId).single();
    if (autoPerms) {
      console.log('K. SUCESSO: user_permissions criado automaticamente pelo trigger:', {
        can_manage_notes: autoPerms.can_manage_notes,
        can_delete_notes: autoPerms.can_delete_notes,
        can_manage_leads: autoPerms.can_manage_leads,
        can_delete_leads: autoPerms.can_delete_leads,
        can_change_stage: autoPerms.can_change_stage,
        can_manage_contacts: autoPerms.can_manage_contacts
      });
    } else {
      console.error('K. FALHA: user_permissions NÃO foi criado automaticamente para o novo profile!');
    }
    // Limpeza
    await adminClient.from('profiles').delete().eq('id', tempUserId);
  }

  console.log('\n====================================================');
  console.log('FIM DA BATERIA DE TESTES');
  console.log('====================================================\n');
  return { executed: true };
}

runAllTests().catch(console.error);
