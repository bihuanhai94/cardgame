import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage } from '@cardgame/shared'
import { GameSocket } from './socket.js'

class FakeWs {
  static instances: FakeWs[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null

  constructor(public url: string) {
    FakeWs.instances.push(this)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  // 进入 CLOSING（真实 WebSocket 在 close() 被调用后、onclose 触发前会经过此状态），
  // 不触发 onclose —— 用于复现 authed 仍为 true 但已不可写的窗口期。
  beginClosing() { this.readyState = 2 }
  emit(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

function make(onMessage = vi.fn()) {
  FakeWs.instances = []
  const s = new GameSocket('ws://x/ws', {
    token: 'T',
    onMessage,
    wsFactory: (url) => new FakeWs(url) as unknown as WebSocket,
  })
  s.connect()
  return { s, onMessage, last: () => FakeWs.instances[FakeWs.instances.length - 1]! }
}

describe('GameSocket', () => {
  it('连接建立后自动发送 auth', () => {
    const { last } = make()
    last().open()
    expect(JSON.parse(last().sent[0]!)).toEqual({ t: 'auth', token: 'T' })
  })

  it('收到 authOk 后回放待发消息', () => {
    const { s, last } = make()
    s.send({ t: 'join', roomId: '123456' })
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    const types = last().sent.map((x) => JSON.parse(x).t)
    expect(types).toEqual(['auth', 'join'])
  })

  it('未连接时发送的消息进入队列而非丢弃', () => {
    const { s, last } = make()
    s.send({ t: 'ping' })
    expect(last().sent).toHaveLength(0)
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    expect(last().sent.map((x) => JSON.parse(x).t)).toContain('ping')
  })

  it('转发服务端消息给 onMessage', () => {
    const { onMessage, last } = make()
    last().open()
    last().emit({ t: 'pong' })
    expect(onMessage).toHaveBeenCalledWith({ t: 'pong' })
  })

  it('断线后按退避重连', async () => {
    vi.useFakeTimers()
    const { last } = make()
    last().open()
    last().close()
    expect(FakeWs.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWs.instances).toHaveLength(2)
    FakeWs.instances[1]!.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWs.instances).toHaveLength(3)
    vi.useRealTimers()
  })

  it('重连后自动重新加入原房间', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    s.send({ t: 'join', roomId: '654321' })
    last().close()
    await vi.advanceTimersByTimeAsync(1000)
    const fresh = last()
    fresh.open()
    fresh.emit({ t: 'authOk', userId: 'u1' })
    const joins = fresh.sent.map((x) => JSON.parse(x)).filter((m) => m.t === 'join')
    expect(joins[0]).toEqual({ t: 'join', roomId: '654321' })
    vi.useRealTimers()
  })

  it('掉线期间排队的 action 不应压制重连后的补发 join', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    s.send({ t: 'join', roomId: '654321' })
    last().close()
    // 掉线期间用户操作，进入队列
    s.send({ t: 'action', action: { type: 'call' } })
    await vi.advanceTimersByTimeAsync(1000)
    const fresh = last()
    fresh.open()
    fresh.emit({ t: 'authOk', userId: 'u1' })
    const types = fresh.sent.map((x) => JSON.parse(x).t)
    expect(types).toEqual(['auth', 'join', 'action'])
    vi.useRealTimers()
  })

  it('CLOSING 窗口期（onclose 尚未触发、authed 仍为 true）发送的消息不能被丢弃，应入队并在重连后送达', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    s.send({ t: 'join', roomId: '654321' })
    const dying = last()
    dying.beginClosing() // readyState = 2，onclose 尚未触发，authed 仍为 true
    s.send({ t: 'action', action: { type: 'call' } })
    // 消息不应被写入这个（正在关闭的）socket
    expect(dying.sent.some((x) => JSON.parse(x).t === 'action')).toBe(false)

    // 随后真正关闭并重连
    dying.close()
    await vi.advanceTimersByTimeAsync(1000)
    const fresh = last()
    fresh.open()
    fresh.emit({ t: 'authOk', userId: 'u1' })
    const types = fresh.sent.map((x) => JSON.parse(x).t)
    // 消息必须在新连接上送达，且晚于补发的 join
    expect(types).toEqual(['auth', 'join', 'action'])
    vi.useRealTimers()
  })

  it('主动 close 后不再重连', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    s.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeWs.instances).toHaveLength(1)
    vi.useRealTimers()
  })
})
