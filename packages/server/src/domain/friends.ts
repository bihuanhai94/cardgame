import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from './ledger.js'

/** 好友关系以有序对存储，保证唯一性 */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export function areFriends(db: DatabaseSync, a: string, b: string): boolean {
  const [x, y] = pair(a, b)
  const row = db
    .prepare('SELECT 1 AS ok FROM friendships WHERE user_a = ? AND user_b = ?')
    .get(x, y)
  return row !== undefined
}

export function sendFriendRequest(db: DatabaseSync, fromUser: string, toUser: string): string {
  if (fromUser === toUser) throw new Error('不能添加自己为好友')
  if (areFriends(db, fromUser, toUser)) throw new Error('你们已经是好友')

  const existing = db
    .prepare(
      `SELECT id FROM friend_requests
       WHERE status = 'pending' AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
    )
    .get(fromUser, toUser, toUser, fromUser)
  if (existing) throw new Error('好友请求已存在')

  const id = randomUUID()
  db.prepare(
    `INSERT INTO friend_requests (id, from_user, to_user, status, created_at)
     VALUES (?,?,?,'pending',?)`,
  ).run(id, fromUser, toUser, Date.now())
  return id
}

interface RequestRow {
  id: string
  from_user: string
  to_user: string
  status: string
  created_at: number
}

function loadPending(db: DatabaseSync, requestId: string, actingUser: string): RequestRow {
  const row = db
    .prepare("SELECT * FROM friend_requests WHERE id = ? AND status = 'pending'")
    .get(requestId) as RequestRow | undefined
  if (!row) throw new Error('好友请求不存在或已处理')
  if (row.to_user !== actingUser) throw new Error('无权处理该好友请求')
  return row
}

export function acceptFriendRequest(
  db: DatabaseSync,
  requestId: string,
  actingUser: string,
): void {
  const row = loadPending(db, requestId, actingUser)
  const [x, y] = pair(row.from_user, row.to_user)
  const now = Date.now()
  withTransaction(db, () => {
    db.prepare("UPDATE friend_requests SET status = 'accepted', resolved_at = ? WHERE id = ?")
      .run(now, requestId)
    db.prepare('INSERT INTO friendships (user_a, user_b, created_at) VALUES (?,?,?)')
      .run(x, y, now)
  })
}

export function rejectFriendRequest(
  db: DatabaseSync,
  requestId: string,
  actingUser: string,
): void {
  loadPending(db, requestId, actingUser)
  db.prepare("UPDATE friend_requests SET status = 'rejected', resolved_at = ? WHERE id = ?")
    .run(Date.now(), requestId)
}

export function listPendingRequests(
  db: DatabaseSync,
  userId: string,
): { id: string; fromUser: string; nickname: string; createdAt: number }[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.from_user, u.nickname, r.created_at
       FROM friend_requests r JOIN users u ON u.id = r.from_user
       WHERE r.to_user = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
    )
    .all(userId) as { id: string; from_user: string; nickname: string; created_at: number }[]
  return rows.map((r) => ({
    id: r.id,
    fromUser: r.from_user,
    nickname: r.nickname,
    createdAt: r.created_at,
  }))
}

export function listFriends(
  db: DatabaseSync,
  userId: string,
): { id: string; nickname: string }[] {
  return db
    .prepare(
      `SELECT u.id, u.nickname FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY u.nickname`,
    )
    .all(userId, userId, userId) as { id: string; nickname: string }[]
}
