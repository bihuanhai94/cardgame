import { evalThree, type Card } from '@cardgame/shared'
import type { ZjhAction } from '../games/zhajinhua.js'

/**
 * `zhajinhua.view()` 的返回形状（对该视角已裁剪：`hands` 里只有自己能看到的牌）。
 * 这里独立声明而不是从引擎导入，是因为 decideZjh 的契约就是「只认这份裁剪后的
 * 结构」——它不应该、也不需要知道 ZjhState 长什么样。
 */
export interface ZjhAiView {
  players: string[]
  ante: number
  maxRounds: number
  looked: string[]
  folded: string[]
  round: number
  pot: number
  over: boolean
  winner: string | null
  turn: string | null
  currentBet: number
  compares: Array<{ from: string; to: string; winner: string }>
  committed: Record<string, number>
  hands: Record<string, Card[]>
}

export interface DecideZjhOpts {
  /**
   * 当前下注轮允许的最小加注跨度。这是公开的下注参数（所有人下注多少、
   * 封顶还差多少注都是明摆着的），不涉及任何人的手牌，因此不算违反
   * 「AI 只能看裁剪后视图」的约束——只是 view() 目前没有单独导出这个字段，
   * 由调用方（Room）从引擎内部状态里取出，作为选项显式传入。
   */
  minRaise: number
}

const STRONG = new Set(['trips', 'straightFlush', 'flush'])
const MEDIUM = new Set(['straight', 'pair'])

/**
 * 加注的安全阀：明注涨到底注的这个倍数以上就不再加注，改为跟注。
 * 没有这个阀门，两个都拿到强牌的托管 AI 会互相无限加注——round 只在一整轮
 * 「无人再加注」之后才会前进，纯粹的「有强牌就加注」策略永远等不到那一天，
 * 会把对局锁死在同一轮里。这不是读对手底牌的「揣测」，只看自己这一路涨到
 * 多高，是自我约束，不是对手建模。
 */
const MAX_RAISE_MULT = 8

/** 在已看牌、未弃牌的对手里选一个比牌目标；纯粹按座位顺序挑，不做任何强弱判断。 */
function pickCompareTarget(view: ZjhAiView, playerId: string): string | null {
  for (const p of view.players) {
    if (p === playerId) continue
    if (view.folded.includes(p)) continue
    if (!view.looked.includes(p)) continue
    return p
  }
  return null
}

/**
 * 规则型托管 AI：纯函数，输入输出确定，不读时钟、不读他人手牌。
 *
 * 只在两处访问 `view.hands`：读取 `view.hands[playerId]`（自己的牌）。永远不会
 * 遍历或读取其他玩家的 key —— 这正是「AI 不得看到他人手牌」这条硬约束的落地方式。
 */
export function decideZjh(view: ZjhAiView, playerId: string, opts: DecideZjhOpts): ZjhAction {
  const hasLooked = view.looked.includes(playerId)

  if (!hasLooked) {
    return view.round < 3 ? { type: 'call' } : { type: 'look' }
  }

  const myHand = view.hands[playerId]
  const category = myHand ? evalThree(myHand).category : 'high'
  const strong = STRONG.has(category)
  const medium = MEDIUM.has(category)

  // 封顶后 call/raise 都是非法动作（引擎规则），只剩「比牌」或「弃牌」——
  // 比牌是这种局面下唯一还能把牌局推进下去的动作，视为「跟注」精神上的延续。
  if (view.round >= view.maxRounds) {
    if (strong || medium) {
      const target = pickCompareTarget(view, playerId)
      if (target) return { type: 'compare', targetId: target }
    }
    return { type: 'fold' }
  }

  if (strong) {
    const canRaiseNow = view.round < view.maxRounds / 2 && view.currentBet < view.ante * MAX_RAISE_MULT
    if (canRaiseNow) return { type: 'raise', to: view.currentBet + opts.minRaise }
    return { type: 'call' }
  }

  if (medium) return { type: 'call' }

  // 单张：跟注额超过底池 1/4 就弃牌，否则跟注
  const toCall = view.currentBet - (view.committed[playerId] ?? 0)
  if (toCall > view.pot / 4) return { type: 'fold' }
  return { type: 'call' }
}
