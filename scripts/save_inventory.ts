import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import * as fs from 'fs';

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
  profiles?.forEach(p => allUserIds.add(p.id));

  const list = [];

  for (const userId of allUserIds) {
    const authUser = authUsersMap.get(userId);
    const profile = profiles?.find(p => p.id === userId);

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

    list.push({
      id: userId,
      email: profile?.email || authUser?.email || null,
      full_name: profile?.full_name || authUser?.user_metadata?.full_name || null,
      role: profile?.role || null,
      is_active: profile?.is_active ?? (authUser ? true : false),
      deleted_at: profile?.deleted_at || null,
      in_auth: !!authUser,
      in_profiles: !!profile,
      created_at_profile: profile?.created_at || null,
      created_at_auth: authUser?.created_at || null,
      associations: {
        leads_responsible: leadsResp.count || 0,
        leads_created: leadsCreated.count || 0,
        leads_edited: leadsEdited.count || 0,
        notes_created: notesCreated.count || 0,
        notes_edited: notesEdited.count || 0,
        stage_history: historyChanged.count || 0,
        contacts_created: contactsCreated.count || 0,
        gcal: gcal.count || 0,
        permissions: perms.count || 0,
      },
      lead_samples: leadsResp.data || [],
      note_samples: notesCreated.data || [],
    });
  }

  fs.writeFileSync('users_inventory.json', JSON.stringify(list, null, 2));
  console.log(`Saved ${list.length} users to users_inventory.json`);
}

run().catch(console.error);
