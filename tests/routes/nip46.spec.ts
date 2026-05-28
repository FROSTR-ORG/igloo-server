import { describe, expect, test } from 'bun:test';
import { randomBytes, createHmac } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { nip44 } from 'nostr-tools';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Independent NIP-44 v2 conversation key derivation used as the test oracle.
 * Equivalent to nostr-tools.nip44.v2.utils.getConversationKey but invoked
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
 * Igloo's threshold ECDH would return for signerPriv * peerPub along with
 * the standards-compliant NIP-44 v2 conversation key derived independently.
 */
function buildNip46PeerFixture() {
  const peerPriv = randomBytes(32);
  const peerPubFull = secp256k1.getPublicKey(peerPriv, true); // 02/03 + X
  const peerPubCompressed = toHex(peerPubFull);
  const peerPubXOnly = peerPubCompressed.slice(2);

  const signerPriv = randomBytes(32);
  const signerPubFull = secp256k1.getPublicKey(signerPriv, true);
  const signerPubXOnly = toHex(signerPubFull).slice(2);

  const sharedFromSigner = secp256k1.getSharedSecret(signerPriv, peerPubCompressed).slice(1, 33);
  const sharedFromPeerCompat = secp256k1.getSharedSecret(peerPriv, '02' + signerPubXOnly).slice(1, 33);

  const convToolkitBytes = nip44.v2.utils.getConversationKey(peerPriv, signerPubXOnly);
  const convLocalBytes = oracleConversationKey(sharedFromPeerCompat);

  return {
    peerPriv: toHex(peerPriv),
    peerPubCompressed,
    peerPubXOnly,
    signerPubXOnly,
    sharedXHex: toHex(sharedFromSigner),
    convBytesHex: toHex(convToolkitBytes),
    convLocalHex: toHex(convLocalBytes),
  };
}

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

  test('string payload requests persist client_request_id and reuse the existing pending row', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const database = await import(root + 'src/db/database.ts');
      const nip46 = await import(root + 'src/db/nip46.ts');

      await nip46.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-string-payload', 'hash', 'salt')");

      const payload = JSON.stringify({ id: 'string-client-id', method: 'sign_event', params: [] });
      const first = nip46.createNip46Request({
        userId: 1,
        session_pubkey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        method: 'sign_event',
        payload
      });
      const second = nip46.createNip46Request({
        userId: 1,
        session_pubkey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        method: 'sign_event',
        payload
      });

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        sameId: first.id === second.id,
        clientRequestId: second.client_request_id ?? null
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.sameId).toBe(true);
    expect(result.clientRequestId).toBe('string-client-id');
  });

  test('schema verification repairs a marked-applied request table missing the dedupe column and index', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const database = await import(root + 'src/db/database.ts');
      database.default.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250915_0001_init_nip46.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250915_0002_event_type_check_trigger.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250916_0001_fix_null_event_type.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250916_0003_fix_nip46_trigger_recursion.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250916_0004_audit_nip46_data_sizes.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250916_0005_add_rate_limits_table.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250917_0001_fix_rate_limits_trigger_recursion.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250918_0006_add_nip46_transport_keys.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250922_0007_add_nip46_relays.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20250922_0008_create_nip46_requests.sql')");
      database.default.exec("INSERT OR IGNORE INTO schema_migrations (name) VALUES ('20260306_0010_harden_nip46_relays_and_requests.sql')");

      database.default.exec("DROP TABLE IF EXISTS nip46_requests");
      database.default.exec(\`
        CREATE TABLE nip46_requests (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          session_pubkey TEXT NOT NULL,
          method TEXT NOT NULL,
          params TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          result TEXT,
          error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME
        )
      \`);

      const nip46 = await import(root + 'src/db/nip46.ts?schema_repair');
      await nip46.initializeNip46DB();

      const columns = database.default.prepare("PRAGMA table_info(nip46_requests)").all();
      const indexes = database.default.prepare("PRAGMA index_list(nip46_requests)").all();
      const hasClientRequestId = columns.some((column) => column.name === 'client_request_id');
      const hasPendingDedupe = indexes.some(
        (index) => index.name === 'idx_nip46_requests_pending_dedupe' && index.unique === 1 && index.partial === 1
      );

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({ hasClientRequestId, hasPendingDedupe }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.hasClientRequestId).toBe(true);
    expect(result.hasPendingDedupe).toBe(true);
  });
});

describe('NIP-46 nip44 RPC standards-compliant interop', () => {
  test('oracle parity: nostr-tools NIP-44 conversation key matches HKDF(sharedX, "nip44-v2")', () => {
    const fixture = buildNip46PeerFixture();
    expect(fixture.convBytesHex).toBe(fixture.convLocalHex);
  });

  test('nip44_encrypt produces ciphertext decryptable by a standards-compliant external peer', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      const result = await service.handleNip44Encrypt({
        params: [${JSON.stringify(fixture.peerPubXOnly)}, 'hello from igloo nip46']
      });
      console.log('@@RESULT@@' + JSON.stringify({ ciphertext: result }));
      process.exit(0);
    `;
    const result = runRouteScript<{ ciphertext: string }>(script);
    expect(typeof result.ciphertext).toBe('string');
    const decoded = nip44.decrypt(result.ciphertext, Buffer.from(fixture.convBytesHex, 'hex'));
    expect(decoded).toBe('hello from igloo nip46');
  });

  test('nip44_decrypt accepts externally generated standards-compliant ciphertext', () => {
    const fixture = buildNip46PeerFixture();
    const plaintext = 'hello from external nip44 peer';
    const externalCiphertext = nip44.encrypt(plaintext, Buffer.from(fixture.convBytesHex, 'hex'));
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      const result = await service.handleNip44Decrypt({
        params: [${JSON.stringify(fixture.peerPubXOnly)}, ${JSON.stringify(externalCiphertext)}]
      });
      console.log('@@RESULT@@' + JSON.stringify({ plaintext: result }));
      process.exit(0);
    `;
    const result = runRouteScript<{ plaintext: string }>(script);
    expect(result.plaintext).toBe(plaintext);
  });

  test('nip44_decrypt rejects legacy raw-shared-secret ciphertext (no fallback) on an allowed session', () => {
    const fixture = buildNip46PeerFixture();
    // Control: encrypt using the raw shared X as the "conversation key" (the
    // pre-fix, non-standard behavior). A standards-only decryptor must reject.
    const legacyCiphertext = nip44.encrypt('legacy payload', Buffer.from(fixture.sharedXHex, 'hex'));
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      let error = null;
      let result = null;
      try {
        result = await service.handleNip44Decrypt({
          params: [${JSON.stringify(fixture.peerPubXOnly)}, ${JSON.stringify(legacyCiphertext)}]
        });
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }
      console.log('@@RESULT@@' + JSON.stringify({ result, error }));
      process.exit(0);
    `;
    const result = runRouteScript<{ result: string | null; error: string | null }>(script);
    expect(result.result).toBeNull();
    expect(typeof result.error).toBe('string');
  });

  test('nip44_decrypt rejects malformed ciphertext on an allowed session', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      let error = null;
      let result = null;
      try {
        result = await service.handleNip44Decrypt({
          params: [${JSON.stringify(fixture.peerPubXOnly)}, '!!!not-base64!!!']
        });
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }
      console.log('@@RESULT@@' + JSON.stringify({ result, error }));
      process.exit(0);
    `;
    const result = runRouteScript<{ result: string | null; error: string | null }>(script);
    expect(result.result).toBeNull();
    expect(typeof result.error).toBe('string');
  });

  test('nip44_decrypt rejects non-v2 payload on an allowed session', () => {
    const fixture = buildNip46PeerFixture();
    const validCiphertext = nip44.encrypt('hi', Buffer.from(fixture.convBytesHex, 'hex'));
    const raw = Buffer.from(validCiphertext, 'base64');
    raw[0] = 1; // non-v2 version
    const tampered = raw.toString('base64');
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      let error = null;
      let result = null;
      try {
        result = await service.handleNip44Decrypt({
          params: [${JSON.stringify(fixture.peerPubXOnly)}, ${JSON.stringify(tampered)}]
        });
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }
      console.log('@@RESULT@@' + JSON.stringify({ result, error }));
      process.exit(0);
    `;
    const result = runRouteScript<{ result: string | null; error: string | null }>(script);
    expect(result.result).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.error!.toLowerCase()).toContain('encryption version');
  });

  test('nip44_encrypt and nip44_decrypt accept x-only and compressed 02/03 peer pubkeys', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      const peers = [
        ${JSON.stringify(fixture.peerPubXOnly)},
        '02' + ${JSON.stringify(fixture.peerPubXOnly)},
        '03' + ${JSON.stringify(fixture.peerPubXOnly)},
      ];
      const results = [];
      for (const peer of peers) {
        const ct = await service.handleNip44Encrypt({ params: [peer, 'shape-' + peer.slice(0, 2)] });
        const pt = await service.handleNip44Decrypt({ params: [peer, ct] });
        results.push({ peer, plaintext: pt, ciphertextType: typeof ct });
      }
      console.log('@@RESULT@@' + JSON.stringify({ results }));
      process.exit(0);
    `;
    const result = runRouteScript<{ results: Array<{ peer: string; plaintext: string; ciphertextType: string }> }>(script);
    expect(result.results).toHaveLength(3);
    for (const entry of result.results) {
      expect(entry.ciphertextType).toBe('string');
      expect(entry.plaintext).toBe('shape-' + entry.peer.slice(0, 2));
    }
  });

  test('nip44_encrypt and nip44_decrypt error on missing/empty params with descriptive messages', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });

      const captures = [];
      async function capture(label, fn) {
        try { await fn(); captures.push({ label, error: null }); }
        catch (e) { captures.push({ label, error: e && e.message ? e.message : String(e) }); }
      }

      await capture('encrypt:no-params', () => service.handleNip44Encrypt({ params: [] }));
      await capture('encrypt:empty-peer', () => service.handleNip44Encrypt({ params: ['', 'hi'] }));
      await capture('encrypt:empty-plain', () => service.handleNip44Encrypt({ params: [${JSON.stringify(fixture.peerPubXOnly)}, ''] }));
      await capture('decrypt:no-params', () => service.handleNip44Decrypt({ params: [] }));
      await capture('decrypt:empty-peer', () => service.handleNip44Decrypt({ params: ['', 'ct'] }));
      await capture('decrypt:empty-ct', () => service.handleNip44Decrypt({ params: [${JSON.stringify(fixture.peerPubXOnly)}, ''] }));

      console.log('@@RESULT@@' + JSON.stringify({ captures }));
      process.exit(0);
    `;
    const result = runRouteScript<{ captures: Array<{ label: string; error: string | null }> }>(script);
    expect(result.captures).toHaveLength(6);
    for (const entry of result.captures) {
      expect(typeof entry.error).toBe('string');
      expect(entry.error).not.toBeNull();
    }
  });

  test('nip44 method-specific policy: only nip44_encrypt granted auto-approves while nip44_decrypt stays pending', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');
      const database = await import(root + 'src/db/database.ts');
      const nip46db = await import(root + 'src/db/nip46.ts');

      await nip46db.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-policy-encrypt-only', 'hash', 'salt')");
      const userId = 1;
      const peer = ${JSON.stringify(fixture.peerPubXOnly)};

      nip46db.upsertSession({
        userId,
        client_pubkey: peer,
        status: 'active',
        policy: { methods: { nip44_encrypt: true } }
      });

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const sends = [];
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });
      service.agent = {
        socket: {
          send: async (...args) => { sends.push(args); }
        }
      };
      service.activeUserId = userId;
      service.started = true;

      await service.handleSocketRequest({
        id: 'req-encrypt-1',
        method: 'nip44_encrypt',
        params: [peer, 'should auto approve'],
        session: { pubkey: peer }
      });
      await service.handleSocketRequest({
        id: 'req-decrypt-1',
        method: 'nip44_decrypt',
        params: [peer, 'arbitrary-ct'],
        session: { pubkey: peer }
      });

      // Wait for fire-and-forget processApprovedRequest to settle.
      for (let i = 0; i < 50; i += 1) {
        await new Promise(r => setTimeout(r, 10));
      }

      const requests = nip46db.listNip46Requests(userId);
      const encryptReq = requests.find(r => r.method === 'nip44_encrypt');
      const decryptReq = requests.find(r => r.method === 'nip44_decrypt');

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        sendsCount: sends.length,
        encryptStatus: encryptReq ? encryptReq.status : null,
        decryptStatus: decryptReq ? decryptReq.status : null,
        encryptHasResult: encryptReq ? typeof encryptReq.result === 'string' : false,
      }));
      process.exit(0);
    `;
    const result = runRouteScript<{ sendsCount: number; encryptStatus: string | null; decryptStatus: string | null; encryptHasResult: boolean }>(script);
    expect(result.encryptStatus).toBe('completed');
    expect(result.encryptHasResult).toBe(true);
    expect(result.decryptStatus).toBe('pending');
    expect(result.sendsCount).toBe(1);
  });

  test('nip44 method-specific policy: only nip44_decrypt granted auto-approves while nip44_encrypt stays pending', () => {
    const fixture = buildNip46PeerFixture();
    const validCiphertext = nip44.encrypt('peer-encrypted', Buffer.from(fixture.convBytesHex, 'hex'));
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');
      const database = await import(root + 'src/db/database.ts');
      const nip46db = await import(root + 'src/db/nip46.ts');

      await nip46db.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-policy-decrypt-only', 'hash', 'salt')");
      const userId = 1;
      const peer = ${JSON.stringify(fixture.peerPubXOnly)};

      nip46db.upsertSession({
        userId,
        client_pubkey: peer,
        status: 'active',
        policy: { methods: { nip44_decrypt: true } }
      });

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const sends = [];
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });
      service.agent = {
        socket: {
          send: async (...args) => { sends.push(args); }
        }
      };
      service.activeUserId = userId;
      service.started = true;

      await service.handleSocketRequest({
        id: 'req-encrypt-2',
        method: 'nip44_encrypt',
        params: [peer, 'should stay pending'],
        session: { pubkey: peer }
      });
      await service.handleSocketRequest({
        id: 'req-decrypt-2',
        method: 'nip44_decrypt',
        params: [peer, ${JSON.stringify(validCiphertext)}],
        session: { pubkey: peer }
      });

      for (let i = 0; i < 50; i += 1) {
        await new Promise(r => setTimeout(r, 10));
      }

      const requests = nip46db.listNip46Requests(userId);
      const encryptReq = requests.find(r => r.method === 'nip44_encrypt');
      const decryptReq = requests.find(r => r.method === 'nip44_decrypt');

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        sendsCount: sends.length,
        encryptStatus: encryptReq ? encryptReq.status : null,
        decryptStatus: decryptReq ? decryptReq.status : null,
        decryptResult: decryptReq ? decryptReq.result : null,
      }));
      process.exit(0);
    `;
    const result = runRouteScript<{ sendsCount: number; encryptStatus: string | null; decryptStatus: string | null; decryptResult: string | null }>(script);
    expect(result.decryptStatus).toBe('completed');
    expect(result.decryptResult).toBe('peer-encrypted');
    expect(result.encryptStatus).toBe('pending');
    expect(result.sendsCount).toBe(1);
  });

  test('nip44 method-specific policy: both granted means both auto-approve', () => {
    const fixture = buildNip46PeerFixture();
    const externalCiphertext = nip44.encrypt('both-granted', Buffer.from(fixture.convBytesHex, 'hex'));
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');
      const database = await import(root + 'src/db/database.ts');
      const nip46db = await import(root + 'src/db/nip46.ts');

      await nip46db.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-policy-both', 'hash', 'salt')");
      const userId = 1;
      const peer = ${JSON.stringify(fixture.peerPubXOnly)};

      nip46db.upsertSession({
        userId,
        client_pubkey: peer,
        status: 'active',
        policy: { methods: { nip44_encrypt: true, nip44_decrypt: true } }
      });

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const sends = [];
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });
      service.agent = {
        socket: {
          send: async (...args) => { sends.push(args); }
        }
      };
      service.activeUserId = userId;
      service.started = true;

      await service.handleSocketRequest({
        id: 'req-encrypt-3',
        method: 'nip44_encrypt',
        params: [peer, 'plaintext-from-server'],
        session: { pubkey: peer }
      });
      await service.handleSocketRequest({
        id: 'req-decrypt-3',
        method: 'nip44_decrypt',
        params: [peer, ${JSON.stringify(externalCiphertext)}],
        session: { pubkey: peer }
      });

      for (let i = 0; i < 50; i += 1) {
        await new Promise(r => setTimeout(r, 10));
      }

      const requests = nip46db.listNip46Requests(userId);
      const encryptReq = requests.find(r => r.method === 'nip44_encrypt');
      const decryptReq = requests.find(r => r.method === 'nip44_decrypt');

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        sendsCount: sends.length,
        encryptStatus: encryptReq ? encryptReq.status : null,
        encryptResult: encryptReq ? encryptReq.result : null,
        decryptStatus: decryptReq ? decryptReq.status : null,
        decryptResult: decryptReq ? decryptReq.result : null,
        sendsResponseIds: sends.map(call => call && call[0] && call[0].id),
      }));
      process.exit(0);
    `;
    const result = runRouteScript<{
      sendsCount: number;
      encryptStatus: string | null;
      encryptResult: string | null;
      decryptStatus: string | null;
      decryptResult: string | null;
      sendsResponseIds: Array<string | null>;
    }>(script);
    expect(result.encryptStatus).toBe('completed');
    expect(typeof result.encryptResult).toBe('string');
    expect(result.decryptStatus).toBe('completed');
    expect(result.decryptResult).toBe('both-granted');
    expect(result.sendsCount).toBe(2);
    // Preserve original client request IDs in responses.
    expect(result.sendsResponseIds).toContain('req-encrypt-3');
    expect(result.sendsResponseIds).toContain('req-decrypt-3');
  });

  test('nip44 RPC responses preserve the original request id on success and on error', () => {
    const fixture = buildNip46PeerFixture();
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      const { Nip46Service } = await import(root + 'src/nip46/service.ts');
      const database = await import(root + 'src/db/database.ts');
      const nip46db = await import(root + 'src/db/nip46.ts');

      await nip46db.initializeNip46DB();
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('nip46-id-preserve', 'hash', 'salt')");
      const userId = 1;
      const peer = ${JSON.stringify(fixture.peerPubXOnly)};

      nip46db.upsertSession({
        userId,
        client_pubkey: peer,
        status: 'active',
        policy: { methods: { nip44_encrypt: true, nip44_decrypt: true } }
      });

      const node = {
        req: { ecdh: async () => ({ ok: true, data: ${JSON.stringify(fixture.sharedXHex)} }) }
      };
      const sends = [];
      const service = new Nip46Service({
        addServerLog: () => {},
        broadcastEvent: () => {},
        getNode: () => node,
      });
      service.agent = {
        socket: {
          send: async (...args) => { sends.push(args); }
        }
      };
      service.activeUserId = userId;
      service.started = true;

      await service.handleSocketRequest({
        id: 'happy-id-42',
        method: 'nip44_encrypt',
        params: [peer, 'preserve me'],
        session: { pubkey: peer }
      });
      // Bad ciphertext triggers a decrypt error inside processApprovedRequest.
      await service.handleSocketRequest({
        id: 'sad-id-99',
        method: 'nip44_decrypt',
        params: [peer, '!!!not-base64!!!'],
        session: { pubkey: peer }
      });

      for (let i = 0; i < 50; i += 1) {
        await new Promise(r => setTimeout(r, 10));
      }

      try { await database.closeDatabase(); } catch {}
      console.log('@@RESULT@@' + JSON.stringify({
        sends: sends.map(call => ({
          id: call && call[0] && call[0].id,
          hasResult: call && call[0] && Object.prototype.hasOwnProperty.call(call[0], 'result'),
          hasError: call && call[0] && Object.prototype.hasOwnProperty.call(call[0], 'error'),
        })),
      }));
      process.exit(0);
    `;
    const result = runRouteScript<{
      sends: Array<{ id: string | null; hasResult: boolean; hasError: boolean }>;
    }>(script);
    expect(result.sends).toHaveLength(2);
    const happy = result.sends.find(s => s.id === 'happy-id-42');
    const sad = result.sends.find(s => s.id === 'sad-id-99');
    expect(happy).toBeDefined();
    expect(happy!.hasResult).toBe(true);
    expect(happy!.hasError).toBe(false);
    expect(sad).toBeDefined();
    expect(sad!.hasError).toBe(true);
    expect(sad!.hasResult).toBe(false);
  });
});
