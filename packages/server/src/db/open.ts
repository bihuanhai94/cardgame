import { DatabaseSync } from './sqlite.js'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'

export function applyMigrations(db: DatabaseSyncType): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`)
  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]
  const applied = new Set(appliedRows.map((r) => r.id))
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, Date.now())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function openDb(path: string): DatabaseSyncType {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)
  return db
}

export function openTestDb(): DatabaseSyncType {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)
  return db
}
