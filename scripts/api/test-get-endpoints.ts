/*
 End-to-end GET checks using an API key (DB mode)
 - Reads API key from env: API_KEY
 - Base URL from env: BASE_URL (default http://127.0.0.1:8002)
 - Validates response status, content type, and minimal shape
 - Prints a compact summary at the end
 */

type TestCase = {
  name: string;
  path: string;
  expectStatus?: number | ((status: number) => boolean);
  expectContentType?: RegExp; // e.g., /^application\/json/
  validate?: (jsonOrText: any, res: Response) => void | Promise<void>;
};

const BASE_URL = process.env.BASE_URL?.trim() || 'http://127.0.0.1:8002';
const API_KEY = process.env.API_KEY?.trim();

if (!API_KEY) {
  console.error('API_KEY env var is required. Example:');
  console.error('  API_KEY=... bun run api:test:get');
  process.exit(2);
}

function withAuth(headers: HeadersInit = {}): HeadersInit {
  return {
    'X-API-Key': API_KEY!,
    'Accept': 'application/json, text/html',
    ...headers,
  };
}

function url(path: string): string {
  return path.startsWith('http') ? path : `${BASE_URL}${path}`;
}

// GET endpoints expected to be accessible in DB mode with an API key
// Note: Some of these are public; we still send the API key to exercise key auth path.
const tests: TestCase[] = [
  {
    name: 'Server status',
    path: '/api/status',
    expectStatus: s => s === 200,
    expectContentType: /^application\/json/i,
    validate: (data: any) => {
      if (typeof data?.serverRunning !== 'boolean') throw new Error('serverRunning missing');
      if (!('timestamp' in data)) throw new Error('timestamp missing');
    },
  },
  {
    name: 'Auth status',
    path: '/api/auth/status',
    expectStatus: 200,
    expectContentType: /^application\/json/i,
    validate: (data: any) => {
      if (!Array.isArray(data?.methods)) throw new Error('methods missing');
    },
  },
  {
    name: 'OpenAPI (JSON)',
    path: '/api/docs/openapi.json',
    expectStatus: 200,
    expectContentType: /^application\/json/i,
    validate: (data: any) => {
      if (!data?.openapi) throw new Error('openapi field missing');
    },
  },
  {
    name: 'OpenAPI (YAML)',
    path: '/api/docs/openapi.yaml',
    expectStatus: 200,
    expectContentType: /^(text\/yaml|application\/yaml)/i,
  },
  {
    name: 'Docs UI',
    path: '/api/docs',
    expectStatus: s => s === 200 || s === 500, // 500 if swagger assets weren’t vendored
    expectContentType: /^text\/html/i,
  },
  {
    name: 'Onboarding status (DB mode)',
    path: '/api/onboarding/status',
    expectStatus: 200,
    expectContentType: /^application\/json/i,
    validate: (data: any) => {
      if (typeof data?.initialized !== 'boolean') throw new Error('initialized missing');
      if (data?.headlessMode !== false && data?.headlessMode !== true) throw new Error('headlessMode missing');
    },
  },
];

type Result = { name: string; path: string; ok: boolean; status: number; detail?: string };

async function runOne(tc: TestCase): Promise<Result> {
  const target = url(tc.path);
  try {
    const res = await fetch(target, { method: 'GET', headers: withAuth() });
    const status = res.status;
    const ctype = res.headers.get('content-type') || '';

    // Status check
    if (typeof tc.expectStatus === 'number') {
      if (status !== tc.expectStatus) {
        return { name: tc.name, path: tc.path, ok: false, status, detail: `Expected ${tc.expectStatus}, got ${status}` };
      }
    } else if (typeof tc.expectStatus === 'function') {
      if (!tc.expectStatus(status)) {
        return { name: tc.name, path: tc.path, ok: false, status, detail: `Unexpected status ${status}` };
      }
    }

    // Content-Type check
    if (tc.expectContentType && !tc.expectContentType.test(ctype)) {
      return { name: tc.name, path: tc.path, ok: false, status, detail: `Unexpected Content-Type: ${ctype}` };
    }

    // Body validation (json or text)
    if (tc.validate) {
      const isJson = /json/i.test(ctype);
      const body = isJson ? await res.json().catch(() => ({})) : await res.text();
      await tc.validate(body, res);
    }

    return { name: tc.name, path: tc.path, ok: true, status };
  } catch (err: any) {
    return { name: tc.name, path: tc.path, ok: false, status: -1, detail: err?.message || String(err) };
  }
}

async function main() {
  console.log(`\n== GET endpoint checks (API key) ==`);
  console.log(`Base URL: ${BASE_URL}`);
  const results = await Promise.all(tests.map(runOne));
  for (const r of results) {
    const statusStr = r.status === -1 ? 'ERR' : r.status;
    console.log(`${r.ok ? '✅' : '❌'} ${r.name} [${statusStr}] ${r.path}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const passed = results.filter(r => r.ok).length;
  console.log(`\nPassed ${passed}/${results.length}`);
  if (passed !== results.length) process.exitCode = 1;
}

main();

