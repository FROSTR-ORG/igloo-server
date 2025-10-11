/*
 NIP-44 / NIP-04 roundtrip smoke tests using API key.
 - Requires TEST_PEER_PUBKEY (x-only or compressed 02/03+X)
 - Skips when node inactive or peer key missing
 - BASE_URL default: http://localhost:8002
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:8002';
const API_KEY = process.env.API_KEY?.trim();
const PEER = process.env.TEST_PEER_PUBKEY?.trim();

if (!API_KEY) {
  console.error('API_KEY env var is required. Example:');
  console.error('  API_KEY=... TEST_PEER_PUBKEY=... bun run api:test:nip');
  process.exit(2);
}

function u(p: string) { return p.startsWith('http') ? p : `${BASE_URL}${p}`; }
function h(): HeadersInit { return { 'X-API-Key': API_KEY!, 'Content-Type': 'application/json', 'Accept': 'application/json' }; }

type Status = { nodeActive: boolean };

async function getStatus(): Promise<Status | null> {
  try {
    const r = await fetch(u('/api/status'), { headers: { 'X-API-Key': API_KEY!, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return { nodeActive: !!j?.nodeActive };
  } catch { return null; }
}

async function postJSON(path: string, body: any) {
  const res = await fetch(u(path), { method: 'POST', headers: h(), body: JSON.stringify(body) });
  const ctype = res.headers.get('content-type') || '';
  const payload = /json/i.test(ctype) ? await res.json().catch(() => ({})) : await res.text();
  return { status: res.status, payload, headers: res.headers } as const;
}

// no extra debug/tailing — keep the test concise

async function testNip44() {
  console.log('\n-- NIP-44 --');
  const plaintext = 'hello nip44';
  const enc = await postJSON('/api/nip44/encrypt', { peer_pubkey: PEER, content: plaintext });
  if (enc.status === 503) return console.log('ℹ️  Node unavailable (503). Skipping NIP-44.');
  if (enc.status === 401) return console.log('❌  Unauthorized (401) on /api/nip44/encrypt');
  if (enc.status !== 200 || typeof (enc.payload as any)?.result !== 'string') {
    console.log('❌  Encrypt failed:', enc.status, enc.payload);
    return;
  }
  console.log('✅ Encrypt ok');
  const ciphertext = (enc.payload as any).result;
  const dec = await postJSON('/api/nip44/decrypt', { peer_pubkey: PEER, content: ciphertext });
  if (dec.status === 200 && (dec.payload as any)?.result === plaintext) {
    console.log('✅ Decrypt ok — roundtrip matches');
  } else {
    console.log('❌  Decrypt failed:', dec.status, dec.payload);
    process.exitCode = 1;
  }
}

async function testNip04() {
  console.log('\n-- NIP-04 --');
  const plaintext = 'hello nip04';
  const enc = await postJSON('/api/nip04/encrypt', { peer_pubkey: PEER, content: plaintext });
  if (enc.status === 503) return console.log('ℹ️  Node unavailable (503). Skipping NIP-04.');
  if (enc.status === 401) return console.log('❌  Unauthorized (401) on /api/nip04/encrypt');
  if (enc.status !== 200 || typeof (enc.payload as any)?.result !== 'string') {
    console.log('❌  Encrypt failed:', enc.status, enc.payload);
    return;
  }
  console.log('✅ Encrypt ok');
  const ciphertext = (enc.payload as any).result;
  const dec = await postJSON('/api/nip04/decrypt', { peer_pubkey: PEER, content: ciphertext });
  if (dec.status === 200 && (dec.payload as any)?.result === plaintext) {
    console.log('✅ Decrypt ok — roundtrip matches');
  } else {
    console.log('❌  Decrypt failed:', dec.status, dec.payload);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n== NIP-44 / NIP-04 tests ==');
  console.log(`Base URL: ${BASE_URL}`);
  if (!PEER) {
    console.log('ℹ️  TEST_PEER_PUBKEY not set. Skipping.');
    return;
  }

  const status = await getStatus();
  if (!status) {
    console.log('❌ Could not fetch /api/status');
    process.exitCode = 1;
    return;
  }
  if (!status.nodeActive) {
    console.log('ℹ️  Node inactive. Start/configure node, then re-run.');
    return;
  }

  await testNip44();
  await testNip04();
}

main();
