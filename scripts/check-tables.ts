import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const loadedEnv = loadEnv('development', process.cwd(), '');
const url = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY;

const adminClient = createClient(url, serviceKey);

async function main() {
  const tables = ['stage_history', 'lead_services', 'contacts', 'lead_contacts', 'pipeline_stages'];
  for (const t of tables) {
    const { data, error } = await adminClient.from(t).select('*').limit(1);
    console.log(`Table ${t}:`, {
      exists: !error,
      error: error?.message,
      cols: data && data[0] ? Object.keys(data[0]) : 'empty or no rows'
    });
  }
}

main();
