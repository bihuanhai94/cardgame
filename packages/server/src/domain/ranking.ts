import type { DatabaseSync } from 'node:sqlite'
import { mintTo } from './ledger.js'

export const DAILY_GRANT = 200
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/** 以 UTC+8 为准的日期键，形如 2026-08-10 */
export function dayKey(now: number): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function claimDaily(
  db: DatabaseSync,
  userId: string,
  now: number = Date.now(),
): { claimed: boolean; amount: number } {
  const day = dayKey(now)
  const exists = db
    .prepare('SELECT 1 AS ok FROM daily_claims WHERE user_id = ? AND day = ?')
    .get(userId, day)
  if (exists) return { claimed: false, amount: 0 }

  db.prepare('INSERT INTO daily_claims (user_id, day, amount) VALUES (?,?,?)')
    .run(userId, day, DAILY_GRANT)
  mintTo(db, userId, DAILY_GRANT, 'daily_grant', day)
  return { claimed: true, amount: DAILY_GRANT }
}

export interface RankingRow {
  userId: string
  nickname: string
  net: number
  balance: number
  receivable: number
  payable: number
}

/** 排行榜按净资产降序。禁止改为按余额排序（借款可刷榜）。 */
export function ranking(db: DatabaseSync, limit = 100): RankingRow[] {
  const rows = db
    .prepare(
      `SELECT
         u.id AS userId,
         u.nickname AS nickname,
         COALESCE(l.bal, 0) AS balance,
         COALESCE(r.recv, 0) AS receivable,
         COALESCE(p.pay, 0) AS payable
       FROM users u
       LEFT JOIN (
         SELECT account, SUM(delta) AS bal FROM ledger_entries GROUP BY account
       ) l ON l.account = 'user:' || u.id
       LEFT JOIN (
         SELECT lender AS uid, SUM(principal - repaid) AS recv
         FROM loans WHERE status = 'open' GROUP BY lender
       ) r ON r.uid = u.id
       LEFT JOIN (
         SELECT borrower AS uid, SUM(principal - repaid) AS pay
         FROM loans WHERE status = 'open' GROUP BY borrower
       ) p ON p.uid = u.id
       ORDER BY (COALESCE(l.bal,0) + COALESCE(r.recv,0) - COALESCE(p.pay,0)) DESC, u.nickname ASC
       LIMIT ?`,
    )
    .all(limit) as Omit<RankingRow, 'net'>[]
  return rows.map((r) => ({ ...r, net: r.balance + r.receivable - r.payable }))
}
