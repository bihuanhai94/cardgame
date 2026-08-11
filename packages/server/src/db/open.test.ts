import { describe, it, expect } from 'vitest'
import { openTestDb, applyMigrations } from './open.js'

describe('openTestDb', () => {
  it('建出全部业务表', () => {
    const db = openTestDb()
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of [
      'schema_migrations', 'users', 'invite_codes', 'sessions',
      'friendships', 'friend_requests', 'ledger_entries', 'loans',
      'daily_claims', 'match_records',
    ]) {
      expect(names).toContain(t)
    }
  })

  it('记录已应用的迁移', () => {
    const db = openTestDb()
    const row = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    expect(row.n).toBeGreaterThan(0)
  })

  it('开启了外键约束', () => {
    const db = openTestDb()
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
  })

  it('重复应用迁移是幂等的', () => {
    const db = openTestDb()
    const before = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    applyMigrations(db)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    expect(after).toBe(before)
  })
})
