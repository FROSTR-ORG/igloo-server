import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('User & Peers routes', () => {
  test('user route rejects API key identities', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { handleUserRoute } = await import(root + 'src/routes/user.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/user/profile');
      const res = await handleUserRoute(req, new URL(req.url), context, { authenticated: true, userId: 'api-key:demo' });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(401);
    expect(result.body?.error).toContain('Database user authentication required');
  });

  test('peers route surfaces missing credential error', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handlePeersRoute } = await import(root + 'src/routes/peers.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/peers');
      const res = await handlePeersRoute(req, new URL(req.url), context, { authenticated: true });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(400);
    expect(result.body?.error).toBe('No group credential available');
  });
});
