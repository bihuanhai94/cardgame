import { describe, it, expect } from 'vitest'
import type { Engine } from '@cardgame/shared'
import { highCard } from '../games/highcard.js'
import { zhajinhua, type ZjhState } from '../games/zhajinhua.js'
import { fuzzEngine } from './fuzz.js'

/**
 * 炸金花的手牌每局都不同（由 round+1 派生的种子决定），secretProbe 只接受一个
 * 固定字符串，所以每局单独 peek 一次 init 结果，取 owner 手牌的 JSON 表示作为
 * 该局专属的探针字符串，再以 rounds: 1 跑一局 fuzz。只调用引擎已公开的 init，
 * 不改动引擎本身。
 */
function zjhSecretFor(round: number, players: string[], options: Record<string, unknown>) {
  const state = zhajinhua.init({ seed: round + 1, players, options }) as ZjhState
  const owner = players[0]!
  return { probe: JSON.stringify(state.hands[owner]), owner }
}

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
      isLegal: (s) => !s.done,
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
      isLegal: () => false,
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
      isLegal: () => true,
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
      isLegal: (_s, _p, a) => a.type === 'only',
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
      isLegal: (s) => !s.done,
      apply: (s) => ({ state: { ...s, done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 0, b: 0 } }),
      view: (s) => s, // 未裁剪，直接返回内部状态
    }
    expect(() =>
      fuzzEngine(leaky, { rounds: 1, players: ['a', 'b'], secretProbe: 'SECRET-b', secretOwner: 'b' }),
    ).toThrow(/视图泄漏/)
  })

  it('对局进行中裁剪正确、终局才公开的引擎不会被误报', () => {
    const revealsAtEnd: Engine<{ secret: string; done: boolean }, { type: 'go' }> = {
      id: 'reveals-at-end',
      init: () => ({ secret: 'SECRET-b', done: false }),
      legalActions: (s) => (s.done ? [] : [{ type: 'go' }]),
      isLegal: (s) => !s.done,
      apply: (s) => ({ state: { ...s, done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 0, b: 0 } }),
      // 进行中裁剪：非 owner 看不到 secret；终局摊牌：所有人都能看到——这是引擎的正当行为。
      view: (s, viewerId) => (s.done ? s : { secret: viewerId === 'b' ? s.secret : '', done: s.done }),
    }
    expect(() =>
      fuzzEngine(revealsAtEnd, {
        rounds: 1,
        players: ['a', 'b'],
        secretProbe: 'SECRET-b',
        secretOwner: 'b',
      }),
    ).not.toThrow()
  })

  it('炸金花跑多局 fuzz（probeIllegal + secretProbe 全开）不抛', () => {
    const players = ['a', 'b', 'c']
    const options = { ante: 100, maxRounds: 10 }
    let totalRounds = 0
    let totalActions = 0
    for (let round = 0; round < 5000; round++) {
      const { probe, owner } = zjhSecretFor(round, players, options)
      const r = fuzzEngine(zhajinhua, {
        rounds: 1,
        players,
        options,
        probeIllegal: true,
        secretProbe: probe,
        secretOwner: owner,
        maxSteps: 500,
      })
      totalRounds += r.rounds
      totalActions += r.actions
    }
    expect(totalRounds).toBe(5000)
    expect(totalActions).toBeGreaterThan(0)
  })
})
