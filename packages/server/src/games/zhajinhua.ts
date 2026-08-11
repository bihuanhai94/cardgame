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

/**
 * 一次下注动作（call/raise/比牌的扣款）落定后，统一处理：
 * 1. 只剩一人时结束本局；
 * 2. 若本轮下注（RoundState）已结束但仍有多人在局，开启下一轮（round+1），
 *    让尚未加注的玩家仍可继续行动（跟注/比牌），直到有人加注、弃牌到只剩一人、
 *    或达到封顶后被迫收场。
 */
function afterBet(state: ZjhState, bet: RoundState, folded: string[]): ZjhState {
  const alive = state.players.filter((p) => !folded.includes(p))
  if (alive.length <= 1) {
    return { ...state, bet, folded, over: true, winner: alive[0] ?? null }
  }
  if (bet.over) {
    const restarted = startRound(bet.seats, bet.turn, bet.currentBet, bet.minRaise)
    return { ...state, bet: restarted, folded, round: state.round + 1 }
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
      case 'call':
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
        state: { ...next, pot: state.pot + paid },
        events: [{ type: action.type, payload: { playerId } }],
      }
    }

    // compare
    const { targetId } = action
    const payBefore = committedOf(state.bet, playerId)
    const paidBet = applyBet(state.bet, playerId, { type: 'call' })
    const paid = committedOf(paidBet, playerId) - payBefore

    const challengerEval = evalThree(state.hands[playerId]!)
    const targetEval = evalThree(state.hands[targetId]!)
    const cmp = compareThree(challengerEval, targetEval)
    // 平局（cmp === 0）时发起方判负：challenger 只在严格胜出（cmp > 0）时获胜。
    const winnerId = cmp > 0 ? playerId : targetId
    const loserId = winnerId === playerId ? targetId : playerId

    let bet: RoundState = {
      ...paidBet,
      seats: paidBet.seats.map((s) => (s.id === loserId ? { ...s, folded: true } : s)),
    }
    if (bet.seats[bet.turn]?.id === loserId) bet = nextTurn(bet)
    bet = { ...bet, over: isRoundOver(bet) }

    const folded = [...state.folded, loserId]
    const next = afterBet(state, bet, folded)

    return {
      state: {
        ...next,
        pot: state.pot + paid,
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
    const contribution = (p: string) => state.ante + committedOf(state.bet, p)

    if (alive.length === 0) {
      for (const p of state.players) deltas[p] = 0
      return { deltas }
    }

    const winner = alive[0]!
    for (const p of state.players) {
      deltas[p] = p === winner ? 0 : -contribution(p)
    }
    deltas[winner] = state.pot - contribution(winner)
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
    }
  },
}
