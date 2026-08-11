import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { mintTo } from './ledger.js'

export const INITIAL_GRANT = 10000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MIN_PASSWORD_LEN = 6
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface User {
  id: string
  nickname: string
  invitedBy: string | null
  createdAt: number
}

interface UserRow {
  id: string
  nickname: string
  password_hash: string
  password_salt: string
  invited_by: string | null
  created_at: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    nickname: row.nickname,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function randomCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

export function createInviteCode(db: DatabaseSync, createdBy: string | null): string {
  const stmt = db.prepare(
    'INSERT INTO invite_codes (code, created_by, created_at) VALUES (?,?,?)',
  )
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode()
    try {
      stmt.run(code, createdBy, Date.now())
      return code
    } catch {
      // 主键冲突，重试
    }
  }
  throw new Error('生成邀请码失败：连续冲突')
}

export function registerUser(
  db: DatabaseSync,
  input: { nickname: string; password: string; inviteCode: string },
): User {
  const nickname = input.nickname.trim()
  if (nickname.length === 0) throw new Error('昵称不能为空')
  if (input.password.length < MIN_PASSWORD_LEN) {
    throw new Error(`密码至少 ${MIN_PASSWORD_LEN} 位`)
  }

  const codeRow = db
    .prepare('SELECT code, created_by, used_by FROM invite_codes WHERE code = ?')
    .get(input.inviteCode) as { code: string; created_by: string | null; used_by: string | null } | undefined
  if (!codeRow) throw new Error('邀请码无效')
  if (codeRow.used_by !== null) throw new Error('邀请码已被使用')

  const dup = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname)
  if (dup) throw new Error('昵称已被占用')

  const id = randomUUID()
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword(input.password, salt)
  const now = Date.now()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO users (id, nickname, password_hash, password_salt, invited_by, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, nickname, hash, salt, codeRow.created_by, now)
    db.prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?')
      .run(id, now, input.inviteCode)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  mintTo(db, id, INITIAL_GRANT, 'initial_grant')

  return { id, nickname, invitedBy: codeRow.created_by, createdAt: now }
}

export function login(
  db: DatabaseSync,
  nickname: string,
  password: string,
): { user: User; token: string } | null {
  const row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname.trim()) as
    | UserRow
    | undefined
  if (!row) return null

  const attempt = Buffer.from(hashPassword(password, row.password_salt), 'hex')
  const stored = Buffer.from(row.password_hash, 'hex')
  if (attempt.length !== stored.length || !timingSafeEqual(attempt, stored)) return null

  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, row.id, now, now + SESSION_TTL_MS)

  return { user: toUser(row), token }
}

export function verifyToken(db: DatabaseSync, token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as UserRow | undefined
  return row ? toUser(row) : null
}

export function logout(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function getUser(db: DatabaseSync, userId: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
  return row ? toUser(row) : null
}
