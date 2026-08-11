import {
  createDeck, createRng, shuffle,
  type Card, type Engine, type EngineContext, type Settlement,
} from '@cardgame/shared'

export interface HighCardState {
  players: string[]
  ante: number
  hands: Record<string, Card>
  pot: number
  folded: string[]
  acted: string[]
}

export type HighCardAction = { type: 'call' } | { type: 'fold' }

function cardValue(c: Card): number {
  const suitOrder: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 }
  return c.rank * 10 + (suitOrder[c.suit] ?? 0)
}

/** 本局是否已结束：唯一判定点，isOver 与 view 共用，避免两处逻辑分叉 */
function isOver(state: HighCardState): boolean {
  return state.acted.length === state.players.length
}

export const highCard: Engine<HighCardState, HighCardAction> = {
  id: 'highcard',

  init(ctx: EngineContext): HighCardState {
    const ante = typeof ctx.options.ante === 'number' ? ctx.options.ante : 100
    const deck = shuffle(createDeck(), createRng(ctx.seed))
    const hands: Record<string, Card> = {}
    ctx.players.forEach((p, i) => {
      hands[p] = deck[i]!
    })
    return {
      players: [...ctx.players],
      ante,
      hands,
      pot: ante * ctx.players.length,
      folded: [],
      acted: [],
    }
  },

  legalActions(state, playerId) {
    if (!state.players.includes(playerId)) return []
    if (state.folded.includes(playerId) || state.acted.includes(playerId)) return []
    return [{ type: 'call' }, { type: 'fold' }]
  },

  isLegal(state, playerId, action) {
    if (!state.players.includes(playerId)) return false
    if (state.folded.includes(playerId) || state.acted.includes(playerId)) return false
    return action?.type === 'call' || action?.type === 'fold'
  },

  apply(state, playerId, action) {
    if (!highCard.isLegal(state, playerId, action)) {
      throw new Error(`非法动作：${(action as { type?: string })?.type ?? '未知'}`)
    }

    if (action.type === 'fold') {
      return {
        state: {
          ...state,
          folded: [...state.folded, playerId],
          acted: [...state.acted, playerId],
        },
        events: [{ type: 'folded', payload: { playerId } }],
      }
    }
    return {
      state: { ...state, acted: [...state.acted, playerId] },
      events: [{ type: 'called', payload: { playerId } }],
    }
  },

  isOver,

  settle(state): Settlement {
    const deltas: Record<string, number> = {}
    const alive = state.players.filter((p) => !state.folded.includes(p))

    if (alive.length === 0) {
      for (const p of state.players) deltas[p] = 0
      return { deltas }
    }

    let winner = alive[0]!
    for (const p of alive) {
      if (cardValue(state.hands[p]!) > cardValue(state.hands[winner]!)) winner = p
    }
    for (const p of state.players) deltas[p] = -state.ante
    deltas[winner] = state.pot - state.ante
    return { deltas }
  },

  view(state, viewerId) {
    const over = isOver(state)
    const hands: Record<string, Card> = {}
    if (over) {
      Object.assign(hands, state.hands)
    } else if (viewerId && state.hands[viewerId]) {
      hands[viewerId] = state.hands[viewerId]!
    }
    return {
      players: state.players,
      ante: state.ante,
      pot: state.pot,
      folded: state.folded,
      acted: state.acted,
      over,
      hands,
    }
  },
}
