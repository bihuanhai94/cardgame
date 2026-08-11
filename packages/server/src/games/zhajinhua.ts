import {
  createDeck, createRng, shuffle,
  evalThree, compareThree,
  startRound, isLegalBet, applyBet, nextTurn, isRoundOver,
  type Card, type Engine, type EngineContext, type Settlement,
  type RoundState, type BetSeat,
} from '@cardgame/shared'

export interface ZjhState {
  players: string[]
  ante: number
  maxRounds: number
  hands: Record<string, Card[]>
  looked: string[]
  folded: string[]
  round: number
  bet: RoundState
  pot: number
  /** 每人迄今投入总额（含底注），pot 恒等于其总和。settle 直接读取，不再从 bet.committed 反推。 */
  contributed: Record<string, number>
  compares: Array<{ from: string; to: string; winner: string }>
  over: boolean
  winner: string | null
}

export type ZjhAction =
  | { type: 'look' }
  | { type: 'fold' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'compare'; targetId: string }

/** 无需建模筹码上限：本引擎不涉及全下/边池，给一个足够大的栈即可。 */
const UNLIMITED_STACK = Number.MAX_SAFE_INTEGER

function currentActor(state: ZjhState): string | null {
  if (state.over) return null
  return state.bet.seats[state.bet.turn]?.id ?? null
}

function committedOf(bet: RoundState, id: string): number {
  return bet.seats.find((s) => s.id === id)?.committed ?? 0
}

function addContribution(state: ZjhState, playerId: string, paid: number): Record<string, number> {
  return { ...state.contributed, [playerId]: (state.contributed[playerId] ?? 0) + paid }
}

/**
 * 一轮（orbit）：每个在局玩家把明注按各自 stakeFactor 缴一遍。
 * 一轮结束（RoundState.over）时，若仍有 ≥2 人在局，把每个存活玩家的
 * `committed` 清零后用同一个 currentBet 重新开轮——这样下一轮才会真的再收一次钱，
 * 而不是让所有人的跟注额永远停在 0（那样池子会冻结、封顶轮数只是空转）。
 */
function reopenOrbit(bet: RoundState): RoundState {
  const resetSeats = bet.seats.map((s) => (s.folded ? s : { ...s, committed: 0 }))
  return startRound(resetSeats, bet.turn, bet.currentBet, bet.minRaise)
}

/**
 * 一次下注/比牌动作落定后统一处理：
 * 1. 只剩一人时结束本局；
 * 2. 若本轮（RoundState）已结束但仍有多人在局，`round += 1` 并开启下一轮。
 */
function afterBet(state: ZjhState, bet: RoundState, folded: string[]): ZjhState {
  const alive = state.players.filter((p) => !folded.includes(p))
  if (alive.length <= 1) {
    return { ...state, bet, folded, over: true, winner: alive[0] ?? null }
  }
  if (bet.over) {
    return { ...state, bet: reopenOrbit(bet), folded, round: state.round + 1 }
  }
  return { ...state, bet, folded }
}

export const zhajinhua: Engine<ZjhState, ZjhAction> = {
  id: 'zhajinhua',

  init(ctx: EngineContext): ZjhState {
    const ante = typeof ctx.options.ante === 'number' ? ctx.options.ante : 100
    const maxRounds = typeof ctx.options.maxRounds === 'number' ? ctx.options.maxRounds : 10
    const deck = shuffle(createDeck(), createRng(ctx.seed))
    const hands: Record<string, Card[]> = {}
    ctx.players.forEach((p, i) => {
      hands[p] = deck.slice(i * 3, i * 3 + 3)
    })
    const seats: BetSeat[] = ctx.players.map((id) => ({
      id, stack: UNLIMITED_STACK, committed: 0, folded: false, allin: false, stakeFactor: 0.5,
    }))
    const bet = startRound(seats, 0, ante, ante)
    const contributed: Record<string, number> = {}
    for (const p of ctx.players) contributed[p] = ante
    return {
      players: [...ctx.players],
      ante,
      maxRounds,
      hands,
      looked: [],
      folded: [],
      round: 0,
      bet,
      pot: ante * ctx.players.length,
      contributed,
      compares: [],
      over: false,
      winner: null,
    }
  },

  legalActions(state, playerId) {
    if (currentActor(state) !== playerId) return []
    const all: ZjhAction[] = [
      { type: 'look' },
      { type: 'fold' },
      { type: 'call' },
      { type: 'raise', to: state.bet.currentBet + state.bet.minRaise },
      ...state.players
        .filter((p) => p !== playerId)
        .map((p): ZjhAction => ({ type: 'compare', targetId: p })),
    ]
    return all.filter((a) => zhajinhua.isLegal(state, playerId, a))
  },

  isLegal(state, playerId, action) {
    if (state.over) return false
    if (!state.players.includes(playerId)) return false
    if (state.folded.includes(playerId)) return false
    if (currentActor(state) !== playerId) return false
    if (!action || typeof action.type !== 'string') return false

    switch (action.type) {
      case 'look':
        return !state.looked.includes(playerId)
      case 'fold':
        return isLegalBet(state.bet, playerId, action)
      case 'call':
        // 封顶后不再允许跟注：只能比牌或弃牌，逼迫手牌收场。
        if (state.round >= state.maxRounds) return false
        return isLegalBet(state.bet, playerId, action)
      case 'raise':
        if (state.round >= state.maxRounds) return false
        return isLegalBet(state.bet, playerId, action)
      case 'compare': {
        const targetId = (action as { targetId: string }).targetId
        if (typeof targetId !== 'string') return false
        if (targetId === playerId) return false
        if (!state.players.includes(targetId)) return false
        if (state.folded.includes(targetId)) return false
        if (!state.looked.includes(playerId)) return false
        if (!state.looked.includes(targetId)) return false
        return true
      }
      default:
        return false
    }
  },

  apply(state, playerId, action) {
    if (!zhajinhua.isLegal(state, playerId, action)) {
      throw new Error(`非法动作：${(action as { type?: string })?.type ?? '未知'}`)
    }

    if (action.type === 'look') {
      const bet: RoundState = {
        ...state.bet,
        seats: state.bet.seats.map((s) => (s.id === playerId ? { ...s, stakeFactor: 1 } : s)),
      }
      return { state: { ...state, bet, looked: [...state.looked, playerId] }, events: [{ type: 'looked', payload: { playerId } }] }
    }

    if (action.type === 'fold' || action.type === 'call' || action.type === 'raise') {
      const newBet = applyBet(state.bet, playerId, action)
      const folded = action.type === 'fold' ? [...state.folded, playerId] : state.folded
      const paid = committedOf(newBet, playerId) - committedOf(state.bet, playerId)
      const next = afterBet(state, newBet, folded)
      return {
        state: { ...next, pot: state.pot + paid, contributed: addContribution(state, playerId, paid) },
        events: [{ type: action.type, payload: { playerId } }],
      }
    }

    // compare：发起方需支付与当前明注相等的注额——不是「补到当前明注」的差额，
    // 是每次发起都要重新付一次全额，因此不能借用 applyBet 的 call 语义（那是按
    // toCall 补差额，若本轮已缴满会算出 0，等于比牌免费）。发起方能比牌就意味着
    // 已看牌、stakeFactor 恒为 1，不涉及折算，直接加算明注即可。
    const { targetId } = action
    const pay = state.bet.currentBet
    const paidBet: RoundState = {
      ...state.bet,
      seats: state.bet.seats.map((s) => (s.id === playerId ? { ...s, committed: s.committed + pay } : s)),
    }

    const challengerEval = evalThree(state.hands[playerId]!)
    const targetEval = evalThree(state.hands[targetId]!)
    const cmp = compareThree(challengerEval, targetEval)
    // 平局（cmp === 0）时发起方判负：challenger 只在严格胜出（cmp > 0）时获胜。
    const winnerId = cmp > 0 ? playerId : targetId
    const loserId = winnerId === playerId ? targetId : playerId

    // 比牌是发起方的一次完整行动，无论谁输，行动权都要交给下一位——
    // nextTurn 会自动跳过刚被标记 folded 的输家，不必按输家是谁分两种情况处理。
    let bet: RoundState = {
      ...paidBet,
      seats: paidBet.seats.map((s) => (s.id === loserId ? { ...s, folded: true } : s)),
    }
    bet = nextTurn(bet)
    bet = { ...bet, over: isRoundOver(bet) }

    const folded = [...state.folded, loserId]
    const next = afterBet(state, bet, folded)

    return {
      state: {
        ...next,
        pot: state.pot + pay,
        contributed: addContribution(state, playerId, pay),
        compares: [...state.compares, { from: playerId, to: targetId, winner: winnerId }],
      },
      events: [{ type: 'compared', payload: { from: playerId, to: targetId, winner: winnerId } }],
    }
  },

  isOver(state) {
    return state.over
  },

  settle(state): Settlement {
    const deltas: Record<string, number> = {}
    const alive = state.players.filter((p) => !state.folded.includes(p))

    if (alive.length === 0) {
      for (const p of state.players) deltas[p] = 0
      return { deltas }
    }

    // 封顶后只剩「比牌或弃牌」两种动作，每次比牌都会淘汰一人，
    // 所以最后的存活者必然是历次比牌里一路胜出的那个——不需要在这里
    // 重新比一次牌，alive[0] 就是真正的赢家（by construction）。
    const winner = alive[0]!
    for (const p of state.players) {
      deltas[p] = p === winner ? 0 : -(state.contributed[p] ?? 0)
    }
    deltas[winner] = state.pot - (state.contributed[winner] ?? 0)
    return { deltas }
  },

  view(state, viewerId) {
    const hands: Record<string, Card[]> = {}
    if (state.over) {
      for (const p of state.players) {
        if (!state.folded.includes(p)) hands[p] = state.hands[p]!
      }
    } else if (viewerId && state.looked.includes(viewerId)) {
      hands[viewerId] = state.hands[viewerId]!
    }

    return {
      players: state.players,
      ante: state.ante,
      maxRounds: state.maxRounds,
      looked: state.looked,
      folded: state.folded,
      round: state.round,
      pot: state.pot,
      over: state.over,
      winner: state.winner,
      turn: currentActor(state),
      currentBet: state.bet.currentBet,
      compares: state.compares,
      hands,
      // 各家本轮已投入 —— 下注额在牌桌上是公开信息，
      // 不看到它就无法判断该不该跟。裁剪边界管的是牌，不是钱。
      committed: Object.fromEntries(state.bet.seats.map((s) => [s.id, s.committed])),
    }
  },
}
