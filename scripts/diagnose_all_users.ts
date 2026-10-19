import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Supabase URL ou Service Role Key não configurados.');
  process.exit(1);
}

const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function diagnose() {
  console.log('=== TRIVERUS CRM: INVENTÁRIO COMPLETO DE USUÁRIOS E DADOS ASSOCIADOS ===\n');

  // 1. Listar usuários de auth.users
  const { data: authUsersData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authErr) {
    console.error('Erro ao listar auth.users:', authErr);
    process.exit(1);
  }

  const authUsersMap = new Map<string, any>();
  for (const u of authUsersData.users) {
    authUsersMap.set(u.id, u);
  }

  // 2. Listar perfis de public.profiles
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (profErr) {
    console.error('Erro ao listar profiles:', profErr);
    process.exit(1);
  }

  console.log(`Total de usuários em auth.users: ${authUsersData.users.length}`);
  console.log(`Total de registros em public.profiles: ${profiles?.length || 0}\n`);

  // Map all known user IDs (union of auth.users and public.profiles)
  const allUserIds = new Set<string>();
  authUsersData.users.forEach((u) => allUserIds.add(u.id));
  profiles?.forEach((p) => allUserIds.add(p.id));

  // Check associations for each user
  const results = [];

  for (const userId of allUserIds) {
    const authUser = authUsersMap.get(userId);
    const profile = profiles?.find((p) => p.id === userId);

    // Queries to check commercial records associated
    const [
      leadsResp,
      leadsCreated,
      leadsEdited,
      interactionsCreated,
      interactionsEdited,
      interactionsUser,
      stageHistoryResp,
      contactsCreated,
      gcalResp,
      permsResp,
    ] = await Promise.all([
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('responsible_user_id', userId),
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('last_edited_by_user_id', userId),
      supabaseAdmin.from('interactions').select('id, content', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('interactions').select('id, content', { count: 'exact' }).eq('last_edited_by_user_id', userId),
      supabaseAdmin.from('interactions').select('id, content', { count: 'exact' }).eq('user_id', userId),
      supabaseAdmin.from('stage_history').select('id', { count: 'exact' }).eq('changed_by_user_id', userId),
      supabaseAdmin.from('contacts').select('id', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('google_calendar_connections').select('id, google_email', { count: 'exact' }).eq('user_id', userId),
      supabaseAdmin.from('user_permissions').select('id, permission_key', { count: 'exact' }).eq('user_id', userId),
    ]);

    const email = profile?.email || authUser?.email || '(sem email)';
    const fullName = profile?.full_name || authUser?.user_metadata?.full_name || '(sem nome)';
    const inAuth = !!authUser;
    const inProfiles = !!profile;
    const isActive = profile?.is_active ?? (inAuth ? true : false);
    const deletedAt = profile?.deleted_at || null;
    const role = profile?.role || '(sem role)';

    const totalLeadsResponsible = leadsResp.count || 0;
    const totalLeadsCreated = leadsCreated.count || 0;
    const totalLeadsEdited = leadsEdited.count || 0;
    const totalInteractionsCreated = interactionsCreated.count || 0;
    const totalInteractionsEdited = interactionsEdited.count || 0;
    const totalInteractionsUser = interactionsUser.count || 0;
    const totalStageChanges = stageHistoryResp.count || 0;
    const totalContactsCreated = contactsCreated.count || 0;
    const gcalCount = gcalResp.count || 0;
    const permsCount = permsResp.count || 0;

    results.push({
      userId,
      email,
      fullName,
      role,
      inAuth,
      inProfiles,
      isActive,
      deletedAt,
      createdAtProfile: profile?.created_at,
      createdAtAuth: authUser?.created_at,
      records: {
        leadsResponsible: totalLeadsResponsible,
        leadsCreated: totalLeadsCreated,
        leadsEdited: totalLeadsEdited,
        interactionsCreated: totalInteractionsCreated,
        interactionsEdited: totalInteractionsEdited,
        interactionsUser: totalInteractionsUser,
        stageHistory: totalStageChanges,
        contactsCreated: totalContactsCreated,
        gcalConnections: gcalCount,
        permissions: permsCount,
      },
      leadSamples: leadsResp.data?.slice(0, 3) || [],
      interactionSamples: interactionsCreated.data?.slice(0, 3) || [],
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

diagnose().catch(console.error);
