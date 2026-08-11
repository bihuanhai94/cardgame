import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from './users.js'
import { sendFriendRequest, acceptFriendRequest } from './friends.js'
import { createLoan, LOAN_COOLDOWN_MS } from './loans.js'
import { getBalance, userAccount, checkGlobalInvariant } from './ledger.js'
import { claimDaily, ranking, dayKey, DAILY_GRANT } from './ranking.js'

const OLD = Date.now() + LOAN_COOLDOWN_MS + 1000

function setup() {
  const db = openTestDb()
  const mk = (n: string) =>
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
  return { db, a: mk('甲'), b: mk('乙') }
}

describe('dayKey', () => {
  it('按 UTC+8 切分日期', () => {
    // 2026-08-10T00:30:00+08:00 => 2026-08-09T16:30:00Z
    expect(dayKey(Date.parse('2026-08-09T16:30:00Z'))).toBe('2026-08-10')
  })

  it('UTC+8 的 23:59 仍属当天', () => {
    expect(dayKey(Date.parse('2026-08-10T15:59:00Z'))).toBe('2026-08-10')
  })
})

describe('claimDaily', () => {
  it('首次签到发放补给', () => {
    const { db, a } = setup()
    const r = claimDaily(db, a.id)
    expect(r).toEqual({ claimed: true, amount: DAILY_GRANT })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT)
  })

  it('同日重复签到不再发放', () => {
    const { db, a } = setup()
    const now = Date.now()
    claimDaily(db, a.id, now)
    const r = claimDaily(db, a.id, now)
    expect(r).toEqual({ claimed: false, amount: 0 })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT)
  })

  it('次日可再次签到', () => {
    const { db, a } = setup()
    const now = Date.parse('2026-08-10T02:00:00Z')
    claimDaily(db, a.id, now)
    claimDaily(db, a.id, now + 24 * 3600 * 1000)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT * 2)
  })
})

describe('ranking', () => {
  it('按净资产降序排列', () => {
    const { db, a, b } = setup()
    claimDaily(db, a.id)
    const list = ranking(db)
    expect(list[0]!.userId).toBe(a.id)
    expect(list[0]!.net).toBe(INITIAL_GRANT + DAILY_GRANT)
    expect(list[1]!.userId).toBe(b.id)
  })

  it('借款不改变排名顺序', () => {
    const { db, a, b } = setup()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    claimDaily(db, a.id)
    createLoan(db, a.id, b.id, 5000, OLD)
    const list = ranking(db)
    // 乙余额更高，但净资产未变，排名仍在甲之后
    expect(list[0]!.userId).toBe(a.id)
    expect(list[1]!.userId).toBe(b.id)
    expect(list[1]!.balance).toBe(INITIAL_GRANT + 5000)
    expect(list[1]!.payable).toBe(5000)
    expect(list[1]!.net).toBe(INITIAL_GRANT)
  })

  it('返回昵称', () => {
    const { db } = setup()
    expect(ranking(db).map((r) => r.nickname).sort()).toEqual(['乙', '甲'])
  })

  it('limit 生效', () => {
    const { db } = setup()
    expect(ranking(db, 1)).toHaveLength(1)
  })
})

describe('transaction atomicity', () => {
  it('claimDaily 的签到记录与铸币必须原子', () => {
    const { db, a } = setup()
    const balanceBefore = getBalance(db, userAccount(a.id))
    const now = Date.now()

    // 让每日补给过账在签到记录写入之后失败
    db.exec(`CREATE TRIGGER fail_daily_mint BEFORE INSERT ON ledger_entries
             WHEN NEW.reason = 'daily_grant'
             BEGIN SELECT RAISE(ABORT, 'boom'); END`)

    try {
      expect(() => claimDaily(db, a.id, now)).toThrow()
    } finally {
      db.exec('DROP TRIGGER fail_daily_mint')
    }

    // 关键断言：签到记录必须因事务回滚而消失（不原子则它会留下）
    const claimed = db
      .prepare('SELECT 1 AS ok FROM daily_claims WHERE user_id = ? AND day = ?')
      .get(a.id, dayKey(now))
    expect(claimed).toBeUndefined()
    expect(getBalance(db, userAccount(a.id))).toBe(balanceBefore)
    expect(checkGlobalInvariant(db).ok).toBe(true)

    // 同日重试应该成功，不应被标记为「已领」
    const r = claimDaily(db, a.id, now)
    expect(r).toEqual({ claimed: true, amount: DAILY_GRANT })
    expect(getBalance(db, userAccount(a.id))).toBe(balanceBefore + DAILY_GRANT)
  })
})
