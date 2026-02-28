import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('NIP-46 routes', () => {
  test('route unavailable in headless mode', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handleNip46Route } = await import(root + 'src/routes/nip46.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/nip46/transport');
      const res = await handleNip46Route(req, new URL(req.url), context, { authenticated: true, userId: 1 });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(404);
    expect(result.body?.error).toContain('NIP-46 persistence unavailable');
  });

  test('rejects invalid policy map values with 400', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { handleNip46Route } = await import(root + 'src/routes/nip46.ts');
      const database = await import(root + 'src/db/database.ts');

      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-user', 'hash', 'salt')");

      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/nip46/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          policy: { methods: { sign_event: 'yes' } }
        })
      });

      const res = await handleNip46Route(req, new URL(req.url), context, { authenticated: true, userId: 1 });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      try { await database.closeDatabase(); } catch {}
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(400);
    expect(result.body?.error).toContain('policy.methods.sign_event');
  });
});
