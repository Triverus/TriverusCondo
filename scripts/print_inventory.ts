import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function run() {
  const { data: authUsersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUsersMap = new Map();
  authUsersData.users.forEach(u => authUsersMap.set(u.id, u));

  const { data: profiles } = await supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: true });

  const allUserIds = new Set();
  authUsersData.users.forEach(u => allUserIds.add(u.id));
  profiles.forEach(p => allUserIds.add(p.id));

  console.log(`TOTAL DISTINCT USER IDS: ${allUserIds.size}`);

  for (const userId of allUserIds) {
    const authUser = authUsersMap.get(userId);
    const profile = profiles.find(p => p.id === userId);

    // Count in all relevant tables
    const [
      leadsResp, leadsCreated, leadsEdited,
      notesCreated, notesEdited,
      historyChanged,
      contactsCreated,
      gcal, perms
    ] = await Promise.all([
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('responsible_user_id', userId),
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('leads').select('id, name', { count: 'exact' }).eq('last_edited_by_user_id', userId),
      supabaseAdmin.from('interactions').select('id, title, content', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('interactions').select('id, title, content', { count: 'exact' }).eq('last_edited_by_user_id', userId),
      supabaseAdmin.from('stage_history').select('id', { count: 'exact' }).eq('changed_by_user_id', userId),
      supabaseAdmin.from('contacts').select('id', { count: 'exact' }).eq('created_by_user_id', userId),
      supabaseAdmin.from('google_calendar_connections').select('id', { count: 'exact' }).eq('user_id', userId),
      supabaseAdmin.from('user_permissions').select('id', { count: 'exact' }).eq('user_id', userId),
    ]);

    const email = profile?.email || authUser?.email || '(sem email)';
    const name = profile?.full_name || authUser?.user_metadata?.full_name || '(sem nome)';
    const inAuth = !!authUser;
    const inProfiles = !!profile;
    const isActive = profile?.is_active ?? (inAuth ? true : false);
    const deletedAt = profile?.deleted_at || null;
    const role = profile?.role || '(sem role)';

    console.log('--------------------------------------------------');
    console.log(`ID: ${userId}`);
    console.log(`Nome: ${name} | Email: ${email}`);
    console.log(`Role: ${role} | Ativo: ${isActive} | DeletedAt: ${deletedAt}`);
    console.log(`Em auth.users: ${inAuth} | Em public.profiles: ${inProfiles}`);
    console.log(`Criado em: Profiles=${profile?.created_at || 'N/A'} | Auth=${authUser?.created_at || 'N/A'}`);
    console.log(`Associações:
  - Leads Responsável: ${leadsResp.count || 0}
  - Leads Criados: ${leadsCreated.count || 0}
  - Leads Editados: ${leadsEdited.count || 0}
  - Notas/Interações Criadas: ${notesCreated.count || 0}
  - Notas/Interações Editadas: ${notesEdited.count || 0}
  - Histórico de Estágios: ${historyChanged.count || 0}
  - Contatos Criados: ${contactsCreated.count || 0}
  - Conexões GCal: ${gcal.count || 0}
  - Permissões: ${perms.count || 0}`);
    if ((leadsResp.count || 0) > 0) {
      console.log('  Exemplos Leads:', leadsResp.data);
    }
    if ((notesCreated.count || 0) > 0) {
      console.log('  Exemplos Notas Criadas:', notesCreated.data);
    }
  }
}

run().catch(console.error);
