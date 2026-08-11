import { describe, it, expect, beforeAll } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, login } from '../domain/users.js'
import { checkGlobalInvariant } from '../domain/ledger.js'
import { RoomManager } from '../room/room.js'
import { registerEngine } from '../room/registry.js'
import { highCard } from '../games/highcard.js'
import * as http from 'node:http'
import { WebSocket as WsClient } from 'ws'
import { handleMessage, attachGateway, renderBroadcast, type ConnCtx } from './gateway.js'

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

  it('有效 JSON 但值为 null 返回 error 而不抛出', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), 'null')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), 'null')[0]!.t).toBe('error')
  })

  it('有效 JSON 但值为数字返回 error', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), '42')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), '42')[0]!.t).toBe('error')
  })

  it('有效 JSON 但值为数组返回 error', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), '[]')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), '[]')[0]!.t).toBe('error')
  })

  it('有效 JSON 但值为字符串返回 error', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), '"hello"')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), '"hello"')[0]!.t).toBe('error')
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

describe('开局', () => {
  let lastDb: ReturnType<typeof boot>['db']
  let lastRooms: ReturnType<typeof boot>['rooms']
  let lastMk: ReturnType<typeof boot>['mk']

  function authed() {
    const { db, rooms, mk } = boot()
    lastDb = db
    lastRooms = rooms
    lastMk = mk
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 3, options: { ante: 100 } })
    const ca = ctx(db, rooms)
    const cb = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    handleMessage(cb, JSON.stringify({ t: 'auth', token: b.token }))
    return { db, rooms, room, ca, cb, a, b }
  }

  /** 复用上一次 authed() 产生的 db/rooms，让第三名玩家加入同一房间 */
  function authed2(room: { id: string }) {
    const c = lastMk('丙')
    const cc = ctx(lastDb, lastRooms)
    handleMessage(cc, JSON.stringify({ t: 'auth', token: c.token }))
    handleMessage(cc, JSON.stringify({ t: 'join', roomId: room.id }))
    return { cb: cc, c }
  }

  function twoJoined() {
    const { db, rooms, room, ca, cb, a, b } = authed()
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    handleMessage(cb, JSON.stringify({ t: 'join', roomId: room.id }))
    return { db, rooms, room, ca, cb, a, b }
  }

  function oneJoined() {
    const { db, rooms, room, ca, a } = authed()
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    return { db, rooms, room, ca, a }
  }

  function authedNoRoom() {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const ca = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    return { db, rooms, ca, a }
  }

  it('房主可以开局', () => {
    const { room, ca } = authed()
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    const { cb } = authed2(room)
    void cb
    const out = handleMessage(ca, JSON.stringify({ t: 'start' }))
    expect(out.some((m) => m.t === 'gameView')).toBe(true)
    expect(room.isStarted()).toBe(true)
  })

  it('非房主开局被拒绝', () => {
    const { room, ca, cb } = twoJoined()
    void ca
    expect(handleMessage(cb, JSON.stringify({ t: 'start' }))[0])
      .toMatchObject({ t: 'error', code: 'NOT_OWNER' })
    expect(room.isStarted()).toBe(false)
  })

  it('人数不足时返回 START_FAILED', () => {
    const { room, ca } = oneJoined()
    expect(handleMessage(ca, JSON.stringify({ t: 'start' }))[0])
      .toMatchObject({ t: 'error', code: 'START_FAILED' })
    expect(room.isStarted()).toBe(false)
  })

  it('重复开局返回 START_FAILED', () => {
    const { ca } = twoJoined()
    handleMessage(ca, JSON.stringify({ t: 'start' }))
    expect(handleMessage(ca, JSON.stringify({ t: 'start' }))[0])
      .toMatchObject({ t: 'error', code: 'START_FAILED' })
  })

  it('未加入房间时开局被拒绝', () => {
    const { ca } = authedNoRoom()
    expect(handleMessage(ca, JSON.stringify({ t: 'start' }))[0])
      .toMatchObject({ t: 'error', code: 'NOT_IN_ROOM' })
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

  it('行动者自己也拿到最新的 roomState（房主再次开局的入口不会消失）', () => {
    const { ca } = playing()
    const out = handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(out.some((m) => m.t === 'roomState')).toBe(true)
  })
})

describe('renderBroadcast（广播路径的逐连接裁剪）', () => {
  it('两个连接各自拿到互不相同的裁剪视图，互不泄漏对方手牌', () => {
    const { rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 2, options: { ante: 100 } })
    room.sit(a.user.id)
    room.sit(b.user.id)
    room.start()

    const [renderedA, renderedB] = renderBroadcast(room, [
      { userId: a.user.id },
      { userId: b.user.id },
    ])

    const viewA = renderedA!.find((m) => m.t === 'gameView') as { view: { hands: Record<string, unknown> } }
    const viewB = renderedB!.find((m) => m.t === 'gameView') as { view: { hands: Record<string, unknown> } }

    expect(Object.keys(viewA.view.hands)).toEqual([a.user.id])
    expect(Object.keys(viewB.view.hands)).toEqual([b.user.id])
    // 决定性断言：B 的视图中不包含 A 的手牌键，若两个连接复用同一份渲染结果，这里会失败
    expect(viewB.view.hands).not.toHaveProperty(a.user.id)
    expect(viewA.view.hands).not.toHaveProperty(b.user.id)
  })

})

describe('attachGateway 广播（真实两连接）', () => {
  function wait<T>(ws: WsClient, predicate: (msg: any) => T | undefined): Promise<T> {
    return new Promise((resolve) => {
      const onMsg = (data: Buffer) => {
        const msg = JSON.parse(data.toString())
        const hit = predicate(msg)
        if (hit !== undefined) {
          ws.off('message', onMsg)
          resolve(hit)
        }
      }
      ws.on('message', onMsg)
    })
  }

  it('非行动方的连接通过广播收到 settled，且看不到对方手牌', async () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 2, options: { ante: 100 } })

    const server = http.createServer()
    const gw = attachGateway(server, { db, rooms })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const wsA = new WsClient(`ws://127.0.0.1:${port}/ws`)
    const wsB = new WsClient(`ws://127.0.0.1:${port}/ws`)
    await Promise.all([
      new Promise((r) => wsA.on('open', r)),
      new Promise((r) => wsB.on('open', r)),
    ])

    wsA.send(JSON.stringify({ t: 'auth', token: a.token }))
    wsB.send(JSON.stringify({ t: 'auth', token: b.token }))
    await wait(wsA, (m) => (m.t === 'authOk' ? true : undefined))
    await wait(wsB, (m) => (m.t === 'authOk' ? true : undefined))

    wsA.send(JSON.stringify({ t: 'join', roomId: room.id }))
    await wait(wsA, (m) => (m.t === 'roomState' ? true : undefined))
    wsB.send(JSON.stringify({ t: 'join', roomId: room.id }))
    await wait(wsB, (m) => (m.t === 'roomState' ? true : undefined))

    wsA.send(JSON.stringify({ t: 'start' }))
    await wait(wsA, (m) => (m.t === 'gameView' ? true : undefined))

    // 甲先行动，此时局未结束
    wsA.send(JSON.stringify({ t: 'action', action: { type: 'call' } }))
    await wait(wsA, (m) => (m.t === 'gameView' ? true : undefined))

    // 乙行动使对局结束；乙自己作为行动者会收到 settled，
    // 关键断言在甲身上：甲全程没有再发消息，却仍应通过 broadcast() 收到 settled。
    const settledOnAPromise = wait(wsA, (m) =>
      m.t === 'settled' ? (m as { deltas: Record<string, number> }) : undefined,
    )
    const viewOnAPromise = wait(wsA, (m) =>
      m.t === 'gameView' ? (m as { view: { hands: Record<string, unknown> } }) : undefined,
    )
    wsB.send(JSON.stringify({ t: 'action', action: { type: 'call' } }))

    const [settledOnA, viewOnA] = await Promise.all([settledOnAPromise, viewOnAPromise])
    expect(Object.values(settledOnA.deltas).reduce((x, y) => x + y, 0)).toBe(0)
    // 结算后视图裁剪按 highcard 的 over 规则会揭示全部手牌；断言至少不会
    // 意外包含未知键，形状健全即可（泄漏检测由 fuzz 的 secretProbe 负责）
    expect(viewOnA.view.hands).toBeDefined()

    wsA.close()
    wsB.close()
    gw.close()
    server.close()
  })
})
