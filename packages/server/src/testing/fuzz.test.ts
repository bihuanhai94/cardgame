import { describe, it, expect } from 'vitest'
import type { Engine } from '@cardgame/shared'
import { highCard } from '../games/highcard.js'
import { fuzzEngine } from './fuzz.js'

describe('fuzzEngine', () => {
  it('highcard 通过 2000 局随机对局', () => {
    const r = fuzzEngine(highCard, { rounds: 2000, players: ['a', 'b', 'c'], options: { ante: 100 } })
    expect(r.rounds).toBe(2000)
    expect(r.actions).toBeGreaterThan(0)
  })

  it('两人局同样通过', () => {
    expect(fuzzEngine(highCard, { rounds: 500, players: ['a', 'b'] }).rounds).toBe(500)
  })

  it('highcard 拒绝非法动作（spec 9 不变量 #2）', () => {
    const r = fuzzEngine(highCard, {
      rounds: 500,
      players: ['a', 'b', 'c'],
      options: { ante: 100 },
      probeIllegal: true,
    })
    expect(r.rounds).toBe(500)
  })

  it('检测出违反零和的引擎', () => {
    const broken: Engine<{ done: boolean }, { type: 'go' }> = {
      id: 'broken-sum',
      init: () => ({ done: false }),
      legalActions: (s) => (s.done ? [] : [{ type: 'go' }]),
      apply: () => ({ state: { done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 100, b: 0 } }),
      view: (s) => s,
    }
    expect(() => fuzzEngine(broken, { rounds: 1, players: ['a', 'b'] })).toThrow(/零和/)
  })

  it('检测出无人有合法动作的死锁', () => {
    const stuck: Engine<{ n: number }, { type: 'go' }> = {
      id: 'broken-deadlock-no-mover',
      init: () => ({ n: 0 }),
      legalActions: () => [],
      apply: (s) => ({ state: s, events: [] }),
      isOver: () => false,
      settle: () => ({ deltas: {} }),
      view: (s) => s,
    }
    expect(() => fuzzEngine(stuck, { rounds: 1, players: ['a', 'b'], maxSteps: 1_000_000 })).toThrow(
      /无人有合法动作/,
    )
  })

  it('检测出超过步数限制的死锁', () => {
    let step = 0
    const busy: Engine<{ n: number }, { type: 'go' }> = {
      id: 'broken-deadlock-step-budget',
      init: () => ({ n: 0 }),
      legalActions: () => [{ type: 'go' }],
      apply: (s) => {
        step++
        return { state: { n: s.n + 1 }, events: [] }
      },
      isOver: () => false,
      settle: () => ({ deltas: {} }),
      view: (s) => s,
    }
    expect(() => fuzzEngine(busy, { rounds: 1, players: ['a'], maxSteps: 10 })).toThrow(/超过/)
  })

  it('检测出接受非法动作的引擎', () => {
    const permissive: Engine<{ n: number }, { type: string }> = {
      id: 'broken-illegal',
      init: () => ({ n: 0 }),
      legalActions: () => [{ type: 'only' }],
      apply: (s) => ({ state: { n: s.n + 1 }, events: [] }),
      isOver: (s) => s.n >= 1,
      settle: () => ({ deltas: {} }),
      view: (s) => s,
    }
    expect(() =>
      fuzzEngine(permissive, { rounds: 1, players: ['a', 'b'], probeIllegal: true }),
    ).toThrow(/非法动作/)
  })

  it('视图裁剪泄漏会被检出', () => {
    const leaky: Engine<{ secret: string; done: boolean }, { type: 'go' }> = {
      id: 'broken-leak',
      init: () => ({ secret: 'SECRET-b', done: false }),
      legalActions: (s) => (s.done ? [] : [{ type: 'go' }]),
      apply: (s) => ({ state: { ...s, done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 0, b: 0 } }),
      view: (s) => s, // 未裁剪，直接返回内部状态
    }
    expect(() =>
      fuzzEngine(leaky, { rounds: 1, players: ['a', 'b'], secretProbe: 'SECRET-b', secretOwner: 'b' }),
    ).toThrow(/视图泄漏/)
  })
})
