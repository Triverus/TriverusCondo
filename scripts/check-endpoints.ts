const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkEndpoints() {
  if (!url || !key) return;
  const endpoints = ['/rest/v1/', '/auth/v1/health', '/storage/v1/status'];
  for (const ep of endpoints) {
    try {
      const res = await fetch(url + ep, {
        headers: { apikey: key, Authorization: 'Bearer ' + key }
      });
      console.log(ep, res.status);
    } catch (e: any) {
      console.log(ep, e.message);
    }
  }
}

checkEndpoints();
