import { describe, it, expect } from 'vitest'
import { createDeck, createRng, shuffle, startRound, type Card } from '@cardgame/shared'
import { decideZjh, type ZjhAiView } from './zhajinhua.js'
import { zhajinhua, type ZjhState } from '../games/zhajinhua.js'

/** 按点数/花色直接构造三张牌，避免依赖洗牌结果。 */
function cards(spec: Array<[number, Card['suit']]>): Card[] {
  return spec.map(([rank, suit]) => ({ rank, suit }))
}

const TRIPS = cards([[5, 's'], [5, 'h'], [5, 'd']])
const STRAIGHT_FLUSH = cards([[5, 's'], [6, 's'], [7, 's']])
const FLUSH = cards([[2, 's'], [7, 's'], [9, 's']])
const STRAIGHT = cards([[5, 's'], [6, 'h'], [7, 'd']])
const PAIR = cards([[5, 's'], [5, 'h'], [9, 'd']])
const HIGH = cards([[2, 's'], [7, 'h'], [10, 'd']])

/** 构造一局完整的 ZjhState，跳过洗牌，手牌与所处轮次全部可控。 */
function makeState(opts: {
  players?: string[]
  round?: number
  maxRounds?: number
  looked?: string[]
  folded?: string[]
  hands: Record<string, Card[]>
  currentBet?: number
  minRaise?: number
  committed?: Record<string, number>
  turn?: number
}): ZjhState {
  const players = opts.players ?? ['a', 'b', 'c']
  const ante = 100
  const currentBet = opts.currentBet ?? ante
  const minRaise = opts.minRaise ?? ante
  const looked = opts.looked ?? []
  const folded = opts.folded ?? []
  const seats = players.map((id) => ({
    id,
    stack: Number.MAX_SAFE_INTEGER,
    committed: opts.committed?.[id] ?? (looked.includes(id) ? currentBet : Math.ceil(currentBet * 0.5)),
    folded: folded.includes(id),
    allin: false,
    stakeFactor: looked.includes(id) ? 1 : 0.5,
  }))
  const bet = startRound(seats, opts.turn ?? 0, currentBet, minRaise)
  const contributed: Record<string, number> = {}
  for (const p of players) contributed[p] = seats.find((s) => s.id === p)!.committed
  return {
    players,
    ante,
    maxRounds: opts.maxRounds ?? 10,
    hands: opts.hands,
    looked,
    folded,
    round: opts.round ?? 0,
    bet,
    pot: Object.values(contributed).reduce((a, b) => a + b, 0),
    contributed,
    compares: [],
    over: false,
    winner: null,
  }
}

function viewAndOpts(state: ZjhState, playerId: string): [ZjhAiView, { minRaise: number }] {
  const view = zhajinhua.view(state, playerId) as ZjhAiView
  return [view, { minRaise: state.bet.minRaise }]
}

describe('decideZjh 纯函数性', () => {
  it('相同输入产生相同输出', () => {
    const state = makeState({ hands: { a: HIGH, b: HIGH, c: HIGH }, looked: ['a'], round: 1 })
    const [view, opts] = viewAndOpts(state, 'a')
    const r1 = decideZjh(view, 'a', opts)
    const r2 = decideZjh(view, 'a', opts)
    expect(r1).toEqual(r2)
  })
})

describe('decideZjh 绝不读取他人手牌（陷阱测试）', () => {
  it('构造带 getter 陷阱的对手手牌，AI 决策全程不触发该 getter', () => {
    const state = makeState({ hands: { a: TRIPS, b: HIGH, c: HIGH }, looked: ['a'], round: 1 })
    const [rawView, opts] = viewAndOpts(state, 'a')

    let trapped = false
    const view: ZjhAiView = {
      ...rawView,
      hands: Object.freeze(
        Object.defineProperties({ ...rawView.hands }, {
          b: {
            enumerable: true,
            get() {
              trapped = true
              return HIGH
            },
          },
        }),
      ),
    }

    const action = decideZjh(view, 'a', opts)
    expect(trapped).toBe(false)
    expect(action).toBeTruthy()
  })
})

describe('decideZjh 策略表', () => {
  it('闷牌且轮数 < 3：跟注', () => {
    const state = makeState({ hands: { a: HIGH, b: HIGH, c: HIGH }, round: 1 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('闷牌且轮数 >= 3：看牌', () => {
    const state = makeState({ hands: { a: HIGH, b: HIGH, c: HIGH }, round: 3 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'look' })
  })

  it('已看牌，豹子：轮数 < 封顶一半时加最小注', () => {
    const state = makeState({ hands: { a: TRIPS, b: HIGH, c: HIGH }, looked: ['a'], round: 1, maxRounds: 10 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'raise', to: view.currentBet + opts.minRaise })
  })

  it('已看牌，顺金：轮数 < 封顶一半时加最小注', () => {
    const state = makeState({ hands: { a: STRAIGHT_FLUSH, b: HIGH, c: HIGH }, looked: ['a'], round: 1, maxRounds: 10 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts).type).toBe('raise')
  })

  it('已看牌，豹子：明注涨到底注 8 倍以上时不再加注（防止两个强牌互相无限加注锁死对局）', () => {
    const state = makeState({
      hands: { a: TRIPS, b: HIGH, c: HIGH },
      looked: ['a'],
      round: 1,
      maxRounds: 10,
      currentBet: 900, // ante=100，已经 9 倍
      committed: { a: 900, b: 900, c: 900 },
    })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('已看牌，金花：轮数 >= 封顶一半时改为跟注', () => {
    const state = makeState({ hands: { a: FLUSH, b: HIGH, c: HIGH }, looked: ['a'], round: 6, maxRounds: 10 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('已看牌，顺子：跟注', () => {
    const state = makeState({ hands: { a: STRAIGHT, b: HIGH, c: HIGH }, looked: ['a'], round: 1 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('已看牌，对子：跟注', () => {
    const state = makeState({ hands: { a: PAIR, b: HIGH, c: HIGH }, looked: ['a'], round: 1 })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('已看牌，单张，跟注额超过底池 1/4：弃牌', () => {
    // 底池很小、跟注额（currentBet - 已投入）相对偏大 —— 用小底池 + 大 currentBet 制造这一场景
    const state = makeState({
      hands: { a: HIGH, b: HIGH, c: HIGH },
      looked: ['a'],
      round: 1,
      currentBet: 1000,
      committed: { a: 0, b: 1000, c: 1000 },
    })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(view.currentBet - (view.committed['a'] ?? 0)).toBeGreaterThan(view.pot / 4)
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'fold' })
  })

  it('已看牌，单张，跟注额不超过底池 1/4：跟注', () => {
    const state = makeState({
      hands: { a: HIGH, b: HIGH, c: HIGH },
      looked: ['a'],
      round: 1,
      currentBet: 100,
      committed: { a: 90, b: 100, c: 100 },
    })
    const [view, opts] = viewAndOpts(state, 'a')
    expect(view.currentBet - (view.committed['a'] ?? 0)).toBeLessThanOrEqual(view.pot / 4)
    expect(decideZjh(view, 'a', opts)).toEqual({ type: 'call' })
  })

  it('封顶后仍能给出合法动作（call/raise 已非法，只能 compare/fold）', () => {
    const state = makeState({
      hands: { a: TRIPS, b: HIGH, c: HIGH },
      looked: ['a', 'b'],
      round: 10,
      maxRounds: 10,
    })
    const [view, opts] = viewAndOpts(state, 'a')
    const action = decideZjh(view, 'a', opts)
    expect(['compare', 'fold']).toContain(action.type)
    expect(zhajinhua.isLegal(state, 'a', action)).toBe(true)
  })
})

describe('decideZjh 输出必为合法动作', () => {
  const scenarios: Array<{ name: string; hands: Record<string, Card[]>; looked: string[]; round: number }> = [
    { name: '闷牌早期', hands: { a: HIGH, b: HIGH, c: HIGH }, looked: [], round: 1 },
    { name: '闷牌后期', hands: { a: HIGH, b: HIGH, c: HIGH }, looked: [], round: 4 },
    { name: '看牌豹子', hands: { a: TRIPS, b: HIGH, c: HIGH }, looked: ['a'], round: 1 },
    { name: '看牌顺子', hands: { a: STRAIGHT, b: HIGH, c: HIGH }, looked: ['a'], round: 1 },
    { name: '看牌单张', hands: { a: HIGH, b: PAIR, c: HIGH }, looked: ['a'], round: 1 },
  ]

  for (const s of scenarios) {
    it(`${s.name}：产出的动作满足 isLegal`, () => {
      const state = makeState({ hands: s.hands, looked: s.looked, round: s.round })
      const [view, opts] = viewAndOpts(state, 'a')
      const action = decideZjh(view, 'a', opts)
      expect(zhajinhua.isLegal(state, 'a', action)).toBe(true)
    })
  }
})

// 保证测试用牌构造函数本身没有依赖未使用的 import，触发一次真实洗牌验证不会抛错
describe('测试工具自检', () => {
  it('createDeck/shuffle 仍然可用', () => {
    const deck = shuffle(createDeck(), createRng(1))
    expect(deck).toHaveLength(52)
  })
})
