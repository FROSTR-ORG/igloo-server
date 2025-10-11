/*
 Permission probes for GET endpoints using an API key (DB mode)
 - Confirms protected routes are NOT accessible via API key alone
 - This validates least privilege for the API key issuance feature
 */

type Case = { name: string; path: string; allowedStatuses: number[] };

const BASE_URL = process.env.BASE_URL?.trim() || 'http://127.0.0.1:8002';
const API_KEY = process.env.API_KEY?.trim();
if (!API_KEY) {
  console.error('API_KEY env var is required. Example:');
  console.error('  API_KEY=... bun run api:test:get:blocked');
  process.exit(2);
}

function u(p: string) { return p.startsWith('http') ? p : `${BASE_URL}${p}`; }
function authHeaders(): HeadersInit { return { 'X-API-Key': API_KEY!, 'Accept': 'application/json' }; }

const restricted: Case[] = [
  { name: 'Env (DB mode)', path: '/api/env', allowedStatuses: [401, 403] },
  { name: 'Peers list', path: '/api/peers', allowedStatuses: [401, 400, 503] },
  { name: 'Peers group', path: '/api/peers/group', allowedStatuses: [401, 400] },
  { name: 'Peers policies', path: '/api/peers/policies', allowedStatuses: [401, 400, 503] },
  { name: 'User profile', path: '/api/user/profile', allowedStatuses: [401] },
  { name: 'NIP-46 sessions', path: '/api/nip46/sessions', allowedStatuses: [401] },
  { name: 'NIP-46 transport', path: '/api/nip46/transport', allowedStatuses: [401] },
  { name: 'NIP-46 relays', path: '/api/nip46/relays', allowedStatuses: [401] },
  { name: 'NIP-46 requests', path: '/api/nip46/requests', allowedStatuses: [401] },
  { name: 'Admin users', path: '/api/admin/users', allowedStatuses: [401, 403] },
  { name: 'Admin API keys', path: '/api/admin/api-keys', allowedStatuses: [401, 403] },
  { name: 'Admin status', path: '/api/admin/status', allowedStatuses: [401, 403] },
];

async function probe(c: Case) {
  const target = u(c.path);
  try {
    const res = await fetch(target, { method: 'GET', headers: authHeaders() });
    const ok = c.allowedStatuses.includes(res.status);
    console.log(`${ok ? '✅' : '❌'} ${c.name} [${res.status}] ${c.path}${ok ? '' : ' — expected one of ' + c.allowedStatuses.join(', ')}`);
    if (!ok) process.exitCode = 1;
  } catch (e: any) {
    console.log(`❌ ${c.name} [ERR] ${c.path} — ${e?.message || String(e)}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n== GET permission probes (API key should NOT grant access) ==');
  console.log(`Base URL: ${BASE_URL}`);
  for (const c of restricted) {
    // eslint-disable-next-line no-await-in-loop
    await probe(c);
  }
}

main();

