import { describe, it, expect, beforeAll } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, login } from '../domain/users.js'
import { checkGlobalInvariant } from '../domain/ledger.js'
import { RoomManager } from '../room/room.js'
import { registerEngine } from '../room/registry.js'
import { highCard } from '../games/highcard.js'
import { handleMessage, type ConnCtx } from './gateway.js'

beforeAll(() => registerEngine(highCard))

function boot() {
  const db = openTestDb()
  const rooms = new RoomManager()
  const mk = (n: string) => {
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
    return login(db, n, 'pw123456')!
  }
  return { db, rooms, mk }
}

function ctx(db: ReturnType<typeof openTestDb>, rooms: RoomManager): ConnCtx {
  return { db, rooms, userId: null, roomId: null }
}

describe('鉴权消息', () => {
  it('有效 token 返回 authOk', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    const out = handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(out[0]).toEqual({ t: 'authOk', userId: a.user.id })
    expect(c.userId).toBe(a.user.id)
  })

  it('无效 token 返回 error', () => {
    const { db, rooms } = boot()
    const out = handleMessage(ctx(db, rooms), JSON.stringify({ t: 'auth', token: 'bad' }))
    expect(out[0]!.t).toBe('error')
  })

  it('未鉴权时其他消息被拒绝', () => {
    const { db, rooms } = boot()
    const out = handleMessage(ctx(db, rooms), JSON.stringify({ t: 'join', roomId: '123456' }))
    expect(out[0]).toMatchObject({ t: 'error', code: 'UNAUTHENTICATED' })
  })

  it('非法 JSON 返回 error 而不抛出', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), '{ 不是 json')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), '{ 不是 json')[0]!.t).toBe('error')
  })

  it('未知消息类型返回 error', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(handleMessage(c, JSON.stringify({ t: '未知' }))[0]!.t).toBe('error')
  })
})

describe('加入房间', () => {
  function authed() {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 3, options: { ante: 100 } })
    const ca = ctx(db, rooms)
    const cb = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    handleMessage(cb, JSON.stringify({ t: 'auth', token: b.token }))
    return { db, rooms, room, ca, cb, a, b }
  }

  it('加入后返回房间状态', () => {
    const { room, ca } = authed()
    const out = handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    expect(out.find((m) => m.t === 'roomState')).toBeTruthy()
    expect(ca.roomId).toBe(room.id)
  })

  it('加入不存在的房间返回 error', () => {
    const { ca } = authed()
    const out = handleMessage(ca, JSON.stringify({ t: 'join', roomId: '000000' }))
    expect(out[0]).toMatchObject({ t: 'error', code: 'ROOM_NOT_FOUND' })
  })

  it('离开后 roomId 清空', () => {
    const { room, ca } = authed()
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    handleMessage(ca, JSON.stringify({ t: 'leave' }))
    expect(ca.roomId).toBeNull()
  })

  it('ping 回 pong', () => {
    const { ca } = authed()
    expect(handleMessage(ca, JSON.stringify({ t: 'ping' }))[0]).toEqual({ t: 'pong' })
  })
})

describe('对局动作', () => {
  function playing() {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 2, options: { ante: 100 } })
    const ca = ctx(db, rooms)
    const cb = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    handleMessage(cb, JSON.stringify({ t: 'auth', token: b.token }))
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    handleMessage(cb, JSON.stringify({ t: 'join', roomId: room.id }))
    room.start()
    return { db, room, ca, cb, a, b }
  }

  it('动作返回事件与自己的裁剪视图', () => {
    const { ca } = playing()
    const out = handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(out.some((m) => m.t === 'events')).toBe(true)
    const view = out.find((m) => m.t === 'gameView') as { view: { hands: Record<string, unknown> } }
    expect(Object.keys(view.view.hands)).toHaveLength(1)
  })

  it('未加入房间时行动返回 error', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(handleMessage(c, JSON.stringify({ t: 'action', action: { type: 'call' } }))[0])
      .toMatchObject({ t: 'error', code: 'NOT_IN_ROOM' })
  })

  it('非法动作返回 error 且不影响对局', () => {
    const { ca, room } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const out = handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(out[0]!.t).toBe('error')
    expect(room.isStarted()).toBe(true)
  })

  it('对局结束后下发 settled 并落账', () => {
    const { db, ca, cb, a, b } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const out = handleMessage(cb, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const settled = out.find((m) => m.t === 'settled') as { deltas: Record<string, number> }
    expect(settled).toBeTruthy()
    expect(Object.values(settled.deltas).reduce((x, y) => x + y, 0)).toBe(0)

    const row = db.prepare('SELECT COUNT(*) AS n FROM match_records').get() as { n: number }
    expect(row.n).toBe(1)
    void a; void b
  })

  it('结算后账本仍满足全局零和', () => {
    const { db, ca, cb } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    handleMessage(cb, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })
})
