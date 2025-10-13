import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('JSON body size limits', () => {
  test('env POST returns 413 when Content-Length exceeds limit', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.AUTH_ENABLED = 'true';
      process.env.API_KEY = 'k';
      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');

      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
        clientIp: '127.0.0.1'
      };

      const headers = new Headers({ 'x-api-key': 'k', 'content-length': String(1024 * 1024) });
      const req = new Request('http://localhost/api/env', { method: 'POST', headers, body: JSON.stringify({ RELAYS: ['wss://relay.example'] }) });
      const res = await handleEnvRoute(req, new URL(req.url), context, null);
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status }));
      process.exit(0);
    `;
    const result = runRouteScript(script);
    expect(result.status).toBe(413);
  });

  test('recovery POST returns 413 when Content-Length exceeds limit', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      const { handleRecoveryRoute } = await import(root + 'src/routes/recovery.ts');

      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        clientIp: '127.0.0.1'
      };

      const headers = new Headers({ 'content-length': String(1024 * 1024) });
      const req = new Request('http://localhost/api/recover', { method: 'POST', headers, body: JSON.stringify({ groupCredential: 'g', shareCredentials: ['s'] }) });
      const res = await handleRecoveryRoute(req, new URL(req.url), context, { authenticated: true });
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status }));
      process.exit(0);
    `;
    const result = runRouteScript(script);
    expect(result.status).toBe(413);
  });
});
