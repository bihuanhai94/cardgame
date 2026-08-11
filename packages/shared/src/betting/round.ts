export interface BetSeat {
  id: string
  stack: number
  committed: number
  folded: boolean
  allin: boolean
  /** 该家的注额系数。炸金花闷牌为 0.5，看牌后与德州恒为 1。 */
  stakeFactor: number
}

export interface RoundState {
  seats: BetSeat[]
  turn: number
  /** 本轮需要跟到的名义额度（未按 stakeFactor 折算） */
  currentBet: number
  /** 下次加注至少要在 currentBet 之上加多少 */
  minRaise: number
  /** 自上次加注以来已行动过的座位 id */
  actedSinceRaise: string[]
  over: boolean
}

export type BetAction =
  | { type: 'fold' }
  | { type: 'call' }
  | { type: 'raise'; to: number }

const clone = (rs: RoundState): RoundState => ({
  ...rs,
  seats: rs.seats.map((s) => ({ ...s })),
  actedSinceRaise: [...rs.actedSinceRaise],
})

const seatOf = (rs: RoundState, id: string) => rs.seats.find((s) => s.id === id)

/** 仍需行动的座位：未弃牌、未全下 */
const active = (rs: RoundState) => rs.seats.filter((s) => !s.folded && !s.allin)

/** 仍在局中的座位：未弃牌（含全下） */
const live = (rs: RoundState) => rs.seats.filter((s) => !s.folded)

export function startRound(
  seats: BetSeat[], firstToAct: number, openBet: number, minRaise: number,
): RoundState {
  const rs: RoundState = {
    seats: seats.map((s) => ({ ...s })),
    turn: firstToAct,
    currentBet: openBet,
    minRaise,
    actedSinceRaise: [],
    over: false,
  }
  return advanceIfNeeded(rs)
}

/** 该家还需投入多少才算跟上（已按 stakeFactor 折算并向上取整） */
export function toCall(rs: RoundState, seatId: string): number {
  const s = seatOf(rs, seatId)
  if (!s) return 0
  const need = Math.ceil(rs.currentBet * s.stakeFactor) - s.committed
  return Math.max(0, need)
}

export function isLegalBet(rs: RoundState, seatId: string, a: BetAction): boolean {
  if (rs.over) return false
  const s = seatOf(rs, seatId)
  if (!s || s.folded || s.allin) return false
  if (rs.seats[rs.turn]?.id !== seatId) return false

  if (a.type === 'fold' || a.type === 'call') return true

  if (a.type === 'raise') {
    if (!Number.isInteger(a.to)) return false
    if (a.to < rs.currentBet + rs.minRaise) return false
    const need = Math.ceil(a.to * s.stakeFactor) - s.committed
    return need <= s.stack           // 筹码不够就不能加注，只能全下跟注
  }
  return false
}

export function applyBet(rs0: RoundState, seatId: string, a: BetAction): RoundState {
  if (!isLegalBet(rs0, seatId, a)) throw new Error('非法下注动作')
  const rs = clone(rs0)
  const s = seatOf(rs, seatId)!

  if (a.type === 'fold') {
    s.folded = true
  } else {
    const want = a.type === 'call'
      ? toCall(rs, seatId)
      : Math.ceil(a.to * s.stakeFactor) - s.committed
    const pay = Math.min(want, s.stack)
    s.stack -= pay
    s.committed += pay
    if (s.stack === 0) s.allin = true

    if (a.type === 'raise') {
      rs.minRaise = a.to - rs.currentBet
      rs.currentBet = a.to
      rs.actedSinceRaise = []          // 加注重新开放所有人的行动权
    }
  }

  if (!rs.actedSinceRaise.includes(seatId)) rs.actedSinceRaise.push(seatId)
  return advanceIfNeeded(nextTurn(rs))
}

export function nextTurn(rs0: RoundState): RoundState {
  const rs = clone(rs0)
  const n = rs.seats.length
  for (let i = 1; i <= n; i++) {
    const idx = (rs.turn + i) % n
    const s = rs.seats[idx]!
    if (!s.folded && !s.allin) { rs.turn = idx; break }
  }
  return rs
}

export function isRoundOver(rs: RoundState): boolean {
  if (live(rs).length <= 1) return true
  const need = active(rs)
  if (need.length === 0) return true
  return need.every((s) =>
    rs.actedSinceRaise.includes(s.id) && toCall(rs, s.id) === 0)
}

function advanceIfNeeded(rs: RoundState): RoundState {
  const out = clone(rs)
  out.over = isRoundOver(out)
  return out
}
