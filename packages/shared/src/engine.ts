export interface EngineContext {
  seed: number
  players: string[]
  options: Record<string, unknown>
}

export interface GameEvent {
  type: string
  payload?: unknown
}

/** 一局结束后各玩家的金币变动，总和必须为 0 */
export interface Settlement {
  deltas: Record<string, number>
}

export interface ApplyResult<S> {
  state: S
  events: GameEvent[]
}

/**
 * 游戏引擎契约。实现必须是纯函数：
 * 不读时钟、不使用全局随机源，全部随机性来自 ctx.seed。
 */
export interface Engine<S, A> {
  readonly id: string
  init(ctx: EngineContext): S
  legalActions(state: S, playerId: string): A[]
  apply(state: S, playerId: string, action: A): ApplyResult<S>
  isOver(state: S): boolean
  settle(state: S): Settlement
  /** viewerId 为 null 表示观战者。返回值不得包含任何他人暗牌。 */
  view(state: S, viewerId: string | null): unknown
}

export interface RecordedAction<A> {
  playerId: string
  action: A
}

export function assertZeroSum(s: Settlement): void {
  const total = Object.values(s.deltas).reduce((a, b) => a + b, 0)
  if (total !== 0) {
    throw new Error(`结算违反零和约束：总和为 ${total}`)
  }
}

export function replay<S, A>(
  engine: Engine<S, A>,
  ctx: EngineContext,
  actions: readonly RecordedAction<A>[],
): S {
  let state = engine.init(ctx)
  for (const rec of actions) {
    state = engine.apply(state, rec.playerId, rec.action).state
  }
  return state
}
