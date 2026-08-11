import { randomUUID, randomInt } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { assertZeroSum, type GameEvent, type SeatInfo } from '@cardgame/shared'
import { getEngine } from './registry.js'
import { postTransaction, userAccount, withTransaction } from '../domain/ledger.js'
import { autoRepay } from '../domain/loans.js'

interface Seat {
  index: number
  userId: string | null
  online: boolean
  isAi: boolean
}

export interface SettlementRecord {
  roomId: string
  gameId: string
  seed: number
  players: string[]
  actions: { playerId: string; action: unknown }[]
  deltas: Record<string, number>
}

export interface RoomOpts {
  id: string
  gameId: string
  ownerId: string
  seats: number
  options: Record<string, unknown>
  seedSource?: () => number
}

export class Room {
  readonly id: string
  readonly gameId: string
  readonly ownerId: string
  readonly options: Record<string, unknown>

  private seatList: Seat[]
  private seedSource: () => number
  private seed = 0
  private state: unknown = null
  private started = false
  private actions: { playerId: string; action: unknown }[] = []
  private pendingSettlement: SettlementRecord | null = null
  private nicknames = new Map<string, string>()

  constructor(opts: RoomOpts) {
    this.id = opts.id
    this.gameId = opts.gameId
    this.ownerId = opts.ownerId
    this.options = opts.options
    this.seedSource = opts.seedSource ?? (() => randomInt(0, 2 ** 31 - 1))
    this.seatList = Array.from({ length: opts.seats }, (_, index) => ({
      index,
      userId: null,
      online: false,
      isAi: false,
    }))
  }

  setNickname(userId: string, nickname: string): void {
    this.nicknames.set(userId, nickname)
  }

  isStarted(): boolean {
    return this.started
  }

  players(): string[] {
    return this.seatList.filter((s) => s.userId !== null).map((s) => s.userId!)
  }

  sit(userId: string): number {
    if (this.started) throw new Error('本局已开局，无法入座')
    if (this.players().includes(userId)) throw new Error('你已在房间中')
    const free = this.seatList.find((s) => s.userId === null)
    if (!free) throw new Error('座位已满')
    free.userId = userId
    free.online = true
    return free.index
  }

  leave(userId: string): void {
    const seat = this.seatList.find((s) => s.userId === userId)
    if (!seat) return
    if (this.started) {
      seat.online = false
      seat.isAi = true
      return
    }
    seat.userId = null
    seat.online = false
    seat.isAi = false
  }

  setOnline(userId: string, online: boolean): void {
    const seat = this.seatList.find((s) => s.userId === userId)
    if (seat) {
      seat.online = online
      if (online) seat.isAi = false
    }
  }

  start(): void {
    if (this.started) throw new Error('本局已开局')
    const players = this.players()
    if (players.length < 2) throw new Error('至少需要 2 人才能开局')
    this.seed = this.seedSource()
    const engine = getEngine(this.gameId)
    this.state = engine.init({ seed: this.seed, players, options: this.options })
    this.started = true
    this.actions = []
    this.pendingSettlement = null
  }

  act(userId: string, action: unknown): { events: GameEvent[] } {
    if (!this.started) throw new Error('本局尚未开局')
    const engine = getEngine(this.gameId)
    if (!engine.isLegal(this.state, userId, action)) {
      throw new Error('非法动作')
    }
    const result = engine.apply(this.state, userId, action)
    this.state = result.state
    this.actions.push({ playerId: userId, action })

    if (engine.isOver(this.state)) {
      const settlement = engine.settle(this.state)
      assertZeroSum(settlement)
      this.pendingSettlement = {
        roomId: this.id,
        gameId: this.gameId,
        seed: this.seed,
        players: this.players(),
        actions: [...this.actions],
        deltas: settlement.deltas,
      }
      this.started = false
    }
    return { events: result.events }
  }

  /** 领取并清空本局结算，只能领一次 */
  takeSettlement(): SettlementRecord | null {
    const rec = this.pendingSettlement
    this.pendingSettlement = null
    return rec
  }

  viewFor(userId: string | null): unknown {
    if (this.state === null) return null
    return getEngine(this.gameId).view(this.state, userId)
  }

  seatInfos(): SeatInfo[] {
    return this.seatList.map((s) => ({
      index: s.index,
      userId: s.userId,
      nickname: s.userId ? (this.nicknames.get(s.userId) ?? null) : null,
      online: s.online,
      isAi: s.isAi,
    }))
  }
}

/** 把一局的结算写入账本与战绩，并对负债玩家自动还款。全程单事务。 */
export function settleToLedger(db: DatabaseSync, record: SettlementRecord): void {
  const total = Object.values(record.deltas).reduce((a, b) => a + b, 0)
  if (total !== 0) throw new Error(`结算违反零和约束：总和为 ${total}`)

  const lines = Object.entries(record.deltas)
    .filter(([, delta]) => delta !== 0)
    .map(([userId, delta]) => ({ account: userAccount(userId), delta }))

  // 过账、战绩、自动还款必须是一个原子单元：任何一步单独生效都会让
  // 账本、借条与战绩三者互相对不上，而全局零和校验查不出这种不一致。
  withTransaction(db, () => {
    if (lines.length > 0) {
      postTransaction(db, lines, 'game_settle', record.roomId)
    }

    db.prepare(
      `INSERT INTO match_records (id, room_id, game_id, seed, players, actions, deltas, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(),
      record.roomId,
      record.gameId,
      record.seed,
      JSON.stringify(record.players),
      JSON.stringify(record.actions),
      JSON.stringify(record.deltas),
      Date.now(),
    )

    for (const [userId, delta] of Object.entries(record.deltas)) {
      if (delta > 0) autoRepay(db, userId)
    }
  })
}

export class RoomManager {
  private rooms = new Map<string, Room>()

  create(opts: { gameId: string; ownerId: string; seats: number; options: Record<string, unknown> }): Room {
    let id = ''
    for (let i = 0; i < 50; i++) {
      const candidate = String(randomInt(100000, 1000000))
      if (!this.rooms.has(candidate)) {
        id = candidate
        break
      }
    }
    if (id === '') throw new Error('房间号分配失败')
    const room = new Room({ ...opts, id })
    this.rooms.set(id, room)
    return room
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  remove(id: string): void {
    this.rooms.delete(id)
  }

  list(): Room[] {
    return [...this.rooms.values()]
  }
}
