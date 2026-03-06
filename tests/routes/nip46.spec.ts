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

  test('duplicate request lookup still finds older pending requests beyond 500 rows', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const database = await import(root + 'src/db/database.ts');
      const nip46 = await import(root + 'src/db/nip46.ts');

      await nip46.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-dedupe', 'hash', 'salt')");

      const sessionPubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      for (let i = 0; i < 550; i += 1) {
        nip46.createNip46Request({
          userId: 1,
          session_pubkey: sessionPubkey,
          method: 'sign_event',
          payload: { id: 'client-' + i, method: 'sign_event', params: [] }
        });
      }

      const oldest = nip46.getPendingNip46RequestByClientId(1, sessionPubkey, 'client-0');
      const newest = nip46.getPendingNip46RequestByClientId(1, sessionPubkey, 'client-549');

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        oldestFound: Boolean(oldest),
        newestFound: Boolean(newest)
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.oldestFound).toBe(true);
    expect(result.newestFound).toBe(true);
  });

  test('session creation rate limit survives delete-and-recreate churn', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.NIP46_SESSION_RATE_LIMIT_MAX = '1';
      process.env.NIP46_SESSION_RATE_LIMIT_WINDOW = '3600';

      const { handleNip46Route } = await import(root + 'src/routes/nip46.ts');
      const database = await import(root + 'src/db/database.ts');
      const { deleteSession } = await import(root + 'src/db/nip46.ts');

      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-rate-limit', 'hash', 'salt')");

      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const pubkey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const makeRequest = () => new Request('http://localhost/api/nip46/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey })
      });

      const first = await handleNip46Route(makeRequest(), new URL('http://localhost/api/nip46/sessions'), context, { authenticated: true, userId: 1 });
      deleteSession(1, pubkey);
      const second = await handleNip46Route(makeRequest(), new URL('http://localhost/api/nip46/sessions'), context, { authenticated: true, userId: 1 });
      const secondBody = await second.json();

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        firstStatus: first.status,
        secondStatus: second.status,
        secondBody
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.firstStatus).toBe(200);
    expect(result.secondStatus).toBe(429);
    expect(result.secondBody?.error).toContain('Rate limit exceeded');
  });
});
