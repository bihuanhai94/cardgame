import { assertZeroSum, createRng, type Engine } from '@cardgame/shared'

export interface FuzzResult {
  rounds: number
  actions: number
}

export interface FuzzOpts<S = unknown> {
  rounds: number
  players: string[]
  options?: Record<string, unknown>
  maxSteps?: number
  /** 尝试投递一个必定非法的动作，验证引擎会拒绝 */
  probeIllegal?: boolean
  /** 在非 owner 的视图里搜索该字符串，出现即视为泄漏（静态、全程固定的探针） */
  secretProbe?: string
  secretOwner?: string
  /**
   * 按局给出探针：拿到的是 fuzzEngine 刚为该局 init 出来的初始状态（种子与内部
   * `round + 1` 完全一致，调用方不必也不能自己重新派生种子），据此返回该局专属
   * 的 { probe, owner }；返回 null/undefined 则跳过该局的泄漏检查。优先于
   * 静态的 secretProbe/secretOwner。
   */
  secretFor?: (round: number, initialState: S) => { probe: string; owner: string } | null | undefined
}

/**
 * 随机对局自测。逐局断言三项不变量：
 * 1. 结算总和为 0
 * 2. 无非法动作被接受
 * 3. 无死锁（有限步内结束）
 * 另可选检查视图裁剪是否泄漏他人信息——只在对局进行中检查（!engine.isOver），
 * 终局摊牌是引擎的正当行为，不应被计为泄漏。
 */
export function fuzzEngine<S, A>(engine: Engine<S, A>, opts: FuzzOpts<S>): FuzzResult {
  const maxSteps = opts.maxSteps ?? 500
  let actionCount = 0

  for (let round = 0; round < opts.rounds; round++) {
    const rng = createRng(round + 1)
    let state = engine.init({
      seed: round + 1,
      players: [...opts.players],
      options: opts.options ?? {},
    })

    // 按局解析这一局专属的泄漏探针：secretFor 拿到的就是上面这个 init 出来的
    // 初始状态本身，不会重新派生种子，因此不会跟内部 round+1 的种子失配。
    // 提供了 secretFor 但该局返回 null/undefined 时，视为「这一局不检查」，
    // 不会退回静态 secretProbe/secretOwner（那样会检查错误的一局）。
    let secretProbe = opts.secretProbe
    let secretOwner = opts.secretOwner
    if (opts.secretFor) {
      const perRound = opts.secretFor(round, state)
      secretProbe = perRound?.probe
      secretOwner = perRound?.owner
    }

    let steps = 0
    while (!engine.isOver(state)) {
      if (steps++ >= maxSteps) {
        throw new Error(`第 ${round} 局死锁：超过 ${maxSteps} 步仍未结束`)
      }

      const movable = opts.players.filter((p) => engine.legalActions(state, p).length > 0)
      if (movable.length === 0) {
        throw new Error(`第 ${round} 局死锁：无人有合法动作但对局未结束`)
      }

      const actor = movable[Math.floor(rng() * movable.length)]!
      const legal = engine.legalActions(state, actor)

      if (opts.probeIllegal) {
        const illegal = { type: '__illegal__' } as unknown as A
        if (!engine.isLegal(state, actor, illegal)) {
          let rejected = false
          try {
            engine.apply(state, actor, illegal)
          } catch {
            rejected = true
          }
          if (!rejected) {
            throw new Error(`第 ${round} 局接受了非法动作`)
          }
        }
      }

      if (secretProbe && secretOwner) {
        for (const viewer of [...opts.players, null]) {
          if (viewer === secretOwner) continue
          const json = JSON.stringify(engine.view(state, viewer))
          if (json.includes(secretProbe)) {
            throw new Error(`第 ${round} 局视图泄漏：${viewer ?? '观战者'} 看到了他人信息`)
          }
        }
      }

      const action = legal[Math.floor(rng() * legal.length)]!
      state = engine.apply(state, actor, action).state
      actionCount++
    }

    assertZeroSum(engine.settle(state))
  }

  return { rounds: opts.rounds, actions: actionCount }
}
