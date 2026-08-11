import { describe, it, expect } from 'vitest'
import { assertZeroSum, replay } from '@cardgame/shared'
import { highCard, type HighCardAction } from './highcard.js'
import { registerEngine, getEngine, listEngines } from '../room/registry.js'

const ctx = { seed: 42, players: ['a', 'b', 'c'], options: { ante: 100 } }

describe('highCard 初始化', () => {
  it('每人发一张牌', () => {
    const s = highCard.init(ctx)
    expect(Object.keys(s.hands)).toHaveLength(3)
  })

  it('同种子发出相同的牌', () => {
    expect(highCard.init(ctx).hands).toEqual(highCard.init(ctx).hands)
  })

  it('不同种子发出不同的牌', () => {
    const other = highCard.init({ ...ctx, seed: 7 })
    expect(other.hands).not.toEqual(highCard.init(ctx).hands)
  })

  it('初始底池等于人数乘底注', () => {
    expect(highCard.init(ctx).pot).toBe(300)
  })

  it('初始时无人弃牌', () => {
    expect(highCard.init(ctx).folded).toEqual([])
  })
})

describe('highCard 动作', () => {
  it('合法动作为跟注与弃牌', () => {
    const s = highCard.init(ctx)
    expect(highCard.legalActions(s, 'a').map((x) => x.type).sort()).toEqual(['call', 'fold'])
  })

  it('已弃牌者无合法动作', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'fold' }).state
    expect(highCard.legalActions(s, 'a')).toEqual([])
  })

  it('弃牌被记录并产生事件', () => {
    const r = highCard.apply(highCard.init(ctx), 'a', { type: 'fold' })
    expect(r.state.folded).toContain('a')
    expect(r.events[0]!.type).toBe('folded')
  })

  it('跟注推进行动指针', () => {
    const s = highCard.init(ctx)
    const r = highCard.apply(s, 'a', { type: 'call' })
    expect(r.state.acted).toContain('a')
  })

  it('拒绝非行动方的动作', () => {
    const s = highCard.init(ctx)
    expect(() => highCard.apply(s, 'zzz', { type: 'call' })).toThrow(/非法动作/)
  })

  it('拒绝重复行动', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'call' }).state
    expect(() => highCard.apply(s, 'a', { type: 'call' })).toThrow(/非法动作/)
  })
})

describe('highCard 结束与结算', () => {
  const allCall: { playerId: string; action: HighCardAction }[] = [
    { playerId: 'a', action: { type: 'call' } },
    { playerId: 'b', action: { type: 'call' } },
    { playerId: 'c', action: { type: 'call' } },
  ]

  it('全部行动后结束', () => {
    expect(highCard.isOver(replay(highCard, ctx, allCall))).toBe(true)
  })

  it('未全部行动时未结束', () => {
    expect(highCard.isOver(highCard.init(ctx))).toBe(false)
  })

  it('结算满足零和', () => {
    const s = replay(highCard, ctx, allCall)
    expect(() => assertZeroSum(highCard.settle(s))).not.toThrow()
  })

  it('赢家收益为正、其余为负', () => {
    const s = replay(highCard, ctx, allCall)
    const { deltas } = highCard.settle(s)
    const positives = Object.values(deltas).filter((v) => v > 0)
    expect(positives).toHaveLength(1)
  })

  it('弃牌者只输底注', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'fold' } },
      { playerId: 'b', action: { type: 'call' } },
      { playerId: 'c', action: { type: 'call' } },
    ])
    expect(highCard.settle(s).deltas['a']).toBe(-100)
  })

  it('全部弃牌时全员退回底注', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'fold' } },
      { playerId: 'b', action: { type: 'fold' } },
      { playerId: 'c', action: { type: 'fold' } },
    ])
    expect(highCard.settle(s).deltas).toEqual({ a: 0, b: 0, c: 0 })
  })
})

describe('highCard 视图裁剪', () => {
  it('未结束时只能看到自己的牌', () => {
    const s = highCard.init(ctx)
    const v = highCard.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['a'])
  })

  it('观战者未结束时看不到任何手牌', () => {
    const v = highCard.view(highCard.init(ctx), null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('结束后所有人可见全部手牌', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'call' } },
      { playerId: 'b', action: { type: 'call' } },
      { playerId: 'c', action: { type: 'call' } },
    ])
    const v = highCard.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands).sort()).toEqual(['a', 'b', 'c'])
  })

  it('序列化后的视图不含他人牌面', () => {
    const s = highCard.init(ctx)
    const json = JSON.stringify(highCard.view(s, 'a'))
    const bCard = JSON.stringify(s.hands['b'])
    expect(json.includes(bCard)).toBe(false)
  })
})

describe('isLegal', () => {
  const ctx = { seed: 42, players: ['a', 'b', 'c'], options: { ante: 100 } }

  it('在局且未行动的玩家可以跟注与弃牌', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'a', { type: 'call' })).toBe(true)
    expect(highCard.isLegal(s, 'a', { type: 'fold' })).toBe(true)
  })

  it('拒绝未知动作类型', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'a', { type: '__illegal__' } as never)).toBe(false)
  })

  it('拒绝不在本局的玩家', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'zzz', { type: 'call' })).toBe(false)
  })

  it('拒绝已行动的玩家', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'call' }).state
    expect(highCard.isLegal(s, 'a', { type: 'call' })).toBe(false)
  })

  it('与 legalActions 一致：legalActions 给出的每个动作都必须 isLegal', () => {
    const s = highCard.init(ctx)
    for (const p of ctx.players) {
      for (const a of highCard.legalActions(s, p)) {
        expect(highCard.isLegal(s, p, a)).toBe(true)
      }
    }
  })
})

describe('引擎注册表', () => {
  it('注册后可取出', () => {
    registerEngine(highCard)
    expect(getEngine('highcard')).toBe(highCard)
  })

  it('未注册的 id 抛异常', () => {
    expect(() => getEngine('不存在')).toThrow(/未注册/)
  })

  it('列出已注册 id', () => {
    registerEngine(highCard)
    expect(listEngines()).toContain('highcard')
  })
})
