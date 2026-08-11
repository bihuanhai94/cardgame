import type { ClientMessage, ServerMessage } from '@cardgame/shared'

export interface GameSocketOpts {
  token: string
  onMessage: (msg: ServerMessage) => void
  wsFactory?: (url: string) => WebSocket
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

export class GameSocket {
  private ws: WebSocket | null = null
  private queue: ClientMessage[] = []
  private authed = false
  private closedByUser = false
  private attempt = 0
  private currentRoomId: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private url: string, private opts: GameSocketOpts) {}

  connect(): void {
    this.closedByUser = false
    const factory = this.opts.wsFactory ?? ((u: string) => new WebSocket(u))
    const ws = factory(this.url)
    this.ws = ws
    this.authed = false

    ws.onopen = () => {
      this.attempt = 0
      ws.send(JSON.stringify({ t: 'auth', token: this.opts.token } satisfies ClientMessage))
    }

    ws.onmessage = (e: MessageEvent | { data: string }) => {
      const msg = JSON.parse(String((e as { data: string }).data)) as ServerMessage
      if (msg.t === 'authOk') {
        this.authed = true
        const pending = this.queue
        this.queue = []
        // 重连后必须重新入房（服务端的房间归属是每连接的）。
        // 但若队列里已有 join，就不要再补发一条 —— 按队列是否为空来判断是错的：
        // 掉线期间任何一条 action 入队都会让补发被跳过，人就被留在房间外面了。
        const queuedJoin = pending.some((m) => m.t === 'join')
        if (this.currentRoomId && !queuedJoin) {
          this.rawSend({ t: 'join', roomId: this.currentRoomId })
        }
        for (const m of pending) this.rawSend(m)
      }
      this.opts.onMessage(msg)
    }

    ws.onclose = () => {
      this.authed = false
      if (this.closedByUser) return
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!
      this.attempt++
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  private rawSend(msg: ClientMessage): void {
    // 防御性检查：真实 WebSocket 在 CLOSING/CLOSED 状态下 send() 会抛异常；
    // OPEN === 1，直接用数值常量以避免依赖全局 WebSocket（测试用 FakeWs 无此静态属性）。
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  send(msg: ClientMessage): void {
    if (msg.t === 'join') this.currentRoomId = msg.roomId
    if (msg.t === 'leave') this.currentRoomId = null
    if (this.authed && this.ws) {
      this.rawSend(msg)
    } else {
      this.queue.push(msg)
    }
  }

  close(): void {
    this.closedByUser = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}
