import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function checkDetails() {
  const { data: allInteractions, error: intErr } = await supabaseAdmin.from('interactions').select('*');
  console.log(`Total interações no banco: ${allInteractions?.length || 0}`);
  if (allInteractions && allInteractions.length > 0) {
    console.log('Interações existentes:');
    allInteractions.forEach(i => console.log(`  ID: ${i.id} | Lead: ${i.lead_id} | CreatedBy: ${i.created_by_user_id} | EditedBy: ${i.last_edited_by_user_id} | UserID: ${i.user_id} | Content: ${i.content?.slice(0, 40)}`));
  }

  const { data: allLeads, error: leadErr } = await supabaseAdmin.from('leads').select('id, name, responsible_user_id, created_by_user_id, last_edited_by_user_id');
  console.log(`\nTotal leads no banco: ${allLeads?.length || 0}`);
  allLeads?.forEach(l => {
    console.log(`  Lead: ${l.name} (${l.id}) | Resp: ${l.responsible_user_id} | CreatedBy: ${l.created_by_user_id} | EditedBy: ${l.last_edited_by_user_id}`);
  });

  const { data: allHistory } = await supabaseAdmin.from('stage_history').select('*');
  console.log(`\nTotal stage_history: ${allHistory?.length || 0}`);

  const { data: allContacts } = await supabaseAdmin.from('contacts').select('*');
  console.log(`\nTotal contacts: ${allContacts?.length || 0}`);
}

checkDetails().catch(console.error);
