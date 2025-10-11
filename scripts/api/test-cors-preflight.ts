/*
 CORS preflight probes (OPTIONS) for common endpoints.
 - Sends Origin and Access-Control-Request-Method headers
 - Prints allow headers; does not fail the process
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:8002';
const ORIGINS = (process.env.TEST_ORIGINS || 'http://localhost:3000,http://localhost:8002')
  .split(',').map(s => s.trim()).filter(Boolean);

const PATHS = ['/api/status', '/api/auth/status', '/api/docs/openapi.json'];

function u(p: string) { return p.startsWith('http') ? p : `${BASE_URL}${p}`; }

async function probe(path: string, origin: string) {
  try {
    const res = await fetch(u(path), {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    const aco = res.headers.get('access-control-allow-origin');
    const acm = res.headers.get('access-control-allow-methods');
    const ach = res.headers.get('access-control-allow-headers');
    const vary = res.headers.get('vary');
    console.log(`${res.ok ? '✅' : '❌'} OPTIONS ${path} (Origin: ${origin}) [${res.status}]`);
    console.log(`    A-C-Allow-Origin: ${aco ?? '—'} | Methods: ${acm ?? '—'} | Headers: ${ach ?? '—'} | Vary: ${vary ?? '—'}`);
  } catch (e: any) {
    console.log(`❌ OPTIONS ${path} (Origin: ${origin}) — ${e?.message || String(e)}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n== CORS preflight probes ==');
  console.log(`Base URL: ${BASE_URL}`);
  for (const origin of ORIGINS) {
    for (const path of PATHS) {
      // eslint-disable-next-line no-await-in-loop
      await probe(path, origin);
    }
  }
}

main();

