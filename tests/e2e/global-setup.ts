/**
 * Playwright global setup for DB-mode smoke tests.
 *
 * What this does:
 * 1. Generate a deterministic 2-of-2 FROSTR keyset.
 * 2. Start igloo-server against a fresh temporary DB path.
 * 3. Complete onboarding and login.
 * 4. Persist user credentials to start the Bifrost node.
 * 5. Start a real co-signer process.
 * 6. Probe signing readiness.
 * 7. Create a reusable API key for auth tests.
 * 8. Persist shared state for specs and teardown.
 */

import { request } from '@playwright/test';
import type { APIRequestContext, FullConfig } from '@playwright/test';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import type { SmokeTestState } from './state.js';

const REQUESTED_PORT_RAW = process.env.SMOKE_TEST_PORT ?? '18002';
const REQUESTED_PORT = Number.parseInt(REQUESTED_PORT_RAW, 10);
const DEFAULT_PORT = Number.isFinite(REQUESTED_PORT) && REQUESTED_PORT > 0 ? REQUESTED_PORT : 18002;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TMP_DIR = process.env.SMOKE_TEST_TMP_DIR ?? path.join(os.tmpdir(), `igloo-smoke-test-${RUN_ID}`);
const STATE_FILE = path.join(TMP_DIR, 'state.json');
const DB_PATH = path.join(TMP_DIR, 'db');
const SERVER_LOG = path.join(TMP_DIR, 'server.log');
const COSIGNER_LOG = path.join(TMP_DIR, 'cosigner.log');

const smokeDefaultsPath = path.resolve('tests/e2e/smoke-test-defaults.json');
const smokeDefaultsRaw: unknown = JSON.parse(fs.readFileSync(smokeDefaultsPath, 'utf8'));
if (typeof smokeDefaultsRaw !== 'object' || smokeDefaultsRaw === null) {
  throw new Error(`smoke-test-defaults.json must be a JSON object, got ${typeof smokeDefaultsRaw}`);
}
const raw = smokeDefaultsRaw as Record<string, unknown>;
if (typeof raw.testNsecHex !== 'string' || raw.testNsecHex.trim().length === 0) {
  throw new Error(
    'smoke-test-defaults.json is missing required non-empty string property: testNsecHex.',
  );
}
const smokeDefaults = raw as {
  testNsecHex: string;
};

function loadOptionalLocalSmokeCredentials(): Partial<{
  adminSecret: string;
  adminUsername: string;
  adminPassword: string;
}> {
  const localFixturePath =
    process.env.SMOKE_LOCAL_FIXTURE_PATH?.trim() ||
    path.resolve('tests/e2e/smoke-test.local.json');
  if (!fs.existsSync(localFixturePath)) {
    return {};
  }
  try {
    const localRaw: unknown = JSON.parse(fs.readFileSync(localFixturePath, 'utf8'));
    if (typeof localRaw !== 'object' || localRaw === null) {
      throw new Error('expected JSON object');
    }
    const fixture = localRaw as Record<string, unknown>;
    return {
      adminSecret: typeof fixture.adminSecret === 'string' && fixture.adminSecret.trim().length > 0
        ? fixture.adminSecret
        : undefined,
      adminUsername: typeof fixture.adminUsername === 'string' && fixture.adminUsername.trim().length > 0
        ? fixture.adminUsername
        : undefined,
      adminPassword: typeof fixture.adminPassword === 'string' && fixture.adminPassword.trim().length > 0
        ? fixture.adminPassword
        : undefined,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse local smoke fixture at ${localFixturePath}: ${detail}`);
  }
}

const localSmokeCredentials = loadOptionalLocalSmokeCredentials();

function requireNonEmptyString(value: string | undefined, errorMessage: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(errorMessage);
  }
  return value;
}

// Defaults come from fixture for local CI; callers can still override via environment.
const TEST_NSEC_HEX = process.env.TEST_NSEC_HEX ?? smokeDefaults.testNsecHex;
const MISSING_SMOKE_CREDS_MESSAGE =
  'Smoke admin credentials are required. Set SMOKE_ADMIN_SECRET, SMOKE_ADMIN_USERNAME, and ' +
  'SMOKE_ADMIN_PASSWORD (or provide tests/e2e/smoke-test.local.json).';
const ADMIN_SECRET = requireNonEmptyString(
  process.env.SMOKE_ADMIN_SECRET ?? process.env.ADMIN_SECRET ?? localSmokeCredentials.adminSecret,
  MISSING_SMOKE_CREDS_MESSAGE
);
const ADMIN_USERNAME = requireNonEmptyString(
  process.env.SMOKE_ADMIN_USERNAME ?? process.env.ADMIN_USERNAME ?? localSmokeCredentials.adminUsername,
  MISSING_SMOKE_CREDS_MESSAGE
);
const ADMIN_PASSWORD = requireNonEmptyString(
  process.env.SMOKE_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? localSmokeCredentials.adminPassword,
  MISSING_SMOKE_CREDS_MESSAGE
);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeState(state: SmokeTestState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  process.env.SMOKE_STATE_FILE = STATE_FILE;
}

function terminateProcess(proc: ChildProcess | null, label: string): void {
  if (!proc?.pid) return;
  try {
    process.kill(proc.pid, 'SIGTERM');
    console.log(`[setup] Sent SIGTERM to ${label} (pid ${proc.pid})`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.warn(`[setup] Could not stop ${label} (pid ${proc.pid})`, err);
    }
  }
}

// Port probing is inherently TOCTOU: we can only test availability now, not reserve it
// forever. For CI smoke tests this low-probability race is acceptable.
function canBindPort(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

// Reserve an ephemeral port by binding to :0 and immediately closing; another process
// could still claim it before spawn, but this is sufficient for smoke test setup.
function reserveRandomPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// Prefer the requested port, but fall back when busy. This does not eliminate the
// bind race between probing and process startup.
async function resolvePort(host: string, preferredPort: number): Promise<number> {
  if (await canBindPort(preferredPort, host)) {
    return preferredPort;
  }
  const fallbackPort = await reserveRandomPort(host);
  if (!Number.isInteger(fallbackPort) || fallbackPort < 1 || fallbackPort > 65535) {
    throw new Error(
      `[setup] Failed to reserve a valid fallback port after preferred port ${preferredPort} was busy (got: ${fallbackPort})`,
    );
  }
  console.warn(`[setup] Port ${preferredPort} in use, falling back to ${fallbackPort} (probe-close race still applies)`);
  return fallbackPort;
}

async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1000,
  label = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      const nearingDeadline = Date.now() + intervalMs >= deadline;
      if (consecutiveFailures === 3 || nearingDeadline) {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.warn(`[setup] pollUntil(${label}) transient failure x${consecutiveFailures}: ${detail}`);
      }
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
  try {
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      detached: false,
      stdio: ['ignore', out, out],
    });
    proc.on('error', err => {
      fs.appendFileSync(logFile, `\n[spawn error] ${err.message}\n`);
    });
    return proc;
  } finally {
    fs.closeSync(out);
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const host = '127.0.0.1';
  const port = await resolvePort(host, DEFAULT_PORT);
  const baseUrl = `http://${host}:${port}`;

  const state: SmokeTestState = {
    port,
    baseUrl,
    tmpDir: TMP_DIR,
    serverPid: 0,
    cosignerPid: 0,
    sessionId: '',
    apiKey: null,
    apiKeyId: null,
    groupCredential: '',
    shareCredentials: [],
    groupPubkeyHex: '',
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    adminSecret: ADMIN_SECRET,
  };

  let api: APIRequestContext | null = null;
  let serverProcess: ChildProcess | null = null;
  let cosignerProcess: ChildProcess | null = null;

  process.env.SMOKE_STATE_FILE = STATE_FILE;

  try {
    const resolvedTmp = path.resolve(TMP_DIR);
    const tempRoot = path.resolve(os.tmpdir());
    const relToTempRoot = path.relative(tempRoot, resolvedTmp);
    const isInsideTemp =
      relToTempRoot.length > 0 &&
      relToTempRoot !== '.' &&
      !relToTempRoot.startsWith('..') &&
      !path.isAbsolute(relToTempRoot);

    if (fs.existsSync(TMP_DIR)) {
      if (isInsideTemp) {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
      } else {
        console.warn('[setup] Skipping TMP_DIR cleanup outside os.tmpdir():', resolvedTmp);
      }
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(DB_PATH, { recursive: true });
    writeState(state);

    console.log('[setup] Generating FROSTR credentials...');
    const iglooCore = await import('@frostr/igloo-core') as typeof import('@frostr/igloo-core');
    const { generateKeysetWithSecret, decodeGroup } = iglooCore;

    const { groupCredential, shareCredentials } = generateKeysetWithSecret(2, 2, TEST_NSEC_HEX);
    if (
      !Array.isArray(shareCredentials) ||
      shareCredentials.length < 2 ||
      typeof shareCredentials[0] !== 'string' ||
      typeof shareCredentials[1] !== 'string'
    ) {
      throw new Error(
        `Invalid keyset from generateKeysetWithSecret: shareCredentials.length=${Array.isArray(shareCredentials) ? shareCredentials.length : 'non-array'} ` +
        `shareCredentials=${JSON.stringify(shareCredentials)} groupCredentialType=${typeof groupCredential}`
      );
    }
    const group = decodeGroup(groupCredential);
    const groupPubkeyHex = group.group_pk.replace(/^(02|03)/, '');
    state.groupCredential = groupCredential;
    state.shareCredentials = shareCredentials;
    state.groupPubkeyHex = groupPubkeyHex;
    writeState(state);

    console.log('[setup] Starting igloo-server on port', port, '...');
    serverProcess = spawnDetached(
      'bun',
      ['run', 'src/server.ts'],
      {
        ADMIN_SECRET,
        DB_PATH,
        HOST_PORT: String(port),
        HOST_NAME: host,
        RATE_LIMIT_ENABLED: 'false',
        SKIP_RELAY_PROBE: 'true',
        SKIP_STARTUP_ECHO: 'true',
        NODE_ENV: 'test',
        AUTH_ENABLED: 'true',
        FROSTR_SIGN_TIMEOUT: '5000',
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
    state.serverPid = serverProcess.pid ?? 0;
    writeState(state);

    await waitForHttp(`${baseUrl}/api/onboarding/status`, 20_000);
    console.log('[setup] Server is up.');

    console.log('[setup] Running onboarding...');
    api = await request.newContext({ baseURL: baseUrl });

    let res = await api.post('/api/onboarding/validate-admin', {
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    if (!res.ok()) throw new Error(`validate-admin failed ${res.status()}: ${await res.text()}`);

    res = await api.post('/api/onboarding/setup', {
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`setup failed ${res.status()}: ${await res.text()}`);

    console.log('[setup] Logging in...');
    res = await api.post('/api/auth/login', {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`login failed ${res.status()}: ${await res.text()}`);
    const { sessionId } = (await res.json()) as { sessionId: string };
    state.sessionId = sessionId;
    writeState(state);

    console.log('[setup] Setting FROSTR credentials on server...');
    res = await api.post('/api/user/credentials', {
      headers: { 'X-Session-ID': sessionId },
      data: {
        group_cred: groupCredential,
        share_cred: shareCredentials[0],
        relays: [`ws://${host}:${port}`],
      },
    });
    if (!res.ok()) throw new Error(`set-credentials failed ${res.status()}: ${await res.text()}`);

    await pollUntil(
      async () => {
        const s = await api!.get('/api/status', { headers: { 'X-Session-ID': sessionId } });
        if (!s.ok()) return false;
        const body = (await s.json()) as { nodeActive: boolean };
        return body.nodeActive === true;
      },
      15_000,
      1000,
      'nodeActive = true',
    );
    console.log('[setup] Node is active.');

    console.log('[setup] Starting co-signer with shareCredentials[1]...');
    cosignerProcess = spawnDetached(
      'node',
      [
        path.resolve('tests/e2e/cosigner.mjs'),
        groupCredential,
        shareCredentials[1],
        `ws://${host}:${port}`,
      ],
      {},
      COSIGNER_LOG,
    );
    state.cosignerPid = cosignerProcess.pid ?? 0;
    writeState(state);
    console.log('[setup] Co-signer pid:', cosignerProcess.pid);

    console.log('[setup] Probing signing (waiting for co-signer to join relay)...');
    const TEST_MSG = 'a'.repeat(64);
    let signOk = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (cosignerProcess && cosignerProcess.exitCode !== null) {
        const cosLog = fs.existsSync(COSIGNER_LOG) ? fs.readFileSync(COSIGNER_LOG, 'utf8') : '(empty)';
        throw new Error(
          `Co-signer exited early with code ${cosignerProcess.exitCode} before signing was ready.\nCo-signer log:\n${cosLog}`
        );
      }
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
      throw new Error(`Co-signer did not become ready within probe window.\nCo-signer log:\n${cosLog}`);
    }

    console.log('[setup] Creating test API key...');
    res = await api.post('/api/admin/api-keys', {
      headers: { 'X-Session-ID': sessionId },
      data: { label: 'smoke-test-key' },
    });
    if (res.ok()) {
      const body = (await res.json()) as { apiKey: { token: string; id: string | number } };
      state.apiKey = body.apiKey.token;
      state.apiKeyId = String(body.apiKey.id);
    } else {
      console.warn('[setup] Could not create API key - auth tests will skip API-key checks.');
    }

    await api.dispose();
    api = null;

    writeState(state);
    console.log('[setup] Global setup complete. State saved to', STATE_FILE);
  } catch (err) {
    if (api) {
      try {
        await api.dispose();
      } catch {
        // no-op
      }
    }

    terminateProcess(cosignerProcess, 'co-signer');
    terminateProcess(serverProcess, 'server');

    // Persist whatever we have so teardown can still clean up.
    try {
      writeState(state);
    } catch {
      // no-op
    }
    throw err;
  }
}
