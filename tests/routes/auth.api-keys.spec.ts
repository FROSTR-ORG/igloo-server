import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

type ScriptResult = {
  created?: any;
  verifyBefore?: any;
  authResult?: any;
  afterAuthKeys?: any;
  revoked?: any;
  verifyAfter?: any;
  createStatus?: number | null;
  createBody?: any;
  listStatus?: number | null;
  listBody?: any;
  revokeAdminStatus?: number | null;
  revokeAdminBody?: any;
  headlessAuth?: any;
  headlessInvalid?: any;
  headlessStatus?: any;
  loginStatus?: number;
  badAdminStatus?: number | null;
  secondRevokeStatus?: number | null;
  secondRevokeBody?: any;
};

function runScript(code: string, env: Record<string, string>): ScriptResult {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-script-'));
  try {
    const scriptPath = path.join(tmpDir, 'runner.ts');
    writeFileSync(scriptPath, code, 'utf8');

    const result = Bun.spawnSync({
      cmd: ['bun', 'run', scriptPath],
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 10000
    });

    if (result.exitCode !== 0) {
      throw new Error(`Script failed: ${result.stderr.toString()}`);
    }

    const stdout = result.stdout.toString().trim();
    const lines = stdout.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('@@RESULT@@')) continue;
      const payload = line.slice('@@RESULT@@'.length);
      return JSON.parse(payload);
    }
    throw new Error(`Failed to parse script output: ${stdout}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('database-backed API keys', () => {
  test('admin-managed keys authenticate and revoke correctly', () => {
    const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-db-'));
    const dbPath = path.join(tmpDataDir, 'api-keys.db');
    const projectRoot = pathToFileURL(process.cwd() + '/').href;

    const script = `
      try {
        const root = '${projectRoot}';
        process.env.HEADLESS = process.env.HEADLESS ?? 'false';
        process.env.DB_PATH = '${dbPath.replace(/\\/g, '\\\\')}';
        process.env.NODE_ENV = 'test';
        process.env.AUTH_ENABLED = 'true';
        process.env.RATE_LIMIT_ENABLED = 'false';
        process.env.ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'test-admin-secret';
        process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        const database = await import(root + 'src/db/database.ts');
        const auth = await import(root + 'src/routes/auth.ts');
        const admin = await import(root + 'src/routes/admin.ts');

        database.default.exec(
          "CREATE TABLE IF NOT EXISTS api_keys (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "prefix TEXT NOT NULL UNIQUE," +
          "key_hash TEXT NOT NULL," +
          "label TEXT," +
          "created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL," +
          "created_by_admin INTEGER NOT NULL DEFAULT 1," +
          "created_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
          "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
          "last_used_at DATETIME," +
          "last_used_ip TEXT," +
          "revoked_at DATETIME," +
          "revoked_reason TEXT," +
          "CHECK (length(prefix) >= 12)," +
          "CHECK (length(key_hash) = 64)" +
          ");"
        );
        database.default.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_active_prefix ON api_keys(prefix) WHERE revoked_at IS NULL;");
        database.default.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at);");
        database.default.exec("CREATE TRIGGER IF NOT EXISTS trg_api_keys_touch_updated_at " +
          "AFTER UPDATE ON api_keys " +
          "FOR EACH ROW " +
          "WHEN NEW.updated_at = OLD.updated_at " +
          "BEGIN " +
            "UPDATE api_keys SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; " +
          "END;");

        if (!database.isDatabaseInitialized()) {
          database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('admin','test-hash','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')");
          try { database.default.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('admin','user'))"); } catch {}
          try { database.default.exec("UPDATE users SET role='admin' WHERE username='admin' OR id=1"); } catch {}
        }

        const created = database.createApiKey({ label: 'automation', createdByAdmin: true });
        const verifyBefore = database.verifyApiKeyToken(created.token);

        const authReq = new Request('http://localhost/api/status', {
          headers: {
            'X-API-Key': created.token,
            'X-Forwarded-For': '203.0.113.7'
          }
        });
        const authResult = await auth.authenticate(authReq);

        const afterAuthKeys = database.listApiKeys();

        const revoked = database.revokeApiKey(
          typeof created.id === 'string' ? BigInt(created.id) : created.id,
          'rotated'
        );
        const verifyAfter = database.verifyApiKeyToken(created.token);

        const createReq = new Request('http://localhost/api/admin/api-keys', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + process.env.ADMIN_SECRET,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ label: 'admin-generated', userId: 1 })
        });
        const createRes = await admin.handleAdminRoute(createReq, new URL(createReq.url), {} as any);
        const createStatus = createRes?.status ?? null;
        const createBody = createRes ? await createRes.json() : null;

        const listReq = new Request('http://localhost/api/admin/api-keys', {
          headers: { Authorization: 'Bearer ' + process.env.ADMIN_SECRET }
        });
        const listRes = await admin.handleAdminRoute(listReq, new URL(listReq.url), {} as any);
        const listStatus = listRes?.status ?? null;
        const listBody = listRes ? await listRes.json() : null;

        let revokeAdminStatus = null;
        let revokeAdminBody = null;
        if (createBody?.apiKey?.id !== undefined && createBody?.apiKey?.id !== null) {
          const revokeRes = await admin.handleAdminRoute(
            new Request('http://localhost/api/admin/api-keys/revoke', {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + process.env.ADMIN_SECRET,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ apiKeyId: createBody.apiKey.id, reason: 'cleanup' })
            }),
            new URL('http://localhost/api/admin/api-keys/revoke'),
            {} as any
          );
          revokeAdminStatus = revokeRes?.status ?? null;
          revokeAdminBody = revokeRes ? await revokeRes.json() : null;
        }

        const badAdminReq = new Request('http://localhost/api/admin/api-keys', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer wrong-secret',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ label: 'bad-secret', userId: 1 })
        });
        const badAdminRes = await admin.handleAdminRoute(badAdminReq, new URL(badAdminReq.url), {} as any);
        const badAdminStatus = badAdminRes?.status ?? null;

        const secondRevokeRes = revokeAdminStatus === 200
          ? await admin.handleAdminRoute(
              new Request('http://localhost/api/admin/api-keys/revoke', {
                method: 'POST',
                headers: {
                  Authorization: 'Bearer ' + process.env.ADMIN_SECRET,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apiKeyId: createBody.apiKey.id, reason: 'cleanup-again' })
              }),
              new URL('http://localhost/api/admin/api-keys/revoke'),
              {} as any
            )
          : null;
        const secondRevokeStatus = secondRevokeRes?.status ?? null;
        const secondRevokeBody = secondRevokeRes ? await secondRevokeRes.json() : null;

        const loginReq = new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: created.token })
        });
        const loginRes = await auth.handleLogin(loginReq);
        const loginStatus = loginRes.status;

        const payload = {
          created,
          verifyBefore,
          authResult,
          afterAuthKeys,
          revoked,
          verifyAfter,
          createStatus,
          createBody,
          listStatus,
          listBody,
          revokeAdminStatus,
          revokeAdminBody,
          loginStatus,
          badAdminStatus,
          secondRevokeStatus,
          secondRevokeBody
        };

        console.log('@@RESULT@@' + JSON.stringify(payload));
      } finally {
        const auth = await import('${projectRoot}src/routes/auth.ts');
        const database = await import('${projectRoot}src/db/database.ts');
        try { auth.stopAuthCleanup(); } catch {}
        try { await database.closeDatabase(); } catch {}
        process.exit(0);
      }
    `;

    const env = {
      HEADLESS: 'false',
      DB_PATH: dbPath,
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      RATE_LIMIT_ENABLED: 'false'
    };

    const output = runScript(script, env);

    expect(output.created?.token).toHaveLength(64);
    expect(output.verifyBefore?.success).toBeTrue();
    expect(output.authResult?.authenticated).toBeTrue();
    expect(output.authResult?.userId).toMatch(/^api-key:/);
    expect(output.afterAuthKeys?.[0]?.lastUsedIp).toBe('203.0.113.7');
    expect(output.revoked?.success).toBeTrue();
    expect(output.verifyAfter?.success).toBeFalse();
    expect(output.verifyAfter?.reason).toBe('revoked');
    expect(output.createStatus).toBe(201);
    expect(output.createBody?.apiKey?.token).toHaveLength(64);
    expect(output.listStatus).toBe(200);
    expect(Array.isArray(output.listBody?.apiKeys)).toBeTrue();
    expect(output.revokeAdminStatus).toBe(200);
    expect(output.revokeAdminBody?.success).toBeTrue();
    expect(output.loginStatus).toBe(401);
    expect(output.badAdminStatus).toBe(401);
    expect(output.secondRevokeStatus).toBe(409);
    expect(output.secondRevokeBody?.error).toBe('API key already revoked');

    rmSync(tmpDataDir, { recursive: true, force: true });
  }, { timeout: 15000 });

  test('session admin can list API keys without admin secret', async () => {
    const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-session-admin-'));
    const dbPath = path.join(tmpDataDir, 'api-keys.db');
    const projectRoot = pathToFileURL(process.cwd() + '/').href;

    const script = `
      try {
        const root = '${projectRoot}';
        process.env.HEADLESS = 'false';
        process.env.DB_PATH = '${dbPath.replace(/\\/g, '\\\\')}';
        process.env.NODE_ENV = 'test';
        process.env.AUTH_ENABLED = 'true';
        process.env.RATE_LIMIT_ENABLED = 'false';
        process.env.ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'test-admin-secret';
        process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        const admin = await import(root + 'src/routes/admin.ts');
        const database = await import(root + 'src/db/database.ts');

        database.default.exec(
          "CREATE TABLE IF NOT EXISTS api_keys (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "prefix TEXT NOT NULL UNIQUE," +
          "key_hash TEXT NOT NULL," +
          "label TEXT," +
          "created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL," +
          "created_by_admin INTEGER NOT NULL DEFAULT 1," +
          "created_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
          "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP," +
          "last_used_at DATETIME," +
          "last_used_ip TEXT," +
          "revoked_at DATETIME," +
          "revoked_reason TEXT," +
          "CHECK (length(prefix) >= 12)," +
          "CHECK (length(key_hash) = 64)" +
          ");"
        );
        database.default.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_active_prefix ON api_keys(prefix) WHERE revoked_at IS NULL;");
        database.default.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at);");
        database.default.exec("CREATE TRIGGER IF NOT EXISTS trg_api_keys_touch_updated_at " +
          "AFTER UPDATE ON api_keys " +
          "FOR EACH ROW " +
          "WHEN NEW.updated_at = OLD.updated_at " +
          "BEGIN " +
            "UPDATE api_keys SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; " +
          "END;");
        if (!database.isDatabaseInitialized()) {
          database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('admin','test-hash','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')");
          try { database.default.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('admin','user'))"); } catch {}
          try { database.default.exec("UPDATE users SET role='admin' WHERE username='admin' OR id=1"); } catch {}
        }

        const listRes = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys'),
          new URL('http://localhost/api/admin/api-keys'),
          {} as any,
          { authenticated: true, userId: 1 }
        );

        console.log('@@RESULT@@' + JSON.stringify({ status: listRes?.status ?? null }));
      } finally {
        const database = await import('${projectRoot}src/db/database.ts');
        try { await database.closeDatabase(); } catch {}
        process.exit(0);
      }
    `;

    const output = runScript(script, {
      HEADLESS: 'false',
      DB_PATH: dbPath,
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      RATE_LIMIT_ENABLED: 'false'
    });

    expect(output.status).toBe(200);
    rmSync(tmpDataDir, { recursive: true, force: true });
  }, { timeout: 10000 });
});

describe('headless API key authentication', () => {
  test('env-managed key authenticates requests', () => {
    const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-headless-'));
    const dbPath = path.join(tmpDataDir, 'headless.db');
    const projectRoot = pathToFileURL(process.cwd() + '/').href;

    const script = `
      try {
        process.env.HEADLESS = 'true';
        process.env.API_KEY = process.env.API_KEY ?? 'headless-secret-1234567890';
        process.env.DB_PATH = process.env.DB_PATH ?? '${dbPath.replace(/\\/g, '\\\\')}';
        process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        process.env.AUTH_ENABLED = 'true';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const auth = await import('${projectRoot}src/routes/auth.ts');

        const goodReq = new Request('http://localhost/api/status', {
          headers: { 'X-API-Key': 'headless-secret-1234567890' }
        });
        const headlessAuth = await auth.authenticate(goodReq);

        const badReq = new Request('http://localhost/api/status', {
          headers: { 'X-API-Key': 'wrong-key' }
        });
        const headlessInvalid = await auth.authenticate(badReq);

        const headlessStatus = auth.getAuthStatus();

        console.log('@@RESULT@@' + JSON.stringify({ headlessAuth, headlessInvalid, headlessStatus }));
      } finally {
        const auth = await import('${projectRoot}src/routes/auth.ts');
        try { auth.stopAuthCleanup(); } catch {}
        process.exit(0);
      }
    `;

    const env = {
      HEADLESS: 'true',
      API_KEY: 'headless-secret-1234567890',
      DB_PATH: dbPath,
      SESSION_SECRET: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      RATE_LIMIT_ENABLED: 'false'
    };

    const output = runScript(script, env);

    expect(output.headlessAuth?.authenticated).toBeTrue();
    expect(output.headlessAuth?.userId).toBe('api-user');
    expect(output.headlessInvalid?.authenticated).toBeFalse();
    expect(output.headlessInvalid?.error === 'Invalid API key' || output.headlessInvalid?.error === 'Authentication required').toBeTrue();
    expect(output.headlessStatus?.methods).toContain('api-key');

    rmSync(tmpDataDir, { recursive: true, force: true });
  }, { timeout: 10000 });
});
