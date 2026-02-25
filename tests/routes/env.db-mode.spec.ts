import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

function loadFixtureTestKeysetSecret(): string | undefined {
  const fixturePath = path.resolve('tests/e2e/smoke-test-defaults.json');
  if (!fs.existsSync(fixturePath)) return undefined;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const testNsecHex = (raw as Record<string, unknown>).testNsecHex;
    return typeof testNsecHex === 'string' && testNsecHex.trim().length > 0 ? testNsecHex : undefined;
  } catch {
    return undefined;
  }
}

const TEST_KEYSET_SECRET =
  process.env.TEST_KEYSET_SECRET ??
  process.env.TEST_NSEC_HEX ??
  loadFixtureTestKeysetSecret();
if (!TEST_KEYSET_SECRET) {
  throw new Error(
    'TEST_KEYSET_SECRET (or TEST_NSEC_HEX) must be set, or tests/e2e/smoke-test-defaults.json must provide testNsecHex.'
  );
}

describe('DB-mode /api/env behavior', () => {
  test('rejects non-admin session without ADMIN_SECRET (403)', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};

      // DB mode (HEADLESS=false by default)
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');

      const logs = [];
      const context = {
        node: null,
        addServerLog: (...args: any[]) => { try { logs.push(args.map(String).join(' ')); } catch {} },
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        clientIp: '127.0.0.1',
        requestId: 'env-db-403',
        updateNode: () => {}
      };

      const req = new Request('http://localhost/api/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RELAYS: ['wss://relay.example'] })
      });

      const res = await handleEnvRoute(req, new URL(req.url), context, { authenticated: true, userId: 2 });
      const status = res?.status ?? null;
      console.log('@@RESULT@@' + JSON.stringify({ status }));
      process.exit(0);
    `;

    const out = runRouteScript(script);
    expect(out.status).toBe(403);
  }, { timeout: 8000 });

  test('stamps CREDENTIALS_SAVED_AT and attempts restart on creds update', () => {
    const script = `
      import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
      import os from 'os';
      import path from 'path';
      const root = ${JSON.stringify(PROJECT_ROOT)};

      // DB mode; provide ADMIN_SECRET to authorize write
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.ADMIN_SECRET = 'test-admin-secret';

      // Isolate .env operations to a temp directory
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'env-db-mode-'));
      const originalCwd = process.cwd();
      process.chdir(tmp);
      // Provide a minimal .env to start from
      writeFileSync('.env', '', 'utf8');

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');

      const logs: string[] = [];
      const context = {
        node: null,
        addServerLog: (...args: any[]) => { try { logs.push(args.map(String).join(' ')); } catch {} },
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        clientIp: '127.0.0.1',
        requestId: 'env-db-stamp',
        updateNode: () => {}
      };

      // Generate real FROSTR credentials so validateGroup/validateShare pass.
      // Resolve from project root because this script runs from a temp directory.
      const { createRequire } = await import('module');
      const requireFromRoot = createRequire(root + 'package.json');
      const iglooCorePath = requireFromRoot.resolve('@frostr/igloo-core');
      const { generateKeysetWithSecret } = await import(iglooCorePath);
      const { groupCredential, shareCredentials } = generateKeysetWithSecret(2, 2, ${JSON.stringify(TEST_KEYSET_SECRET)});

      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'test-admin-secret'
      });
      const body = { GROUP_CRED: groupCredential, SHARE_CRED: shareCredentials[0] };
      const req = new Request('http://localhost/api/env', { method: 'POST', headers, body: JSON.stringify(body) });

      const res = await handleEnvRoute(req, new URL(req.url), context, { authenticated: true, userId: 2 });
      const status = res?.status ?? null;

      // Verify timestamp via route utils (supports both explicit var and mtime fallback)
      const utils = await import(root + 'src/routes/utils.ts');
      const stamp = await utils.getCredentialsSavedAt();
      const hasStamp = !!stamp;

      process.chdir(originalCwd);

      console.log('@@RESULT@@' + JSON.stringify({ status, hasStamp }));
      process.exit(0);
    `;

    const out = runRouteScript(script);
    expect(out.hasStamp).toBeTrue();
    expect(out.status).toBe(200);
  }, { timeout: 10000 });
});
