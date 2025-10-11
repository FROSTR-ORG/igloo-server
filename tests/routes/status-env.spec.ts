import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('Status & Env routes', () => {
  test('status route returns server snapshot in headless mode', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.AUTH_ENABLED = 'false';

      const { handleStatusRoute } = await import(root + 'src/routes/status.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/status');
      const res = await handleStatusRoute(req, new URL(req.url), context, null);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(result.body?.serverRunning).toBe(true);
    expect(Array.isArray(result.body?.relays)).toBe(true);
  });

  test('status route handles CORS preflight', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handleStatusRoute } = await import(root + 'src/routes/status.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/status', { method: 'OPTIONS' });
      const res = await handleStatusRoute(req, new URL(req.url), context, null);
      console.log('@@RESULT@@' + JSON.stringify({ status: res?.status ?? null }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(204);
  });

  test('env route unavailable in database mode', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/env');
      const res = await handleEnvRoute(req, new URL(req.url), context, null);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(401);
    expect(result.body?.error).toContain('Authentication required');
  });

  test('env route requires authentication for writes', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.AUTH_ENABLED = 'true';

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/env', { method: 'POST' });
      const res = await handleEnvRoute(req, new URL(req.url), context, null);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(401);
    expect(result.body?.error).toContain('Authentication required');
  });

  test('headless env GET requires auth (no API key)', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.AUTH_ENABLED = 'false';

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/env');
      const res = await handleEnvRoute(req, new URL(req.url), context, null);
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(401);
    expect(String(result.body?.error || '').toLowerCase()).toContain('authentication');
  });
});
