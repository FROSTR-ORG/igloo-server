/**
 * Playwright global setup for igloo-server DB-mode smoke tests.
 *
 * What this does:
 *   1. Generate a 2-of-3 FROSTR keyset using @frostr/igloo-core (fixed nsec).
 *   2. Start igloo-server on port 18002 with a fresh temp SQLite DB.
 *   3. Complete DB-mode onboarding (validate-admin → setup → login).
 *   4. POST /api/user/credentials (share-0 + group) to start the bifrost node.
 *   5. Launch a minimal co-signer (cosigner.mjs) with share-1 via igloo-core.
 *   6. Probe signing to confirm the threshold is reachable.
 *   7. Create a persistent test API key.
 *   8. Write all shared state to a JSON file; export SMOKE_STATE_FILE env var.
 */

import { request } from '@playwright/test';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { FullConfig } from '@playwright/test';

// ─── Test constants ──────────────────────────────────────────────────────────

const PORT = 18002;
const BASE_URL = `http://localhost:${PORT}`;
const TMP_DIR = path.join(os.tmpdir(), 'igloo-smoke-test');
const STATE_FILE = path.join(TMP_DIR, 'state.json');
const DB_PATH = path.join(TMP_DIR, 'db');
const SERVER_LOG = path.join(TMP_DIR, 'server.log');
const COSIGNER_LOG = path.join(TMP_DIR, 'cosigner.log');

// A fixed, deterministic 32-byte secp256k1 private key (well below curve order)
const TEST_NSEC_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// Meets igloo-server password rules: upper + lower + digit + special(@), no sequences
const ADMIN_SECRET = 'SmokeTestAdmin1';
const ADMIN_USERNAME = 'testadmin';
const ADMIN_PASSWORD = 'T3stPass@9';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1000,
  label = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch {
      // ignore, keep polling
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  await pollUntil(
    async () => {
      const res = await fetch(url).catch(() => null);
      return res !== null && res.status < 500;
    },
    timeoutMs,
    500,
    `HTTP ${url}`,
  );
}

function spawnDetached(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logFile: string,
): ChildProcess {
  const out = fs.openSync(logFile, 'a');
  const proc = spawn(cmd, args, {
    env: { ...process.env, ...env },
    detached: false,
    stdio: ['ignore', out, out],
  });
  proc.on('error', err => {
    fs.appendFileSync(logFile, `\n[spawn error] ${err.message}\n`);
  });
  return proc;
}

// ─── Global setup ────────────────────────────────────────────────────────────

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Fresh temp directory every run
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(DB_PATH, { recursive: true });

  // ── 1. Generate FROSTR credentials via igloo-core ──────────────────────────
  console.log('[setup] Generating FROSTR credentials…');
  // Dynamic import so TS type-checker doesn't complain about the JS dist path
  const { generateKeysetWithSecret, decodeGroup } = await import(
    /* @ts-ignore */
    '../../node_modules/@frostr/igloo-core/dist/index.js'
  ) as {
    generateKeysetWithSecret: (t: number, n: number, sk: string) => { groupCredential: string; shareCredentials: string[] };
    decodeGroup: (g: string) => { group_pk: string; threshold: number; commits: unknown[] };
  };

  // Use 2-of-2 (not 2-of-3) so signing always selects the one connected cosigner.
  const { groupCredential, shareCredentials } = generateKeysetWithSecret(2, 2, TEST_NSEC_HEX);
  const group = decodeGroup(groupCredential);
  // x-only pubkey (strip 02/03 compression prefix) for NIP-44/NIP-04 tests
  const groupPubkeyHex = group.group_pk.replace(/^(02|03)/, '');


  // ── 3. Start igloo-server ──────────────────────────────────────────────────
  console.log('[setup] Starting igloo-server on port', PORT, '…');
  const serverProcess = spawnDetached(
    'bun',
    ['run', 'src/server.ts'],
    {
      ADMIN_SECRET,
      DB_PATH,
      HOST_PORT: String(PORT),
      HOST_NAME: '127.0.0.1',
      RATE_LIMIT_ENABLED: 'false',
      SKIP_RELAY_PROBE: 'true',
      SKIP_STARTUP_ECHO: 'true',
      NODE_ENV: 'test',
      AUTH_ENABLED: 'true',
      FROSTR_SIGN_TIMEOUT: '15000',
      UI_EVENT_LOG_INCLUDE_PINGS: 'false',
      UPDATE_CHECK_DISABLED: 'true',
      ALLOW_LOCALHOST_RELAY: 'true',
      // Clear any .env credentials so the server starts without pre-loaded creds
      GROUP_CRED: '',
      SHARE_CRED: '',
      RELAYS: '',
    },
    SERVER_LOG,
  );

  await waitForHttp(`${BASE_URL}/api/onboarding/status`, 20_000);
  console.log('[setup] Server is up.');

  // ── 4. Onboarding ──────────────────────────────────────────────────────────
  console.log('[setup] Running onboarding…');
  const api = await request.newContext({ baseURL: BASE_URL });

  let res = await api.post('/api/onboarding/validate-admin', {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok()) throw new Error(`validate-admin failed ${res.status()}: ${await res.text()}`);

  res = await api.post('/api/onboarding/setup', {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) throw new Error(`setup failed ${res.status()}: ${await res.text()}`);

  // ── 5. Login ───────────────────────────────────────────────────────────────
  console.log('[setup] Logging in…');
  res = await api.post('/api/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) throw new Error(`login failed ${res.status()}: ${await res.text()}`);
  const { sessionId } = (await res.json()) as { sessionId: string };

  // ── 6. Set FROSTR credentials (share-0 + group) ────────────────────────────
  // In DB mode credentials are stored per-user (encrypted) via /api/user/credentials,
  // NOT via /api/env (which only writes to .env file and does not start the node).
  console.log('[setup] Setting FROSTR credentials on server…');
  res = await api.post('/api/user/credentials', {
    headers: { 'X-Session-ID': sessionId },
    data: {
      group_cred: groupCredential,
      share_cred: shareCredentials[0],
      relays: [`ws://127.0.0.1:${PORT}`],
    },
  });
  if (!res.ok()) throw new Error(`set-credentials failed ${res.status()}: ${await res.text()}`);

  // Wait for the bifrost node to go active
  await pollUntil(
    async () => {
      const s = await api.get('/api/status', { headers: { 'X-Session-ID': sessionId } });
      if (!s.ok()) return false;
      const body = (await s.json()) as { nodeActive: boolean };
      return body.nodeActive === true;
    },
    15_000,
    1000,
    'nodeActive = true',
  );
  console.log('[setup] Node is active.');

  // ── 7. Start co-signer (share index 1) using igloo-core directly ──────────
  // We use a minimal cosigner.mjs script so we control which share credentials
  // are used and avoid igloo-cli's interactive TUI entirely.
  // Server holds shareCredentials[0]; co-signer holds shareCredentials[1].
  console.log('[setup] Starting co-signer with shareCredentials[1]…');
  const cosignerProcess = spawnDetached(
    'node',
    [
      path.resolve('tests/e2e/cosigner.mjs'),
      groupCredential,
      shareCredentials[1],
      `ws://127.0.0.1:${PORT}`,
    ],
    {},
    COSIGNER_LOG,
  );
  console.log('[setup] Co-signer pid:', cosignerProcess.pid);

  // ── 8. Signing readiness probe ─────────────────────────────────────────────
  // Retry signing a known 32-byte hex to confirm threshold is reachable
  console.log('[setup] Probing signing (waiting for co-signer to join relay)…');
  const TEST_MSG = 'a'.repeat(64); // 32-byte all-0xAA event id
  let signOk = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(3000);
    const sr = await api.post('/api/sign', {
      headers: { 'X-Session-ID': sessionId },
      data: { message: TEST_MSG },
    }).catch(() => null);
    if (sr && sr.ok()) {
      signOk = true;
      console.log(`[setup] Signing OK on attempt ${attempt}.`);
      break;
    }
    const errBody = sr ? await sr.text().catch(() => '(unreadable)') : '(no response)';
    console.log(`[setup] Signing attempt ${attempt} failed (${sr?.status() ?? 'err'}): ${errBody.slice(0, 200)}`);
  }
  if (!signOk) {
    const cosLog = fs.existsSync(COSIGNER_LOG) ? fs.readFileSync(COSIGNER_LOG, 'utf8') : '(empty)';
    throw new Error(`Co-signer did not become ready within 25 s.\nCo-signer log:\n${cosLog}`);
  }

  // ── 9. Create persistent test API key ─────────────────────────────────────
  console.log('[setup] Creating test API key…');
  res = await api.post('/api/admin/api-keys', {
    headers: { 'X-Session-ID': sessionId },
    data: { label: 'smoke-test-key' },
  });
  let apiKey: string | null = null;
  let apiKeyId: string | null = null;
  if (res.ok()) {
    const body = (await res.json()) as { apiKey: { token: string; id: string | number } };
    apiKey = body.apiKey.token;
    apiKeyId = String(body.apiKey.id);
  } else {
    console.warn('[setup] Could not create API key – admin key tests will be skipped.');
  }

  await api.dispose();

  // ── 10. Persist shared state ───────────────────────────────────────────────
  const state = {
    port: PORT,
    baseUrl: BASE_URL,
    tmpDir: TMP_DIR,
    serverPid: serverProcess.pid,
    cosignerPid: cosignerProcess.pid,
    sessionId,
    apiKey,
    apiKeyId,
    groupCredential,
    shareCredentials,
    groupPubkeyHex,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    adminSecret: ADMIN_SECRET,
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  process.env.SMOKE_STATE_FILE = STATE_FILE;

  console.log('[setup] ✓ Global setup complete. State saved to', STATE_FILE);
}
