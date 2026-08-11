import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  registerUser, login, logout, verifyToken, createInviteCode, type User,
} from '../domain/users.js'
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  listPendingRequests, listFriends,
} from '../domain/friends.js'
import { createLoan, repayLoan, listLoans, netWorth } from '../domain/loans.js'
import { claimDaily, ranking } from '../domain/ranking.js'
import { getEngine } from '../room/registry.js'
import type { RoomManager } from '../room/room.js'

export interface Deps {
  db: DatabaseSync
  rooms: RoomManager
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice(7)
}

export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false })
  const { db, rooms } = deps

  const requireUser = (req: FastifyRequest): User => {
    const token = bearer(req)
    const user = token ? verifyToken(db, token) : null
    if (!user) {
      const err = new Error('未登录') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }
    return user
  }

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as unknown as { statusCode?: number }).statusCode ?? 400
    const message = (err as unknown as { message?: string }).message ?? 'Internal error'
    reply.status(status).send({ error: message })
  })

  app.post('/api/register', async (req) => {
    const body = req.body as { nickname: string; password: string; inviteCode: string }
    const user = registerUser(db, body)
    const r = login(db, body.nickname, body.password)!
    return { user, token: r.token }
  })

  app.post('/api/login', async (req, reply) => {
    const body = req.body as { nickname: string; password: string }
    const r = login(db, body.nickname, body.password)
    if (!r) return reply.status(401).send({ error: '昵称或密码错误' })
    return { user: r.user, token: r.token }
  })

  app.post('/api/logout', async (req) => {
    requireUser(req)
    const token = bearer(req)!
    logout(db, token)
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    const user = requireUser(req)
    return { user, netWorth: netWorth(db, user.id) }
  })

  app.post('/api/invite', async (req) => {
    const user = requireUser(req)
    return { code: createInviteCode(db, user.id) }
  })

  app.get('/api/friends', async (req) => {
    const user = requireUser(req)
    return { friends: listFriends(db, user.id), pending: listPendingRequests(db, user.id) }
  })

  app.post('/api/friends/request', async (req) => {
    const user = requireUser(req)
    const { toUserId } = req.body as { toUserId: string }
    return { id: sendFriendRequest(db, user.id, toUserId) }
  })

  app.post('/api/friends/accept', async (req) => {
    const user = requireUser(req)
    const { requestId } = req.body as { requestId: string }
    acceptFriendRequest(db, requestId, user.id)
    return { ok: true }
  })

  app.post('/api/friends/reject', async (req) => {
    const user = requireUser(req)
    const { requestId } = req.body as { requestId: string }
    rejectFriendRequest(db, requestId, user.id)
    return { ok: true }
  })

  app.get('/api/users/search', async (req) => {
    const user = requireUser(req)
    const q = (req.query as { q?: string }).q ?? ''
    if (q.trim() === '') return { users: [] }
    const users = db
      .prepare('SELECT id, nickname FROM users WHERE nickname LIKE ? AND id <> ? LIMIT 20')
      .all(`%${q}%`, user.id)
    return { users }
  })

  app.get('/api/loans', async (req) => {
    const user = requireUser(req)
    return listLoans(db, user.id)
  })

  app.post('/api/loans', async (req) => {
    const user = requireUser(req)
    const { borrowerId, amount } = req.body as { borrowerId: string; amount: number }
    return { loan: createLoan(db, user.id, borrowerId, amount) }
  })

  app.post('/api/loans/repay', async (req) => {
    const user = requireUser(req)
    const { loanId, amount } = req.body as { loanId: string; amount: number }
    return { loan: repayLoan(db, loanId, user.id, amount) }
  })

  app.post('/api/daily', async (req) => {
    const user = requireUser(req)
    return claimDaily(db, user.id)
  })

  app.get('/api/ranking', async (req) => {
    requireUser(req)
    return { ranking: ranking(db) }
  })

  app.post('/api/rooms', async (req) => {
    const user = requireUser(req)
    const { gameId, seats, options } = req.body as {
      gameId: string
      seats: number
      options: Record<string, unknown>
    }
    const engine = getEngine(gameId) // 未注册则抛错，交给错误处理器转 400
    // 通过引擎契约的可选钩子校验 options：路由层不认识任何具体玩法，
    // 只认识 Engine 接口，因此新增玩法无需改动这里。必须在任何状态
    // （RoomManager 里的房间、rooms 表里的行）被创建之前拒绝，否则会留下孤儿房间。
    engine.validateOptions?.(options ?? {})
    const room = rooms.create({ gameId, ownerId: user.id, seats, options: options ?? {} })
    db.prepare('INSERT INTO rooms (id, game_id, owner_id, options, created_at) VALUES (?,?,?,?,?)')
      .run(room.id, gameId, user.id, JSON.stringify(options ?? {}), Date.now())
    return { roomId: room.id }
  })

  app.get('/api/rooms', async (req) => {
    requireUser(req)
    return {
      rooms: rooms.list().map((r) => ({
        id: r.id,
        gameId: r.gameId,
        started: r.isStarted(),
        seats: r.seatInfos(),
      })),
    }
  })

  return app
}
