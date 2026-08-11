import { describe, it, expect } from 'vitest'
import { assertZeroSum, replay, type Card } from '@cardgame/shared'
import { zhajinhua, type ZjhAction, type ZjhState } from './zhajinhua.js'
import { registerEngine, getEngine } from '../room/registry.js'

const ctx = { seed: 42, players: ['a', 'b', 'c'], options: { ante: 100 } }

function act(s: ZjhState, playerId: string, action: ZjhAction) {
  return zhajinhua.apply(s, playerId, action).state
}

// 固定的 3x3 张互不重复的牌，方便手工构造比牌场景
const HANDS = {
  high9: [{ suit: 's', rank: 9 }, { suit: 'h', rank: 4 }, { suit: 'd', rank: 2 }] as Card[],
  high9dup: [{ suit: 'c', rank: 9 }, { suit: 'd', rank: 4 }, { suit: 'h', rank: 2 }] as Card[], // 与 high9 同分（点数相同、花色不同）
  trips: [{ suit: 's', rank: 5 }, { suit: 'h', rank: 5 }, { suit: 'd', rank: 5 }] as Card[],
  low: [{ suit: 's', rank: 3 }, { suit: 'h', rank: 6 }, { suit: 'd', rank: 8 }] as Card[],
}

describe('init', () => {
  it('每人 3 张、无重复', () => {
    const s = zhajinhua.init(ctx)
    const all: string[] = []
    for (const p of ctx.players) {
      expect(s.hands[p]).toHaveLength(3)
      for (const c of s.hands[p]!) all.push(`${c.suit}${c.rank}`)
    }
    expect(new Set(all).size).toBe(all.length)
  })

  it('同 seed 发相同牌', () => {
    expect(zhajinhua.init(ctx).hands).toEqual(zhajinhua.init(ctx).hands)
  })

  it('不同 seed 发不同牌', () => {
    expect(zhajinhua.init({ ...ctx, seed: 7 }).hands).not.toEqual(zhajinhua.init(ctx).hands)
  })

  it('初始所有人处于闷牌', () => {
    expect(zhajinhua.init(ctx).looked).toEqual([])
  })

  it('初始底池 = 底注 × 人数', () => {
    expect(zhajinhua.init(ctx).pot).toBe(300)
  })
})

describe('看牌', () => {
  it('look 后进入 looked，stakeFactor 变 1', () => {
    const s = act(zhajinhua.init(ctx), 'a', { type: 'look' })
    expect(s.looked).toContain('a')
    expect(s.bet.seats.find((x) => x.id === 'a')?.stakeFactor).toBe(1)
  })

  it('未看牌时 view 里连自己的手牌都看不到', () => {
    const s = zhajinhua.init(ctx)
    const v = zhajinhua.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('看牌后 view 里能看到自己的、看不到别人的', () => {
    const s = act(zhajinhua.init(ctx), 'a', { type: 'look' })
    const v = zhajinhua.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['a'])
  })

  it('重复 look 非法', () => {
    const s = act(zhajinhua.init(ctx), 'a', { type: 'look' })
    expect(zhajinhua.isLegal(s, 'a', { type: 'look' })).toBe(false)
    expect(() => act(s, 'a', { type: 'look' })).toThrow(/非法动作/)
  })

  it('已弃牌者 look 非法', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    // 轮到 b，构造一个已弃牌但仍轮到自己的假设场景不现实；直接校验 isLegal 对已弃牌者恒为 false
    expect(zhajinhua.isLegal(s, 'a', { type: 'look' })).toBe(false)
  })
})

describe('闷牌注额', () => {
  it('闷牌者跟注只需明注的一半（向上取整）', () => {
    const s = zhajinhua.init({ seed: 1, players: ['a', 'b', 'c'], options: { ante: 101 } })
    // ante=101，一半=50.5，向上取整为 51
    const need = 51 - 0
    const before = s.bet.seats.find((x) => x.id === 'a')!.committed
    const after = act(s, 'a', { type: 'call' })
    expect(after.bet.seats.find((x) => x.id === 'a')!.committed - before).toBe(need)
  })

  it('看牌后跟注恢复全额', () => {
    let s = zhajinhua.init({ seed: 1, players: ['a', 'b', 'c'], options: { ante: 101 } })
    s = act(s, 'a', { type: 'look' })
    const after = act(s, 'a', { type: 'call' })
    expect(after.bet.seats.find((x) => x.id === 'a')!.committed).toBe(101)
  })
})

describe('比牌', () => {
  function setup() {
    let s = zhajinhua.init(ctx)
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low, c: HANDS.low } }
    return s
  }

  it('闷牌者不能发起比牌（未看牌时对已看牌者）', () => {
    let s = setup()
    // b 已看牌，但 a（发起方）未看牌，即使当前轮到 a 也不能比牌
    s = { ...s, looked: ['b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    expect(zhajinhua.isLegal(s, 'a', { type: 'compare', targetId: 'b' })).toBe(false)
  })

  it('不能向闷牌者比牌', () => {
    let s = setup()
    s = act(s, 'a', { type: 'look' })
    // b 未看牌，a 不能比 b
    expect(zhajinhua.isLegal(s, 'a', { type: 'compare', targetId: 'b' })).toBe(false)
  })

  it('不能向已弃牌者比牌', () => {
    let s = setup()
    s = act(s, 'a', { type: 'look' })
    s = { ...s, folded: ['b'], looked: [...s.looked, 'b'] }
    expect(zhajinhua.isLegal(s, 'a', { type: 'compare', targetId: 'b' })).toBe(false)
  })

  it('不能向自己比牌', () => {
    let s = setup()
    s = act(s, 'a', { type: 'look' })
    expect(zhajinhua.isLegal(s, 'a', { type: 'compare', targetId: 'a' })).toBe(false)
  })

  it('看牌双方比牌：牌大者赢，牌小者进入 folded，注额等于明注', () => {
    let s = setup()
    s = act(s, 'a', { type: 'look' })
    // 让 c 也看牌：需先轮到 c。用简单直接构造：手动把 c 标记为已看牌并设置为当前行动者
    s = { ...s, looked: [...s.looked, 'c'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'c' ? { ...x, stakeFactor: 1 } : x)), turn: s.bet.seats.findIndex((x) => x.id === 'a') } }
    const potBefore = s.pot
    const stake = s.bet.currentBet // 100，a 尚未投入
    const r = act(s, 'a', { type: 'compare', targetId: 'c' })
    expect(r.folded).toContain('c')
    expect(r.folded).not.toContain('a')
    expect(r.pot).toBe(potBefore + stake)
    expect(r.compares).toEqual([{ from: 'a', to: 'c', winner: 'a' }])
  })

  it('平局时发起方判负', () => {
    let s = zhajinhua.init(ctx)
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.high9dup, c: HANDS.low } }
    s = act(s, 'a', { type: 'look' })
    s = { ...s, looked: [...s.looked, 'b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    const r = act(s, 'a', { type: 'compare', targetId: 'b' })
    expect(r.compares[0]!.winner).toBe('b')
    expect(r.folded).toContain('a') // 发起方 a 判负
  })

  it('compares 记录里不含任何牌面', () => {
    let s = zhajinhua.init(ctx)
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low, c: HANDS.low } }
    s = act(s, 'a', { type: 'look' })
    s = { ...s, looked: [...s.looked, 'b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    const r = act(s, 'a', { type: 'compare', targetId: 'b' })
    const json = JSON.stringify(r.compares)
    expect(json.includes('suit')).toBe(false)
    expect(json.includes('rank')).toBe(false)
  })

  it('剩两人时比牌直接决出胜负', () => {
    let s = zhajinhua.init({ seed: 1, players: ['a', 'b'], options: { ante: 100 } })
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low } }
    s = act(s, 'a', { type: 'look' })
    s = { ...s, looked: [...s.looked, 'b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    const r = act(s, 'a', { type: 'compare', targetId: 'b' })
    expect(r.over).toBe(true)
    expect(r.winner).toBe('a')
  })
})

describe('封顶', () => {
  function forceRound(state: ZjhState, round: number): ZjhState {
    return { ...state, round }
  }

  it('达到 maxRounds 后 legalActions 不含 raise', () => {
    const s = forceRound(zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), 3)
    const types = zhajinhua.legalActions(s, 'a').map((x) => x.type)
    expect(types).not.toContain('raise')
  })

  it('达到 maxRounds 后 raise 被 isLegal 拒绝', () => {
    const s = forceRound(zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), 3)
    expect(zhajinhua.isLegal(s, 'a', { type: 'raise', to: 300 })).toBe(false)
  })

  it('封顶后仍可 compare / fold，但不再有 call', () => {
    let s = forceRound(zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), 3)
    s = act(s, 'a', { type: 'look' })
    // 让 b 也看牌，这样 a 才有比牌目标
    s = { ...s, looked: [...s.looked, 'b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    const types = zhajinhua.legalActions(s, 'a').map((x) => x.type)
    expect(types).toEqual(expect.arrayContaining(['fold', 'compare']))
    expect(types).not.toContain('call')
  })

  it('封顶后未看牌者只能 look / fold，不能 call 也不能 compare', () => {
    const s = forceRound(zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), 3)
    const types = zhajinhua.legalActions(s, 'a').map((x) => x.type)
    expect(types.sort()).toEqual(['fold', 'look'])
  })

  it('封顶不会死锁：当前行动者（无论是否看过牌）总有至少一个合法动作', () => {
    const capped = { ...zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), round: 3 }
    expect(zhajinhua.legalActions(capped, 'a').length).toBeGreaterThan(0) // 未看牌：look/fold

    const looked = act(capped, 'a', { type: 'look' })
    expect(zhajinhua.legalActions(looked, 'a').length).toBeGreaterThan(0) // 已看牌但无比牌目标：fold
  })
})

describe('封顶终局（性质测试）', () => {
  const STEP_CEILING = 500

  function driveAllCall(seed: number, maxRounds: number, players: string[]) {
    let s = zhajinhua.init({ seed, players, options: { ante: 100, maxRounds } })
    let steps = 0
    while (!s.over && steps < STEP_CEILING) {
      const actor = s.players[s.bet.turn]!
      const legal = zhajinhua.legalActions(s, actor)
      const preferred = legal.find((a) => a.type === 'call') ?? legal.find((a) => a.type === 'fold')
      if (!preferred) throw new Error(`玩家 ${actor} 在第 ${steps} 步无合法动作（死锁）`)
      s = act(s, actor, preferred)
      steps += 1
    }
    return { state: s, steps }
  }

  it('封顶后手牌必定在有限步内结束（三名只跟注的玩家）', () => {
    const { state, steps } = driveAllCall(1, 2, ['a', 'b', 'c'])
    expect(state.over).toBe(true)
    expect(steps).toBeLessThan(STEP_CEILING)
  })

  it('每完成一轮都会真的再收一次钱：两轮之后池子随之增长（而不是冻结）', () => {
    let s = zhajinhua.init({ seed: 1, players: ['a', 'b', 'c'], options: { ante: 100, maxRounds: 10 } })
    // 三人全程闷牌，各跟注一次 = 完成第一轮（闷牌折半，每人 50）；再跟注一次 = 完成第二轮
    for (let orbit = 0; orbit < 2; orbit++) {
      for (const p of s.players) {
        s = act(s, p, { type: 'call' })
      }
    }
    expect(s.round).toBe(2)
    expect(s.pot).toBe(100 * 3 + 50 * 3 * 2) // 底注 300 + 两轮闷牌跟注（每轮每人 50）
  })

  it('比牌永远不会免费：即使发起方本轮已跟满明注，仍需再付一次全额', () => {
    let s = zhajinhua.init({ seed: 1, players: ['a', 'b'], options: { ante: 100, maxRounds: 10 } })
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low } }
    // 手工构造「a 已看牌且本轮已跟满 100（committed === currentBet）」的场景。
    // 若比牌复用 applyBet 的 call 语义（按差额补齐），此时 toCall 为 0，比牌会变成免费；
    // 正确实现必须不管 committed 是多少，永远再收一次全额。
    s = {
      ...s,
      looked: ['a', 'b'],
      bet: {
        ...s.bet,
        seats: s.bet.seats.map((x) => ({ ...x, stakeFactor: 1, committed: x.id === 'a' ? 100 : 0 })),
        turn: s.bet.seats.findIndex((x) => x.id === 'a'),
      },
    }
    const potBefore = s.pot
    const r = act(s, 'a', { type: 'compare', targetId: 'b' })
    expect(r.pot).toBe(potBefore + 100)
    expect(r.contributed['a']).toBe((s.contributed['a'] ?? 0) + 100)
  })
})

describe('结算', () => {
  it('只剩一人时 over、winner 正确', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    s = act(s, 'b', { type: 'fold' })
    expect(s.over).toBe(true)
    expect(s.winner).toBe('c')
  })

  it('settle 的 deltas 之和恒为 0', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    s = act(s, 'b', { type: 'fold' })
    expect(() => assertZeroSum(zhajinhua.settle(s))).not.toThrow()
  })

  it('赢家所得 = 其他人投入之和', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    s = act(s, 'b', { type: 'fold' })
    const { deltas } = zhajinhua.settle(s)
    expect(deltas['c']).toBe(-(deltas['a']! + deltas['b']!))
  })

  it('弃牌者只输自己已投入的部分', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    s = act(s, 'b', { type: 'fold' })
    // a、b 均未看牌未跟注，只投入了底注
    expect(zhajinhua.settle(s).deltas['a']).toBe(-100)
    expect(zhajinhua.settle(s).deltas['b']).toBe(-100)
  })

  it('零和：真实下注（含加注）后结算仍为零和，且赢家净得等于其余人净投入', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'look' })
    s = act(s, 'a', { type: 'raise', to: 250 })
    s = act(s, 'b', { type: 'fold' })
    s = act(s, 'c', { type: 'fold' })
    expect(s.over).toBe(true) // 只剩 a 一人在局
    expect(() => assertZeroSum(zhajinhua.settle(s))).not.toThrow()
    const { deltas } = zhajinhua.settle(s)
    expect(deltas['a']).toBeGreaterThan(0)
    expect(deltas['a']).toBe(-(deltas['b']! + deltas['c']!))
  })

  it('零和：由比牌淘汰收场时结算仍为零和', () => {
    let s = zhajinhua.init(ctx)
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low, c: HANDS.low } }
    s = act(s, 'a', { type: 'look' })
    s = { ...s, looked: [...s.looked, 'b'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'b' ? { ...x, stakeFactor: 1 } : x)) } }
    s = act(s, 'a', { type: 'compare', targetId: 'b' })
    s = act(s, 'c', { type: 'fold' })
    expect(s.over).toBe(true)
    expect(s.winner).toBe('a')
    expect(() => assertZeroSum(zhajinhua.settle(s))).not.toThrow()
  })

  it('封顶被迫比牌收场时，赢的是历次比牌里真正胜出的玩家，而不是随意一人', () => {
    let s = zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 0 } })
    s = { ...s, hands: { a: HANDS.high9, b: HANDS.low, c: HANDS.low } }
    s = act(s, 'a', { type: 'look' })
    s = { ...s, looked: [...s.looked, 'b', 'c'], bet: { ...s.bet, seats: s.bet.seats.map((x) => (x.id === 'a' ? x : { ...x, stakeFactor: 1 })) } }
    s = act(s, 'a', { type: 'compare', targetId: 'b' }) // a 赢，b 出局
    s = act(s, 'c', { type: 'compare', targetId: 'a' }) // a 应该继续赢
    expect(s.over).toBe(true)
    expect(s.winner).toBe('a')
    expect(s.compares.every((c) => c.winner === 'a')).toBe(true)
  })
})

describe('isLegal 与 legalActions 一致', () => {
  it('legalActions 给出的每个动作都必须 isLegal', () => {
    const s = zhajinhua.init(ctx)
    for (const a of zhajinhua.legalActions(s, 'a')) {
      expect(zhajinhua.isLegal(s, 'a', a)).toBe(true)
    }
  })

  it('非当前行动者的任何动作都非法', () => {
    const s = zhajinhua.init(ctx)
    expect(zhajinhua.isLegal(s, 'b', { type: 'call' })).toBe(false)
    expect(zhajinhua.isLegal(s, 'b', { type: 'look' })).toBe(false)
    expect(zhajinhua.legalActions(s, 'b')).toEqual([])
  })
})

describe('视图裁剪', () => {
  it('序列化后的 view 不含他人牌面', () => {
    const s = act(zhajinhua.init(ctx), 'a', { type: 'look' })
    const json = JSON.stringify(zhajinhua.view(s, 'a'))
    const bCard = JSON.stringify(s.hands['b']![0])
    expect(json.includes(bCard)).toBe(false)
  })

  it('观战者（viewerId=null）看不到任何手牌', () => {
    const s = act(zhajinhua.init(ctx), 'a', { type: 'look' })
    const v = zhajinhua.view(s, null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('over 后所有未弃牌者手牌公开', () => {
    let s = zhajinhua.init(ctx)
    s = act(s, 'a', { type: 'fold' })
    s = act(s, 'b', { type: 'fold' })
    const v = zhajinhua.view(s, null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['c'])
  })
})

describe('引擎注册表', () => {
  it('注册后可取出', () => {
    registerEngine(zhajinhua)
    expect(getEngine('zhajinhua')).toBe(zhajinhua)
  })
})
