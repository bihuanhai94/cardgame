import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { getBalance, userAccount, checkGlobalInvariant } from './ledger.js'
import {
  createInviteCode, registerUser, login, verifyToken, logout, getUser, INITIAL_GRANT,
} from './users.js'

function reg(db: ReturnType<typeof openTestDb>, nickname: string) {
  const code = createInviteCode(db, null)
  return registerUser(db, { nickname, password: 'pw123456', inviteCode: code })
}

describe('createInviteCode', () => {
  it('生成 8 位大写码', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(code).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('连续生成不重复', () => {
    const db = openTestDb()
    const codes = new Set(Array.from({ length: 200 }, () => createInviteCode(db, null)))
    expect(codes.size).toBe(200)
  })
})

describe('registerUser', () => {
  it('注册成功并返回用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(u.nickname).toBe('甲')
    expect(u.id).toBeTruthy()
  })

  it('发放初始资金', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(getBalance(db, userAccount(u.id))).toBe(INITIAL_GRANT)
  })

  it('邀请码用过一次后失效', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: code })
    expect(() =>
      registerUser(db, { nickname: '乙', password: 'pw123456', inviteCode: code }),
    ).toThrow(/已被使用/)
  })

  it('拒绝不存在的邀请码', () => {
    const db = openTestDb()
    expect(() =>
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: 'NOTEXIST' }),
    ).toThrow(/邀请码无效/)
  })

  it('拒绝重复昵称', () => {
    const db = openTestDb()
    reg(db, '甲')
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: code }),
    ).toThrow(/昵称已被占用/)
  })

  it('拒绝过短密码', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '甲', password: '123', inviteCode: code }),
    ).toThrow(/密码至少/)
  })

  it('拒绝空昵称', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '  ', password: 'pw123456', inviteCode: code }),
    ).toThrow(/昵称不能为空/)
  })

  it('注册失败时不留下用户记录', () => {
    const db = openTestDb()
    try {
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: 'BAD' })
    } catch { /* 预期抛出 */ }
    const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('初始资金过账失败时不留下用户记录、邀请码不被消耗', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)

    db.exec(`CREATE TRIGGER fail_initial_grant BEFORE INSERT ON ledger_entries
             WHEN NEW.reason = 'initial_grant'
             BEGIN SELECT RAISE(ABORT, 'boom'); END`)

    try {
      expect(() =>
        registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: code }),
      ).toThrow()
    } finally {
      db.exec('DROP TRIGGER fail_initial_grant')
    }

    const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    expect(userCount).toBe(0)

    const codeRow = db.prepare('SELECT used_by FROM invite_codes WHERE code = ?').get(code) as
      | { used_by: string | null }
      | undefined
    expect(codeRow!.used_by).toBeNull()

    expect(checkGlobalInvariant(db).ok).toBe(true)
  })

  it('记录邀请人', () => {
    const db = openTestDb()
    const a = reg(db, '甲')
    const code = createInviteCode(db, a.id)
    const b = registerUser(db, { nickname: '乙', password: 'pw123456', inviteCode: code })
    expect(b.invitedBy).toBe(a.id)
  })
})

describe('login / verifyToken / logout', () => {
  it('正确密码登录成功', () => {
    const db = openTestDb()
    reg(db, '甲')
    const r = login(db, '甲', 'pw123456')
    expect(r).not.toBeNull()
    expect(r!.token).toBeTruthy()
  })

  it('错误密码登录失败', () => {
    const db = openTestDb()
    reg(db, '甲')
    expect(login(db, '甲', 'wrongpass')).toBeNull()
  })

  it('不存在的昵称登录失败', () => {
    const db = openTestDb()
    expect(login(db, '不存在', 'pw123456')).toBeNull()
  })

  it('token 可换回用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    const r = login(db, '甲', 'pw123456')!
    expect(verifyToken(db, r.token)!.id).toBe(u.id)
  })

  it('非法 token 返回 null', () => {
    const db = openTestDb()
    expect(verifyToken(db, 'garbage')).toBeNull()
  })

  it('登出后 token 失效', () => {
    const db = openTestDb()
    reg(db, '甲')
    const r = login(db, '甲', 'pw123456')!
    logout(db, r.token)
    expect(verifyToken(db, r.token)).toBeNull()
  })

  it('过期 token 失效', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .run('expired', u.id, Date.now() - 2000, Date.now() - 1000)
    expect(verifyToken(db, 'expired')).toBeNull()
  })
})

describe('getUser', () => {
  it('查得到已注册用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(getUser(db, u.id)!.nickname).toBe('甲')
  })

  it('查不到时返回 null', () => {
    const db = openTestDb()
    expect(getUser(db, 'nope')).toBeNull()
  })
})
