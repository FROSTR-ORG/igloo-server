import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

function runScript(code: string, env: Record<string, string>) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-neg-'))
  try {
    const scriptPath = path.join(tmpDir, 'runner.ts')
    writeFileSync(scriptPath, code, 'utf8')
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', scriptPath],
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 10000
    })
    if (result.exitCode !== 0) {
      throw new Error(`Script failed: ${result.stderr.toString()}`)
    }
    const stdout = result.stdout.toString().trim()
    const marker = '@@RESULT@@'
    const line = stdout.split('\n').reverse().find(l => l.startsWith(marker))
    if (!line) throw new Error(`Failed to parse script output: ${stdout}`)
    return JSON.parse(line.slice(marker.length))
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

describe('admin API negatives and session create', () => {
  test('HEADLESS=true: admin route is unavailable', () => {
    const projectRoot = pathToFileURL(process.cwd() + '/').href
    const script = `
      try {
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        const admin = await import('${projectRoot}src/routes/admin.ts');
        const res = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys'),
          new URL('http://localhost/api/admin/api-keys'),
          {} as any,
          null
        );
        console.log('@@RESULT@@' + JSON.stringify({ isNull: res === null }));
      } finally {
        process.exit(0);
      }
    `
    const out = runScript(script, { HEADLESS: 'true' })
    expect(out.isNull).toBeTrue()
  })

  test('invalid bodies: label type, userId type, revoke id', () => {
    const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-neg-db-'))
    const dbPath = path.join(tmpDataDir, 'api-keys.db')
    const projectRoot = pathToFileURL(process.cwd() + '/').href
    const script = `
      try {
        process.env.HEADLESS = 'false';
        process.env.DB_PATH = '${dbPath.replace(/\\/g, '\\\\')}';
        process.env.NODE_ENV = 'test';
        process.env.AUTH_ENABLED = 'true';
        process.env.RATE_LIMIT_ENABLED = 'false';
        process.env.ADMIN_SECRET = 'test-admin-secret';
        process.env.SESSION_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        const admin = await import('${projectRoot}src/routes/admin.ts');
        const database = await import('${projectRoot}src/db/database.ts');

        // bootstrap minimal schema
        database.default.exec("CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,prefix TEXT NOT NULL UNIQUE,key_hash TEXT NOT NULL,label TEXT,created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_by_admin INTEGER NOT NULL DEFAULT 1,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,last_used_at DATETIME,last_used_ip TEXT,revoked_at DATETIME,revoked_reason TEXT,CHECK (length(prefix) >= 12),CHECK (length(key_hash) = 64));");
        if (!database.isDatabaseInitialized()) {
          database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('admin','x','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')");
          try { database.default.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('admin','user'))"); } catch {}
          try { database.default.exec("UPDATE users SET role='admin' WHERE username='admin'"); } catch {}
        }

        const badLabelRes = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-secret' }, body: JSON.stringify({ label: [1,2,3] }) }),
          new URL('http://localhost/api/admin/api-keys'),
          {} as any,
          null
        );
        const badUserIdRes = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-secret' }, body: JSON.stringify({ userId: 'abc' }) }),
          new URL('http://localhost/api/admin/api-keys'),
          {} as any,
          null
        );
        const badRevokeRes = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-secret' }, body: JSON.stringify({ apiKeyId: 'abc' }) }),
          new URL('http://localhost/api/admin/api-keys/revoke'),
          {} as any,
          null
        );

        console.log('@@RESULT@@' + JSON.stringify({
          badLabel: badLabelRes?.status ?? null,
          badUserId: badUserIdRes?.status ?? null,
          badRevoke: badRevokeRes?.status ?? null
        }));
      } finally {
        const database = await import('${projectRoot}src/db/database.ts');
        try { await database.closeDatabase(); } catch {}
        process.exit(0);
      }
    `

    const out = runScript(script, {
      HEADLESS: 'false',
      DB_PATH: dbPath,
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      RATE_LIMIT_ENABLED: 'false'
    })

    expect(out.badLabel).toBe(400)
    expect(out.badUserId).toBe(400)
    expect(out.badRevoke).toBe(400)
    rmSync(tmpDataDir, { recursive: true, force: true })
  })

  test('session-admin can create keys without ADMIN_SECRET', () => {
    const tmpDataDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-neg-session-'))
    const dbPath = path.join(tmpDataDir, 'api-keys.db')
    const projectRoot = pathToFileURL(process.cwd() + '/').href
    const script = `
      try {
        process.env.HEADLESS = 'false';
        process.env.DB_PATH = '${dbPath.replace(/\\/g, '\\\\')}';
        process.env.NODE_ENV = 'test';
        process.env.AUTH_ENABLED = 'true';
        process.env.RATE_LIMIT_ENABLED = 'false';
        process.env.ADMIN_SECRET = 'test-admin-secret';
        process.env.SESSION_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        const admin = await import('${projectRoot}src/routes/admin.ts');
        const database = await import('${projectRoot}src/db/database.ts');

        database.default.exec("CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,prefix TEXT NOT NULL UNIQUE,key_hash TEXT NOT NULL,label TEXT,created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_by_admin INTEGER NOT NULL DEFAULT 1,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,last_used_at DATETIME,last_used_ip TEXT,revoked_at DATETIME,revoked_reason TEXT,CHECK (length(prefix) >= 12),CHECK (length(key_hash) = 64));");
        if (!database.isDatabaseInitialized()) {
          database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('admin','x','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')");
          try { database.default.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('admin','user'))"); } catch {}
          try { database.default.exec("UPDATE users SET role='admin' WHERE username='admin'"); } catch {}
        }

        const res = await admin.handleAdminRoute(
          new Request('http://localhost/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'from-session' }) }),
          new URL('http://localhost/api/admin/api-keys'),
          {} as any,
          { authenticated: true, userId: 1 }
        );
        console.log('@@RESULT@@' + JSON.stringify({ status: res?.status ?? null }));
      } finally {
        const database = await import('${projectRoot}src/db/database.ts');
        try { await database.closeDatabase(); } catch {}
        process.exit(0);
      }
    `
    const out = runScript(script, {
      HEADLESS: 'false',
      DB_PATH: dbPath,
      ADMIN_SECRET: 'test-admin-secret',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      RATE_LIMIT_ENABLED: 'false'
    })

    expect(out.status).toBe(201)
    rmSync(tmpDataDir, { recursive: true, force: true })
  })
})
