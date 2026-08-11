import { describe, it, expect } from 'vitest'
import { assertZeroSum, replay, type Engine } from './engine.js'

interface CounterState { turn: number; scores: Record<string, number>; over: boolean }
type CounterAction = { type: 'add'; n: number } | { type: 'stop' }

const counter: Engine<CounterState, CounterAction> = {
  id: 'counter',
  init: (ctx) => ({
    turn: 0,
    scores: Object.fromEntries(ctx.players.map((p) => [p, 0])),
    over: false,
  }),
  legalActions: () => [{ type: 'add', n: 1 }, { type: 'stop' }],
  apply: (state, playerId, action) => {
    if (action.type === 'stop') {
      return { state: { ...state, over: true }, events: [{ type: 'stopped' }] }
    }
    return {
      state: {
        ...state,
        turn: state.turn + 1,
        scores: { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + action.n },
      },
      events: [{ type: 'added', payload: { playerId, n: action.n } }],
    }
  },
  isOver: (state) => state.over,
  settle: (state) => {
    const ids = Object.keys(state.scores)
    const total = ids.reduce((s, id) => s + (state.scores[id] ?? 0), 0)
    const deltas: Record<string, number> = {}
    for (const id of ids) deltas[id] = (state.scores[id] ?? 0) * ids.length - total
    return { deltas }
  },
  view: (state, viewerId) => ({ turn: state.turn, me: viewerId, over: state.over }),
}

describe('assertZeroSum', () => {
  it('总和为 0 时通过', () => {
    expect(() => assertZeroSum({ deltas: { a: 100, b: -100 } })).not.toThrow()
  })

  it('总和非 0 时抛异常', () => {
    expect(() => assertZeroSum({ deltas: { a: 100, b: -50 } })).toThrow(/零和/)
  })

  it('空结算通过', () => {
    expect(() => assertZeroSum({ deltas: {} })).not.toThrow()
  })
})

describe('replay', () => {
  const ctx = { seed: 1, players: ['a', 'b'], options: {} }

  it('从动作序列重建出相同状态', () => {
    const actions = [
      { playerId: 'a', action: { type: 'add', n: 3 } as CounterAction },
      { playerId: 'b', action: { type: 'add', n: 5 } as CounterAction },
    ]
    const state = replay(counter, ctx, actions)
    expect(state.turn).toBe(2)
    expect(state.scores).toEqual({ a: 3, b: 5 })
  })

  it('空动作序列返回初始状态', () => {
    expect(replay(counter, ctx, []).turn).toBe(0)
  })

  it('重放两次结果一致', () => {
    const actions = [{ playerId: 'a', action: { type: 'add', n: 7 } as CounterAction }]
    expect(replay(counter, ctx, actions)).toEqual(replay(counter, ctx, actions))
  })
})

describe('引擎结算', () => {
  it('settle 的结果满足零和', () => {
    const ctx = { seed: 1, players: ['a', 'b'], options: {} }
    const state = replay(counter, ctx, [
      { playerId: 'a', action: { type: 'add', n: 3 } as CounterAction },
    ])
    expect(() => assertZeroSum(counter.settle(state))).not.toThrow()
  })
})
