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
        if (this.currentRoomId && this.queue.length === 0) {
          this.rawSend({ t: 'join', roomId: this.currentRoomId })
        }
        const pending = this.queue
        this.queue = []
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
    this.ws?.send(JSON.stringify(msg))
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
