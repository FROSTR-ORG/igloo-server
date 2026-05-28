import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes, createHmac } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { nip44 } from 'nostr-tools';

type FakeECDHNode = {
  req: {
    ecdh: (peer: string) => Promise<{ ok: boolean; data: any }>;
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Independent NIP-44 v2 conversation key derivation used as the test oracle.
 * Equivalent to `nostr-tools.nip44.v2.utils.getConversationKey` but invoked
 * directly from the ECDH shared X so we can simulate threshold ECDH without
 * exposing a real private key inside Igloo.
 */
function oracleConversationKey(sharedX: Uint8Array): Uint8Array {
  if (sharedX.length !== 32) throw new Error('sharedX must be 32 bytes');
  return Uint8Array.from(
    createHmac('sha256', Buffer.from('nip44-v2', 'utf8')).update(Buffer.from(sharedX)).digest()
  );
}

/**
 * Generates a peer + signer pair and returns the shared X coordinate that
 * Igloo's threshold ECDH would return for `signerPriv * peerPub` along with
 * the standards-compliant NIP-44 v2 conversation key derived independently
 * from that shared X.
 */
function buildPeerFixture() {
  const peerPriv = randomBytes(32);
  const peerPubFull = secp256k1.getPublicKey(peerPriv, true); // 02/03 + X
  const peerPubCompressed = toHex(peerPubFull);
  const peerPubXOnly = peerPubCompressed.slice(2);

  const signerPriv = randomBytes(32);
  const signerPubFull = secp256k1.getPublicKey(signerPriv, true);
  const signerPubXOnly = toHex(signerPubFull).slice(2);

  // ECDH symmetric: signerPriv * peerPub == peerPriv * signerPub on X axis.
  // We derive shared X from the signer side (what Igloo's `ecdh` returns) and
  // the conversation key from the peer side as the independent oracle.
  const sharedFromSigner = secp256k1.getSharedSecret(signerPriv, peerPubCompressed).slice(1, 33);
  const sharedFromPeerCompat = secp256k1.getSharedSecret(peerPriv, '02' + signerPubXOnly).slice(1, 33);

  // Oracle uses nostr-tools getConversationKey to assert spec parity.
  const convToolkitBytes = nip44.v2.utils.getConversationKey(peerPriv, signerPubXOnly);
  const convLocalBytes = oracleConversationKey(sharedFromPeerCompat);

  return {
    peerPriv,
    peerPubCompressed,
    peerPubXOnly,
    signerPubXOnly,
    sharedX: sharedFromSigner,
    convBytes: convToolkitBytes,
    convLocalBytes,
  };
}

afterEach(() => {
  delete process.env.AUTH_ENABLED;
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.HEADLESS;
});

describe('HTTP NIP-44 standards-compliant interop', () => {
  test('oracle parity: nostr-tools getConversationKey matches HKDF(sharedX, "nip44-v2")', () => {
    const fixture = buildPeerFixture();
    expect(toHex(fixture.convBytes)).toBe(toHex(fixture.convLocalBytes));
  });

  test('/api/nip44/encrypt produces ciphertext decryptable by a standards-compliant peer', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const plaintext = 'hello from igloo';
    const req = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: plaintext }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(typeof body?.result).toBe('string');

    // External peer decrypts using independently derived conversation key.
    const decoded = nip44.decrypt(body.result, fixture.convBytes);
    expect(decoded).toBe(plaintext);
  }, { timeout: 10000 });

  test('/api/nip44/decrypt accepts externally generated standards-compliant ciphertext', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const plaintext = 'hello from external peer';
    const externalCiphertext = nip44.encrypt(plaintext, fixture.convBytes);

    const req = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: externalCiphertext }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body?.result).toBe(plaintext);
  }, { timeout: 10000 });

  test('/api/nip44/decrypt rejects legacy raw-shared-secret ciphertext (no fallback)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    // Control: encrypt using the raw shared secret as the "conversation key"
    // (the pre-fix, non-standard behavior). A standards-only decryptor must reject.
    const legacyCiphertext = nip44.encrypt('legacy payload', fixture.sharedX);

    const req = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: legacyCiphertext }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(500);
    const body = await res?.json();
    expect(typeof body?.error).toBe('string');
    expect(body.result).toBeUndefined();
  }, { timeout: 10000 });

  test('/api/nip44/decrypt rejects malformed ciphertext', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const req = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: '!!!not-base64!!!' }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(500);
    const body = await res?.json();
    expect(typeof body?.error).toBe('string');
  }, { timeout: 10000 });

  test('/api/nip44/decrypt rejects non-v2 payloads', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    // Take a valid v2 ciphertext and flip the version byte to make it non-v2.
    const validCiphertext = nip44.encrypt('hi', fixture.convBytes);
    const raw = Buffer.from(validCiphertext, 'base64');
    raw[0] = 1; // non-v2
    const tampered = raw.toString('base64');

    const req = new Request('http://localhost/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: tampered }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(500);
    const body = await res?.json();
    expect(typeof body?.error).toBe('string');
    expect(body.error.toLowerCase()).toContain('encryption version');
  }, { timeout: 10000 });
});

describe('HTTP NIP-44 contract semantics', () => {
  test('returns 401 when the request is not authenticated', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);

    for (const path of ['/api/nip44/encrypt', '/api/nip44/decrypt']) {
      const req = new Request('http://localhost' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: 'x' }),
      });
      const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: false });
      expect(res?.status).toBe(401);
      const body = await res?.json();
      expect(body?.error).toBe('Unauthorized');
    }
  });

  test('returns 405 for non-POST methods and 200 for OPTIONS preflight', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);

    const options = new Request('http://localhost/api/nip44/encrypt', { method: 'OPTIONS' });
    const optRes = await handleNip44Route(options, new URL(options.url), context, { authenticated: true });
    expect(optRes?.status).toBe(200);

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const req = new Request('http://localhost/api/nip44/encrypt', { method });
      const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
      expect(res?.status).toBe(405);
      const body = await res?.json();
      expect(body?.error).toBe('Method not allowed');
    }
  });

  test('returns 413 when declared body length exceeds the JSON limit', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const huge = 'x'.repeat(8);
    const req = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: huge }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(413);
    const body = await res?.json();
    expect(body?.error).toBe('Request too large');
  });

  test('returns 503 when the signing node is unavailable', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const context = makeContext(null);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
    const req = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: 'a'.repeat(64), content: 'hi' }),
    });
    const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body?.error).toBe('Node not available');
  });

  test('returns 504 when ECDH times out', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';
    process.env.FROSTR_SIGN_TIMEOUT = '1000'; // floor enforced by getOpTimeoutMs
    try {
      const node: FakeECDHNode = {
        req: { ecdh: () => new Promise(() => { /* never resolves */ }) },
      };
      const context = makeContext(node);

      const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);
      const req = new Request('http://localhost/api/nip44/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_pubkey: 'a'.repeat(64), content: 'hi' }),
      });
      const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
      expect(res?.status).toBe(504);
      const body = await res?.json();
      expect(body?.error).toContain('ECDH timed out');
    } finally {
      delete process.env.FROSTR_SIGN_TIMEOUT;
    }
  }, { timeout: 10000 });

  test('rejects malformed JSON and non-string content with 400', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);

    const badJson = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const badJsonRes = await handleNip44Route(badJson, new URL(badJson.url), context, { authenticated: true });
    expect(badJsonRes?.status).toBe(400);

    const badContent = new Request('http://localhost/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_pubkey: fixture.peerPubXOnly, content: 12345 }),
    });
    const badContentRes = await handleNip44Route(badContent, new URL(badContent.url), context, { authenticated: true });
    expect(badContentRes?.status).toBe(400);
    const badContentBody = await badContentRes?.json();
    expect(badContentBody?.error).toBe('Invalid content');
  });

  test('rejects malformed peer_pubkey identifiers with 400', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);

    for (const bad of [
      'nothex',
      'gg'.repeat(32),                // non-hex chars in 64-length string
      '00'.repeat(33),                // 66 hex but invalid prefix (not 02/03)
      '04' + 'a'.repeat(64),          // uncompressed prefix rejected by xOnly
      '02',                           // too short
      ''.padEnd(63, 'a'),             // 63 hex chars
    ]) {
      const req = new Request('http://localhost/api/nip44/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_pubkey: bad, content: 'hi' }),
      });
      const res = await handleNip44Route(req, new URL(req.url), context, { authenticated: true });
      expect(res?.status).toBe(400);
      const body = await res?.json();
      expect(body?.error).toBe('Invalid peer_pubkey');
    }
  });

  test('accepts x-only and compressed 02/03 peer keys on encrypt and decrypt', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const fixture = buildPeerFixture();
    const node: FakeECDHNode = {
      req: { ecdh: async () => ({ ok: true, data: toHex(fixture.sharedX) }) },
    };
    const context = makeContext(node);

    const { handleNip44Route } = await import(`../../src/routes/nip44.ts?${Math.random()}`);

    // 64-hex x-only + each compressed variant (02 / 03) must reach the route.
    const candidates = [
      fixture.peerPubXOnly,
      '02' + fixture.peerPubXOnly,
      '03' + fixture.peerPubXOnly,
    ];

    for (const peer of candidates) {
      const enc = new Request('http://localhost/api/nip44/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_pubkey: peer, content: 'shape-test' }),
      });
      const encRes = await handleNip44Route(enc, new URL(enc.url), context, { authenticated: true });
      expect(encRes?.status).toBe(200);
      const encBody = await encRes?.json();
      expect(typeof encBody?.result).toBe('string');

      const dec = new Request('http://localhost/api/nip44/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_pubkey: peer, content: encBody.result }),
      });
      const decRes = await handleNip44Route(dec, new URL(dec.url), context, { authenticated: true });
      expect(decRes?.status).toBe(200);
      const decBody = await decRes?.json();
      expect(decBody?.result).toBe('shape-test');
    }
  }, { timeout: 10000 });

  test('OpenAPI peer_pubkey pattern matches the runtime x-only / 02 / 03 contract', async () => {
    const fs = await import('node:fs/promises');
    const yamlSource = await fs.readFile('docs/openapi/openapi.yaml', 'utf8');
    const yamlMod: any = await import('yaml');
    const yamlParse: (s: string) => unknown =
      typeof yamlMod.parse === 'function' ? yamlMod.parse : yamlMod.default.parse;
    const spec: any = yamlParse(yamlSource);
    const peerProp = spec?.components?.schemas?.Nip44Request?.properties?.peer_pubkey;
    expect(typeof peerProp?.pattern).toBe('string');
    const pattern = new RegExp(peerProp.pattern);
    const xOnly = 'a'.repeat(64);
    expect(pattern.test(xOnly)).toBe(true);
    expect(pattern.test('02' + xOnly)).toBe(true);
    expect(pattern.test('03' + xOnly)).toBe(true);
    // 66-hex with a non-02/03 prefix must NOT be advertised as accepted.
    expect(pattern.test('04' + xOnly)).toBe(false);
    expect(pattern.test('00' + xOnly)).toBe(false);
    // Released contract must require POST.
    expect(spec?.paths?.['/api/nip44/encrypt']?.post).toBeDefined();
    expect(spec?.paths?.['/api/nip44/encrypt']?.get).toBeUndefined();
    expect(spec?.paths?.['/api/nip44/decrypt']?.post).toBeDefined();
    expect(spec?.paths?.['/api/nip44/decrypt']?.get).toBeUndefined();
    // Released contract must document auth + the negative cases we actually return.
    const encResponses = spec?.paths?.['/api/nip44/encrypt']?.post?.responses ?? {};
    const decResponses = spec?.paths?.['/api/nip44/decrypt']?.post?.responses ?? {};
    for (const code of ['200', '400', '401', '405', '413', '500', '503', '504']) {
      expect(encResponses[code]).toBeDefined();
      expect(decResponses[code]).toBeDefined();
    }
    // Released contract advertises auth.
    expect(Array.isArray(spec?.paths?.['/api/nip44/encrypt']?.post?.security)).toBe(true);
    expect(spec.paths['/api/nip44/encrypt'].post.security.length).toBeGreaterThan(0);
  });
});
