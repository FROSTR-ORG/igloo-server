import { describe, expect, test, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'

describe('admin whoami with DB-backed session', () => {
  test('expired DB session yields 401 on whoami without auth', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-db-whoami-exp-'))
    const dbPath = path.join(tmpDir, 'igloo.db')

    process.env.HEADLESS = 'false'
    process.env.DB_PATH = dbPath
    process.env.NODE_ENV = 'test'
    process.env.AUTH_ENABLED = 'true'
    process.env.RATE_LIMIT_ENABLED = 'false'
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.ADMIN_SECRET = 'test-admin-secret'

    const database = await import('../../src/db/database.ts')
    const auth = await import('../../src/routes/auth.ts')
    const admin = await import('../../src/routes/admin.ts')

    if (!database.isDatabaseInitialized()) {
      database.default.exec("INSERT INTO users (username, password_hash, salt) VALUES ('admin','x','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')")
      try { database.default.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('admin','user'))") } catch {}
      try { database.default.exec("UPDATE users SET role='admin' WHERE username='admin' OR id=1") } catch {}
    }

    const sessionId = auth.createSession(1, '203.0.113.7')
    expect(sessionId).toBeString()
    database.default.exec("UPDATE sessions SET last_access = datetime('now', '-1 day') WHERE id = '" + sessionId + "'")

    const req = new Request('http://localhost/api/admin/whoami')
    const res = await admin.handleAdminRoute(req, new URL('http://localhost/api/admin/whoami'), {} as any, null)
    expect(res?.status).toBe(401)

    rmSync(tmpDir, { recursive: true, force: true })
  })
})

afterAll(async () => {
  try { const auth = await import('../../src/routes/auth.ts'); auth.stopAuthCleanup(); } catch {}
  try { const db = await import('../../src/db/database.ts'); await db.closeDatabase(); } catch {}
})
