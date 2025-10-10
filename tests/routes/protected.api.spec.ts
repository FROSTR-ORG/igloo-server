import { afterEach, describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'url';
import { runRouteScript } from './helpers/script-runner';

type FakeSignNode = {
  req: {
    sign: (id: string) => Promise<{ ok: boolean; data: any[] }>;
  };
};

type FakeECDHNode = {
  req: {
    ecdh: (peer: string) => Promise<{ ok: boolean; data: string }>;
  };
};

function makeContext(node: any) {
  return {
    node,
    addServerLog: () => {},
    broadcastEvent: () => {},
    peerStatuses: new Map(),
    eventStreams: new Set(),
    restartState: { blockedByCredentials: false },
  };
}

afterEach(() => {
  delete process.env.GROUP_CRED;
  delete process.env.SHARE_CRED;
  delete process.env.AUTH_ENABLED;
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.HEADLESS;
  delete process.env.DB_PATH;
});

describe('API key-protected route handlers', () => {
  test('shares listing reflects env-backed credentials', async () => {
    const root = pathToFileURL(process.cwd() + '/').href;
    const script = `
      const root = ${JSON.stringify(root)};
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.HEADLESS = 'true';
      process.env.GROUP_CRED = 'group-cred-stub';
      process.env.SHARE_CRED = 'share-cred-stub';

      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');

      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        clientIp: '127.0.0.1',
        requestId: 'shares-env',
      };

      const req = new Request('http://localhost/api/env/shares');
      const res = await handleEnvRoute(req, new URL(req.url), context, { authenticated: true });
      const body = await res?.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res?.status ?? null, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body.length).toBeGreaterThanOrEqual(1);
    expect(result.body[0]).toMatchObject({
      hasShareCredential: true,
      hasGroupCredential: true,
    });
  }, { timeout: 8000 });

  test('sign route returns signature when node succeeds', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleSignRoute } = await import(`../../src/routes/sign.ts?${Math.random()}`);

    const node: FakeSignNode = {
      req: {
        sign: async (id: string) => ({ ok: true, data: [[id, 'stub', 'deadbeefcafe']] }),
      },
    };

    const context = makeContext(node);
    const req = new Request('http://localhost/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '1'.repeat(64) }),
    });

    const res = await handleSignRoute(req, new URL(req.url), context, { authenticated: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signature).toBe('deadbeefcafe');
    expect(body.id).toBe('1'.repeat(64));
  }, { timeout: 10000 });

  test('sign route returns 503 when node unavailable', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleSignRoute } = await import(`../../src/routes/sign.ts?${Math.random()}`);
    const context = makeContext(null);
    const req = new Request('http://localhost/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '1'.repeat(64) }),
    });

    const res = await handleSignRoute(req, new URL(req.url), context, { authenticated: true });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('NODE_UNAVAILABLE');
  }, { timeout: 8000 });

  test('recovery endpoint rejects invalid credential payload', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleRecoveryRoute } = await import(`../../src/routes/recovery.ts?${Math.random()}`);
    const context = makeContext(null);
    const req = new Request('http://localhost/api/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupCredential: 'invalid',
        shareCredentials: ['invalid-share'],
      }),
    });

    const res = await handleRecoveryRoute(req, new URL(req.url), context, { authenticated: true });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid');
  }, { timeout: 8000 });

  test('recovery validate flags malformed group credential', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleRecoveryRoute } = await import(`../../src/routes/recovery.ts?${Math.random()}`);
    const context = makeContext(null);
    const req = new Request('http://localhost/api/recover/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'group',
        credential: 'invalid-group',
      }),
    });

    const res = await handleRecoveryRoute(req, new URL(req.url), context, { authenticated: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validation?.isValid).toBe(false);
  }, { timeout: 8000 });

  test('NIP-44 endpoint round-trips using derived ECDH secret', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const node: FakeECDHNode = {
      req: {
        ecdh: async () => ({ ok: true, data: 'a'.repeat(64) }),
      },
    };
    const context = makeContext(node);

    const payload = { peer_pubkey: '02' + '1'.repeat(64), content: 'hello nip44' };
    const encReq = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const encRes = await handleNip44Route(encReq, new URL(encReq.url), context, { authenticated: true });
    expect(encRes?.status).toBe(200);
    const encBody = await encRes?.json();
    expect(typeof encBody?.result).toBe('string');

    const decReq = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: payload.peer_pubkey, content: encBody.result }),
    });
    const decRes = await handleNip44Route(decReq, new URL(decReq.url), context, { authenticated: true });
    expect(decRes?.status).toBe(200);
    const decBody = await decRes?.json();
    expect(decBody?.result).toBe('hello nip44');
  }, { timeout: 10000 });

  test('NIP-04 endpoint round-trips using derived ECDH secret', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { handleNip04Route } = await import(`../../src/routes/nip04.ts?${Math.random()}`);
    const node: FakeECDHNode = {
      req: {
        ecdh: async () => ({ ok: true, data: 'b'.repeat(64) }),
      },
    };
    const context = makeContext(node);

    const payload = { peer_pubkey: '03' + '2'.repeat(64), content: 'hello nip04' };
    const encReq = new Request('http://localhost/api/nip04/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const encRes = await handleNip04Route(encReq, new URL(encReq.url), context, { authenticated: true });
    expect(encRes?.status).toBe(200);
    const encBody = await encRes?.json();
    expect(typeof encBody?.result).toBe('string');

    const decReq = new Request('http://localhost/api/nip04/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: payload.peer_pubkey, content: encBody.result }),
    });
    const decRes = await handleNip04Route(decReq, new URL(decReq.url), context, { authenticated: true });
    expect(decRes?.status).toBe(200);
    const decBody = await decRes?.json();
    expect(decBody?.result).toBe('hello nip04');
  }, { timeout: 10000 });

  test('HTTP requests to /api/events fall through to 404', () => {
    const root = pathToFileURL(process.cwd() + '/').href;
    const script = `
      const root = ${JSON.stringify(root)};
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.HEADLESS = 'true';

      const { handleRequest } = await import(root + 'src/routes/index.ts');
      const baseContext = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };
      const privilegedContext = {
        ...baseContext,
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/events');
      const res = await handleRequest(req, new URL(req.url), baseContext, privilegedContext);
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect([401, 404]).toContain(result.status);
  }, { timeout: 8000 });
});
