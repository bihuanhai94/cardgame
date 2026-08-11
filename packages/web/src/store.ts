import { create } from 'zustand'
import type { SeatInfo, ServerMessage } from '@cardgame/shared'
import { ApiClient } from './net/api.js'
import { GameSocket } from './net/socket.js'

export interface NetWorth {
  balance: number
  receivable: number
  payable: number
  net: number
}

export interface User {
  id: string
  nickname: string
}

interface State {
  api: ApiClient
  socket: GameSocket | null
  token: string | null
  user: User | null
  netWorth: NetWorth | null
  roomId: string | null
  ownerId: string | null
  started: boolean
  seats: SeatInfo[]
  view: unknown
  lastSettlement: Record<string, number> | null
  error: string | null

  reset(): void
  applyServerMessage(msg: ServerMessage): void
  register(nickname: string, password: string, inviteCode: string): Promise<void>
  login(nickname: string, password: string): Promise<void>
  logout(): Promise<void>
  refreshMe(): Promise<void>
  connect(): void
  joinRoom(roomId: string): void
  act(action: unknown): void
  startGame(): void
}

const api = new ApiClient('')

// 防御性包装：某些运行环境（如带 --experimental-sqlite 标志的 Node 测试进程）会提供一个
// 残缺的全局 localStorage（无 getItem/setItem 方法），与浏览器环境不一致。
// 用可选调用兜底，避免测试进程在 import 阶段直接抛错。
function readToken(): string | null {
  return localStorage.getItem?.('token') ?? null
}
function writeToken(token: string | null): void {
  if (token === null) localStorage.removeItem?.('token')
  else localStorage.setItem?.('token', token)
}

export const useStore = create<State>((set, get) => ({
  api,
  socket: null,
  token: readToken(),
  user: null,
  netWorth: null,
  roomId: null,
  ownerId: null,
  started: false,
  seats: [],
  view: null,
  lastSettlement: null,
  error: null,

  reset() {
    set({
      user: null, netWorth: null, roomId: null, ownerId: null, started: false, seats: [],
      view: null, lastSettlement: null, error: null,
    })
  },

  applyServerMessage(msg) {
    switch (msg.t) {
      case 'gameView':
        set({ view: msg.view, error: null })
        break
      case 'roomState':
        set({
          roomId: msg.roomId || null,
          ownerId: msg.ownerId || null,
          started: msg.started,
          seats: msg.seats,
          error: null,
        })
        break
      case 'settled':
        set({ lastSettlement: msg.deltas })
        // 结算后异步刷新净资产；网络失败不应让调用方（如测试环境）崩溃或产生未处理拒绝。
        get().refreshMe().catch(() => {})
        break
      case 'error':
        set({ error: msg.message })
        break
      default:
        break
    }
  },

  async register(nickname, password, inviteCode) {
    const r = await api.post<{ user: User; token: string }>('/api/register', {
      nickname, password, inviteCode,
    })
    writeToken(r.token)
    api.setToken(r.token)
    set({ token: r.token, user: r.user })
    get().connect()
    await get().refreshMe()
  },

  async login(nickname, password) {
    const r = await api.post<{ user: User; token: string }>('/api/login', { nickname, password })
    writeToken(r.token)
    api.setToken(r.token)
    set({ token: r.token, user: r.user })
    get().connect()
    await get().refreshMe()
  },

  async logout() {
    await api.post('/api/logout')
    writeToken(null)
    api.setToken(null)
    get().socket?.close()
    set({ token: null, socket: null })
    get().reset()
  },

  async refreshMe() {
    const r = await api.get<{ user: User; netWorth: NetWorth }>('/api/me')
    set({ user: r.user, netWorth: r.netWorth })
  },

  connect() {
    const token = get().token
    if (!token || get().socket) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new GameSocket(`${proto}://${location.host}/ws`, {
      token,
      onMessage: (m) => get().applyServerMessage(m),
    })
    socket.connect()
    set({ socket })
  },

  joinRoom(roomId) {
    get().socket?.send({ t: 'join', roomId })
  },

  act(action) {
    get().socket?.send({ t: 'action', action })
  },

  startGame() {
    get().socket?.send({ t: 'start' })
  },
}))
