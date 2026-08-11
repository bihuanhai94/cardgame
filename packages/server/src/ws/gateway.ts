import type * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { DatabaseSync } from 'node:sqlite'
import type { ClientMessage, ServerMessage } from '@cardgame/shared'
import { verifyToken, getUser } from '../domain/users.js'
import { settleToLedger, type RoomManager } from '../room/room.js'

export interface ConnCtx {
  db: DatabaseSync
  rooms: RoomManager
  userId: string | null
  roomId: string | null
}

function err(code: string, message: string): ServerMessage {
  return { t: 'error', code, message }
}

/**
 * 处理一条客户端消息，返回应下发给「本连接」的消息列表。
 * 需要广播给他人的部分由 attachGateway 负责重新裁剪后分发。
 */
export function handleMessage(ctx: ConnCtx, raw: string): ServerMessage[] {
  let msg: ClientMessage
  try {
    msg = JSON.parse(raw) as ClientMessage
  } catch {
    return [err('BAD_JSON', '消息不是合法 JSON')]
  }

  if (typeof msg !== 'object' || msg === null) {
    return [err('BAD_JSON', '消息必须是一个对象')]
  }

  if (msg.t === 'auth') {
    const user = verifyToken(ctx.db, msg.token)
    if (!user) return [err('BAD_TOKEN', '登录凭证无效')]
    ctx.userId = user.id
    return [{ t: 'authOk', userId: user.id }]
  }

  if (ctx.userId === null) return [err('UNAUTHENTICATED', '请先完成鉴权')]

  switch (msg.t) {
    case 'ping':
      return [{ t: 'pong' }]

    case 'join': {
      const room = ctx.rooms.get(msg.roomId)
      if (!room) return [err('ROOM_NOT_FOUND', '房间不存在')]
      if (!room.players().includes(ctx.userId)) {
        try {
          room.sit(ctx.userId)
        } catch (e) {
          return [err('JOIN_FAILED', (e as Error).message)]
        }
      } else {
        room.setOnline(ctx.userId, true)
      }
      const user = getUser(ctx.db, ctx.userId)
      if (user) room.setNickname(user.id, user.nickname)
      ctx.roomId = room.id
      const out: ServerMessage[] = [
        { t: 'roomState', roomId: room.id, ownerId: room.ownerId, seats: room.seatInfos(), started: room.isStarted() },
      ]
      if (room.isStarted()) out.push({ t: 'gameView', view: room.viewFor(ctx.userId) })
      return out
    }

    case 'leave': {
      if (ctx.roomId) {
        ctx.rooms.get(ctx.roomId)?.leave(ctx.userId)
        ctx.roomId = null
      }
      return [{ t: 'roomState', roomId: '', ownerId: '', seats: [], started: false }]
    }

    case 'start': {
      if (!ctx.roomId) return [err('NOT_IN_ROOM', '你不在任何房间中')]
      const room = ctx.rooms.get(ctx.roomId)
      if (!room) return [err('ROOM_NOT_FOUND', '房间不存在')]
      if (room.ownerId !== ctx.userId) return [err('NOT_OWNER', '只有房主可以开局')]
      try {
        room.start()
      } catch (e) {
        return [err('START_FAILED', (e as Error).message)]
      }
      return [
        { t: 'roomState', roomId: room.id, ownerId: room.ownerId, seats: room.seatInfos(), started: room.isStarted() },
        { t: 'gameView', view: room.viewFor(ctx.userId) },
      ]
    }

    case 'action': {
      if (!ctx.roomId) return [err('NOT_IN_ROOM', '你不在任何房间中')]
      const room = ctx.rooms.get(ctx.roomId)
      if (!room) return [err('ROOM_NOT_FOUND', '房间不存在')]

      let events
      try {
        events = room.act(ctx.userId, msg.action).events
      } catch (e) {
        return [err('ILLEGAL_ACTION', (e as Error).message)]
      }

      const out: ServerMessage[] = [
        { t: 'events', events },
        { t: 'gameView', view: room.viewFor(ctx.userId) },
      ]

      const settlement = room.takeSettlement()
      if (settlement) {
        settleToLedger(ctx.db, settlement)
        out.push({ t: 'settled', deltas: settlement.deltas })
      }
      return out
    }

    default:
      return [err('UNKNOWN_TYPE', '未知的消息类型')]
  }
}

export function attachGateway(
  server: http.Server,
  deps: { db: DatabaseSync; rooms: RoomManager },
): { close(): void } {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const conns = new Map<WebSocket, ConnCtx>()

  const broadcast = (roomId: string, except: WebSocket): void => {
    const room = deps.rooms.get(roomId)
    if (!room) return
    for (const [sock, c] of conns) {
      if (sock === except || c.roomId !== roomId || sock.readyState !== WebSocket.OPEN) continue
      // 每个连接单独裁剪，绝不复用他人视图
      sock.send(JSON.stringify({ t: 'gameView', view: room.viewFor(c.userId) }))
      sock.send(JSON.stringify({
        t: 'roomState', roomId, ownerId: room.ownerId, seats: room.seatInfos(), started: room.isStarted(),
      }))
    }
  }

  wss.on('connection', (sock) => {
    const ctx: ConnCtx = { db: deps.db, rooms: deps.rooms, userId: null, roomId: null }
    conns.set(sock, ctx)

    sock.on('message', (data) => {
      try {
        const before = ctx.roomId
        const out = handleMessage(ctx, data.toString())
        for (const m of out) sock.send(JSON.stringify(m))
        const roomId = ctx.roomId ?? before
        if (roomId) broadcast(roomId, sock)
      } catch (e) {
        sock.send(JSON.stringify({ t: 'error', code: 'INTERNAL', message: '服务器内部错误' }))
      }
    })

    sock.on('close', () => {
      if (ctx.roomId && ctx.userId) {
        deps.rooms.get(ctx.roomId)?.setOnline(ctx.userId, false)
        broadcast(ctx.roomId, sock)
      }
      conns.delete(sock)
    })
  })

  return { close: () => wss.close() }
}
