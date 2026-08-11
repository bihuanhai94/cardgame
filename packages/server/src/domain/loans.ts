import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { postTransaction, getBalance, userAccount, withTransaction } from './ledger.js'
import { areFriends } from './friends.js'

export const LOAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export interface Loan {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  outstanding: number
  status: 'open' | 'settled'
  createdAt: number
}

interface LoanRow {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  status: 'open' | 'settled'
  created_at: number
}

function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    lender: row.lender,
    borrower: row.borrower,
    principal: row.principal,
    repaid: row.repaid,
    outstanding: row.principal - row.repaid,
    status: row.status,
    createdAt: row.created_at,
  }
}

function assertEligible(db: DatabaseSync, userId: string, now: number): void {
  const row = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as
    | { created_at: number }
    | undefined
  if (!row) throw new Error('用户不存在')
  if (now - row.created_at < LOAN_COOLDOWN_MS) {
    throw new Error('账号注册满 7 天后才能使用借条')
  }
}

export function createLoan(
  db: DatabaseSync,
  lender: string,
  borrower: string,
  amount: number,
  now: number = Date.now(),
): Loan {
  if (lender === borrower) throw new Error('不能给自己打借条')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('借款金额必须为正整数')
  if (!areFriends(db, lender, borrower)) throw new Error('借条仅限好友之间')
  assertEligible(db, lender, now)
  assertEligible(db, borrower, now)
  if (getBalance(db, userAccount(lender)) < amount) throw new Error('债权人余额不足')

  const id = randomUUID()

  // 借条行与账本过账必须原子：否则崩溃窗口会留下与账本对不上的借条，
  // 而全局零和校验查不出这种不一致（账本本身仍是平的）。
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO loans (id, lender, borrower, principal, repaid, status, created_at)
       VALUES (?,?,?,?,0,'open',?)`,
    ).run(id, lender, borrower, amount, now)

    postTransaction(
      db,
      [
        { account: userAccount(lender), delta: -amount },
        { account: userAccount(borrower), delta: amount },
      ],
      'loan_create',
      id,
    )
  })

  return toLoan(
    db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow,
  )
}

export function repayLoan(
  db: DatabaseSync,
  loanId: string,
  actingUser: string,
  amount: number,
): Loan {
  const row = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as LoanRow | undefined
  if (!row) throw new Error('借条不存在')
  if (row.borrower !== actingUser) throw new Error('无权操作该借条')
  if (row.status === 'settled') throw new Error('该借条已结清')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('还款金额必须为正整数')

  const outstanding = row.principal - row.repaid
  if (amount > outstanding) throw new Error('还款金额超过未还金额')
  if (getBalance(db, userAccount(actingUser)) < amount) throw new Error('余额不足')

  const repaid = row.repaid + amount
  const status = repaid >= row.principal ? 'settled' : 'open'

  withTransaction(db, () => {
    db.prepare('UPDATE loans SET repaid = ?, status = ?, settled_at = ? WHERE id = ?')
      .run(repaid, status, status === 'settled' ? Date.now() : null, loanId)

    postTransaction(
      db,
      [
        { account: userAccount(row.borrower), delta: -amount },
        { account: userAccount(row.lender), delta: amount },
      ],
      'loan_repay',
      loanId,
    )
  })

  return toLoan(db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as LoanRow)
}

export function listLoans(
  db: DatabaseSync,
  userId: string,
): { asLender: Loan[]; asBorrower: Loan[] } {
  const asLender = (
    db.prepare('SELECT * FROM loans WHERE lender = ? ORDER BY created_at DESC').all(userId) as LoanRow[]
  ).map(toLoan)
  const asBorrower = (
    db.prepare('SELECT * FROM loans WHERE borrower = ? ORDER BY created_at DESC').all(userId) as LoanRow[]
  ).map(toLoan)
  return { asLender, asBorrower }
}

export function netWorth(
  db: DatabaseSync,
  userId: string,
): { balance: number; receivable: number; payable: number; net: number } {
  const balance = getBalance(db, userAccount(userId))
  const recv = db
    .prepare(
      "SELECT COALESCE(SUM(principal - repaid), 0) AS v FROM loans WHERE lender = ? AND status = 'open'",
    )
    .get(userId) as { v: number }
  const pay = db
    .prepare(
      "SELECT COALESCE(SUM(principal - repaid), 0) AS v FROM loans WHERE borrower = ? AND status = 'open'",
    )
    .get(userId) as { v: number }
  return {
    balance,
    receivable: recv.v,
    payable: pay.v,
    net: balance + recv.v - pay.v,
  }
}

/** 用当前余额从最早的借条开始清偿，返回实际还款总额 */
export function autoRepay(db: DatabaseSync, userId: string): number {
  const loans = db
    .prepare("SELECT * FROM loans WHERE borrower = ? AND status = 'open' ORDER BY created_at ASC")
    .all(userId) as LoanRow[]
  let paidTotal = 0
  for (const loan of loans) {
    const available = getBalance(db, userAccount(userId))
    if (available <= 0) break
    const outstanding = loan.principal - loan.repaid
    const pay = Math.min(available, outstanding)
    if (pay <= 0) continue
    repayLoan(db, loan.id, userId, pay)
    paidTotal += pay
  }
  return paidTotal
}
