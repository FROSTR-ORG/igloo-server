import path from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import db from './database.js'

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function getAppliedSet(): Set<string> {
  const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY id ASC').all() as { name: string }[]
  return new Set(rows.map(r => r.name))
}

export function runMigrations(migrationsDirRel = 'src/db/migrations', opts?: { stopOnError?: boolean }): string[] {
  ensureMigrationsTable()
  const applied = getAppliedSet()

  // Resolve and canonicalize the migrations directory path
  const dir = path.resolve(
    path.isAbsolute(migrationsDirRel) ? migrationsDirRel : path.join(process.cwd(), migrationsDirRel)
  )

  // Security: Ensure migrations directory is within project boundaries
  const projectRoot = path.resolve(process.cwd())
  if (!dir.startsWith(projectRoot + path.sep) && dir !== projectRoot) {
    throw new Error(`Security: Migration directory must be within project root. Attempted: ${dir}`)
  }

  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort()

  const appliedNow: string[] = []
  const stopOnError = opts?.stopOnError ?? true
  for (const file of files) {
    if (applied.has(file)) continue
    const full = path.join(dir, file)
    const sql = readFileSync(full, 'utf-8')
    // Basic sanity checks for managed SQL files
    if (sql.length > 1_000_000) {
      console.error(`[migrations] Skipping ${file}: file too large (>1MB)`) 
      if (stopOnError) throw new Error('Migration too large')
      else continue
    }
    // Use bun:sqlite transaction API for atomicity of each migration file
    const migrate = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file)
    })
    try {
      migrate()
      appliedNow.push(file)
    } catch (e) {
      console.error(`[migrations] Failed to apply ${file}:`, e)
      if (stopOnError) throw e
      // otherwise continue to next migration
    }
  }
  return appliedNow
}
