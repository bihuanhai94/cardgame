import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from './users.js'
import { sendFriendRequest, acceptFriendRequest } from './friends.js'
import { getBalance, userAccount, checkGlobalInvariant } from './ledger.js'
import { createLoan, repayLoan, listLoans, netWorth, autoRepay, LOAN_COOLDOWN_MS } from './loans.js'

const OLD = Date.now() + LOAN_COOLDOWN_MS + 1000

function setup() {
  const db = openTestDb()
  const mk = (n: string) => {
    const u = registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
    // Backdate users to well before OLD to ensure age check passes for OLD timestamp
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(OLD - LOAN_COOLDOWN_MS - 2000, u.id)
    return u
  }
  const a = mk('甲')
  const b = mk('乙')
  const c = mk('丙')
  acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
  return { db, a, b, c }
}

describe('createLoan', () => {
  it('借出后债权人减钱、债务人加钱', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT - 1000)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT + 1000)
  })

  it('生成未结清的借条', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(loan.status).toBe('open')
    expect(loan.outstanding).toBe(1000)
  })

  it('账本仍满足全局零和', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })

  it('拒绝向非好友借出', () => {
    const { db, a, c } = setup()
    expect(() => createLoan(db, a.id, c.id, 1000, OLD)).toThrow(/仅限好友/)
  })

  it('拒绝给自己打借条', () => {
    const { db, a } = setup()
    expect(() => createLoan(db, a.id, a.id, 1000, OLD)).toThrow(/不能给自己/)
  })

  it('拒绝非正整数金额', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, 0, OLD)).toThrow(/必须为正整数/)
    expect(() => createLoan(db, a.id, b.id, 10.5, OLD)).toThrow(/必须为正整数/)
  })

  it('拒绝超出债权人余额的金额', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, INITIAL_GRANT + 1, OLD)).toThrow(/余额不足/)
  })

  it('新账号 7 天内不能借出', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, 100, Date.now())).toThrow(/满 7 天/)
  })

  it('新账号 7 天内不能借入', () => {
    const db = openTestDb()
    const mk = (n: string, backdate: number) => {
      const u = registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
      db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(backdate, u.id)
      return u
    }
    const old = mk('老', Date.now() - LOAN_COOLDOWN_MS - 1000)
    const fresh = mk('新', Date.now())
    acceptFriendRequest(db, sendFriendRequest(db, old.id, fresh.id), fresh.id)
    expect(() => createLoan(db, old.id, fresh.id, 100, Date.now())).toThrow(/满 7 天/)
  })
})

describe('repayLoan', () => {
  it('部分还款后 outstanding 减少', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const after = repayLoan(db, loan.id, b.id, 400)
    expect(after.outstanding).toBe(600)
    expect(after.status).toBe('open')
  })

  it('全额还款后状态变为 settled', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const after = repayLoan(db, loan.id, b.id, 1000)
    expect(after.status).toBe('settled')
    expect(after.outstanding).toBe(0)
  })

  it('还款后双方余额恢复', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 1000)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT)
  })

  it('拒绝超额还款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(() => repayLoan(db, loan.id, b.id, 1001)).toThrow(/超过未还金额/)
  })

  it('非债务人不能还款', () => {
    const { db, a, b, c } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(() => repayLoan(db, loan.id, c.id, 100)).toThrow(/无权/)
  })

  it('余额不足时不能还款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    // 把乙的钱全部转走（直写流水，模拟余额被掏空）
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', userAccount(b.id), -(INITIAL_GRANT + 1000), 'drain', Date.now())
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', 'system:mint', INITIAL_GRANT + 1000, 'drain', Date.now())
    expect(() => repayLoan(db, loan.id, b.id, 100)).toThrow(/余额不足/)
  })

  it('已结清的借条不能再还', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 1000)
    expect(() => repayLoan(db, loan.id, b.id, 1)).toThrow(/已结清/)
  })
})

describe('netWorth', () => {
  it('无借贷时净资产等于余额', () => {
    const { db, c } = setup()
    expect(netWorth(db, c.id)).toEqual({
      balance: INITIAL_GRANT, receivable: 0, payable: 0, net: INITIAL_GRANT,
    })
  })

  it('借出方净资产不变', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(netWorth(db, a.id).net).toBe(INITIAL_GRANT)
  })

  it('借入方净资产不变', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(netWorth(db, b.id).net).toBe(INITIAL_GRANT)
  })

  it('借入方的应付被正确记录', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    const nw = netWorth(db, b.id)
    expect(nw.balance).toBe(INITIAL_GRANT + 1000)
    expect(nw.payable).toBe(1000)
  })

  it('部分还款后应收应付同步减少', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 300)
    expect(netWorth(db, a.id).receivable).toBe(700)
    expect(netWorth(db, b.id).payable).toBe(700)
  })
})

describe('listLoans', () => {
  it('分别列出应收与应付', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(listLoans(db, a.id).asLender).toHaveLength(1)
    expect(listLoans(db, a.id).asBorrower).toHaveLength(0)
    expect(listLoans(db, b.id).asBorrower).toHaveLength(1)
  })
})

describe('autoRepay', () => {
  it('用余额清偿全部欠款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const paid = autoRepay(db, b.id)
    expect(paid).toBe(1000)
    expect(listLoans(db, b.id).asBorrower[0]!.status).toBe('settled')
    void loan
  })

  it('余额不足时按可用额度部分清偿', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 5000, OLD)
    // 把乙的余额压到 2000
    const drain = INITIAL_GRANT + 5000 - 2000
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', userAccount(b.id), -drain, 'drain', Date.now())
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', 'system:mint', drain, 'drain', Date.now())
    expect(autoRepay(db, b.id)).toBe(2000)
    expect(listLoans(db, b.id).asBorrower[0]!.outstanding).toBe(3000)
  })

  it('无欠款时返回 0', () => {
    const { db, c } = setup()
    expect(autoRepay(db, c.id)).toBe(0)
  })
})
