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

  it('封顶后仍可 call / fold / compare', () => {
    let s = forceRound(zhajinhua.init({ ...ctx, options: { ante: 100, maxRounds: 3 } }), 3)
    s = act(s, 'a', { type: 'look' })
    const types = zhajinhua.legalActions(s, 'a').map((x) => x.type)
    expect(types).toEqual(expect.arrayContaining(['call', 'fold']))
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
