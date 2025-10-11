/*
 POST /api/sign smoke test using API key
 - If node is inactive, expects 503 (prints advisory)
 - If node is active, accepts 200/502/504 depending on upstream signing availability
 - Reads API key from API_KEY and base URL from BASE_URL
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:8002';
const API_KEY = process.env.API_KEY?.trim();
if (!API_KEY) {
  console.error('API_KEY env var is required. Example:');
  console.error('  API_KEY=... bun run api:test:sign');
  process.exit(2);
}

function u(p: string) { return p.startsWith('http') ? p : `${BASE_URL}${p}`; }
function headersJSON(): HeadersInit { return { 'X-API-Key': API_KEY!, 'Content-Type': 'application/json', 'Accept': 'application/json' }; }

type Status = { nodeActive: boolean };

async function getStatus(): Promise<Status | null> {
  try {
    const r = await fetch(u('/api/status'), { headers: { 'X-API-Key': API_KEY!, Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return { nodeActive: !!j?.nodeActive };
  } catch { return null; }
}

async function signByMessage(messageHex: string) {
  const body = JSON.stringify({ message: messageHex });
  const res = await fetch(u('/api/sign'), { method: 'POST', headers: headersJSON(), body });
  const ctype = res.headers.get('content-type') || '';
  const payload = /json/i.test(ctype) ? await res.json().catch(() => ({})) : await res.text();
  return { status: res.status, payload } as const;
}

async function main() {
  console.log('\n== POST /api/sign test (API key) ==');
  console.log(`Base URL: ${BASE_URL}`);
  const status = await getStatus();
  if (!status) {
    console.log('❌ Could not fetch /api/status');
    process.exitCode = 1;
    return;
  }

  console.log(`Node active: ${status.nodeActive}`);
  const msg = '0'.repeat(64); // 32-byte zero hash (valid hex)
  const { status: code, payload } = await signByMessage(msg);

  if (code === 200) {
    const ok = typeof (payload as any)?.id === 'string' && typeof (payload as any)?.signature === 'string';
    console.log(`${ok ? '✅' : '❌'} /api/sign [200] — ${ok ? 'signature present' : 'unexpected payload'}`);
    if (!ok) process.exitCode = 1;
  } else if (code === 503) {
    console.log('ℹ️  /api/sign [503] Node unavailable — start/configure node to enable signing');
  } else if (code === 504) {
    console.log('ℹ️  /api/sign [504] Timeout — node reachable but signing timed out');
  } else if (code === 502) {
    console.log('ℹ️  /api/sign [502] Upstream signing failed — check node/policies');
  } else if (code === 401) {
    console.log('❌  /api/sign [401] Unauthorized — API key invalid or not accepted');
    process.exitCode = 1;
  } else {
    console.log(`❌  /api/sign [${code}] Unexpected response`);
    process.exitCode = 1;
  }
}

main();

