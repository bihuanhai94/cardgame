import { assertZeroSum, createRng, type Engine } from '@cardgame/shared'

export interface FuzzResult {
  rounds: number
  actions: number
}

export interface FuzzOpts {
  rounds: number
  players: string[]
  options?: Record<string, unknown>
  maxSteps?: number
  /** 尝试投递一个必定非法的动作，验证引擎会拒绝 */
  probeIllegal?: boolean
  /** 在非 owner 的视图里搜索该字符串，出现即视为泄漏 */
  secretProbe?: string
  secretOwner?: string
}

/**
 * 随机对局自测。逐局断言三项不变量：
 * 1. 结算总和为 0
 * 2. 无非法动作被接受
 * 3. 无死锁（有限步内结束）
 * 另可选检查视图裁剪是否泄漏他人信息。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fuzzEngine<S, A>(engine: Engine<S, A>, opts: FuzzOpts): FuzzResult {
  const maxSteps = opts.maxSteps ?? 500
  let actionCount = 0

  for (let round = 0; round < opts.rounds; round++) {
    const rng = createRng(round + 1)
    let state = engine.init({
      seed: round + 1,
      players: [...opts.players],
      options: opts.options ?? {},
    })

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

      if (opts.secretProbe && opts.secretOwner) {
        for (const viewer of [...opts.players, null]) {
          if (viewer === opts.secretOwner) continue
          const json = JSON.stringify(engine.view(state, viewer))
          if (json.includes(opts.secretProbe)) {
            throw new Error(`第 ${round} 局视图泄漏：${viewer ?? '观战者'} 看到了他人信息`)
          }
        }
      }

      const action = legal[Math.floor(rng() * legal.length)]!
      state = engine.apply(state, actor, action).state
      actionCount++
    }

    assertZeroSum(engine.settle(state))

    // Check for view leaks in terminal state (settlement view not checked in loop)
    if (opts.secretProbe && opts.secretOwner) {
      for (const viewer of [...opts.players, null]) {
        if (viewer === opts.secretOwner) continue
        const json = JSON.stringify(engine.view(state, viewer))
        if (json.includes(opts.secretProbe)) {
          throw new Error(`第 ${round} 局视图泄漏：${viewer ?? '观战者'} 看到了他人信息`)
        }
      }
    }
  }

  return { rounds: opts.rounds, actions: actionCount }
}
