import type { Card } from '../cards.js'

export type ThreeCategory =
  | 'high' | 'pair' | 'straight' | 'flush' | 'straightFlush' | 'trips'

export interface ThreeEval {
  category: ThreeCategory
  score: number
  cards: Card[]
}

/**
 * 国际标准（Teen Patti / Three Card Brag）的牌型序。
 * 注意 straight > flush —— 三张牌时顺子（720 种）比金花（1096 种）稀有，
 * 中式炸金花常见的「金花 > 顺子」在概率上是反的，本项目不采用。
 */
const CATEGORY_RANK: Record<ThreeCategory, number> = {
  high: 0, pair: 1, flush: 2, straight: 3, straightFlush: 4, trips: 5,
}

/**
 * 顺子判定。返回该顺子的「高张等价值」用于比较：
 * AKQ 记 14（最大），A23 记 3（最小，比 234 的 4 小）。
 * 返回 null 表示不是顺子。
 */
function straightHigh(ranks: number[]): number | null {
  const r = [...ranks].sort((a, b) => a - b)
  if (r[0] === 2 && r[1] === 3 && r[2] === 14) return 3   // A23：最小顺
  if (r[2]! - r[1]! === 1 && r[1]! - r[0]! === 1) return r[2]! // 普通顺（含 QKA=14，最大）
  return null
}

/** 把若干个 0-15 的分量打包成一个可比较的整数（高位优先） */
function pack(...parts: number[]): number {
  return parts.reduce((acc, p) => acc * 16 + p, 0)
}

export function evalThree(cards: readonly Card[]): ThreeEval {
  if (cards.length !== 3) throw new Error('炸金花必须是 3 张牌')

  const sorted = [...cards].sort((a, b) => b.rank - a.rank)
  const ranks = sorted.map((c) => c.rank)
  const suits = sorted.map((c) => c.suit)

  const isFlush = suits[0] === suits[1] && suits[1] === suits[2]
  const high = straightHigh(ranks)
  const isTrips = ranks[0] === ranks[1] && ranks[1] === ranks[2]

  let category: ThreeCategory
  let body: number

  if (isTrips) {
    category = 'trips'
    body = pack(ranks[0]!)
  } else if (high !== null && isFlush) {
    category = 'straightFlush'
    body = pack(high)
  } else if (isFlush) {
    category = 'flush'
    body = pack(ranks[0]!, ranks[1]!, ranks[2]!)
  } else if (high !== null) {
    category = 'straight'
    body = pack(high)
  } else if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    category = 'pair'
    const pairRank = ranks[0] === ranks[1] ? ranks[0]! : ranks[1]!
    const kicker = ranks[0] === ranks[1] ? ranks[2]! : ranks[0]!
    body = pack(pairRank, kicker)
  } else {
    category = 'high'
    body = pack(ranks[0]!, ranks[1]!, ranks[2]!)
  }

  // 分数结构：牌型 | 牌型内主体。花色不参与，点数相同即同分。
  const score = CATEGORY_RANK[category] * 16 ** 3 + body

  return { category, score, cards: sorted }
}

/**
 * 正数表示 a 大，0 表示平局。
 * 国际标准不用花色决胜，所以平局是可能的 —— 由调用方按规则裁定
 * （炸金花：比牌平局时发起方判负）。
 */
export function compareThree(a: ThreeEval, b: ThreeEval): number {
  return a.score - b.score
}
