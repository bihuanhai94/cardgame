import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode } from '../domain/users.js'
import { RoomManager } from '../room/room.js'
import { registerEngine } from '../room/registry.js'
import { highCard } from '../games/highcard.js'
import { buildApp } from './routes.js'

registerEngine(highCard)

function boot() {
  const db = openTestDb()
  const app = buildApp({ db, rooms: new RoomManager() })
  return { db, app }
}

async function newUser(app: ReturnType<typeof buildApp>, db: ReturnType<typeof openTestDb>, nickname: string) {
  const code = createInviteCode(db, null)
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { nickname, password: 'pw123456', inviteCode: code },
  })
  return res.json() as { user: { id: string }; token: string }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('注册与登录', () => {
  it('注册返回 token', async () => {
    const { db, app } = boot()
    const r = await newUser(app, db, '甲')
    expect(r.token).toBeTruthy()
  })

  it('邀请码无效时返回 400', async () => {
    const { app } = boot()
    const res = await app.inject({
      method: 'POST', url: '/api/register',
      payload: { nickname: '甲', password: 'pw123456', inviteCode: 'BAD' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/邀请码无效/)
  })

  it('登录成功返回 token', async () => {
    const { db, app } = boot()
    await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/login', payload: { nickname: '甲', password: 'pw123456' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBeTruthy()
  })

  it('密码错误返回 401', async () => {
    const { db, app } = boot()
    await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/login', payload: { nickname: '甲', password: 'wrongpw' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('鉴权', () => {
  it('无 token 访问 /api/me 返回 401', async () => {
    const { app } = boot()
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)
  })

  it('带 token 返回用户与净资产', async () => {
    const { db, app } = boot()
    const u = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().netWorth.net).toBe(10000)
  })

  it('登出后 token 失效', async () => {
    const { db, app } = boot()
    const u = await newUser(app, db, '甲')
    await app.inject({ method: 'POST', url: '/api/logout', headers: auth(u.token) })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })).statusCode).toBe(401)
  })
})

describe('好友接口', () => {
  it('完整走通请求与接受', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const b = await newUser(app, db, '乙')

    const req = await app.inject({
      method: 'POST', url: '/api/friends/request',
      headers: auth(a.token), payload: { toUserId: b.user.id },
    })
    expect(req.statusCode).toBe(200)

    const pending = await app.inject({ method: 'GET', url: '/api/friends', headers: auth(b.token) })
    expect(pending.json().pending).toHaveLength(1)

    await app.inject({
      method: 'POST', url: '/api/friends/accept',
      headers: auth(b.token), payload: { requestId: req.json().id },
    })
    const list = await app.inject({ method: 'GET', url: '/api/friends', headers: auth(a.token) })
    expect(list.json().friends).toHaveLength(1)
  })

  it('搜索用户按昵称匹配', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    await newUser(app, db, '乙丙')
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=乙', headers: auth(a.token) })
    expect(res.json().users).toHaveLength(1)
  })

  it('搜索结果不含自己', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=甲', headers: auth(a.token) })
    expect(res.json().users).toHaveLength(0)
  })
})

describe('借条接口', () => {
  it('非好友借款返回 400', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const b = await newUser(app, db, '乙')
    const res = await app.inject({
      method: 'POST', url: '/api/loans',
      headers: auth(a.token), payload: { borrowerId: b.user.id, amount: 100 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/好友|7 天/)
  })

  it('借条列表初始为空', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/loans', headers: auth(a.token) })
    expect(res.json()).toEqual({ asLender: [], asBorrower: [] })
  })
})

describe('签到与排行', () => {
  it('首次签到成功、重复签到返回未领取', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    expect((await app.inject({ method: 'POST', url: '/api/daily', headers: auth(a.token) })).json().claimed).toBe(true)
    expect((await app.inject({ method: 'POST', url: '/api/daily', headers: auth(a.token) })).json().claimed).toBe(false)
  })

  it('排行榜返回净资产字段', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/ranking', headers: auth(a.token) })
    expect(res.json().ranking[0].net).toBe(10000)
  })
})

describe('房间接口', () => {
  it('创建房间返回 6 位房号', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: 'highcard', seats: 3, options: { ante: 100 } },
    })
    expect(res.json().roomId).toMatch(/^\d{6}$/)
  })

  it('未知玩法返回 400', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: '不存在', seats: 3, options: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('房间列表包含已创建房间', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: 'highcard', seats: 3, options: {} },
    })
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: auth(a.token) })
    expect(res.json().rooms).toHaveLength(1)
  })
})
