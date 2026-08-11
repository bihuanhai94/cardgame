import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * jsdom has no WebAudio: `window.AudioContext` is undefined there.
 * We install a counting stub so we can assert "no AudioContext was
 * constructed" from outside the module, without touching its internals.
 */
class StubAudioContext {
  static instances = 0
  /** count of every audio-graph node actually created, across all instances */
  static nodesCreated = 0
  state = 'running'
  destination = {}
  constructor() {
    StubAudioContext.instances++
  }
  createGain() {
    StubAudioContext.nodesCreated++
    return { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  }
  createBiquadFilter() {
    StubAudioContext.nodesCreated++
    return { type: '', frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, Q: { value: 0 }, connect: vi.fn() }
  }
  createBufferSource() {
    StubAudioContext.nodesCreated++
    return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { getChannelData: () => new Float32Array(length), length, sampleRate }
  }
  createOscillator() {
    StubAudioContext.nodesCreated++
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
  StubAudioContext.nodesCreated = 0
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

  it('从关到开的 toggle() 构造且仅构造一次 AudioContext；再 toggle() 打开不会重复构造', async () => {
    // toggle() is itself a user gesture, exactly the moment browsers permit
    // audio-context creation — so constructing here (the `if (on) ctx()`
    // branch) is intentional, not a laziness violation. This test pins
    // that behaviour down.
    installStub()
    const { SFX } = await import('./index.js')
    expect(SFX.enabled).toBe(true) // fresh module: starts enabled

    SFX.toggle() // on -> off: must not construct
    expect(SFX.enabled).toBe(false)
    expect(StubAudioContext.instances).toBe(0)

    SFX.toggle() // off -> on: must construct exactly once
    expect(SFX.enabled).toBe(true)
    expect(StubAudioContext.instances).toBe(1)

    SFX.toggle() // on -> off again
    SFX.toggle() // off -> on again: singleton context is reused, no 2nd construction
    expect(SFX.enabled).toBe(true)
    expect(StubAudioContext.instances).toBe(1)
  })

  it('静音时每个音效均可调用而不抛异常（不会触及 ctx()）', async () => {
    // no AudioContext installed at all: if the module tried to construct
    // one while muted, this would throw (AudioContext is not defined).
    // This proves the muted path never reaches ctx() — see the next test
    // for the stronger, direct claim that zero nodes are created.
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

  it('静音时不创建任何音频节点（直接计数 createGain/createOscillator/createBufferSource/createBiquadFilter 调用次数）', async () => {
    installStub()
    const { SFX } = await import('./index.js')
    SFX.toggle() // -> disabled
    expect(SFX.enabled).toBe(false)

    SFX.chip()
    SFX.chips(5)
    SFX.deal()
    SFX.turn()
    SFX.win()
    SFX.fold()

    expect(StubAudioContext.nodesCreated).toBe(0)
  })

  it('导入模块本身不会构造 AudioContext', async () => {
    installStub()
    await import('./index.js')
    expect(StubAudioContext.instances).toBe(0)
  })
})
