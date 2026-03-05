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

  test('peer policy update succeeds when fallback cache write fails after DB persist', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';

      const fs = await import('fs');
      const path = await import('path');

      // Force fallback policy writes to fail (ENOTDIR) while DB writes can still succeed.
      const cwdForFallback = path.dirname(process.env.DB_PATH);
      process.chdir(cwdForFallback);
      fs.writeFileSync(path.join(process.cwd(), 'data'), 'block-fallback-directory');

      const db = await import(root + 'src/db/database.ts');
      const peers = await import(root + 'src/routes/peers.ts');

      const created = await db.createUser('peer-user', 'peer-password');
      const userId = created.userId;
      db.updateUserCredentials(userId, { group_cred: 'gc', share_cred: 'sc' }, 'peer-password', false);

      const context = {
        node: { config: { policies: [] }, peers: [] },
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const pubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const req = new Request('http://localhost/api/peers/' + pubkey + '/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowSend: true })
      });
      const auth = { authenticated: true, userId, getPassword: () => 'peer-password' };
      const res = await peers.handlePeersRoute(req, new URL(req.url), context, auth);
      const body = await res.json();
      const stored = db.getUserPeerPolicies(userId);
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body, storedCount: stored.length, stored }));
      try { await db.closeDatabase(); } catch {}
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(result.body?.policy?.allowSend).toBe(true);
    expect(result.storedCount).toBe(1);
  });

  test('peer policy update rollback preserves roles and metadata when persistence fails', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.GROUP_CRED = 'gc';
      process.env.SHARE_CRED = 'sc';

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-rollback-put-'));
      try {
        process.chdir(tmpDir);
        process.env.ENV_FILE_PATH = path.join(tmpDir, '.env.missing');

        // Force fallback persistence to fail by blocking data dir creation.
        fs.writeFileSync(path.join(tmpDir, 'data'), 'block-fallback-directory');

        const peers = await import(root + 'src/routes/peers.ts');
        const { getNodePolicy, setNodePolicies } = await import(root + 'node_modules/@frostr/igloo-core/dist/index.js');
        const pubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        const context = {
          node: {
            config: { policies: [] },
            peers: []
          },
          addServerLog: () => {},
          broadcastEvent: () => {},
          peerStatuses: new Map(),
          eventStreams: new Set(),
          restartState: { blockedByCredentials: false },
        };
        setNodePolicies(context.node, [{
          pubkey,
          allowSend: true,
          allowReceive: true,
          roles: ['signer'],
          metadata: { tier: 'gold', nested: { level: 2 } },
          note: 'keep-me',
          source: 'runtime'
        }], { merge: true });

        const req = new Request('http://localhost/api/peers/' + pubkey + '/policy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowSend: false })
        });
        const res = await peers.handlePeersRoute(req, new URL(req.url), context, null);
        const body = await res.json();
        const restored = getNodePolicy(context.node, pubkey);
        console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body, restored }));
        process.exit(0);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(500);
    expect(result.restored?.allowSend).toBe(true);
    expect(result.restored?.roles).toEqual(['signer']);
    expect(result.restored?.metadata?.tier).toBe('gold');
    expect(result.restored?.metadata?.nested?.level).toBe(2);
  });

  test('peer policy delete rollback preserves roles and metadata when persistence fails', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.GROUP_CRED = 'gc';
      process.env.SHARE_CRED = 'sc';

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-rollback-delete-'));
      try {
        process.chdir(tmpDir);
        process.env.ENV_FILE_PATH = path.join(tmpDir, '.env.missing');

        // Force fallback persistence to fail by blocking data dir creation.
        fs.writeFileSync(path.join(tmpDir, 'data'), 'block-fallback-directory');

        const peers = await import(root + 'src/routes/peers.ts');
        const { getNodePolicy, setNodePolicies } = await import(root + 'node_modules/@frostr/igloo-core/dist/index.js');
        const pubkey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

        const context = {
          node: {
            config: { policies: [] },
            peers: []
          },
          addServerLog: () => {},
          broadcastEvent: () => {},
          peerStatuses: new Map(),
          eventStreams: new Set(),
          restartState: { blockedByCredentials: false },
        };
        setNodePolicies(context.node, [{
          pubkey,
          allowSend: true,
          allowReceive: false,
          roles: ['admin'],
          metadata: { tier: 'silver', nested: { level: 1 } },
          note: 'delete-rollback',
          source: 'runtime'
        }], { merge: true });

        const req = new Request('http://localhost/api/peers/' + pubkey + '/policy', {
          method: 'DELETE'
        });
        const res = await peers.handlePeersRoute(req, new URL(req.url), context, null);
        const body = await res.json();
        const restored = getNodePolicy(context.node, pubkey);
        console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body, restored }));
        process.exit(0);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(500);
    expect(result.restored?.allowReceive).toBe(false);
    expect(result.restored?.roles).toEqual(['admin']);
    expect(result.restored?.metadata?.tier).toBe('silver');
    expect(result.restored?.metadata?.nested?.level).toBe(1);
  });

  test('peer policy update rollback does not clobber concurrent updates to other peers', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.GROUP_CRED = 'gc';
      process.env.SHARE_CRED = 'sc';

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-rollback-concurrent-put-'));
      process.chdir(tmpDir);
      process.env.ENV_FILE_PATH = path.join(tmpDir, '.env.missing');

      // Force persistence retries to fail so rollback path is exercised.
      fs.writeFileSync(path.join(tmpDir, 'data'), 'block-fallback-directory');

      const peers = await import(root + 'src/routes/peers.ts');
      const { getNodePolicy, setNodePolicies } = await import(root + 'node_modules/@frostr/igloo-core/dist/index.js');
      const pubkeyA = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      const pubkeyB = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

      const context = {
        node: {
          config: { policies: [] },
          peers: []
        },
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      setNodePolicies(context.node, [
        { pubkey: pubkeyA, allowSend: true, allowReceive: true, source: 'runtime' },
        { pubkey: pubkeyB, allowSend: true, allowReceive: true, source: 'runtime' }
      ], { merge: false });

      const req = new Request('http://localhost/api/peers/' + pubkeyA + '/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowSend: false })
      });

      const pending = peers.handlePeersRoute(req, new URL(req.url), context, null);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate a concurrent successful update on another peer while first request is retrying.
      setNodePolicies(context.node, [{ pubkey: pubkeyB, allowSend: false, allowReceive: true, source: 'runtime' }], { merge: true });

      const res = await pending;
      const body = await res.json();
      const policyA = getNodePolicy(context.node, pubkeyA);
      const policyB = getNodePolicy(context.node, pubkeyB);

      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body, policyA, policyB }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(500);
    expect(result.policyA?.allowSend).toBe(true);
    expect(result.policyB?.allowSend).toBe(false);
  });

  test('peer policy delete rollback does not clobber concurrent updates to other peers', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.GROUP_CRED = 'gc';
      process.env.SHARE_CRED = 'sc';

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-rollback-concurrent-delete-'));
      process.chdir(tmpDir);
      process.env.ENV_FILE_PATH = path.join(tmpDir, '.env.missing');

      // Force persistence retries to fail so rollback path is exercised.
      fs.writeFileSync(path.join(tmpDir, 'data'), 'block-fallback-directory');

      const peers = await import(root + 'src/routes/peers.ts');
      const { getNodePolicy, setNodePolicies } = await import(root + 'node_modules/@frostr/igloo-core/dist/index.js');
      const pubkeyA = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      const pubkeyB = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const context = {
        node: {
          config: { policies: [] },
          peers: []
        },
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      setNodePolicies(context.node, [
        { pubkey: pubkeyA, allowSend: true, allowReceive: true, source: 'runtime' },
        { pubkey: pubkeyB, allowSend: true, allowReceive: true, source: 'runtime' }
      ], { merge: false });

      const req = new Request('http://localhost/api/peers/' + pubkeyA + '/policy', {
        method: 'DELETE'
      });

      const pending = peers.handlePeersRoute(req, new URL(req.url), context, null);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate a concurrent successful update on another peer while first request is retrying.
      setNodePolicies(context.node, [{ pubkey: pubkeyB, allowSend: false, allowReceive: true, source: 'runtime' }], { merge: true });

      const res = await pending;
      const body = await res.json();
      const policyA = getNodePolicy(context.node, pubkeyA);
      const policyB = getNodePolicy(context.node, pubkeyB);

      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body, policyA, policyB }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(500);
    expect(result.policyA?.allowSend).toBe(true);
    expect(result.policyB?.allowSend).toBe(false);
  });
});
