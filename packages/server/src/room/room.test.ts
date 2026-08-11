import { describe, it, expect, beforeAll } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from '../domain/users.js'
import { getBalance, userAccount, checkGlobalInvariant } from '../domain/ledger.js'
import { sendFriendRequest, acceptFriendRequest } from '../domain/friends.js'
import { createLoan, listLoans, LOAN_COOLDOWN_MS } from '../domain/loans.js'
import { registerEngine } from './registry.js'
import { highCard } from '../games/highcard.js'
import { Room, RoomManager, settleToLedger } from './room.js'

beforeAll(() => registerEngine(highCard))

function makeRoom(seats = 3) {
  return new Room({
    id: 'R1',
    gameId: 'highcard',
    ownerId: 'a',
    seats,
    options: { ante: 100 },
    seedSource: () => 42,
  })
}

describe('Room 座位管理', () => {
  it('入座后出现在座位信息中', () => {
    const room = makeRoom()
    room.sit('a')
    expect(room.seatInfos().filter((s) => s.userId === 'a')).toHaveLength(1)
  })

  it('拒绝重复入座', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.sit('a')).toThrow(/已在房间/)
  })

  it('座位满后拒绝入座', () => {
    const room = makeRoom(2)
    room.sit('a')
    room.sit('b')
    expect(() => room.sit('c')).toThrow(/座位已满/)
  })

  it('离开后座位释放', () => {
    const room = makeRoom(2)
    room.sit('a')
    room.leave('a')
    room.sit('c')
    expect(room.seatInfos().some((s) => s.userId === 'c')).toBe(true)
  })
})

describe('Room 开局', () => {
  it('人数不足时不能开局', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.start()).toThrow(/至少需要 2 人/)
  })

  it('开局后状态为已开始', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    expect(room.isStarted()).toBe(true)
  })

  it('开局后不能再入座', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    expect(() => room.sit('c')).toThrow(/已开局/)
  })

  it('未开局时不能行动', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.act('a', { type: 'call' })).toThrow(/尚未开局/)
  })
})

describe('Room 断线重连', () => {
  it('对局中离开不释放座位，标记为离线与 AI 接管', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    room.leave('a')
    const seatA = room.seatInfos().find((s) => s.userId === 'a')
    expect(seatA).toBeDefined()
    expect(seatA!.online).toBe(false)
    expect(seatA!.isAi).toBe(true)
    // 引擎的玩家列表不受影响，座位没有被清空
    expect(room.players()).toContain('a')
  })

  it('setOnline(true) 重连后清除 AI 标记', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    room.leave('a')
    room.setOnline('a', true)
    const seatA = room.seatInfos().find((s) => s.userId === 'a')
    expect(seatA!.online).toBe(true)
    expect(seatA!.isAi).toBe(false)
  })
})

describe('Room 行动与视图', () => {
  function started() {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    return room
  }

  it('行动返回事件', () => {
    const room = started()
    expect(room.act('a', { type: 'call' }).events[0]!.type).toBe('called')
  })

  it('非在座玩家不能行动', () => {
    const room = started()
    expect(() => room.act('zzz', { type: 'call' })).toThrow()
  })

  it('玩家视图看不到他人手牌', () => {
    const room = started()
    const v = room.viewFor('a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['a'])
  })

  it('观战视图看不到任何手牌', () => {
    const room = started()
    const v = room.viewFor(null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('全部行动后产出结算', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'call' })
    const rec = room.takeSettlement()
    expect(rec).not.toBeNull()
    expect(Object.values(rec!.deltas).reduce((x, y) => x + y, 0)).toBe(0)
  })

  it('未结束时无结算', () => {
    const room = started()
    room.act('a', { type: 'call' })
    expect(room.takeSettlement()).toBeNull()
  })

  it('结算只能领取一次', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'call' })
    room.takeSettlement()
    expect(room.takeSettlement()).toBeNull()
  })

  it('结算记录包含动作序列可供重放', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'fold' })
    const rec = room.takeSettlement()!
    expect(rec.actions).toHaveLength(2)
    expect(rec.seed).toBe(42)
  })
})

describe('settleToLedger', () => {
  function setupDb() {
    const db = openTestDb()
    const mk = (n: string) =>
      registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
    return { db, a: mk('甲'), b: mk('乙') }
  }

  it('把结算写进账本', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [],
      deltas: { [a.id]: 300, [b.id]: -300 },
    })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + 300)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT - 300)
  })

  it('写入战绩记录', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [{ playerId: a.id, action: { type: 'call' } }],
      deltas: { [a.id]: 300, [b.id]: -300 },
    })
    const row = db.prepare('SELECT * FROM match_records WHERE room_id = ?').get('R1') as
      { seed: number; actions: string }
    expect(row.seed).toBe(42)
    expect(JSON.parse(row.actions)).toHaveLength(1)
  })

  it('拒绝非零和结算', () => {
    const { db, a, b } = setupDb()
    expect(() =>
      settleToLedger(db, {
        roomId: 'R1', gameId: 'highcard', seed: 1,
        players: [a.id, b.id], actions: [], deltas: { [a.id]: 300, [b.id]: -100 },
      }),
    ).toThrow(/零和/)
  })

  it('赢钱后自动优先还款', () => {
    const { db, a, b } = setupDb()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    const old = Date.now() + LOAN_COOLDOWN_MS + 1000
    db.prepare('UPDATE users SET created_at = ?').run(Date.now() - LOAN_COOLDOWN_MS - 1000)
    createLoan(db, a.id, b.id, 1000, old)
    // 乙欠甲 1000，现在乙赢 300
    settleToLedger(db, {
      roomId: 'R2', gameId: 'highcard', seed: 1,
      players: [a.id, b.id], actions: [], deltas: { [b.id]: 300, [a.id]: -300 },
    })
    expect(listLoans(db, b.id).asBorrower[0]!.outstanding).toBeLessThan(1000)
  })

  it('结算后全局零和不变量成立', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [], deltas: { [a.id]: 300, [b.id]: -300 },
    })
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })
})

describe('RoomManager', () => {
  it('创建后可按 id 取回', () => {
    const mgr = new RoomManager()
    const room = mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    expect(mgr.get(room.id)).toBe(room)
  })

  it('房间号为 6 位数字', () => {
    const mgr = new RoomManager()
    expect(mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} }).id)
      .toMatch(/^\d{6}$/)
  })

  it('移除后取不到', () => {
    const mgr = new RoomManager()
    const room = mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    mgr.remove(room.id)
    expect(mgr.get(room.id)).toBeUndefined()
  })

  it('list 返回全部房间', () => {
    const mgr = new RoomManager()
    mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    mgr.create({ gameId: 'highcard', ownerId: 'b', seats: 3, options: {} })
    expect(mgr.list()).toHaveLength(2)
  })
})
