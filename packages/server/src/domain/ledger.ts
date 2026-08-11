import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const MINT_ACCOUNT = 'system:mint'

export function userAccount(userId: string): string {
  return `user:${userId}`
}

export interface PostingLine {
  account: string
  delta: number
}

/**
 * 过账。校验零和后在单个事务内写入全部流水。
 * 任一校验失败则抛异常且不留下任何记录。
 */
export function postTransaction(
  db: DatabaseSync,
  lines: PostingLine[],
  reason: string,
  refId: string | null = null,
): string {
  if (lines.length === 0) throw new Error('流水列表不能为空')
  for (const l of lines) {
    if (!Number.isInteger(l.delta)) throw new Error(`金额必须为整数：${l.delta}`)
  }
  const total = lines.reduce((s, l) => s + l.delta, 0)
  if (total !== 0) throw new Error(`交易违反零和约束：总和为 ${total}`)

  const txnId = randomUUID()
  const now = Date.now()
  const stmt = db.prepare(
    'INSERT INTO ledger_entries (txn_id, account, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?,?)',
  )
  db.exec('BEGIN')
  try {
    for (const l of lines) stmt.run(txnId, l.account, l.delta, reason, refId, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return txnId
}

export function getBalance(db: DatabaseSync, account: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS bal FROM ledger_entries WHERE account = ?')
    .get(account) as { bal: number }
  return row.bal
}

export function checkGlobalInvariant(db: DatabaseSync): { total: number; ok: boolean } {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries')
    .get() as { total: number }
  return { total: row.total, ok: row.total === 0 }
}

/** 从 system:mint 账户向玩家注入资金（初始资金、每日补给） */
export function mintTo(
  db: DatabaseSync,
  userId: string,
  amount: number,
  reason: string,
  refId: string | null = null,
): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('注入金额必须为正整数')
  return postTransaction(
    db,
    [
      { account: userAccount(userId), delta: amount },
      { account: MINT_ACCOUNT, delta: -amount },
    ],
    reason,
    refId,
  )
}
