import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import {
  postTransaction, getBalance, checkGlobalInvariant,
  mintTo, userAccount, MINT_ACCOUNT,
} from './ledger.js'

function setup() {
  const db = openTestDb()
  db.prepare(
    'INSERT INTO users (id, nickname, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)',
  ).run('u1', '甲', 'h', 's', Date.now())
  db.prepare(
    'INSERT INTO users (id, nickname, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)',
  ).run('u2', '乙', 'h', 's', Date.now())
  return db
}

describe('postTransaction', () => {
  it('零和的交易写入成功', () => {
    const db = setup()
    postTransaction(db, [
      { account: userAccount('u1'), delta: 100 },
      { account: userAccount('u2'), delta: -100 },
    ], 'test')
    expect(getBalance(db, userAccount('u1'))).toBe(100)
    expect(getBalance(db, userAccount('u2'))).toBe(-100)
  })

  it('非零和的交易被拒绝', () => {
    const db = setup()
    expect(() =>
      postTransaction(db, [
        { account: userAccount('u1'), delta: 100 },
        { account: userAccount('u2'), delta: -50 },
      ], 'bad'),
    ).toThrow(/零和/)
  })

  it('被拒绝的交易不留下任何流水', () => {
    const db = setup()
    try {
      postTransaction(db, [{ account: userAccount('u1'), delta: 100 }], 'bad')
    } catch { /* 预期抛出 */ }
    const row = db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('拒绝空流水列表', () => {
    const db = setup()
    expect(() => postTransaction(db, [], 'empty')).toThrow(/不能为空/)
  })

  it('拒绝非整数金额', () => {
    const db = setup()
    expect(() =>
      postTransaction(db, [
        { account: userAccount('u1'), delta: 10.5 },
        { account: userAccount('u2'), delta: -10.5 },
      ], 'float'),
    ).toThrow(/整数/)
  })

  it('同一笔交易的流水共享 txnId', () => {
    const db = setup()
    const txnId = postTransaction(db, [
      { account: userAccount('u1'), delta: 7 },
      { account: userAccount('u2'), delta: -7 },
    ], 'test')
    const row = db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE txn_id = ?')
      .get(txnId) as { n: number }
    expect(row.n).toBe(2)
  })
})

describe('getBalance', () => {
  it('无流水时余额为 0', () => {
    const db = setup()
    expect(getBalance(db, userAccount('u1'))).toBe(0)
  })

  it('多笔流水累加', () => {
    const db = setup()
    postTransaction(db, [
      { account: userAccount('u1'), delta: 100 },
      { account: userAccount('u2'), delta: -100 },
    ], 'a')
    postTransaction(db, [
      { account: userAccount('u1'), delta: -30 },
      { account: userAccount('u2'), delta: 30 },
    ], 'b')
    expect(getBalance(db, userAccount('u1'))).toBe(70)
  })
})

describe('mintTo', () => {
  it('注入资金后玩家余额增加、mint 账户变负', () => {
    const db = setup()
    mintTo(db, 'u1', 10000, 'initial')
    expect(getBalance(db, userAccount('u1'))).toBe(10000)
    expect(getBalance(db, MINT_ACCOUNT)).toBe(-10000)
  })

  it('拒绝非正数注入', () => {
    const db = setup()
    expect(() => mintTo(db, 'u1', 0, 'x')).toThrow(/必须为正/)
  })
})

describe('checkGlobalInvariant', () => {
  it('空库满足不变量', () => {
    const db = setup()
    expect(checkGlobalInvariant(db)).toEqual({ total: 0, ok: true })
  })

  it('若干交易后仍满足不变量', () => {
    const db = setup()
    mintTo(db, 'u1', 10000, 'initial')
    mintTo(db, 'u2', 10000, 'initial')
    postTransaction(db, [
      { account: userAccount('u1'), delta: -250 },
      { account: userAccount('u2'), delta: 250 },
    ], 'settle')
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })

  it('手工插入破坏性流水后能检测出来', () => {
    const db = setup()
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('hack', userAccount('u1'), 999, 'hack', Date.now())
    const r = checkGlobalInvariant(db)
    expect(r.ok).toBe(false)
    expect(r.total).toBe(999)
  })
})
