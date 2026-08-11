# 1a 炸金花 + 牌桌界面 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让平台真的能开一局炸金花——含闷牌、比牌、封顶，配上定稿的牌桌界面与掉线托管 AI。

**Architecture:** 先修一个会阻塞所有参数化动作的技术债（`Room.act` 的动作校验），再自下而上建三层：`hands/three.ts`（纯牌力）→ `betting/round.ts`（共享下注轮）→ `games/zhajinhua.ts`（引擎）。前端把 `docs/design/table-ui/` 的参考实现移植成 React 组件，接上真实引擎状态。

**Tech Stack:** 沿用 0 期——TypeScript、Vitest、Fastify、ws、node:sqlite、React 19、Vite 5.4、Zustand、Tailwind 4。不新增运行时依赖。

## Global Constraints

- 运行时锁定 **Node.js 22 的非官方 `linux-x64-glibc-217` 构建**。禁止原生模块。
- `node:sqlite` 只能在 `packages/server/src/db/sqlite.ts` 中以值形式导入；其他文件一律 `import type`。
- 禁止 `@ts-ignore` / `@ts-expect-error`。`npx tsc -b` 必须保持零错误。
- **游戏引擎必须是纯函数**：不读时钟、不用全局随机，随机性只来自 `ctx.seed`。
- **视图裁剪**：`view(state, viewerId)` 的返回值直接上网络包。他人暗牌不得出现，`viewerId === null` 为观战者。
- **结算零和**：`settle` 的 deltas 之和恒为 0。所有金额为**整数**金币。
- **筹码本体绝不做 2D 旋转**；**底池累积而非按总额重算**；**底池只追加 DOM 节点**；**筹码落点只依赖自身序号**。（详见 `docs/design/table-ui/README.md`）
- **音效全部 WebAudio 合成**，不加载音频文件。**牌面牌背一律 SVG**，禁止位图。
- 首屏 gzip **≤ 300KB**；玩法代码按需加载。
- 炸金花规则以 `docs/superpowers/specs/2026-08-11-phase1-design.md` §3 为准（**国际标准**）：**顺子 > 金花**；闷注 = 明注一半；看牌后才可比牌；封顶 10 轮；**不用花色决胜，比牌平局时发起方判负**。
- 超时 **20 秒**，超时自动弃牌（可免费过牌时自动过牌）。

**已知修订：** Task 2 的测试夹具在首次执行时发现三处错误，已在本文件中更正 —— 两处「非顺子牌型」的样例误用了连号牌（`s13 s12 s11` 其实是顺金，`s13 h12 d11` 其实是顺子），以及反对称断言在平局时踩到 `Math.sign` 的 `-0` 与 `Object.is` 的坑。挑选牌型样例时务必回头确认它不是更高的牌型。

**关于本计划的代码密度：** 正确性关键的模块（牌力、下注轮、引擎状态机、校验器）给出完整实现代码。UI 任务的权威参考是 `docs/design/table-ui/` 里已验证的实现，计划给出组件划分与接线契约，不重复粘贴 500 行样式——那些文件本身就是规格。每个任务的**测试用例是行为契约**，实现必须让它们通过。

---

## File Structure

```
packages/shared/src/
  engine.ts                 扩展 Engine 接口：新增 isLegal
  hands/three.ts            三张牌牌型识别与全序比较
  betting/round.ts          共享下注轮状态机

packages/server/src/
  room/room.ts              act() 改用 engine.isLegal
  games/highcard.ts         补 isLegal（保持既有玩法可用）
  games/zhajinhua.ts        炸金花引擎
  ai/zhajinhua.ts           规则型 AI / 托管策略
  testing/fuzz.ts           probeIllegal 改用 isLegal；secretProbe 只在对局中检查

packages/web/src/
  ui/chips/Chip.tsx         单枚筹码
  ui/chips/ChipPile.tsx     码摞（玩家）
  ui/chips/ChipHeap.tsx     乱堆（底池），累积式
  ui/chips/flyChips.ts      飞行动画
  ui/CardFace.tsx           牌面（已有 Card.tsx 扩展：加牌背花纹）
  ui/useRollup.ts           数字滚动 hook
  sfx/index.ts              WebAudio 音效
  pages/TableZjh.tsx        炸金花牌桌
  table/Seat.tsx            座位
  table/BetArea.tsx         下注区
  table/ActionBar.tsx       操作区（跟/加/弃/看牌/比牌）
```

---

### Task 1: 引擎契约扩展 —— 用校验器取代动作枚举比对

**Files:**
- Modify: `packages/shared/src/engine.ts`
- Modify: `packages/server/src/room/room.ts`
- Modify: `packages/server/src/games/highcard.ts`
- Modify: `packages/server/src/testing/fuzz.ts`
- Test: `packages/server/src/room/room.test.ts`
- Test: `packages/server/src/games/highcard.test.ts`

**Interfaces:**
- Consumes: 现有 `Engine<S, A>`、`Room.act`、`fuzzEngine`
- Produces: `Engine.isLegal(state, playerId, action): boolean`（必选成员）；`Room.act` 与 `fuzzEngine` 均改用它

**为什么必须先做这个：** `Room.act` 现在用 `JSON.stringify(a) === JSON.stringify(action)` 去比对 `legalActions()` 的枚举结果。炸金花的「加注 N」与「向某人比牌」是参数化动作，枚举不出来；键序不同也会导致合法出牌被拒。不先改，后面每个任务都会撞上。

- [ ] **Step 1: 写失败测试**

在 `packages/server/src/games/highcard.test.ts` 追加：

```ts
describe('isLegal', () => {
  const ctx = { seed: 42, players: ['a', 'b', 'c'], options: { ante: 100 } }

  it('在局且未行动的玩家可以跟注与弃牌', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'a', { type: 'call' })).toBe(true)
    expect(highCard.isLegal(s, 'a', { type: 'fold' })).toBe(true)
  })

  it('拒绝未知动作类型', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'a', { type: '__illegal__' } as never)).toBe(false)
  })

  it('拒绝不在本局的玩家', () => {
    const s = highCard.init(ctx)
    expect(highCard.isLegal(s, 'zzz', { type: 'call' })).toBe(false)
  })

  it('拒绝已行动的玩家', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'call' }).state
    expect(highCard.isLegal(s, 'a', { type: 'call' })).toBe(false)
  })

  it('与 legalActions 一致：legalActions 给出的每个动作都必须 isLegal', () => {
    const s = highCard.init(ctx)
    for (const p of ctx.players) {
      for (const a of highCard.legalActions(s, p)) {
        expect(highCard.isLegal(s, p, a)).toBe(true)
      }
    }
  })
})
```

在 `packages/server/src/room/room.test.ts` 追加：

```ts
describe('Room.act 的动作校验', () => {
  it('接受键序不同但语义相同的动作', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b'); room.start()
    // 客户端 JSON 反序列化后键序可能不同，不能因此拒绝
    expect(() => room.act('a', { type: 'call', extra: undefined } as never)).not.toThrow()
  })

  it('拒绝引擎判定为非法的动作', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b'); room.start()
    expect(() => room.act('a', { type: '__illegal__' })).toThrow(/非法动作/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，`highCard.isLegal is not a function`。

- [ ] **Step 3: 扩展 Engine 接口**

`packages/shared/src/engine.ts` 的 `Engine` 接口中，在 `legalActions` 之后加入：

```ts
  /**
   * 校验一个动作在当前状态下是否合法。
   *
   * 必须用校验而非比对 legalActions 的枚举结果：参数化动作（加注额、
   * 比牌目标）无法穷举，且客户端反序列化后的对象键序不保证一致。
   * 不变量：legalActions 返回的每个动作都必须使本函数返回 true。
   */
  isLegal(state: S, playerId: string, action: A): boolean
```

- [ ] **Step 4: highcard 实现 isLegal**

`packages/server/src/games/highcard.ts` 中，在 `legalActions` 之后加入，并让 `legalActions` 复用同一判定：

```ts
  isLegal(state, playerId, action) {
    if (!state.players.includes(playerId)) return false
    if (state.folded.includes(playerId) || state.acted.includes(playerId)) return false
    return action?.type === 'call' || action?.type === 'fold'
  },
```

`apply` 开头的守卫改为调用它，避免两处判定漂移：

```ts
  apply(state, playerId, action) {
    if (!highCard.isLegal(state, playerId, action)) {
      throw new Error(`非法动作：${(action as { type?: string })?.type ?? '未知'}`)
    }
    // 其余不变
```

- [ ] **Step 5: Room.act 改用 isLegal**

`packages/server/src/room/room.ts` 的 `act()` 中，把枚举比对替换为：

```ts
    const engine = getEngine(this.gameId)
    if (!engine.isLegal(this.state, userId, action)) {
      throw new Error('非法动作')
    }
```

- [ ] **Step 6: fuzz 的非法动作探针改用 isLegal**

`packages/server/src/testing/fuzz.ts` 中 `probeIllegal` 分支：探测动作改为「构造一个 `isLegal` 判定为 false 的动作，断言 `apply` 抛出」。若引擎对该动作 `isLegal` 返回 true（探测动作恰好合法），跳过本次探测而非误报。

```ts
      if (opts.probeIllegal) {
        const illegal = { type: '__illegal__' } as unknown as A
        if (!engine.isLegal(state, actor, illegal)) {
          let rejected = false
          try { engine.apply(state, actor, illegal) } catch { rejected = true }
          if (!rejected) throw new Error(`第 ${round} 局接受了非法动作`)
        }
      }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm test` 然后 `npx tsc -b`
Expected: 全绿；tsc 零错误。

- [ ] **Step 8: 跑 fuzz 确认不变量仍成立**

Run: `pnpm fuzz 100000`
Expected: 通过 100000 局。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "refactor(engine): 动作校验改用 isLegal 取代枚举比对"
```

---

### Task 2: 三张牌牌力评估

**Files:**
- Create: `packages/shared/src/hands/three.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/hands/three.test.ts`

**Interfaces:**
- Consumes: Task 0 期的 `Card`、`Suit`、`Rank`
- Produces:
  - `type ThreeCategory = 'high' | 'pair' | 'straight' | 'flush' | 'straightFlush' | 'trips'`
  - `interface ThreeEval { category: ThreeCategory; score: number; cards: Card[] }`
  - `function evalThree(cards: readonly Card[]): ThreeEval` — 入参必须恰好 3 张，否则抛错
  - `function compareThree(a: ThreeEval, b: ThreeEval): number` — 正数表示 a 大；**点数完全相同时返回 0**（平局由调用方按规则裁定）

**规则要点（国际标准）：** 豹子 > 顺金 > **顺子 > 金花** > 对子 > 单张；A 可作最大或最小，AKQ 最大顺、A23 最小顺；**不使用花色决胜**，点数相同即平局（`compareThree` 返回 0）。

- [ ] **Step 1: 写失败测试**

`packages/shared/src/hands/three.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { evalThree, compareThree } from './three.js'
import type { Card } from '../cards.js'

const C = (s: string): Card[] =>
  s.split(' ').map((t) => ({ suit: t[0] as Card['suit'], rank: Number(t.slice(1)) }))

const ev = (s: string) => evalThree(C(s))
const gt = (a: string, b: string) => expect(compareThree(ev(a), ev(b))).toBeGreaterThan(0)

describe('牌型识别', () => {
  it('豹子', () => { expect(ev('s9 h9 d9').category).toBe('trips') })
  it('顺金', () => { expect(ev('s9 s10 s11').category).toBe('straightFlush') })
  it('金花', () => { expect(ev('s2 s7 s13').category).toBe('flush') })
  it('顺子', () => { expect(ev('s9 h10 d11').category).toBe('straight') })
  it('对子', () => { expect(ev('s9 h9 d4').category).toBe('pair') })
  it('单张', () => { expect(ev('s2 h7 d13').category).toBe('high') })

  it('AKQ 是顺子', () => { expect(ev('s14 h13 d12').category).toBe('straight') })
  it('A23 是顺子', () => { expect(ev('s14 h2 d3').category).toBe('straight') })
  it('AKQ 同花是顺金', () => { expect(ev('s14 s13 s12').category).toBe('straightFlush') })
  it('A23 同花是顺金', () => { expect(ev('s14 s2 s3').category).toBe('straightFlush') })
  it('QKA 之外的 A 高组合不是顺子', () => { expect(ev('s14 h13 d11').category).toBe('high') })
  it('K A 2 不是顺子', () => { expect(ev('s13 h14 d2').category).toBe('high') })
})

describe('牌型之间的大小（国际标准：顺子 > 金花）', () => {
  it('豹子 > 顺金', () => gt('s2 h2 d2', 's14 s13 s12'))
  it('顺金 > 顺子', () => gt('s9 s10 s11', 's14 h13 d12'))
  it('顺子 > 金花', () => gt('s14 h13 d12', 's14 s13 s11'))
  it('最小的顺子 > 最大的金花', () => gt('s14 h2 d3', 's14 s13 s11'))
  it('金花 > 对子', () => gt('s2 s5 s9', 's14 h14 d13'))
  it('对子 > 单张', () => gt('s2 h2 d3', 's14 h13 d11'))
})

describe('同牌型比较', () => {
  it('豹子比点数', () => gt('s14 h14 d14', 's13 h13 d13'))
  it('AKQ 是最大顺子', () => gt('s14 h13 d12', 's11 h12 d13'))
  it('A23 是最小顺子', () => gt('s2 h3 d4', 's14 h2 d3'))
  it('AKQ 同花是最大顺金', () => gt('s14 s13 s12', 's11 s12 s13'))
  it('A23 同花是最小顺金', () => gt('s2 s3 s4', 's14 s2 s3'))
  it('金花逐张比', () => gt('s14 s5 s2', 's13 s9 s4'))   // 注意：不能用连号，否则成了顺金
  it('对子先比对子点数', () => gt('s3 h3 d2', 's2 h2 d14'))
  it('对子相同再比单张', () => gt('s9 h9 d14', 's9 c9 d13'))
  it('单张逐张比', () => gt('s14 h5 d2', 's13 h9 d4'))   // 注意：不能用连号，否则成了顺子
})

describe('平局（国际标准：不用花色决胜）', () => {
  it('点数相同、花色不同的金花判平局', () => {
    expect(compareThree(ev('s14 s13 s11'), ev('h14 h13 h11'))).toBe(0)
  })
  it('点数相同的对子判平局', () => {
    expect(compareThree(ev('s9 h9 d14'), ev('c9 d9 h14'))).toBe(0)
  })
  it('点数相同的单张判平局', () => {
    expect(compareThree(ev('s14 h13 d11'), ev('c14 d13 s11'))).toBe(0)
  })
  it('花色不参与比较：交换花色不改变分数', () => {
    expect(ev('s14 h13 d11').score).toBe(ev('d14 c13 h11').score)
  })
})

describe('入参校验', () => {
  it('不是 3 张时抛错', () => {
    expect(() => evalThree(C('s2 h3'))).toThrow(/3 张/)
    expect(() => evalThree(C('s2 h3 d4 c5'))).toThrow(/3 张/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./three.js`。

- [ ] **Step 3: 实现 three.ts**

```ts
import type { Card, Suit } from '../cards.js'

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
  if (r[2] - r[1] === 1 && r[1] - r[0] === 1) return r[2] // 普通顺（含 QKA=14，最大）
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
```

- [ ] **Step 4: 导出**

`packages/shared/src/index.ts` 追加：

```ts
export * from './hands/three.js'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test` 与 `npx tsc -b`
Expected: 全绿、零错误。

- [ ] **Step 6: 加一个穷举一致性检查**

在测试文件追加：所有 C(52,3) = 22100 种组合两两比较过于昂贵，改为断言「随机 5000 对不同手牌的比较结果非 0，且 compare(a,b) 与 compare(b,a) 严格反号」。

```ts
it('随机 5000 对：比较结果严格反对称', () => {
  const deck = createDeck()
  const rng = createRng(1)
  const pick = () => {
    const s = shuffle(deck, rng).slice(0, 3)
    return evalThree(s)
  }
  for (let i = 0; i < 5000; i++) {
    const a = pick(), b = pick()
    const ab = compareThree(a, b), ba = compareThree(b, a)
    // 用加法而非 Math.sign 比较：平局时 Math.sign 会产生 -0，
    // 而 toBe 用 Object.is，认为 0 与 -0 不等。
    expect(ab + ba).toBe(0)
  }
})
```

（需从 `../cards.js` / `../rng.js` 引入 `createDeck`、`createRng`、`shuffle`。）

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(shared): 三张牌牌力评估与全序比较"
```

---

### Task 3: 共享下注轮状态机

**Files:**
- Create: `packages/shared/src/betting/round.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/betting/round.test.ts`

**Interfaces:**
- Consumes: 无（纯逻辑）
- Produces:
  - `interface BetSeat { id: string; stack: number; committed: number; folded: boolean; allin: boolean; stakeFactor: number }`
  - `interface RoundState { seats: BetSeat[]; turn: number; currentBet: number; minRaise: number; actedSinceRaise: string[]; over: boolean }`
  - `type BetAction = { type: 'fold' } | { type: 'call' } | { type: 'raise'; to: number }`
  - `function startRound(seats, firstToAct, openBet, minRaise): RoundState`
  - `function toCall(rs: RoundState, seatId: string): number` — 该家还需投入多少才算跟上（已按 `stakeFactor` 折算）
  - `function isLegalBet(rs: RoundState, seatId: string, a: BetAction): boolean`
  - `function applyBet(rs: RoundState, seatId: string, a: BetAction): RoundState` — 纯函数，返回新状态
  - `function nextTurn(rs: RoundState): RoundState`
  - `function isRoundOver(rs: RoundState): boolean`

**`stakeFactor` 是什么：** 炸金花的闷牌者按明注的一半跟，`stakeFactor = 0.5`；看牌后变 1。德州所有人恒为 1。把它做成座位属性，两款玩法就能共用同一套「谁该说话 / 跟到多少 / 轮何时结束」的逻辑，而不是各写一套。

**金额取整：** 所有折算后的金额向上取整到整数金币（`Math.ceil`），因为账本只接受整数。

- [ ] **Step 1: 写失败测试**

`packages/shared/src/betting/round.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  startRound, toCall, isLegalBet, applyBet, isRoundOver, type BetSeat,
} from './round.js'

function seats(...specs: Array<[string, number, number?]>): BetSeat[] {
  return specs.map(([id, stack, f]) => ({
    id, stack, committed: 0, folded: false, allin: false, stakeFactor: f ?? 1,
  }))
}

describe('startRound', () => {
  it('记录起始跟注额与最小加注', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(rs.currentBet).toBe(20)
    expect(rs.minRaise).toBe(20)
    expect(rs.turn).toBe(0)
  })
})

describe('toCall', () => {
  it('未投入时等于当前跟注额', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(toCall(rs, 'a')).toBe(20)
  })

  it('闷牌者只需一半', () => {
    const rs = startRound(seats(['a', 1000, 0.5], ['b', 1000]), 0, 20, 20)
    expect(toCall(rs, 'a')).toBe(10)
  })

  it('折算出小数时向上取整', () => {
    const rs = startRound(seats(['a', 1000, 0.5], ['b', 1000]), 0, 25, 25)
    expect(toCall(rs, 'a')).toBe(13)
  })

  it('已投入部分要扣掉', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    expect(toCall(rs, 'a')).toBe(0)
  })
})

describe('isLegalBet', () => {
  it('非当前行动者一律非法', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'b', { type: 'call' })).toBe(false)
  })

  it('已弃牌者非法', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'fold' })
    expect(isLegalBet(rs, 'a', { type: 'call' })).toBe(false)
  })

  it('加注必须达到最小加注幅度', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 39 })).toBe(false)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 40 })).toBe(true)
  })

  it('筹码不足以完成加注时非法（应改为全下跟注）', () => {
    const rs = startRound(seats(['a', 30], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 40 })).toBe(false)
  })

  it('闷牌者的加注能力按折算后的金额判定，而非名义额', () => {
    // 闷牌 factor 0.5：加注到 40 实付 20，30 筹码够；加注到 80 实付 40，不够
    const rs = startRound(seats(['a', 30, 0.5], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 40 })).toBe(true)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 80 })).toBe(false)
  })

  it('闷牌者实付金额与 toCall 的折算口径一致', () => {
    let rs = startRound(seats(['a', 1000, 0.5], ['b', 1000]), 0, 25, 25)
    const before = rs.seats.find((s) => s.id === 'a')!.stack
    rs = applyBet(rs, 'a', { type: 'raise', to: 51 })
    const paid = before - rs.seats.find((s) => s.id === 'a')!.stack
    expect(paid).toBe(Math.ceil(51 * 0.5))   // 26，不是 25.5 也不是 25
  })

  it('筹码不足以跟注时仍可跟（全下）', () => {
    const rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'call' })).toBe(true)
  })
})

describe('applyBet', () => {
  it('跟注扣筹码并累加投入', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    const a = rs.seats.find((s) => s.id === 'a')!
    expect(a.stack).toBe(980)
    expect(a.committed).toBe(20)
  })

  it('筹码不足时跟注变成全下', () => {
    let rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    const a = rs.seats.find((s) => s.id === 'a')!
    expect(a.stack).toBe(0)
    expect(a.allin).toBe(true)
    expect(a.committed).toBe(12)
  })

  it('加注抬高 currentBet 与 minRaise', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'raise', to: 60 })
    expect(rs.currentBet).toBe(60)
    expect(rs.minRaise).toBe(40)
  })

  it('加注重新开放其他人的行动权', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000], ['c', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'call' })
    rs = applyBet(rs, 'c', { type: 'raise', to: 60 })
    expect(isRoundOver(rs)).toBe(false)
    expect(rs.actedSinceRaise).toEqual(['c'])
  })

  it('不修改传入的状态', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    const snapshot = JSON.stringify(rs)
    applyBet(rs, 'a', { type: 'call' })
    expect(JSON.stringify(rs)).toBe(snapshot)
  })
})

describe('isRoundOver', () => {
  it('所有未弃牌者都行动过且投入相等时结束', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'call' })
    expect(isRoundOver(rs)).toBe(true)
  })

  it('只剩一人时结束', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'fold' })
    expect(isRoundOver(rs)).toBe(true)
  })

  it('全下者不阻塞轮结束', () => {
    let rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })   // 全下 12
    rs = applyBet(rs, 'b', { type: 'call' })
    expect(isRoundOver(rs)).toBe(true)
  })
})

describe('轮转', () => {
  it('跳过已弃牌与全下的座位', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000], ['c', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'fold' })
    expect(rs.seats[rs.turn]!.id).toBe('c')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./round.js`。

- [ ] **Step 3: 实现 round.ts**

```ts
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

/**
 * 把名义额度折算成该家还需实付的金额。
 *
 * **这是全模块唯一的取整点。** 折半注会产生小数，若多处各自 Math.ceil，
 * 同一情形会算出不同的数，池子就配不平了 —— 且这种错误要到结算才暴露。
 * 任何需要「按 stakeFactor 折算」的地方都必须走这里。
 */
function needFor(s: BetSeat, nominal: number): number {
  return Math.ceil(nominal * s.stakeFactor) - s.committed
}

/** 该家还需投入多少才算跟上 */
export function toCall(rs: RoundState, seatId: string): number {
  const s = seatOf(rs, seatId)
  if (!s) return 0
  return Math.max(0, needFor(s, rs.currentBet))
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
    return needFor(s, a.to) <= s.stack   // 筹码不够就不能加注，只能全下跟注
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
    const want = a.type === 'call' ? toCall(rs, seatId) : needFor(s, a.to)
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
```

- [ ] **Step 4: 导出并运行测试**

`packages/shared/src/index.ts` 追加 `export * from './betting/round.js'`。

Run: `pnpm test` 与 `npx tsc -b`
Expected: 全绿、零错误。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(shared): 共享下注轮状态机"
```

---

### Task 4: 炸金花引擎

**Files:**
- Create: `packages/server/src/games/zhajinhua.ts`
- Modify: `packages/server/src/main.ts`（注册引擎）
- Test: `packages/server/src/games/zhajinhua.test.ts`

**Interfaces:**
- Consumes: `createDeck`/`createRng`/`shuffle`；Task 2 的 `evalThree`/`compareThree`；Task 3 的 `startRound`/`toCall`/`isLegalBet`/`applyBet`/`isRoundOver`；`Engine` 契约（含 Task 1 的 `isLegal`）
- Produces:
  - `const zhajinhua: Engine<ZjhState, ZjhAction>`，玩法 id `'zhajinhua'`
  - `type ZjhAction = { type:'look' } | { type:'fold' } | { type:'call' } | { type:'raise'; to:number } | { type:'compare'; targetId:string }`
  - `interface ZjhState`（见下）

**状态形状：**

```ts
export interface ZjhState {
  players: string[]
  ante: number
  maxRounds: number            // 封顶轮数，默认 10
  hands: Record<string, Card[]>       // 每人 3 张
  looked: string[]             // 已看牌的玩家
  folded: string[]
  round: number                // 已完成的下注轮数
  bet: RoundState              // 共享下注轮状态
  pot: number                  // 已收入池的部分
  compares: Array<{ from: string; to: string; winner: string }>  // 比牌记录（不含牌面）
  over: boolean
  winner: string | null
}
```

**规则实现要点：**

1. `init` 发 3 张给每人，所有人 `stakeFactor = 0.5`（闷牌），底注按明注计入。
2. `look` 把该玩家加入 `looked`，其 `stakeFactor` 改为 1。看牌**不消耗行动权**——同一回合看完仍需跟/加/弃/比。
3. `compare` 只有 `looked` 双方之间可发起，需支付与当前明注相等的注额；比较 `evalThree`，输者进 `folded`；**平局时发起方判负**（国际标准）；记录只存 `winner`，**不存牌面**。
4. 达到 `maxRounds` 后 `legalActions` 不再包含 `raise`，只剩 `call` / `fold` / `compare`。
5. 只剩一人时 `over = true`，`winner` 为该人。
6. `settle`：赢家得 `pot - 自己投入`，其余各得 `-自己投入`。断言总和为 0。
7. `view`：`hands` 只含 viewer 自己的（且 viewer 必须已 `look`，未看牌时连自己的都不给——这是闷牌的核心体验）；`over` 后公开所有未弃牌者的手牌；`compares` 只给出参与方与胜者，不给牌面。

- [ ] **Step 1: 写测试（行为契约）**

`packages/server/src/games/zhajinhua.test.ts` 至少覆盖：

```
init
  - 每人 3 张、无重复
  - 同 seed 发相同牌、不同 seed 不同
  - 初始所有人处于闷牌（looked 为空）
  - 初始底池 = 底注 × 人数

看牌
  - look 后进入 looked，stakeFactor 变 1
  - 未看牌时 view 里连自己的手牌都看不到
  - 看牌后 view 里能看到自己的、看不到别人的
  - 重复 look 非法
  - 已弃牌者 look 非法

闷牌注额
  - 闷牌者跟注只需明注的一半
  - 折算出小数时向上取整
  - 看牌后跟注恢复全额

比牌
  - 闷牌者不能发起比牌
  - 不能向闷牌者比牌
  - 不能向已弃牌者比牌
  - 不能向自己比牌
  - 比牌需支付与明注相等的注额
  - 输者进入 folded、赢者继续
  - 平局时发起方判负（构造两手同分的牌验证）
  - compares 记录里不含任何牌面
  - 剩两人时比牌直接决出胜负

封顶
  - 达到 maxRounds 后 legalActions 不含 raise
  - 达到 maxRounds 后 raise 被 isLegal 拒绝
  - 封顶后仍可 call / fold / compare

结算
  - 只剩一人时 over、winner 正确
  - settle 的 deltas 之和恒为 0
  - 赢家所得 = 其他人投入之和
  - 弃牌者只输自己已投入的部分

isLegal 与 legalActions 一致
  - legalActions 给出的每个动作都必须 isLegal
  - 非当前行动者的任何动作都非法

视图裁剪
  - 序列化后的 view 不含他人牌面（用 JSON.stringify 搜索验证）
  - 观战者（viewerId=null）看不到任何手牌
  - over 后所有未弃牌者手牌公开
```

- [ ] **Step 2: 运行确认失败** → `pnpm test`

- [ ] **Step 3: 实现引擎**

按上述状态形状与规则要点实现。三处最易写错、必须特别小心：

- **闷牌折算的取整**：所有折算金额 `Math.ceil`，且必须在 `toCall` 一处完成，不要在调用点各自取整——否则两处会算出不同的数。
- **比牌的支付与结算顺序**：先扣注额进池，再比较、再判定出局。反过来会让输者少付一次注。
- **平局判负的方向**：`compareThree` 返回 0 时判**发起方**输。写反了会让主动比牌变成稳赚不赔。
- **`view` 对未看牌者的处理**：未 `look` 的玩家连自己的牌都不能看到。这是闷牌玩法的核心，漏了就等于所有人都在明牌。

- [ ] **Step 4: 注册引擎**

`packages/server/src/main.ts` 中 `registerEngine(highCard)` 之后追加 `registerEngine(zhajinhua)`。

- [ ] **Step 5: 运行测试与 tsc** → 全绿、零错误

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(games): 炸金花引擎（闷牌/比牌/封顶）"
```

---

### Task 5: 炸金花接入 fuzz，并修好 secretProbe

**Files:**
- Modify: `packages/server/src/testing/fuzz.ts`
- Modify: `packages/server/src/testing/run-fuzz.ts`
- Test: `packages/server/src/testing/fuzz.test.ts`

**Interfaces:**
- Produces: `run-fuzz.ts` 支持按玩法 id 选择引擎；`secretProbe` 改为只在对局进行中检查

**secretProbe 为什么必须改：** 现在的实现在终局也检查视图泄漏，而牌类游戏终局普遍摊牌，对任何真实引擎都会误报。0 期因此一直没启用它——也就是说**视图裁剪的自动化保证目前是缺的**。

改法：`fuzzEngine` 的泄漏检查只在 `!engine.isOver(state)` 时执行。终局的公开是引擎的正当行为。

- [ ] **Step 1: 写测试**

```
- secretProbe 在对局进行中能检出泄漏（用已有的 leaky 假引擎）
- secretProbe 不再因终局摊牌而误报（新增一个「进行中裁剪正确、终局公开」的假引擎，断言不抛）
- 炸金花跑 20000 局 fuzz（probeIllegal + secretProbe 全开）不抛
```

- [ ] **Step 2: 确认失败** → 终局摊牌的假引擎当前会误报

- [ ] **Step 3: 实现**

`fuzz.ts` 中把泄漏检查移入 `while (!engine.isOver(state))` 循环内，并删除循环后的那次终局检查。

`run-fuzz.ts` 改为读取第一个参数作为玩法 id：

```ts
const gameId = process.argv[2] ?? 'highcard'
const rounds = Number(process.argv[3] ?? 100000)
```

并按 id 取引擎与对应的 players/options。

- [ ] **Step 4: 跑长测**

Run: `pnpm fuzz zhajinhua 100000`
Expected: 通过，报告局数、动作数与耗时。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(server): 炸金花接入 fuzz，secretProbe 只在对局中检查"
```

---

### Task 6: 协议与网关接入

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/server/src/ws/gateway.ts`
- Modify: `packages/server/src/http/routes.ts`
- Test: `packages/server/src/ws/gateway.test.ts`

**Interfaces:**
- Produces：`roomState` 增加 `gameId`；房间创建接受 `gameId: 'zhajinhua'` 与 `options: { ante, maxRounds }`；网关的 `action` 分支对炸金花动作透传（引擎负责校验，网关不做玩法判断）

**要点：** 网关**不应该**认识任何玩法的动作类型。它只负责鉴权、找房间、把动作交给引擎、把裁剪后的视图分发出去。所有玩法判断留在引擎里。

- [ ] **Step 1: 写测试**

```
- 创建 gameId='zhajinhua' 的房间成功
- 未注册的 gameId 返回 400（既有行为，回归）
- 房主开局后，两个连接各自收到自己的裁剪视图
- 比牌动作经网关透传后被引擎正确处理
- 非法动作（如向闷牌者比牌）返回 ILLEGAL_ACTION，房间状态不变
- roomState 携带 gameId
```

- [ ] **Step 2-4: 确认失败 → 实现 → 确认通过**

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 协议与网关接入炸金花"
```

---

### Task 7: 筹码组件移植为 React

**Files:**
- Create: `packages/web/src/ui/chips/Chip.tsx`
- Create: `packages/web/src/ui/chips/ChipPile.tsx`
- Create: `packages/web/src/ui/chips/ChipHeap.tsx`
- Create: `packages/web/src/ui/chips/flyChips.ts`
- Create: `packages/web/src/ui/chips/denoms.ts`
- Create: `packages/web/src/ui/chips/chips.css`
- Create: `packages/web/src/ui/useRollup.ts`
- Test: `packages/web/src/ui/chips/chips.test.tsx`

**权威参考：** `docs/design/table-ui/chips.css` 与 `chips.js`。那是已验证的实现，移植时**逻辑不要重新发明**，只做 React 化。

**Interfaces:**
- Produces:
  - `breakdown(amount, cap): Denom[]`
  - `<ChipPile amount={n} width={n} perCol={n} />` — 码摞
  - `<ChipHeap ref={r} boxW={n} boxH={n} />`，`ref.current.add(denoms)` / `.clear()` — 累积式乱堆
  - `flyChips(fromEl, toEl, amount, opts): Promise<Denom[]>`
  - `useRollup(value): string` — 数字滚动

**必须保留的行为（来自参考实现，写成测试）：**

```
- 面额拆分：8420 → 8×1000 + 4×100 + 4×5
- ChipHeap.add 只追加 DOM 节点，不重建已有节点
  （断言：add 两次后，第一次生成的节点对象仍在 DOM 中且未被替换）
- 筹码元素上不出现 transform: rotate（本体不旋转）
  （断言：渲染后任一 .chip3d 的 style.transform 不含 'rotate'）
- 落点只依赖序号：同一序号在不同总额下位置一致
- flyChips 返回它实际飞了哪些面额
- ChipPile 分摞：超过 perCol 自动开新摞
```

- [ ] **Step 1-5: 写测试 → 确认失败 → 移植实现 → 确认通过 → 提交**

```bash
git commit -m "feat(web): 筹码组件（码摞/乱堆/飞行/滚动）"
```

---

### Task 8: 音效与牌面

**Files:**
- Create: `packages/web/src/sfx/index.ts`
- Modify: `packages/web/src/ui/Card.tsx`（牌背加菱形网格花纹）
- Test: `packages/web/src/sfx/index.test.ts`
- Test: `packages/web/src/ui/Card.test.tsx`（追加）

**权威参考：** `docs/design/table-ui/sfx.js`，以及 `demo.html` 里的 `back()` 函数。

**Interfaces:**
- Produces: `SFX.chip()` / `.chips(n)` / `.deal()` / `.turn()` / `.win()` / `.fold()` / `.toggle()` / `.enabled`

**测试要点（jsdom 无 WebAudio，用桩验证行为而非听感）：**

```
- 未启用时不创建 AudioContext
- toggle 切换 enabled
- 静音时调用各音效不抛异常、不创建节点
- 牌背含菱形网格路径且不含任何 <img> 或 data: URI
- 牌背不含任何点数或花色文字（回归：牌背绝不能泄漏牌面）
```

- [ ] **Step 1-5: 写测试 → 失败 → 实现 → 通过 → 提交**

```bash
git commit -m "feat(web): WebAudio 音效与牌背花纹"
```

---

### Task 9: 炸金花牌桌页面

**Files:**
- Create: `packages/web/src/pages/TableZjh.tsx`
- Create: `packages/web/src/table/Seat.tsx`
- Create: `packages/web/src/table/BetArea.tsx`
- Create: `packages/web/src/table/ActionBar.tsx`
- Modify: `packages/web/src/store.ts`（炸金花视图类型与动作）
- Modify: `packages/web/src/App.tsx`（按 gameId 路由到对应牌桌）
- Test: `packages/web/src/pages/TableZjh.test.tsx`

**权威参考：** `docs/design/table-ui/demo.html` 的布局与座位坐标。

**Interfaces:**
- Produces: `<TableZjh />`；store 新增 `look()` / `callBet()` / `raiseTo(n)` / `foldHand()` / `compareWith(id)`

**交互要点：**

- 未看牌时自己的两张牌显示为牌背，操作区多一个「看牌」按钮。
- 看牌后「比牌」按钮出现，点击进入选人状态，点某个已看牌的对手确认发起。
- 只有轮到自己时操作区可点（复用 demo 里 `.actions.live` 的做法）。
- 封顶后「加注」按钮变灰并提示「已封顶，只能跟注或比牌」。
- 20 秒倒计时环绕头像，归零自动弃牌（可免费跟注时自动跟）。

**测试要点：**

```
- 未看牌时自己的牌渲染为牌背，且 DOM 中不含自己的点数
- 点「看牌」后发出 { type:'look' }，牌面翻开
- 不是自己回合时操作区按钮禁用
- 封顶状态下加注按钮禁用
- 比牌选人：只有已看牌且未弃牌的对手可选
- 收到 settled 后展示结算并刷新净资产
```

- [ ] **Step 1-6: 写测试 → 失败 → 实现 → 通过 → 体积门禁 → 提交**

Run: `pnpm check-size`（首屏 gzip ≤ 300KB；超了就把 TableZjh 改为 `React.lazy`）

```bash
git commit -m "feat(web): 炸金花牌桌页面"
```

---

### Task 10: 炸金花 AI 与掉线托管

**Files:**
- Create: `packages/server/src/ai/zhajinhua.ts`
- Modify: `packages/server/src/room/room.ts`（超时与托管驱动）
- Test: `packages/server/src/ai/zhajinhua.test.ts`
- Test: `packages/server/src/room/room.test.ts`（追加托管测试）

**新增职责（来自 Task 9 的移交）：** 20 秒倒计时与超时自动出牌一并在本任务实现。Task 9 刻意没做，因为客户端单独倒计时而服务端不会代打，只会让玩家看着数字归零然后什么都不发生。计时策略与 `Room.autoAct` 必须同时落地。

**Interfaces:**
- Produces:
  - `function decideZjh(view: unknown, playerId: string, opts): ZjhAction` — 纯函数，输入是**裁剪后的视图**（AI 不得看到他人手牌）
  - `Room.autoAct(userId)` — 超时或托管时代打一步

**AI 策略（规则型，保守）：**

| 情况 | 决策 |
|---|---|
| 闷牌且轮数 < 3 | 跟注（闷注便宜） |
| 闷牌且轮数 ≥ 3 | 看牌 |
| 已看牌，豹子/顺金/金花 | 跟注；若可加注且轮数 < 封顶一半，加最小注 |
| 已看牌，顺子/对子 | 跟注 |
| 已看牌，单张且跟注额 > 底池 1/4 | 弃牌 |
| 其他 | 跟注 |

**关键约束：AI 只能看裁剪后的视图。** 测试必须断言 `decideZjh` 的入参里不含他人手牌——如果 AI 能看到全局状态，它就是个作弊器，而且这个错误在对局中完全看不出来。

**测试要点：**

```
- decideZjh 是纯函数：同输入同输出
- 传入的视图里不含他人手牌（构造带他人手牌的对象，断言 AI 不读取——用 Object.freeze + getter 陷阱验证）
- 各档牌力的决策符合上表
- 返回的动作必定通过 zhajinhua.isLegal
- 超时后 Room.autoAct 产生合法动作并推进对局
- 掉线玩家被标记 isAi 后，对局不会卡死（10 万局 fuzz 中随机让玩家掉线）
```

- [ ] **Step 1-5: 写测试 → 失败 → 实现 → 通过 → 提交**

```bash
git commit -m "feat(server): 炸金花规则型 AI 与掉线托管"
```

---

### Task 11: 端到端与真机验证

**Files:**
- Create: `packages/server/src/testing/e2e-zjh.mjs`
- Modify: `docs/design/table-ui/README.md`（标注哪些已移植进生产代码）

- [ ] **Step 1: 脚本化端到端**

用 HTTP + WebSocket 脚本（不依赖浏览器）跑通：三个账号注册 → 房主建炸金花房 → 三人入座 → 开局 → 一人看牌 → 一人闷跟 → 发起比牌 → 结算 → 断言三人净资产之和守恒、账本全局零和成立。

Run: `node --experimental-sqlite packages/server/src/testing/e2e-zjh.mjs`
Expected: 全部断言通过，输出完整时序。

- [ ] **Step 2: 真机验证（需人工）**

在真实手机浏览器打开，验证 9 人满桌时：

- 座位、公共区、操作区不重叠
- 小尺寸筹码仍能分辨面额颜色
- 音效在手机静音模式下不报错
- 倒计时与自动弃牌工作正常

**这一步子代理做不了**，必须由人操作。计划执行到此暂停，把验证清单交给使用者。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "test: 炸金花端到端脚本与真机验证清单"
```

---

### Task 12: 房间选项硬化（审查发现的补漏）

**背景：** Task 6 的审查指出，`POST /api/rooms` 的 `options` 是**客户端直接影响账本的一条路径**，而当前只在引擎里做了 `typeof === 'number'` 检查。三种取值会造成真实后果，且都是"手滑填错"就能触发的：

| 取值 | 后果 |
|---|---|
| `ante` 为负 | 底池为负，赢家实际在赔钱 |
| `ante` 为小数 | 结算时账本拒收非整数，房间在结算那一刻卡死 |
| `maxRounds: 0` | 开局即封顶，全场只能弃牌或比牌 |

**Files:**
- Modify: `packages/server/src/games/zhajinhua.ts`（`init` 校验）
- Modify: `packages/server/src/http/routes.ts`（建房前拒绝明显非法的选项）
- Test: `packages/server/src/games/zhajinhua.test.ts`
- Test: `packages/server/src/http/routes.test.ts`

**Interfaces:**
- Produces: `zhajinhua.init` 对非法 options 抛出中文错误；`POST /api/rooms` 对非法 options 返回 400

- [ ] **Step 1: 写失败测试**

引擎侧：

```ts
describe('options 校验', () => {
  const mk = (options: Record<string, unknown>) =>
    () => zhajinhua.init({ seed: 1, players: ['a', 'b'], options })

  it('拒绝非正整数底注', () => {
    expect(mk({ ante: 0 })).toThrow(/底注/)
    expect(mk({ ante: -100 })).toThrow(/底注/)
    expect(mk({ ante: 10.5 })).toThrow(/底注/)
  })

  it('拒绝小于 1 的封顶轮数', () => {
    expect(mk({ ante: 100, maxRounds: 0 })).toThrow(/封顶/)
    expect(mk({ ante: 100, maxRounds: -1 })).toThrow(/封顶/)
    expect(mk({ ante: 100, maxRounds: 2.5 })).toThrow(/封顶/)
  })

  it('缺省值仍然可用', () => {
    expect(() => zhajinhua.init({ seed: 1, players: ['a', 'b'], options: {} })).not.toThrow()
  })
})
```

HTTP 侧：断言 `POST /api/rooms` 携带 `{ante: -100}` 时返回 400，且**房间未被创建**（`GET /api/rooms` 数量不变）——只返回错误但留下孤儿房间同样是缺陷。

- [ ] **Step 2: 确认失败** → `pnpm test`

- [ ] **Step 3: 实现**

引擎 `init` 开头校验：`ante` 必须是正整数，`maxRounds` 必须是 ≥1 的整数；缺省时用默认值（`ante` 100、`maxRounds` 10）。错误信息用中文，与全仓风格一致。

路由侧在 `getEngine(gameId)` 之后、`rooms.create` 之前做同样的校验，使非法请求在**任何状态被创建之前**就被拒绝。两处校验共用一个导出的校验函数，避免又出现"同一规则两份拷贝"。

- [ ] **Step 4: 确认通过并跑 fuzz** → `pnpm test` ×3；`pnpm fuzz zhajinhua 20000`

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(server): 房间选项校验，拒绝负数/小数底注与非法封顶轮数"
```

---

### Task 13: 真实筹码约束（根因修复）

**背景：** Task 10 的实现者发现三个 AI 会互相加注到死锁，并在 AI 层加了安全阀。控制器实测确认**根因不在 AI**：两个人类玩家同样可以无限加注——200 次加注后 `round` 仍为 0、牌局毫无推进、注额涨到 20100。

原因有两层：

1. **封顶数的是「已完成的轮数」，而加注战让轮永远完不成。** 这与 Task 4 修掉的死锁是同一形状：封顶挡住的动作，不是让牌局卡住的那个动作。
2. **座位筹码是 `UNLIMITED_STACK = Number.MAX_SAFE_INTEGER`**（引擎从 Task 4 起就是如此）。真实牌桌上加注战会自然终止，因为总有人先没钱；无限筹码抹掉了这个天然边界。

这同时也是一直挂在待办上的另一个问题：**玩家可以承诺超过自己实际余额的金额**，结算时账本会记出他还不起的债。

**Files:**
- Modify: `packages/server/src/games/zhajinhua.ts`（`init` 接受每人初始筹码）
- Modify: `packages/server/src/room/room.ts`（开局时把真实余额喂给引擎）
- Modify: `packages/server/src/ws/gateway.ts`（开局前读取各玩家余额）
- Test: `packages/server/src/games/zhajinhua.test.ts`、`room.test.ts`

**Interfaces:**
- Produces: `EngineContext.options.stacks?: Record<string, number>`；缺省时沿用当前行为以免破坏既有测试

- [ ] **Step 1: 写失败测试**

```
- 传入 stacks 后，玩家加注不得超过自己的筹码
- 筹码耗尽的玩家变为 allin，不再被要求行动
- 双人加注战在筹码耗尽时必然终止（断言有限步内 over）
- 未传 stacks 时行为与现在一致（既有测试不受影响）
- 结算后没有玩家的 contributed 超过其初始筹码
```

- [ ] **Step 2: 确认失败** → `pnpm test`

- [ ] **Step 3: 实现**

`init` 读取 `ctx.options.stacks`，按玩家 id 设置座位筹码；缺省回落到当前的 `UNLIMITED_STACK`。房间在 `start()` 时从账本取各在座玩家的当前余额传入。

**注意**：这会让 `betting/round.ts` 既有的 allin 分支第一次真正生效——那段逻辑写好了但至今从未被触发过，需要重点验证。

- [ ] **Step 4: 确认通过并跑 fuzz** → `pnpm test` ×3；`pnpm fuzz zhajinhua 50000`

- [ ] **Step 5: 复核 AI 安全阀**

真实筹码到位后，Task 10 的 `MAX_RAISE_MULT` 安全阀可能已成冗余。**先不要删**——先确认加注战确实会因筹码耗尽而终止，再判断安全阀是保留为纵深防御还是移除。在报告中说明结论。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "fix(games): 引擎接受真实筹码，加注战因筹码耗尽而终止"
```

---

## 完成标准

1. `pnpm test` 全绿；`npx tsc -b` 零错误
2. `pnpm fuzz zhajinhua 100000` 通过，`probeIllegal` 与 `secretProbe` 均已启用
3. `pnpm check-size` 通过（首屏 gzip ≤ 300KB）
4. 端到端脚本跑通一局含比牌的炸金花，净资产守恒、账本零和成立
5. 真机验证清单人工确认通过
6. 0 期已有的 241 个测试全部仍通过
7. 玩家不能承诺超过自身余额的金额；加注战因筹码耗尽而必然终止
8. 房间选项校验到位：负数/小数底注与 `maxRounds < 1` 均在建房时被拒，且不留下孤儿房间

## 下一步

1a 完成后，用同一流程做 **1b（德州扑克）**：`hands/seven.ts` 7 选 5、边池模块、德州引擎、德州 AI。届时 `betting/round.ts` 已就位，德州只需扩展多轮结构与边池分配。
