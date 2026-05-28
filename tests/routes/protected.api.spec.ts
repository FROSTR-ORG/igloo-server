import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes, createHmac } from 'node:crypto';
import { pathToFileURL } from 'url';
import { secp256k1 } from '@noble/curves/secp256k1';
import { nip44 } from 'nostr-tools';
import { runRouteScript } from './helpers/script-runner';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function oracleConversationKey(sharedX: Uint8Array): Uint8Array {
  if (sharedX.length !== 32) throw new Error('sharedX must be 32 bytes');
  return Uint8Array.from(
    createHmac('sha256', Buffer.from('nip44-v2', 'utf8')).update(Buffer.from(sharedX)).digest()
  );
}

/**
 * Build a shared peer+signer fixture used to assert cross-surface NIP-44
 * interop between HTTP `/api/nip44/*` and NIP-46 `nip44_*`.
 */
function buildCrossSurfaceFixture() {
  const peerPriv = randomBytes(32);
  const peerPubFull = secp256k1.getPublicKey(peerPriv, true);
  const peerPubCompressed = bytesToHex(peerPubFull);
  const peerPubXOnly = peerPubCompressed.slice(2);

  const signerPriv = randomBytes(32);
  const signerPubFull = secp256k1.getPublicKey(signerPriv, true);
  const signerPubXOnly = bytesToHex(signerPubFull).slice(2);

  const sharedFromSigner = secp256k1.getSharedSecret(signerPriv, peerPubCompressed).slice(1, 33);
  const sharedFromPeerCompat = secp256k1.getSharedSecret(peerPriv, '02' + signerPubXOnly).slice(1, 33);
  const convToolkitBytes = nip44.v2.utils.getConversationKey(peerPriv, signerPubXOnly);

  return {
    peerPubCompressed,
    peerPubXOnly,
    sharedXHex: bytesToHex(sharedFromSigner),
    convBytesHex: bytesToHex(convToolkitBytes),
    convLocalHex: bytesToHex(oracleConversationKey(sharedFromPeerCompat)),
  };
}

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
        sign: async (id: string) => ({ ok: true, data: [[id, 'stub', 'deadbeef'.repeat(16)]] }),
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
    expect(body.signature).toBe('deadbeef'.repeat(16));
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

  test('cross-surface nip44 interop: HTTP /api/nip44/encrypt ciphertext decrypts via NIP-46 nip44_decrypt (x-only peer)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildCrossSurfaceFixture();
    expect(fixture.convBytesHex).toBe(fixture.convLocalHex);

    const node = {
      req: { ecdh: async () => ({ ok: true, data: fixture.sharedXHex }) },
    };
    const context = makeContext(node);

    // 1. Encrypt via HTTP route on the shared "instance" (same fake ECDH node).
    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const plaintext = 'hello cross-surface (x-only)';
    const encReq = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: plaintext }),
    });
    const encRes = await handleNip44Route(encReq, new URL(encReq.url), context, { authenticated: true });
    expect(encRes?.status).toBe(200);
    const encBody = await encRes?.json();
    expect(typeof encBody?.result).toBe('string');

    // 2. Decrypt that HTTP-produced ciphertext via NIP-46 service against the same node.
    const script = `
      const root = ${JSON.stringify(pathToFileURL(process.cwd() + '/').href)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => ({ req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) } }),
      });

      const plaintext = await service.handleNip44Decrypt({
        params: [${JSON.stringify(fixture.peerPubXOnly)}, ${JSON.stringify(encBody.result)}]
      });
      console.log('@@RESULT@@' + JSON.stringify({ plaintext }));
      process.exit(0);
    `;
    const result = runRouteScript<{ plaintext: string }>(script);
    expect(result.plaintext).toBe(plaintext);
  }, { timeout: 15000 });

  test('cross-surface nip44 interop: NIP-46 nip44_encrypt ciphertext decrypts via HTTP /api/nip44/decrypt (compressed peer)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildCrossSurfaceFixture();

    // 1. Encrypt via NIP-46 service on the shared "instance" using a compressed peer key.
    const script = `
      const root = ${JSON.stringify(pathToFileURL(process.cwd() + '/').href)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => ({ req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) } }),
      });

      const ciphertext = await service.handleNip44Encrypt({
        params: [${JSON.stringify(fixture.peerPubCompressed)}, 'hello cross-surface (compressed)']
      });
      console.log('@@RESULT@@' + JSON.stringify({ ciphertext }));
      process.exit(0);
    `;
    const result = runRouteScript<{ ciphertext: string }>(script);
    expect(typeof result.ciphertext).toBe('string');

    // 2. Decrypt that NIP-46-produced ciphertext via HTTP route against the same node.
    const node = {
      req: { ecdh: async () => ({ ok: true, data: fixture.sharedXHex }) },
    };
    const context = makeContext(node);
    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const decReq = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubCompressed, content: result.ciphertext }),
    });
    const decRes = await handleNip44Route(decReq, new URL(decReq.url), context, { authenticated: true });
    expect(decRes?.status).toBe(200);
    const decBody = await decRes?.json();
    expect(decBody?.result).toBe('hello cross-surface (compressed)');
  }, { timeout: 15000 });

  test('cross-surface nip44 interop: standards-compliant external peer ciphertext decrypts on both HTTP and NIP-46', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildCrossSurfaceFixture();
    const externalCiphertext = nip44.encrypt(
      'external peer message',
      Buffer.from(fixture.convBytesHex, 'hex')
    );

    // 1. Decrypt via HTTP.
    const node = {
      req: { ecdh: async () => ({ ok: true, data: fixture.sharedXHex }) },
    };
    const context = makeContext(node);
    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const httpReq = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: externalCiphertext }),
    });
    const httpRes = await handleNip44Route(httpReq, new URL(httpReq.url), context, { authenticated: true });
    expect(httpRes?.status).toBe(200);
    const httpBody = await httpRes?.json();
    expect(httpBody?.result).toBe('external peer message');

    // 2. Decrypt via NIP-46 against the same shared instance.
    const script = `
      const root = ${JSON.stringify(pathToFileURL(process.cwd() + '/').href)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => ({ req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) } }),
      });

      const plaintext = await service.handleNip44Decrypt({
        params: [${JSON.stringify('02' + fixture.peerPubXOnly)}, ${JSON.stringify(externalCiphertext)}]
      });
      console.log('@@RESULT@@' + JSON.stringify({ plaintext }));
      process.exit(0);
    `;
    const result = runRouteScript<{ plaintext: string }>(script);
    expect(result.plaintext).toBe('external peer message');
  }, { timeout: 15000 });

  test('HTTP requests to /api/events return 404', () => {
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
    expect(result.status).toBe(404);
  }, { timeout: 8000 });
});
