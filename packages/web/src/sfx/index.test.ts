import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * jsdom has no WebAudio: `window.AudioContext` is undefined there.
 * We install a counting stub so we can assert "no AudioContext was
 * constructed" from outside the module, without touching its internals.
 */
class StubAudioContext {
  static instances = 0
  state = 'running'
  destination = {}
  constructor() {
    StubAudioContext.instances++
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, Q: { value: 0 }, connect: vi.fn() }
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { getChannelData: () => new Float32Array(length), length, sampleRate }
  }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  }
  resume() {
    return Promise.resolve()
  }
  get currentTime() {
    return 0
  }
}

function installStub() {
  StubAudioContext.instances = 0
  ;(globalThis as unknown as { AudioContext: typeof StubAudioContext }).AudioContext = StubAudioContext
}

function removeAudioContext() {
  delete (globalThis as { AudioContext?: unknown }).AudioContext
}

describe('SFX', () => {
  beforeEach(() => {
    vi.resetModules()
    removeAudioContext()
  })

  afterEach(() => {
    removeAudioContext()
  })

  it('未启用时不创建 AudioContext（关闭后调用各音效均不构造）', async () => {
    installStub()
    const { SFX } = await import('./index.js')
    SFX.toggle() // enabled starts true -> now false
    expect(SFX.enabled).toBe(false)

    SFX.chip()
    SFX.chips(3)
    SFX.deal()
    SFX.turn()
    SFX.win()
    SFX.fold()

    expect(StubAudioContext.instances).toBe(0)
  })

  it('toggle() 切换 enabled', async () => {
    installStub()
    const { SFX } = await import('./index.js')
    const initial = SFX.enabled
    const after = SFX.toggle()
    expect(after).toBe(!initial)
    expect(SFX.enabled).toBe(!initial)
    const again = SFX.toggle()
    expect(again).toBe(initial)
    expect(SFX.enabled).toBe(initial)
  })

  it('静音时每个音效均可调用而不抛异常，且不创建任何节点/上下文', async () => {
    // no AudioContext installed at all: if the module tried to construct
    // one while muted, this would throw (AudioContext is not defined).
    const { SFX } = await import('./index.js')
    SFX.toggle() // -> disabled
    expect(SFX.enabled).toBe(false)

    expect(() => SFX.chip()).not.toThrow()
    expect(() => SFX.chips(5)).not.toThrow()
    expect(() => SFX.deal()).not.toThrow()
    expect(() => SFX.turn()).not.toThrow()
    expect(() => SFX.win()).not.toThrow()
    expect(() => SFX.fold()).not.toThrow()
  })

  it('导入模块本身不会构造 AudioContext', async () => {
    installStub()
    await import('./index.js')
    expect(StubAudioContext.instances).toBe(0)
  })
})
