import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner.ts';

describe('Onboarding routes', () => {
  test('status reports initialization state', () => {
    const tmpDir = mkdtempSync(path.join(process.cwd(), 'tmp-onboard-'));
    const dbPath = path.join(tmpDir, 'state.db');
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.DB_PATH = ${JSON.stringify(dbPath)};
      process.env.ADMIN_SECRET = 'integration-secret';

      const { handleOnboardingRoute } = await import(root + 'src/routes/onboarding.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/onboarding/status');
      const res = await handleOnboardingRoute(req, new URL(req.url), context);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    rmSync(tmpDir, { recursive: true, force: true });
    expect(result.status).toBe(200);
    expect(result.body?.headlessMode).toBe(false);
    expect(typeof result.body?.initialized).toBe('boolean');
  });

  test('validate-admin rejects missing secret', () => {
    const tmpDir = mkdtempSync(path.join(process.cwd(), 'tmp-onboard-'));
    const dbPath = path.join(tmpDir, 'state.db');
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.DB_PATH = ${JSON.stringify(dbPath)};
      process.env.ADMIN_SECRET = 'integration-secret';

      const { handleOnboardingRoute } = await import(root + 'src/routes/onboarding.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/onboarding/validate-admin', { method: 'POST' });
      const res = await handleOnboardingRoute(req, new URL(req.url), context);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    rmSync(tmpDir, { recursive: true, force: true });
    expect(result.status).toBe(401);
    expect(result.body?.error).toBe('Authentication failed');
  });
});
