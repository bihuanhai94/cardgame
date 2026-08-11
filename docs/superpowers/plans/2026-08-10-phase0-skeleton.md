# 0 期骨架 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成一个可注册、可加好友、可开房间、可打借条、可看净资产排行的纸牌平台骨架，为后续接入具体玩法做好全部支撑。

**Architecture:** pnpm 单仓三包（shared / server / web）。shared 存放牌、种子化随机、引擎接口与协议类型，前后端共用。server 是 Fastify + ws 单进程，房间状态常驻内存，持久化用 Node 22 内置 `node:sqlite`，金币走复式记账账本。web 是 React + Vite 的 PWA，本期只做登录、大厅、好友、借条、排行与一个空牌桌壳。

**Tech Stack:** TypeScript 5.x、pnpm workspaces、Vitest、Fastify 5、ws 8、node:sqlite（Node 22 内置）、React 19、Vite 6、Zustand、Tailwind 4、GSAP。

## Global Constraints

- 运行时锁定 **Node.js 22 的非官方 `linux-x64-glibc-217` 构建**（部署机 CentOS 7，glibc 2.17）。本地开发也用 Node 22，保持一致。
- **禁止引入任何原生模块（node-gyp / prebuild）**。部署机 gcc 4.8 编译不了现代 C++ 原生扩展。数据库用内置 `node:sqlite`，密码哈希用内置 `node:crypto` 的 scrypt，UUID 用 `node:crypto` 的 `randomUUID`。
- `node:sqlite` 在 Node 22 属实验 API，启动需带 `--experimental-sqlite`。所有启动脚本必须带该 flag。
- **游戏引擎必须是纯函数**：`(状态, 动作) → (新状态, 事件[])`，不得读取时钟或全局随机源。所有随机性来自传入的种子。
- **服务端权威 + 视图裁剪**：任何发往客户端的状态必须经过 `view()` 裁剪，他人手牌不得出现在网络包中。
- **账本零和不变量**：任意一笔交易的所有流水条目 `delta` 之和必须为 0；全库 `SUM(delta)` 恒等于 0。违反即抛异常。
- **排名按净资产**：`净资产 = 余额 + 应收借条 − 应付借条`。任何排行榜查询不得直接按余额排序。
- 借条仅限好友之间；**账号创建未满 7 天不得借出或借入**。
- 借条**不设利息、不设强制期限**。
- 牌面素材一律 **SVG / CSS 绘制**，禁止位图。
- web 首屏包 gzip 后 **≤ 300KB**，玩法代码按需加载。
- 所有金额为**整数**金币，不使用浮点数。
- 新账号初始资金 **10000**，每日签到补给 **200**。
- 时间戳统一用毫秒 Unix 整数（`Date.now()`），数据库存 INTEGER。

---

## File Structure

```
packages/shared/
  src/cards.ts          牌的表示、整副牌构造、序列化
  src/rng.ts            mulberry32 种子随机 + 洗牌
  src/engine.ts         Engine 接口、EngineContext、Settlement 等契约类型
  src/protocol.ts       WebSocket 消息类型（前后端共用）
  src/index.ts          统一导出

packages/server/
  src/db/open.ts        数据库连接与迁移执行器
  src/db/migrations.ts  按序号排列的 SQL 迁移
  src/domain/ledger.ts  复式记账：过账、查余额、全局不变量校验
  src/domain/loans.ts   借条：创建、还款、净资产
  src/domain/users.ts   邀请码、注册、登录、会话
  src/domain/friends.ts 好友请求与关系
  src/domain/ranking.ts 净资产排行
  src/room/room.ts      单个房间的状态机（座位、开局、托管）
  src/room/manager.ts   房间注册表（内存）
  src/room/registry.ts  引擎注册表
  src/http/routes.ts    Fastify 路由装配
  src/ws/gateway.ts     WebSocket 网关（鉴权、路由消息、重连）
  src/main.ts           启动入口

packages/web/
  src/main.tsx          入口
  src/store.ts          Zustand store
  src/net/socket.ts     WebSocket 客户端 + 自动重连
  src/pages/Login.tsx
  src/pages/Lobby.tsx
  src/pages/Friends.tsx
  src/pages/Loans.tsx
  src/pages/Ranking.tsx
  src/pages/Table.tsx   空牌桌壳（1 期填充）
  src/ui/Card.tsx       SVG 牌面组件

deploy/
  cardgame.service      systemd unit
  cardgame.nginx.conf   nginx server 块
```

---

### Task 1: 单仓脚手架与测试基线

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `vitest.workspace.ts`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `pnpm test` 可在仓库根执行并跑通 shared 包的 Vitest 用例；`@cardgame/shared` 包名可被其他包引用。

- [ ] **Step 1: 写一个必失败的冒烟测试**

创建 `packages/shared/src/index.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { VERSION } from './index.js'

describe('shared 包', () => {
  it('导出版本号', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 2: 创建工作区配置**

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'packages/*'
```

根 `package.json`：

```json
{
  "name": "cardgame",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`vitest.workspace.ts`（server 用 node 环境、web 用 jsdom，缺了它两边测试无法共存）：

```ts
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
    },
  },
  {
    test: {
      name: 'server',
      root: './packages/server',
      environment: 'node',
    },
  },
  './packages/web/vite.config.ts',
])
```

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`packages/shared/package.json`：

```json
{
  "name": "@cardgame/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" }
}
```

`packages/shared/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm install && pnpm test`
Expected: FAIL，报错找不到 `./index.js` 或 `VERSION` 未导出。

- [ ] **Step 4: 写最小实现**

`packages/shared/src/index.ts`：

```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS，1 passed。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore: 初始化 pnpm 单仓与 vitest 基线"
```

---

### Task 2: 牌的表示与种子化随机

**Files:**
- Create: `packages/shared/src/cards.ts`
- Create: `packages/shared/src/rng.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/cards.test.ts`
- Test: `packages/shared/src/rng.test.ts`

**Interfaces:**
- Consumes: Task 1 的包结构
- Produces:
  - `type Suit = 's' | 'h' | 'd' | 'c' | 'j'`（j 为王牌专用花色）
  - `type Rank = number`（2-14 为普通牌，14 为 A；15 小王，16 大王）
  - `interface Card { suit: Suit; rank: Rank }`
  - `function createDeck(opts?: { jokers?: boolean; decks?: number }): Card[]`
  - `function cardId(c: Card): string` — 形如 `"s14"`、`"j16"`
  - `function parseCard(id: string): Card`
  - `function createRng(seed: number): () => number` — 返回 [0,1) 的确定性随机
  - `function shuffle<T>(items: readonly T[], rng: () => number): T[]` — 不修改入参

- [ ] **Step 1: 写牌的失败测试**

`packages/shared/src/cards.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createDeck, cardId, parseCard } from './cards.js'

describe('createDeck', () => {
  it('不含王时为 52 张', () => {
    expect(createDeck()).toHaveLength(52)
  })

  it('含王时为 54 张', () => {
    expect(createDeck({ jokers: true })).toHaveLength(54)
  })

  it('两副牌含王为 108 张', () => {
    expect(createDeck({ jokers: true, decks: 2 })).toHaveLength(108)
  })

  it('单副牌无重复', () => {
    const ids = createDeck({ jokers: true }).map(cardId)
    expect(new Set(ids).size).toBe(54)
  })

  it('每门花色 13 张', () => {
    const deck = createDeck()
    for (const s of ['s', 'h', 'd', 'c']) {
      expect(deck.filter((c) => c.suit === s)).toHaveLength(13)
    }
  })
})

describe('cardId / parseCard', () => {
  it('往返转换保持一致', () => {
    for (const card of createDeck({ jokers: true })) {
      expect(parseCard(cardId(card))).toEqual(card)
    }
  })

  it('黑桃 A 的 id 为 s14', () => {
    expect(cardId({ suit: 's', rank: 14 })).toBe('s14')
  })

  it('大王的 id 为 j16', () => {
    expect(cardId({ suit: 'j', rank: 16 })).toBe('j16')
  })

  it('非法 id 抛异常', () => {
    expect(() => parseCard('x99')).toThrow()
  })
})
```

- [ ] **Step 2: 写随机数的失败测试**

`packages/shared/src/rng.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createRng, shuffle } from './rng.js'

describe('createRng', () => {
  it('同种子产生相同序列', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同种子产生不同序列', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('输出落在 [0,1) 区间', () => {
    const r = createRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('同种子洗出相同顺序', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(items, createRng(7))).toEqual(shuffle(items, createRng(7)))
  })

  it('不修改入参', () => {
    const items = [1, 2, 3, 4, 5]
    shuffle(items, createRng(1))
    expect(items).toEqual([1, 2, 3, 4, 5])
  })

  it('保留全部元素', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    const out = shuffle(items, createRng(3))
    expect([...out].sort((a, b) => a - b)).toEqual(items)
  })

  it('确实改变了顺序', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(items, createRng(3))).not.toEqual(items)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到模块 `./cards.js` 与 `./rng.js`。

- [ ] **Step 4: 实现 cards.ts**

```ts
export type Suit = 's' | 'h' | 'd' | 'c' | 'j'
export type Rank = number

export interface Card {
  suit: Suit
  rank: Rank
}

const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c']
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function createDeck(opts: { jokers?: boolean; decks?: number } = {}): Card[] {
  const { jokers = false, decks = 1 } = opts
  const out: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) out.push({ suit, rank })
    }
    if (jokers) {
      out.push({ suit: 'j', rank: 15 })
      out.push({ suit: 'j', rank: 16 })
    }
  }
  return out
}

export function cardId(c: Card): string {
  return `${c.suit}${c.rank}`
}

export function parseCard(id: string): Card {
  const suit = id[0] as Suit
  const rank = Number(id.slice(1))
  const validSuit = suit === 'j' ? true : SUITS.includes(suit)
  const validRank = suit === 'j' ? rank === 15 || rank === 16 : RANKS.includes(rank)
  if (!validSuit || !validRank) throw new Error(`非法牌面 id: ${id}`)
  return { suit, rank }
}
```

- [ ] **Step 5: 实现 rng.ts**

```ts
/** mulberry32：32 位种子的确定性伪随机数生成器 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates，返回新数组，不修改入参 */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
```

- [ ] **Step 6: 更新导出**

`packages/shared/src/index.ts`：

```ts
export const VERSION = '0.1.0'
export * from './cards.js'
export * from './rng.js'
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS，全部用例通过。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(shared): 牌的表示与种子化洗牌"
```

---

### Task 3: 引擎契约与通信协议类型

**Files:**
- Create: `packages/shared/src/engine.ts`
- Create: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/engine.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Card`、`createRng`、`shuffle`
- Produces:
  - `interface EngineContext { seed: number; players: string[]; options: Record<string, unknown> }`
  - `interface GameEvent { type: string; payload?: unknown }`
  - `interface Settlement { deltas: Record<string, number> }` — 各玩家金币变动，总和必须为 0
  - `interface Engine<S, A>`，方法：`id`、`init`、`legalActions`、`apply`、`isOver`、`settle`、`view`
  - `function assertZeroSum(s: Settlement): void` — 总和非 0 时抛异常
  - `function replay<S, A>(engine, ctx, actions): S` — 从动作序列重建状态
  - 协议类型 `ClientMessage` / `ServerMessage`

- [ ] **Step 1: 写失败测试**

`packages/shared/src/engine.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { assertZeroSum, replay, type Engine } from './engine.js'

interface CounterState { turn: number; scores: Record<string, number>; over: boolean }
type CounterAction = { type: 'add'; n: number } | { type: 'stop' }

const counter: Engine<CounterState, CounterAction> = {
  id: 'counter',
  init: (ctx) => ({
    turn: 0,
    scores: Object.fromEntries(ctx.players.map((p) => [p, 0])),
    over: false,
  }),
  legalActions: () => [{ type: 'add', n: 1 }, { type: 'stop' }],
  apply: (state, playerId, action) => {
    if (action.type === 'stop') {
      return { state: { ...state, over: true }, events: [{ type: 'stopped' }] }
    }
    return {
      state: {
        ...state,
        turn: state.turn + 1,
        scores: { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + action.n },
      },
      events: [{ type: 'added', payload: { playerId, n: action.n } }],
    }
  },
  isOver: (state) => state.over,
  settle: (state) => {
    const ids = Object.keys(state.scores)
    const total = ids.reduce((s, id) => s + (state.scores[id] ?? 0), 0)
    const deltas: Record<string, number> = {}
    for (const id of ids) deltas[id] = (state.scores[id] ?? 0) * ids.length - total
    return { deltas }
  },
  view: (state, viewerId) => ({ turn: state.turn, me: viewerId, over: state.over }),
}

describe('assertZeroSum', () => {
  it('总和为 0 时通过', () => {
    expect(() => assertZeroSum({ deltas: { a: 100, b: -100 } })).not.toThrow()
  })

  it('总和非 0 时抛异常', () => {
    expect(() => assertZeroSum({ deltas: { a: 100, b: -50 } })).toThrow(/零和/)
  })

  it('空结算通过', () => {
    expect(() => assertZeroSum({ deltas: {} })).not.toThrow()
  })
})

describe('replay', () => {
  const ctx = { seed: 1, players: ['a', 'b'], options: {} }

  it('从动作序列重建出相同状态', () => {
    const actions = [
      { playerId: 'a', action: { type: 'add', n: 3 } as CounterAction },
      { playerId: 'b', action: { type: 'add', n: 5 } as CounterAction },
    ]
    const state = replay(counter, ctx, actions)
    expect(state.turn).toBe(2)
    expect(state.scores).toEqual({ a: 3, b: 5 })
  })

  it('空动作序列返回初始状态', () => {
    expect(replay(counter, ctx, []).turn).toBe(0)
  })

  it('重放两次结果一致', () => {
    const actions = [{ playerId: 'a', action: { type: 'add', n: 7 } as CounterAction }]
    expect(replay(counter, ctx, actions)).toEqual(replay(counter, ctx, actions))
  })
})

describe('引擎结算', () => {
  it('settle 的结果满足零和', () => {
    const ctx = { seed: 1, players: ['a', 'b'], options: {} }
    const state = replay(counter, ctx, [
      { playerId: 'a', action: { type: 'add', n: 3 } as CounterAction },
    ])
    expect(() => assertZeroSum(counter.settle(state))).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到模块 `./engine.js`。

- [ ] **Step 3: 实现 engine.ts**

```ts
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
```

- [ ] **Step 4: 实现 protocol.ts**

```ts
export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'join'; roomId: string }
  | { t: 'leave' }
  | { t: 'action'; action: unknown }
  | { t: 'ping' }

export type ServerMessage =
  | { t: 'authOk'; userId: string }
  | { t: 'roomState'; roomId: string; seats: SeatInfo[]; started: boolean }
  | { t: 'gameView'; view: unknown }
  | { t: 'events'; events: { type: string; payload?: unknown }[] }
  | { t: 'settled'; deltas: Record<string, number> }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }

export interface SeatInfo {
  index: number
  userId: string | null
  nickname: string | null
  online: boolean
  isAi: boolean
}
```

- [ ] **Step 5: 更新导出**

```ts
export const VERSION = '0.1.0'
export * from './cards.js'
export * from './rng.js'
export * from './engine.js'
export * from './protocol.js'
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(shared): 引擎契约与通信协议类型"
```

---

### Task 4: 数据库连接与迁移执行器

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/db/migrations.ts`
- Create: `packages/server/src/db/open.ts`
- Test: `packages/server/src/db/open.test.ts`

**Interfaces:**
- Consumes: Task 1 的工作区结构
- Produces:
  - `function openDb(path: string): DatabaseSync` — 打开库并执行全部未应用的迁移，开启外键与 WAL
  - `function openTestDb(): DatabaseSync` — 内存库，供测试使用
  - `const MIGRATIONS: { id: number; name: string; sql: string }[]`
  - 表：`schema_migrations`、`users`、`invite_codes`、`sessions`、`friendships`、`friend_requests`、`ledger_entries`、`loans`、`daily_claims`、`rooms`、`match_records`

- [ ] **Step 1: 写失败测试**

`packages/server/src/db/open.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb, applyMigrations } from './open.js'

describe('openTestDb', () => {
  it('建出全部业务表', () => {
    const db = openTestDb()
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of [
      'schema_migrations', 'users', 'invite_codes', 'sessions',
      'friendships', 'friend_requests', 'ledger_entries', 'loans',
      'daily_claims', 'match_records',
    ]) {
      expect(names).toContain(t)
    }
  })

  it('记录已应用的迁移', () => {
    const db = openTestDb()
    const row = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    expect(row.n).toBeGreaterThan(0)
  })

  it('开启了外键约束', () => {
    const db = openTestDb()
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
  })

  it('重复应用迁移是幂等的', () => {
    const db = openTestDb()
    const before = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    applyMigrations(db)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    expect(after).toBe(before)
  })
})
```

- [ ] **Step 2: 创建 server 包配置**

`packages/server/package.json`：

```json
{
  "name": "@cardgame/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node --experimental-sqlite --experimental-strip-types src/main.ts",
    "start": "node --experimental-sqlite dist/main.js"
  },
  "dependencies": {
    "@cardgame/shared": "workspace:*",
    "fastify": "^5.2.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13",
    "@types/node": "^22.10.0"
  }
}
```

`packages/server/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "references": [{ "path": "../shared" }],
  "include": ["src"]
}
```

在根 `package.json` 的 scripts 里把 test 改为带 flag：

```json
"test": "node --experimental-sqlite ./node_modules/vitest/vitest.mjs run"
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm install && pnpm test`
Expected: FAIL，找不到 `./open.js`。

- [ ] **Step 4: 实现 migrations.ts**

```ts
export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        nickname      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        invited_by    TEXT REFERENCES users(id),
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE invite_codes (
        code       TEXT PRIMARY KEY,
        created_by TEXT REFERENCES users(id),
        used_by    TEXT REFERENCES users(id),
        created_at INTEGER NOT NULL,
        used_at    INTEGER
      );

      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE friendships (
        user_a     TEXT NOT NULL REFERENCES users(id),
        user_b     TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_a, user_b)
      );

      CREATE TABLE friend_requests (
        id          TEXT PRIMARY KEY,
        from_user   TEXT NOT NULL REFERENCES users(id),
        to_user     TEXT NOT NULL REFERENCES users(id),
        status      TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
        created_at  INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE UNIQUE INDEX idx_friend_req_pair
        ON friend_requests(from_user, to_user) WHERE status = 'pending';

      -- 复式记账流水。account 形如 'user:<id>' 或 'system:mint'
      CREATE TABLE ledger_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        txn_id     TEXT NOT NULL,
        account    TEXT NOT NULL,
        delta      INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        ref_id     TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_ledger_account ON ledger_entries(account);
      CREATE INDEX idx_ledger_txn ON ledger_entries(txn_id);

      CREATE TABLE loans (
        id         TEXT PRIMARY KEY,
        lender     TEXT NOT NULL REFERENCES users(id),
        borrower   TEXT NOT NULL REFERENCES users(id),
        principal  INTEGER NOT NULL CHECK (principal > 0),
        repaid     INTEGER NOT NULL DEFAULT 0 CHECK (repaid >= 0),
        status     TEXT NOT NULL CHECK (status IN ('open','settled')),
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX idx_loans_lender ON loans(lender);
      CREATE INDEX idx_loans_borrower ON loans(borrower);

      CREATE TABLE daily_claims (
        user_id TEXT NOT NULL REFERENCES users(id),
        day     TEXT NOT NULL,
        amount  INTEGER NOT NULL,
        PRIMARY KEY (user_id, day)
      );

      CREATE TABLE rooms (
        id         TEXT PRIMARY KEY,
        game_id    TEXT NOT NULL,
        owner_id   TEXT NOT NULL REFERENCES users(id),
        options    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        closed_at  INTEGER
      );

      CREATE TABLE match_records (
        id         TEXT PRIMARY KEY,
        room_id    TEXT NOT NULL,
        game_id    TEXT NOT NULL,
        seed       INTEGER NOT NULL,
        players    TEXT NOT NULL,
        actions    TEXT NOT NULL,
        deltas     TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_match_room ON match_records(room_id);
    `,
  },
]
```

- [ ] **Step 5: 实现 open.ts**

```ts
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'

export function applyMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`)
  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]
  const applied = new Set(appliedRows.map((r) => r.id))
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, Date.now())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)
  return db
}

export function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)
  return db
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS，`vitest.workspace.ts` 中的 `server` 项目出现在输出里。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(server): SQLite 连接与迁移执行器"
```

---

### Task 5: 复式记账账本

**Files:**
- Create: `packages/server/src/domain/ledger.ts`
- Test: `packages/server/src/domain/ledger.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `openTestDb`、`ledger_entries` 表
- Produces:
  - `const MINT_ACCOUNT = 'system:mint'`
  - `function userAccount(userId: string): string` — 返回 `user:<id>`
  - `interface PostingLine { account: string; delta: number }`
  - `function postTransaction(db, lines: PostingLine[], reason: string, refId?: string | null): string` — 校验零和后原子写入，返回 txnId
  - `function getBalance(db, account: string): number`
  - `function checkGlobalInvariant(db): { total: number; ok: boolean }`
  - `function mintTo(db, userId: string, amount: number, reason: string, refId?: string | null): string` — 从 mint 账户注入资金

- [ ] **Step 1: 写失败测试**

`packages/server/src/domain/ledger.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import {
  postTransaction, getBalance, checkGlobalInvariant,
  mintTo, userAccount, MINT_ACCOUNT,
} from './ledger.js'

function setup() {
  const db = openTestDb()
  db.prepare(
    'INSERT INTO users (id, nickname, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)',
  ).run('u1', '甲', 'h', 's', Date.now())
  db.prepare(
    'INSERT INTO users (id, nickname, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)',
  ).run('u2', '乙', 'h', 's', Date.now())
  return db
}

describe('postTransaction', () => {
  it('零和的交易写入成功', () => {
    const db = setup()
    postTransaction(db, [
      { account: userAccount('u1'), delta: 100 },
      { account: userAccount('u2'), delta: -100 },
    ], 'test')
    expect(getBalance(db, userAccount('u1'))).toBe(100)
    expect(getBalance(db, userAccount('u2'))).toBe(-100)
  })

  it('非零和的交易被拒绝', () => {
    const db = setup()
    expect(() =>
      postTransaction(db, [
        { account: userAccount('u1'), delta: 100 },
        { account: userAccount('u2'), delta: -50 },
      ], 'bad'),
    ).toThrow(/零和/)
  })

  it('被拒绝的交易不留下任何流水', () => {
    const db = setup()
    try {
      postTransaction(db, [{ account: userAccount('u1'), delta: 100 }], 'bad')
    } catch { /* 预期抛出 */ }
    const row = db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('拒绝空流水列表', () => {
    const db = setup()
    expect(() => postTransaction(db, [], 'empty')).toThrow(/不能为空/)
  })

  it('拒绝非整数金额', () => {
    const db = setup()
    expect(() =>
      postTransaction(db, [
        { account: userAccount('u1'), delta: 10.5 },
        { account: userAccount('u2'), delta: -10.5 },
      ], 'float'),
    ).toThrow(/整数/)
  })

  it('同一笔交易的流水共享 txnId', () => {
    const db = setup()
    const txnId = postTransaction(db, [
      { account: userAccount('u1'), delta: 7 },
      { account: userAccount('u2'), delta: -7 },
    ], 'test')
    const row = db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE txn_id = ?')
      .get(txnId) as { n: number }
    expect(row.n).toBe(2)
  })
})

describe('getBalance', () => {
  it('无流水时余额为 0', () => {
    const db = setup()
    expect(getBalance(db, userAccount('u1'))).toBe(0)
  })

  it('多笔流水累加', () => {
    const db = setup()
    postTransaction(db, [
      { account: userAccount('u1'), delta: 100 },
      { account: userAccount('u2'), delta: -100 },
    ], 'a')
    postTransaction(db, [
      { account: userAccount('u1'), delta: -30 },
      { account: userAccount('u2'), delta: 30 },
    ], 'b')
    expect(getBalance(db, userAccount('u1'))).toBe(70)
  })
})

describe('mintTo', () => {
  it('注入资金后玩家余额增加、mint 账户变负', () => {
    const db = setup()
    mintTo(db, 'u1', 10000, 'initial')
    expect(getBalance(db, userAccount('u1'))).toBe(10000)
    expect(getBalance(db, MINT_ACCOUNT)).toBe(-10000)
  })

  it('拒绝非正数注入', () => {
    const db = setup()
    expect(() => mintTo(db, 'u1', 0, 'x')).toThrow(/必须为正/)
  })
})

describe('checkGlobalInvariant', () => {
  it('空库满足不变量', () => {
    const db = setup()
    expect(checkGlobalInvariant(db)).toEqual({ total: 0, ok: true })
  })

  it('若干交易后仍满足不变量', () => {
    const db = setup()
    mintTo(db, 'u1', 10000, 'initial')
    mintTo(db, 'u2', 10000, 'initial')
    postTransaction(db, [
      { account: userAccount('u1'), delta: -250 },
      { account: userAccount('u2'), delta: 250 },
    ], 'settle')
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })

  it('手工插入破坏性流水后能检测出来', () => {
    const db = setup()
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('hack', userAccount('u1'), 999, 'hack', Date.now())
    const r = checkGlobalInvariant(db)
    expect(r.ok).toBe(false)
    expect(r.total).toBe(999)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./ledger.js`。

- [ ] **Step 3: 实现 ledger.ts**

```ts
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const MINT_ACCOUNT = 'system:mint'

export function userAccount(userId: string): string {
  return `user:${userId}`
}

export interface PostingLine {
  account: string
  delta: number
}

/**
 * 过账。校验零和后在单个事务内写入全部流水。
 * 任一校验失败则抛异常且不留下任何记录。
 */
export function postTransaction(
  db: DatabaseSync,
  lines: PostingLine[],
  reason: string,
  refId: string | null = null,
): string {
  if (lines.length === 0) throw new Error('流水列表不能为空')
  for (const l of lines) {
    if (!Number.isInteger(l.delta)) throw new Error(`金额必须为整数：${l.delta}`)
  }
  const total = lines.reduce((s, l) => s + l.delta, 0)
  if (total !== 0) throw new Error(`交易违反零和约束：总和为 ${total}`)

  const txnId = randomUUID()
  const now = Date.now()
  const stmt = db.prepare(
    'INSERT INTO ledger_entries (txn_id, account, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?,?)',
  )
  db.exec('BEGIN')
  try {
    for (const l of lines) stmt.run(txnId, l.account, l.delta, reason, refId, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return txnId
}

export function getBalance(db: DatabaseSync, account: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS bal FROM ledger_entries WHERE account = ?')
    .get(account) as { bal: number }
  return row.bal
}

export function checkGlobalInvariant(db: DatabaseSync): { total: number; ok: boolean } {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries')
    .get() as { total: number }
  return { total: row.total, ok: row.total === 0 }
}

/** 从 system:mint 账户向玩家注入资金（初始资金、每日补给） */
export function mintTo(
  db: DatabaseSync,
  userId: string,
  amount: number,
  reason: string,
  refId: string | null = null,
): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('注入金额必须为正整数')
  return postTransaction(
    db,
    [
      { account: userAccount(userId), delta: amount },
      { account: MINT_ACCOUNT, delta: -amount },
    ],
    reason,
    refId,
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 复式记账账本与零和不变量"
```

---

### Task 6: 邀请码、注册、登录与会话

**Files:**
- Create: `packages/server/src/domain/users.ts`
- Test: `packages/server/src/domain/users.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `openTestDb`；Task 5 的 `mintTo`、`getBalance`、`userAccount`
- Produces:
  - `const INITIAL_GRANT = 10000`
  - `interface User { id: string; nickname: string; invitedBy: string | null; createdAt: number }`
  - `function createInviteCode(db, createdBy: string | null): string` — 返回 8 位大写码
  - `function registerUser(db, input: { nickname: string; password: string; inviteCode: string }): User` — 校验邀请码、写用户、标记码已用、发放初始资金，全程单事务
  - `function login(db, nickname: string, password: string): { user: User; token: string } | null`
  - `function verifyToken(db, token: string): User | null`
  - `function logout(db, token: string): void`
  - `function getUser(db, userId: string): User | null`

- [ ] **Step 1: 写失败测试**

`packages/server/src/domain/users.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { getBalance, userAccount } from './ledger.js'
import {
  createInviteCode, registerUser, login, verifyToken, logout, getUser, INITIAL_GRANT,
} from './users.js'

function reg(db: ReturnType<typeof openTestDb>, nickname: string) {
  const code = createInviteCode(db, null)
  return registerUser(db, { nickname, password: 'pw123456', inviteCode: code })
}

describe('createInviteCode', () => {
  it('生成 8 位大写码', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(code).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('连续生成不重复', () => {
    const db = openTestDb()
    const codes = new Set(Array.from({ length: 200 }, () => createInviteCode(db, null)))
    expect(codes.size).toBe(200)
  })
})

describe('registerUser', () => {
  it('注册成功并返回用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(u.nickname).toBe('甲')
    expect(u.id).toBeTruthy()
  })

  it('发放初始资金', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(getBalance(db, userAccount(u.id))).toBe(INITIAL_GRANT)
  })

  it('邀请码用过一次后失效', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: code })
    expect(() =>
      registerUser(db, { nickname: '乙', password: 'pw123456', inviteCode: code }),
    ).toThrow(/已被使用/)
  })

  it('拒绝不存在的邀请码', () => {
    const db = openTestDb()
    expect(() =>
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: 'NOTEXIST' }),
    ).toThrow(/邀请码无效/)
  })

  it('拒绝重复昵称', () => {
    const db = openTestDb()
    reg(db, '甲')
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: code }),
    ).toThrow(/昵称已被占用/)
  })

  it('拒绝过短密码', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '甲', password: '123', inviteCode: code }),
    ).toThrow(/密码至少/)
  })

  it('拒绝空昵称', () => {
    const db = openTestDb()
    const code = createInviteCode(db, null)
    expect(() =>
      registerUser(db, { nickname: '  ', password: 'pw123456', inviteCode: code }),
    ).toThrow(/昵称不能为空/)
  })

  it('注册失败时不留下用户记录', () => {
    const db = openTestDb()
    try {
      registerUser(db, { nickname: '甲', password: 'pw123456', inviteCode: 'BAD' })
    } catch { /* 预期抛出 */ }
    const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('记录邀请人', () => {
    const db = openTestDb()
    const a = reg(db, '甲')
    const code = createInviteCode(db, a.id)
    const b = registerUser(db, { nickname: '乙', password: 'pw123456', inviteCode: code })
    expect(b.invitedBy).toBe(a.id)
  })
})

describe('login / verifyToken / logout', () => {
  it('正确密码登录成功', () => {
    const db = openTestDb()
    reg(db, '甲')
    const r = login(db, '甲', 'pw123456')
    expect(r).not.toBeNull()
    expect(r!.token).toBeTruthy()
  })

  it('错误密码登录失败', () => {
    const db = openTestDb()
    reg(db, '甲')
    expect(login(db, '甲', 'wrongpass')).toBeNull()
  })

  it('不存在的昵称登录失败', () => {
    const db = openTestDb()
    expect(login(db, '不存在', 'pw123456')).toBeNull()
  })

  it('token 可换回用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    const r = login(db, '甲', 'pw123456')!
    expect(verifyToken(db, r.token)!.id).toBe(u.id)
  })

  it('非法 token 返回 null', () => {
    const db = openTestDb()
    expect(verifyToken(db, 'garbage')).toBeNull()
  })

  it('登出后 token 失效', () => {
    const db = openTestDb()
    reg(db, '甲')
    const r = login(db, '甲', 'pw123456')!
    logout(db, r.token)
    expect(verifyToken(db, r.token)).toBeNull()
  })

  it('过期 token 失效', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .run('expired', u.id, Date.now() - 2000, Date.now() - 1000)
    expect(verifyToken(db, 'expired')).toBeNull()
  })
})

describe('getUser', () => {
  it('查得到已注册用户', () => {
    const db = openTestDb()
    const u = reg(db, '甲')
    expect(getUser(db, u.id)!.nickname).toBe('甲')
  })

  it('查不到时返回 null', () => {
    const db = openTestDb()
    expect(getUser(db, 'nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./users.js`。

- [ ] **Step 3: 实现 users.ts**

```ts
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { mintTo } from './ledger.js'

export const INITIAL_GRANT = 10000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MIN_PASSWORD_LEN = 6
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface User {
  id: string
  nickname: string
  invitedBy: string | null
  createdAt: number
}

interface UserRow {
  id: string
  nickname: string
  password_hash: string
  password_salt: string
  invited_by: string | null
  created_at: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    nickname: row.nickname,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function randomCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

export function createInviteCode(db: DatabaseSync, createdBy: string | null): string {
  const stmt = db.prepare(
    'INSERT INTO invite_codes (code, created_by, created_at) VALUES (?,?,?)',
  )
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode()
    try {
      stmt.run(code, createdBy, Date.now())
      return code
    } catch {
      // 主键冲突，重试
    }
  }
  throw new Error('生成邀请码失败：连续冲突')
}

export function registerUser(
  db: DatabaseSync,
  input: { nickname: string; password: string; inviteCode: string },
): User {
  const nickname = input.nickname.trim()
  if (nickname.length === 0) throw new Error('昵称不能为空')
  if (input.password.length < MIN_PASSWORD_LEN) {
    throw new Error(`密码至少 ${MIN_PASSWORD_LEN} 位`)
  }

  const codeRow = db
    .prepare('SELECT code, created_by, used_by FROM invite_codes WHERE code = ?')
    .get(input.inviteCode) as { code: string; created_by: string | null; used_by: string | null } | undefined
  if (!codeRow) throw new Error('邀请码无效')
  if (codeRow.used_by !== null) throw new Error('邀请码已被使用')

  const dup = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname)
  if (dup) throw new Error('昵称已被占用')

  const id = randomUUID()
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword(input.password, salt)
  const now = Date.now()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO users (id, nickname, password_hash, password_salt, invited_by, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, nickname, hash, salt, codeRow.created_by, now)
    db.prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?')
      .run(id, now, input.inviteCode)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  mintTo(db, id, INITIAL_GRANT, 'initial_grant')

  return { id, nickname, invitedBy: codeRow.created_by, createdAt: now }
}

export function login(
  db: DatabaseSync,
  nickname: string,
  password: string,
): { user: User; token: string } | null {
  const row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname.trim()) as
    | UserRow
    | undefined
  if (!row) return null

  const attempt = Buffer.from(hashPassword(password, row.password_salt), 'hex')
  const stored = Buffer.from(row.password_hash, 'hex')
  if (attempt.length !== stored.length || !timingSafeEqual(attempt, stored)) return null

  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, row.id, now, now + SESSION_TTL_MS)

  return { user: toUser(row), token }
}

export function verifyToken(db: DatabaseSync, token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as UserRow | undefined
  return row ? toUser(row) : null
}

export function logout(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function getUser(db: DatabaseSync, userId: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
  return row ? toUser(row) : null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 邀请码注册、登录与会话"
```

---

### Task 7: 好友关系

**Files:**
- Create: `packages/server/src/domain/friends.ts`
- Test: `packages/server/src/domain/friends.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `registerUser`、`createInviteCode`、`User`
- Produces:
  - `function sendFriendRequest(db, fromUser: string, toUser: string): string` — 返回请求 id
  - `function acceptFriendRequest(db, requestId: string, actingUser: string): void`
  - `function rejectFriendRequest(db, requestId: string, actingUser: string): void`
  - `function listPendingRequests(db, userId: string): { id: string; fromUser: string; nickname: string; createdAt: number }[]`
  - `function areFriends(db, a: string, b: string): boolean`
  - `function listFriends(db, userId: string): { id: string; nickname: string }[]`

- [ ] **Step 1: 写失败测试**

`packages/server/src/domain/friends.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser } from './users.js'
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  listPendingRequests, areFriends, listFriends,
} from './friends.js'

function setup() {
  const db = openTestDb()
  const mk = (n: string) =>
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
  return { db, a: mk('甲'), b: mk('乙'), c: mk('丙') }
}

describe('好友请求', () => {
  it('发出请求后对方能看到', () => {
    const { db, a, b } = setup()
    sendFriendRequest(db, a.id, b.id)
    const pending = listPendingRequests(db, b.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.fromUser).toBe(a.id)
    expect(pending[0]!.nickname).toBe('甲')
  })

  it('接受后双向成为好友', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(areFriends(db, a.id, b.id)).toBe(true)
    expect(areFriends(db, b.id, a.id)).toBe(true)
  })

  it('拒绝后不成为好友', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    rejectFriendRequest(db, id, b.id)
    expect(areFriends(db, a.id, b.id)).toBe(false)
  })

  it('处理后请求从待办列表消失', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(listPendingRequests(db, b.id)).toHaveLength(0)
  })

  it('不能加自己为好友', () => {
    const { db, a } = setup()
    expect(() => sendFriendRequest(db, a.id, a.id)).toThrow(/不能添加自己/)
  })

  it('不能重复发送待处理请求', () => {
    const { db, a, b } = setup()
    sendFriendRequest(db, a.id, b.id)
    expect(() => sendFriendRequest(db, a.id, b.id)).toThrow(/请求已存在/)
  })

  it('已是好友时不能再发请求', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(() => sendFriendRequest(db, a.id, b.id)).toThrow(/已经是好友/)
  })

  it('非接收方不能接受请求', () => {
    const { db, a, b, c } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    expect(() => acceptFriendRequest(db, id, c.id)).toThrow(/无权/)
  })

  it('不能重复处理同一请求', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(() => acceptFriendRequest(db, id, b.id)).toThrow(/请求不存在或已处理/)
  })
})

describe('areFriends / listFriends', () => {
  it('陌生人不是好友', () => {
    const { db, a, c } = setup()
    expect(areFriends(db, a.id, c.id)).toBe(false)
  })

  it('好友列表包含双向关系', () => {
    const { db, a, b } = setup()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    expect(listFriends(db, a.id).map((f) => f.nickname)).toEqual(['乙'])
    expect(listFriends(db, b.id).map((f) => f.nickname)).toEqual(['甲'])
  })

  it('无好友时返回空数组', () => {
    const { db, c } = setup()
    expect(listFriends(db, c.id)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./friends.js`。

- [ ] **Step 3: 实现 friends.ts**

```ts
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** 好友关系以有序对存储，保证唯一性 */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export function areFriends(db: DatabaseSync, a: string, b: string): boolean {
  const [x, y] = pair(a, b)
  const row = db
    .prepare('SELECT 1 AS ok FROM friendships WHERE user_a = ? AND user_b = ?')
    .get(x, y)
  return row !== undefined
}

export function sendFriendRequest(db: DatabaseSync, fromUser: string, toUser: string): string {
  if (fromUser === toUser) throw new Error('不能添加自己为好友')
  if (areFriends(db, fromUser, toUser)) throw new Error('你们已经是好友')

  const existing = db
    .prepare(
      `SELECT id FROM friend_requests
       WHERE status = 'pending' AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
    )
    .get(fromUser, toUser, toUser, fromUser)
  if (existing) throw new Error('好友请求已存在')

  const id = randomUUID()
  db.prepare(
    `INSERT INTO friend_requests (id, from_user, to_user, status, created_at)
     VALUES (?,?,?,'pending',?)`,
  ).run(id, fromUser, toUser, Date.now())
  return id
}

interface RequestRow {
  id: string
  from_user: string
  to_user: string
  status: string
  created_at: number
}

function loadPending(db: DatabaseSync, requestId: string, actingUser: string): RequestRow {
  const row = db
    .prepare("SELECT * FROM friend_requests WHERE id = ? AND status = 'pending'")
    .get(requestId) as RequestRow | undefined
  if (!row) throw new Error('好友请求不存在或已处理')
  if (row.to_user !== actingUser) throw new Error('无权处理该好友请求')
  return row
}

export function acceptFriendRequest(
  db: DatabaseSync,
  requestId: string,
  actingUser: string,
): void {
  const row = loadPending(db, requestId, actingUser)
  const [x, y] = pair(row.from_user, row.to_user)
  const now = Date.now()
  db.exec('BEGIN')
  try {
    db.prepare("UPDATE friend_requests SET status = 'accepted', resolved_at = ? WHERE id = ?")
      .run(now, requestId)
    db.prepare('INSERT INTO friendships (user_a, user_b, created_at) VALUES (?,?,?)')
      .run(x, y, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function rejectFriendRequest(
  db: DatabaseSync,
  requestId: string,
  actingUser: string,
): void {
  loadPending(db, requestId, actingUser)
  db.prepare("UPDATE friend_requests SET status = 'rejected', resolved_at = ? WHERE id = ?")
    .run(Date.now(), requestId)
}

export function listPendingRequests(
  db: DatabaseSync,
  userId: string,
): { id: string; fromUser: string; nickname: string; createdAt: number }[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.from_user, u.nickname, r.created_at
       FROM friend_requests r JOIN users u ON u.id = r.from_user
       WHERE r.to_user = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
    )
    .all(userId) as { id: string; from_user: string; nickname: string; created_at: number }[]
  return rows.map((r) => ({
    id: r.id,
    fromUser: r.from_user,
    nickname: r.nickname,
    createdAt: r.created_at,
  }))
}

export function listFriends(
  db: DatabaseSync,
  userId: string,
): { id: string; nickname: string }[] {
  return db
    .prepare(
      `SELECT u.id, u.nickname FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY u.nickname`,
    )
    .all(userId, userId, userId) as { id: string; nickname: string }[]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 好友请求与关系"
```

---

### Task 8: 借条与净资产

**Files:**
- Create: `packages/server/src/domain/loans.ts`
- Test: `packages/server/src/domain/loans.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `postTransaction`/`getBalance`/`userAccount`；Task 6 的 `registerUser`；Task 7 的 `areFriends`
- Produces:
  - `const LOAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000`
  - `interface Loan { id: string; lender: string; borrower: string; principal: number; repaid: number; outstanding: number; status: 'open' | 'settled'; createdAt: number }`
  - `function createLoan(db, lender: string, borrower: string, amount: number, now?: number): Loan`
  - `function repayLoan(db, loanId: string, actingUser: string, amount: number): Loan`
  - `function listLoans(db, userId: string): { asLender: Loan[]; asBorrower: Loan[] }`
  - `function netWorth(db, userId: string): { balance: number; receivable: number; payable: number; net: number }`
  - `function autoRepay(db, userId: string): number` — 用当前余额自动清偿欠款，返回实际还款总额

- [ ] **Step 1: 写失败测试**

`packages/server/src/domain/loans.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from './users.js'
import { sendFriendRequest, acceptFriendRequest } from './friends.js'
import { getBalance, userAccount, checkGlobalInvariant } from './ledger.js'
import { createLoan, repayLoan, listLoans, netWorth, autoRepay, LOAN_COOLDOWN_MS } from './loans.js'

const OLD = Date.now() + LOAN_COOLDOWN_MS + 1000

function setup() {
  const db = openTestDb()
  const mk = (n: string) =>
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
  const a = mk('甲')
  const b = mk('乙')
  const c = mk('丙')
  acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
  return { db, a, b, c }
}

describe('createLoan', () => {
  it('借出后债权人减钱、债务人加钱', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT - 1000)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT + 1000)
  })

  it('生成未结清的借条', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(loan.status).toBe('open')
    expect(loan.outstanding).toBe(1000)
  })

  it('账本仍满足全局零和', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })

  it('拒绝向非好友借出', () => {
    const { db, a, c } = setup()
    expect(() => createLoan(db, a.id, c.id, 1000, OLD)).toThrow(/仅限好友/)
  })

  it('拒绝给自己打借条', () => {
    const { db, a } = setup()
    expect(() => createLoan(db, a.id, a.id, 1000, OLD)).toThrow(/不能给自己/)
  })

  it('拒绝非正整数金额', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, 0, OLD)).toThrow(/必须为正整数/)
    expect(() => createLoan(db, a.id, b.id, 10.5, OLD)).toThrow(/必须为正整数/)
  })

  it('拒绝超出债权人余额的金额', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, INITIAL_GRANT + 1, OLD)).toThrow(/余额不足/)
  })

  it('新账号 7 天内不能借出', () => {
    const { db, a, b } = setup()
    expect(() => createLoan(db, a.id, b.id, 100, Date.now())).toThrow(/满 7 天/)
  })

  it('新账号 7 天内不能借入', () => {
    const db = openTestDb()
    const mk = (n: string, backdate: number) => {
      const u = registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
      db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(backdate, u.id)
      return u
    }
    const old = mk('老', Date.now() - LOAN_COOLDOWN_MS - 1000)
    const fresh = mk('新', Date.now())
    acceptFriendRequest(db, sendFriendRequest(db, old.id, fresh.id), fresh.id)
    expect(() => createLoan(db, old.id, fresh.id, 100, Date.now())).toThrow(/满 7 天/)
  })
})

describe('repayLoan', () => {
  it('部分还款后 outstanding 减少', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const after = repayLoan(db, loan.id, b.id, 400)
    expect(after.outstanding).toBe(600)
    expect(after.status).toBe('open')
  })

  it('全额还款后状态变为 settled', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const after = repayLoan(db, loan.id, b.id, 1000)
    expect(after.status).toBe('settled')
    expect(after.outstanding).toBe(0)
  })

  it('还款后双方余额恢复', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 1000)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT)
  })

  it('拒绝超额还款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(() => repayLoan(db, loan.id, b.id, 1001)).toThrow(/超过未还金额/)
  })

  it('非债务人不能还款', () => {
    const { db, a, b, c } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    expect(() => repayLoan(db, loan.id, c.id, 100)).toThrow(/无权/)
  })

  it('余额不足时不能还款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    // 把乙的钱全部转走（直写流水，模拟余额被掏空）
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', userAccount(b.id), -(INITIAL_GRANT + 1000), 'drain', Date.now())
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', 'system:mint', INITIAL_GRANT + 1000, 'drain', Date.now())
    expect(() => repayLoan(db, loan.id, b.id, 100)).toThrow(/余额不足/)
  })

  it('已结清的借条不能再还', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 1000)
    expect(() => repayLoan(db, loan.id, b.id, 1)).toThrow(/已结清/)
  })
})

describe('netWorth', () => {
  it('无借贷时净资产等于余额', () => {
    const { db, c } = setup()
    expect(netWorth(db, c.id)).toEqual({
      balance: INITIAL_GRANT, receivable: 0, payable: 0, net: INITIAL_GRANT,
    })
  })

  it('借出方净资产不变', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(netWorth(db, a.id).net).toBe(INITIAL_GRANT)
  })

  it('借入方净资产不变', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(netWorth(db, b.id).net).toBe(INITIAL_GRANT)
  })

  it('借入方的应付被正确记录', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    const nw = netWorth(db, b.id)
    expect(nw.balance).toBe(INITIAL_GRANT + 1000)
    expect(nw.payable).toBe(1000)
  })

  it('部分还款后应收应付同步减少', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    repayLoan(db, loan.id, b.id, 300)
    expect(netWorth(db, a.id).receivable).toBe(700)
    expect(netWorth(db, b.id).payable).toBe(700)
  })
})

describe('listLoans', () => {
  it('分别列出应收与应付', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 1000, OLD)
    expect(listLoans(db, a.id).asLender).toHaveLength(1)
    expect(listLoans(db, a.id).asBorrower).toHaveLength(0)
    expect(listLoans(db, b.id).asBorrower).toHaveLength(1)
  })
})

describe('autoRepay', () => {
  it('用余额清偿全部欠款', () => {
    const { db, a, b } = setup()
    const loan = createLoan(db, a.id, b.id, 1000, OLD)
    const paid = autoRepay(db, b.id)
    expect(paid).toBe(1000)
    expect(listLoans(db, b.id).asBorrower[0]!.status).toBe('settled')
    void loan
  })

  it('余额不足时按可用额度部分清偿', () => {
    const { db, a, b } = setup()
    createLoan(db, a.id, b.id, 5000, OLD)
    // 把乙的余额压到 2000
    const drain = INITIAL_GRANT + 5000 - 2000
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', userAccount(b.id), -drain, 'drain', Date.now())
    db.prepare(
      'INSERT INTO ledger_entries (txn_id, account, delta, reason, created_at) VALUES (?,?,?,?,?)',
    ).run('drain', 'system:mint', drain, 'drain', Date.now())
    expect(autoRepay(db, b.id)).toBe(2000)
    expect(listLoans(db, b.id).asBorrower[0]!.outstanding).toBe(3000)
  })

  it('无欠款时返回 0', () => {
    const { db, c } = setup()
    expect(autoRepay(db, c.id)).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./loans.js`。

- [ ] **Step 3: 实现 loans.ts**

```ts
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { postTransaction, getBalance, userAccount } from './ledger.js'
import { areFriends } from './friends.js'

export const LOAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export interface Loan {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  outstanding: number
  status: 'open' | 'settled'
  createdAt: number
}

interface LoanRow {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  status: 'open' | 'settled'
  created_at: number
}

function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    lender: row.lender,
    borrower: row.borrower,
    principal: row.principal,
    repaid: row.repaid,
    outstanding: row.principal - row.repaid,
    status: row.status,
    createdAt: row.created_at,
  }
}

function assertEligible(db: DatabaseSync, userId: string, now: number): void {
  const row = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as
    | { created_at: number }
    | undefined
  if (!row) throw new Error('用户不存在')
  if (now - row.created_at < LOAN_COOLDOWN_MS) {
    throw new Error('账号注册满 7 天后才能使用借条')
  }
}

export function createLoan(
  db: DatabaseSync,
  lender: string,
  borrower: string,
  amount: number,
  now: number = Date.now(),
): Loan {
  if (lender === borrower) throw new Error('不能给自己打借条')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('借款金额必须为正整数')
  if (!areFriends(db, lender, borrower)) throw new Error('借条仅限好友之间')
  assertEligible(db, lender, now)
  assertEligible(db, borrower, now)
  if (getBalance(db, userAccount(lender)) < amount) throw new Error('债权人余额不足')

  const id = randomUUID()
  db.prepare(
    `INSERT INTO loans (id, lender, borrower, principal, repaid, status, created_at)
     VALUES (?,?,?,?,0,'open',?)`,
  ).run(id, lender, borrower, amount, now)

  postTransaction(
    db,
    [
      { account: userAccount(lender), delta: -amount },
      { account: userAccount(borrower), delta: amount },
    ],
    'loan_create',
    id,
  )

  return toLoan(
    db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow,
  )
}

export function repayLoan(
  db: DatabaseSync,
  loanId: string,
  actingUser: string,
  amount: number,
): Loan {
  const row = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as LoanRow | undefined
  if (!row) throw new Error('借条不存在')
  if (row.borrower !== actingUser) throw new Error('无权操作该借条')
  if (row.status === 'settled') throw new Error('该借条已结清')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('还款金额必须为正整数')

  const outstanding = row.principal - row.repaid
  if (amount > outstanding) throw new Error('还款金额超过未还金额')
  if (getBalance(db, userAccount(actingUser)) < amount) throw new Error('余额不足')

  const repaid = row.repaid + amount
  const status = repaid >= row.principal ? 'settled' : 'open'

  db.prepare('UPDATE loans SET repaid = ?, status = ?, settled_at = ? WHERE id = ?')
    .run(repaid, status, status === 'settled' ? Date.now() : null, loanId)

  postTransaction(
    db,
    [
      { account: userAccount(row.borrower), delta: -amount },
      { account: userAccount(row.lender), delta: amount },
    ],
    'loan_repay',
    loanId,
  )

  return toLoan(db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as LoanRow)
}

export function listLoans(
  db: DatabaseSync,
  userId: string,
): { asLender: Loan[]; asBorrower: Loan[] } {
  const asLender = (
    db.prepare('SELECT * FROM loans WHERE lender = ? ORDER BY created_at DESC').all(userId) as LoanRow[]
  ).map(toLoan)
  const asBorrower = (
    db.prepare('SELECT * FROM loans WHERE borrower = ? ORDER BY created_at DESC').all(userId) as LoanRow[]
  ).map(toLoan)
  return { asLender, asBorrower }
}

export function netWorth(
  db: DatabaseSync,
  userId: string,
): { balance: number; receivable: number; payable: number; net: number } {
  const balance = getBalance(db, userAccount(userId))
  const recv = db
    .prepare(
      "SELECT COALESCE(SUM(principal - repaid), 0) AS v FROM loans WHERE lender = ? AND status = 'open'",
    )
    .get(userId) as { v: number }
  const pay = db
    .prepare(
      "SELECT COALESCE(SUM(principal - repaid), 0) AS v FROM loans WHERE borrower = ? AND status = 'open'",
    )
    .get(userId) as { v: number }
  return {
    balance,
    receivable: recv.v,
    payable: pay.v,
    net: balance + recv.v - pay.v,
  }
}

/** 用当前余额从最早的借条开始清偿，返回实际还款总额 */
export function autoRepay(db: DatabaseSync, userId: string): number {
  const loans = db
    .prepare("SELECT * FROM loans WHERE borrower = ? AND status = 'open' ORDER BY created_at ASC")
    .all(userId) as LoanRow[]
  let paidTotal = 0
  for (const loan of loans) {
    const available = getBalance(db, userAccount(userId))
    if (available <= 0) break
    const outstanding = loan.principal - loan.repaid
    const pay = Math.min(available, outstanding)
    if (pay <= 0) continue
    repayLoan(db, loan.id, userId, pay)
    paidTotal += pay
  }
  return paidTotal
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 借条、还款与净资产"
```

---

### Task 9: 每日签到与净资产排行

**Files:**
- Create: `packages/server/src/domain/ranking.ts`
- Test: `packages/server/src/domain/ranking.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `mintTo`；Task 8 的 `netWorth`
- Produces:
  - `const DAILY_GRANT = 200`
  - `function dayKey(now: number): string` — 形如 `2026-08-10`（UTC+8）
  - `function claimDaily(db, userId: string, now?: number): { claimed: boolean; amount: number }`
  - `function ranking(db, limit?: number): { userId: string; nickname: string; net: number; balance: number; payable: number }[]`

- [ ] **Step 1: 写失败测试**

`packages/server/src/domain/ranking.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from './users.js'
import { sendFriendRequest, acceptFriendRequest } from './friends.js'
import { createLoan, LOAN_COOLDOWN_MS } from './loans.js'
import { getBalance, userAccount } from './ledger.js'
import { claimDaily, ranking, dayKey, DAILY_GRANT } from './ranking.js'

const OLD = Date.now() + LOAN_COOLDOWN_MS + 1000

function setup() {
  const db = openTestDb()
  const mk = (n: string) =>
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
  return { db, a: mk('甲'), b: mk('乙') }
}

describe('dayKey', () => {
  it('按 UTC+8 切分日期', () => {
    // 2026-08-10T00:30:00+08:00 => 2026-08-09T16:30:00Z
    expect(dayKey(Date.parse('2026-08-09T16:30:00Z'))).toBe('2026-08-10')
  })

  it('UTC+8 的 23:59 仍属当天', () => {
    expect(dayKey(Date.parse('2026-08-10T15:59:00Z'))).toBe('2026-08-10')
  })
})

describe('claimDaily', () => {
  it('首次签到发放补给', () => {
    const { db, a } = setup()
    const r = claimDaily(db, a.id)
    expect(r).toEqual({ claimed: true, amount: DAILY_GRANT })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT)
  })

  it('同日重复签到不再发放', () => {
    const { db, a } = setup()
    const now = Date.now()
    claimDaily(db, a.id, now)
    const r = claimDaily(db, a.id, now)
    expect(r).toEqual({ claimed: false, amount: 0 })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT)
  })

  it('次日可再次签到', () => {
    const { db, a } = setup()
    const now = Date.parse('2026-08-10T02:00:00Z')
    claimDaily(db, a.id, now)
    claimDaily(db, a.id, now + 24 * 3600 * 1000)
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + DAILY_GRANT * 2)
  })
})

describe('ranking', () => {
  it('按净资产降序排列', () => {
    const { db, a, b } = setup()
    claimDaily(db, a.id)
    const list = ranking(db)
    expect(list[0]!.userId).toBe(a.id)
    expect(list[0]!.net).toBe(INITIAL_GRANT + DAILY_GRANT)
    expect(list[1]!.userId).toBe(b.id)
  })

  it('借款不改变排名顺序', () => {
    const { db, a, b } = setup()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    claimDaily(db, a.id)
    createLoan(db, a.id, b.id, 5000, OLD)
    const list = ranking(db)
    // 乙余额更高，但净资产未变，排名仍在甲之后
    expect(list[0]!.userId).toBe(a.id)
    expect(list[1]!.userId).toBe(b.id)
    expect(list[1]!.balance).toBe(INITIAL_GRANT + 5000)
    expect(list[1]!.payable).toBe(5000)
    expect(list[1]!.net).toBe(INITIAL_GRANT)
  })

  it('返回昵称', () => {
    const { db } = setup()
    expect(ranking(db).map((r) => r.nickname).sort()).toEqual(['乙', '甲'])
  })

  it('limit 生效', () => {
    const { db } = setup()
    expect(ranking(db, 1)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./ranking.js`。

- [ ] **Step 3: 实现 ranking.ts**

```ts
import type { DatabaseSync } from 'node:sqlite'
import { mintTo } from './ledger.js'

export const DAILY_GRANT = 200
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

/** 以 UTC+8 为准的日期键，形如 2026-08-10 */
export function dayKey(now: number): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export function claimDaily(
  db: DatabaseSync,
  userId: string,
  now: number = Date.now(),
): { claimed: boolean; amount: number } {
  const day = dayKey(now)
  const exists = db
    .prepare('SELECT 1 AS ok FROM daily_claims WHERE user_id = ? AND day = ?')
    .get(userId, day)
  if (exists) return { claimed: false, amount: 0 }

  db.prepare('INSERT INTO daily_claims (user_id, day, amount) VALUES (?,?,?)')
    .run(userId, day, DAILY_GRANT)
  mintTo(db, userId, DAILY_GRANT, 'daily_grant', day)
  return { claimed: true, amount: DAILY_GRANT }
}

export interface RankingRow {
  userId: string
  nickname: string
  net: number
  balance: number
  receivable: number
  payable: number
}

/** 排行榜按净资产降序。禁止改为按余额排序（借款可刷榜）。 */
export function ranking(db: DatabaseSync, limit = 100): RankingRow[] {
  const rows = db
    .prepare(
      `SELECT
         u.id AS userId,
         u.nickname AS nickname,
         COALESCE(l.bal, 0) AS balance,
         COALESCE(r.recv, 0) AS receivable,
         COALESCE(p.pay, 0) AS payable
       FROM users u
       LEFT JOIN (
         SELECT account, SUM(delta) AS bal FROM ledger_entries GROUP BY account
       ) l ON l.account = 'user:' || u.id
       LEFT JOIN (
         SELECT lender AS uid, SUM(principal - repaid) AS recv
         FROM loans WHERE status = 'open' GROUP BY lender
       ) r ON r.uid = u.id
       LEFT JOIN (
         SELECT borrower AS uid, SUM(principal - repaid) AS pay
         FROM loans WHERE status = 'open' GROUP BY borrower
       ) p ON p.uid = u.id
       ORDER BY (COALESCE(l.bal,0) + COALESCE(r.recv,0) - COALESCE(p.pay,0)) DESC, u.nickname ASC
       LIMIT ?`,
    )
    .all(limit) as Omit<RankingRow, 'net'>[]
  return rows.map((r) => ({ ...r, net: r.balance + r.receivable - r.payable }))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): 每日签到与净资产排行"
```

---

### Task 10: 引擎注册表与占位引擎

**Files:**
- Create: `packages/server/src/room/registry.ts`
- Create: `packages/server/src/games/highcard.ts`
- Test: `packages/server/src/games/highcard.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 `createDeck`、`shuffle`、`createRng`、`Engine`、`Settlement`
- Produces:
  - `function registerEngine(engine: Engine<any, any>): void`
  - `function getEngine(id: string): Engine<any, any>` — 未注册时抛异常
  - `function listEngines(): string[]`
  - `const highCard: Engine<HighCardState, HighCardAction>` — 玩法 id 为 `highcard`

**说明：** `highcard`（比大小）是本期的占位玩法——每人发一张牌，各自决定跟注或弃牌，牌大者通吃。它存在的目的是**打通从房间到账本的完整链路**并作为后续真实玩法的参照实现，不是正式玩法。1 期的炸金花将替代它的地位。

- [ ] **Step 1: 写失败测试**

`packages/server/src/games/highcard.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { assertZeroSum, replay } from '@cardgame/shared'
import { highCard, type HighCardAction } from './highcard.js'
import { registerEngine, getEngine, listEngines } from '../room/registry.js'

const ctx = { seed: 42, players: ['a', 'b', 'c'], options: { ante: 100 } }

describe('highCard 初始化', () => {
  it('每人发一张牌', () => {
    const s = highCard.init(ctx)
    expect(Object.keys(s.hands)).toHaveLength(3)
  })

  it('同种子发出相同的牌', () => {
    expect(highCard.init(ctx).hands).toEqual(highCard.init(ctx).hands)
  })

  it('不同种子发出不同的牌', () => {
    const other = highCard.init({ ...ctx, seed: 7 })
    expect(other.hands).not.toEqual(highCard.init(ctx).hands)
  })

  it('初始底池等于人数乘底注', () => {
    expect(highCard.init(ctx).pot).toBe(300)
  })

  it('初始时无人弃牌', () => {
    expect(highCard.init(ctx).folded).toEqual([])
  })
})

describe('highCard 动作', () => {
  it('合法动作为跟注与弃牌', () => {
    const s = highCard.init(ctx)
    expect(highCard.legalActions(s, 'a').map((x) => x.type).sort()).toEqual(['call', 'fold'])
  })

  it('已弃牌者无合法动作', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'fold' }).state
    expect(highCard.legalActions(s, 'a')).toEqual([])
  })

  it('弃牌被记录并产生事件', () => {
    const r = highCard.apply(highCard.init(ctx), 'a', { type: 'fold' })
    expect(r.state.folded).toContain('a')
    expect(r.events[0]!.type).toBe('folded')
  })

  it('跟注推进行动指针', () => {
    const s = highCard.init(ctx)
    const r = highCard.apply(s, 'a', { type: 'call' })
    expect(r.state.acted).toContain('a')
  })

  it('拒绝非行动方的动作', () => {
    const s = highCard.init(ctx)
    expect(() => highCard.apply(s, 'zzz', { type: 'call' })).toThrow(/不在本局/)
  })

  it('拒绝重复行动', () => {
    let s = highCard.init(ctx)
    s = highCard.apply(s, 'a', { type: 'call' }).state
    expect(() => highCard.apply(s, 'a', { type: 'call' })).toThrow(/已经行动/)
  })
})

describe('highCard 结束与结算', () => {
  const allCall: { playerId: string; action: HighCardAction }[] = [
    { playerId: 'a', action: { type: 'call' } },
    { playerId: 'b', action: { type: 'call' } },
    { playerId: 'c', action: { type: 'call' } },
  ]

  it('全部行动后结束', () => {
    expect(highCard.isOver(replay(highCard, ctx, allCall))).toBe(true)
  })

  it('未全部行动时未结束', () => {
    expect(highCard.isOver(highCard.init(ctx))).toBe(false)
  })

  it('结算满足零和', () => {
    const s = replay(highCard, ctx, allCall)
    expect(() => assertZeroSum(highCard.settle(s))).not.toThrow()
  })

  it('赢家收益为正、其余为负', () => {
    const s = replay(highCard, ctx, allCall)
    const { deltas } = highCard.settle(s)
    const positives = Object.values(deltas).filter((v) => v > 0)
    expect(positives).toHaveLength(1)
  })

  it('弃牌者只输底注', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'fold' } },
      { playerId: 'b', action: { type: 'call' } },
      { playerId: 'c', action: { type: 'call' } },
    ])
    expect(highCard.settle(s).deltas['a']).toBe(-100)
  })

  it('全部弃牌时全员退回底注', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'fold' } },
      { playerId: 'b', action: { type: 'fold' } },
      { playerId: 'c', action: { type: 'fold' } },
    ])
    expect(highCard.settle(s).deltas).toEqual({ a: 0, b: 0, c: 0 })
  })
})

describe('highCard 视图裁剪', () => {
  it('未结束时只能看到自己的牌', () => {
    const s = highCard.init(ctx)
    const v = highCard.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['a'])
  })

  it('观战者未结束时看不到任何手牌', () => {
    const v = highCard.view(highCard.init(ctx), null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('结束后所有人可见全部手牌', () => {
    const s = replay(highCard, ctx, [
      { playerId: 'a', action: { type: 'call' } },
      { playerId: 'b', action: { type: 'call' } },
      { playerId: 'c', action: { type: 'call' } },
    ])
    const v = highCard.view(s, 'a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands).sort()).toEqual(['a', 'b', 'c'])
  })

  it('序列化后的视图不含他人牌面', () => {
    const s = highCard.init(ctx)
    const json = JSON.stringify(highCard.view(s, 'a'))
    const bCard = JSON.stringify(s.hands['b'])
    expect(json.includes(bCard)).toBe(false)
  })
})

describe('引擎注册表', () => {
  it('注册后可取出', () => {
    registerEngine(highCard)
    expect(getEngine('highcard')).toBe(highCard)
  })

  it('未注册的 id 抛异常', () => {
    expect(() => getEngine('不存在')).toThrow(/未注册/)
  })

  it('列出已注册 id', () => {
    registerEngine(highCard)
    expect(listEngines()).toContain('highcard')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./highcard.js` 与 `../room/registry.js`。

- [ ] **Step 3: 实现 registry.ts**

```ts
import type { Engine } from '@cardgame/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = Engine<any, any>

const engines = new Map<string, AnyEngine>()

export function registerEngine(engine: AnyEngine): void {
  engines.set(engine.id, engine)
}

export function getEngine(id: string): AnyEngine {
  const e = engines.get(id)
  if (!e) throw new Error(`玩法未注册：${id}`)
  return e
}

export function listEngines(): string[] {
  return [...engines.keys()]
}
```

- [ ] **Step 4: 实现 highcard.ts**

```ts
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

  apply(state, playerId, action) {
    if (!state.players.includes(playerId)) throw new Error('该玩家不在本局中')
    if (state.acted.includes(playerId)) throw new Error('该玩家本轮已经行动过')

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

  isOver(state) {
    return state.acted.length === state.players.length
  },

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
    const over = state.acted.length === state.players.length
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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(server): 引擎注册表与 highcard 占位玩法"
```

---

### Task 11: 房间状态机与结算落账

**Files:**
- Create: `packages/server/src/room/room.ts`
- Create: `packages/server/src/room/manager.ts`
- Test: `packages/server/src/room/room.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `getEngine`；Task 5 的 `postTransaction`、`userAccount`；Task 8 的 `autoRepay`
- Produces:
  - `class Room` — 构造签名 `new Room(opts: { id: string; gameId: string; ownerId: string; seats: number; options: Record<string, unknown>; seedSource: () => number })`
  - `Room` 方法：`sit(userId)`、`leave(userId)`、`start()`、`act(userId, action)`、`viewFor(userId | null)`、`seatInfos()`、`isStarted()`、`takeSettlement()`
  - `function settleToLedger(db, record: { roomId; gameId; seed; players; actions; deltas }): void` — 单事务写账本 + 战绩，并对每位负债玩家执行自动还款
  - `class RoomManager` — `create(...)`、`get(id)`、`remove(id)`、`list()`

- [ ] **Step 1: 写失败测试**

`packages/server/src/room/room.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, INITIAL_GRANT } from '../domain/users.js'
import { getBalance, userAccount, checkGlobalInvariant } from '../domain/ledger.js'
import { sendFriendRequest, acceptFriendRequest } from '../domain/friends.js'
import { createLoan, listLoans, LOAN_COOLDOWN_MS } from '../domain/loans.js'
import { registerEngine } from './registry.js'
import { highCard } from '../games/highcard.js'
import { Room, RoomManager, settleToLedger } from './room.js'

beforeAll(() => registerEngine(highCard))

function makeRoom(seats = 3) {
  return new Room({
    id: 'R1',
    gameId: 'highcard',
    ownerId: 'a',
    seats,
    options: { ante: 100 },
    seedSource: () => 42,
  })
}

describe('Room 座位管理', () => {
  it('入座后出现在座位信息中', () => {
    const room = makeRoom()
    room.sit('a')
    expect(room.seatInfos().filter((s) => s.userId === 'a')).toHaveLength(1)
  })

  it('拒绝重复入座', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.sit('a')).toThrow(/已在房间/)
  })

  it('座位满后拒绝入座', () => {
    const room = makeRoom(2)
    room.sit('a')
    room.sit('b')
    expect(() => room.sit('c')).toThrow(/座位已满/)
  })

  it('离开后座位释放', () => {
    const room = makeRoom(2)
    room.sit('a')
    room.leave('a')
    room.sit('c')
    expect(room.seatInfos().some((s) => s.userId === 'c')).toBe(true)
  })
})

describe('Room 开局', () => {
  it('人数不足时不能开局', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.start()).toThrow(/至少需要 2 人/)
  })

  it('开局后状态为已开始', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    expect(room.isStarted()).toBe(true)
  })

  it('开局后不能再入座', () => {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    expect(() => room.sit('c')).toThrow(/已开局/)
  })

  it('未开局时不能行动', () => {
    const room = makeRoom()
    room.sit('a')
    expect(() => room.act('a', { type: 'call' })).toThrow(/尚未开局/)
  })
})

describe('Room 行动与视图', () => {
  function started() {
    const room = makeRoom()
    room.sit('a'); room.sit('b')
    room.start()
    return room
  }

  it('行动返回事件', () => {
    const room = started()
    expect(room.act('a', { type: 'call' }).events[0]!.type).toBe('called')
  })

  it('非在座玩家不能行动', () => {
    const room = started()
    expect(() => room.act('zzz', { type: 'call' })).toThrow()
  })

  it('玩家视图看不到他人手牌', () => {
    const room = started()
    const v = room.viewFor('a') as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual(['a'])
  })

  it('观战视图看不到任何手牌', () => {
    const room = started()
    const v = room.viewFor(null) as { hands: Record<string, unknown> }
    expect(Object.keys(v.hands)).toEqual([])
  })

  it('全部行动后产出结算', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'call' })
    const rec = room.takeSettlement()
    expect(rec).not.toBeNull()
    expect(Object.values(rec!.deltas).reduce((x, y) => x + y, 0)).toBe(0)
  })

  it('未结束时无结算', () => {
    const room = started()
    room.act('a', { type: 'call' })
    expect(room.takeSettlement()).toBeNull()
  })

  it('结算只能领取一次', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'call' })
    room.takeSettlement()
    expect(room.takeSettlement()).toBeNull()
  })

  it('结算记录包含动作序列可供重放', () => {
    const room = started()
    room.act('a', { type: 'call' })
    room.act('b', { type: 'fold' })
    const rec = room.takeSettlement()!
    expect(rec.actions).toHaveLength(2)
    expect(rec.seed).toBe(42)
  })
})

describe('settleToLedger', () => {
  function setupDb() {
    const db = openTestDb()
    const mk = (n: string) =>
      registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
    return { db, a: mk('甲'), b: mk('乙') }
  }

  it('把结算写进账本', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [],
      deltas: { [a.id]: 300, [b.id]: -300 },
    })
    expect(getBalance(db, userAccount(a.id))).toBe(INITIAL_GRANT + 300)
    expect(getBalance(db, userAccount(b.id))).toBe(INITIAL_GRANT - 300)
  })

  it('写入战绩记录', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [{ playerId: a.id, action: { type: 'call' } }],
      deltas: { [a.id]: 300, [b.id]: -300 },
    })
    const row = db.prepare('SELECT * FROM match_records WHERE room_id = ?').get('R1') as
      { seed: number; actions: string }
    expect(row.seed).toBe(42)
    expect(JSON.parse(row.actions)).toHaveLength(1)
  })

  it('拒绝非零和结算', () => {
    const { db, a, b } = setupDb()
    expect(() =>
      settleToLedger(db, {
        roomId: 'R1', gameId: 'highcard', seed: 1,
        players: [a.id, b.id], actions: [], deltas: { [a.id]: 300, [b.id]: -100 },
      }),
    ).toThrow(/零和/)
  })

  it('赢钱后自动优先还款', () => {
    const { db, a, b } = setupDb()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    const old = Date.now() + LOAN_COOLDOWN_MS + 1000
    db.prepare('UPDATE users SET created_at = ?').run(Date.now() - LOAN_COOLDOWN_MS - 1000)
    createLoan(db, a.id, b.id, 1000, old)
    // 乙欠甲 1000，现在乙赢 300
    settleToLedger(db, {
      roomId: 'R2', gameId: 'highcard', seed: 1,
      players: [a.id, b.id], actions: [], deltas: { [b.id]: 300, [a.id]: -300 },
    })
    expect(listLoans(db, b.id).asBorrower[0]!.outstanding).toBeLessThan(1000)
  })

  it('结算后全局零和不变量成立', () => {
    const { db, a, b } = setupDb()
    settleToLedger(db, {
      roomId: 'R1', gameId: 'highcard', seed: 42,
      players: [a.id, b.id], actions: [], deltas: { [a.id]: 300, [b.id]: -300 },
    })
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })
})

describe('RoomManager', () => {
  it('创建后可按 id 取回', () => {
    const mgr = new RoomManager()
    const room = mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    expect(mgr.get(room.id)).toBe(room)
  })

  it('房间号为 6 位数字', () => {
    const mgr = new RoomManager()
    expect(mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} }).id)
      .toMatch(/^\d{6}$/)
  })

  it('移除后取不到', () => {
    const mgr = new RoomManager()
    const room = mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    mgr.remove(room.id)
    expect(mgr.get(room.id)).toBeUndefined()
  })

  it('list 返回全部房间', () => {
    const mgr = new RoomManager()
    mgr.create({ gameId: 'highcard', ownerId: 'a', seats: 3, options: {} })
    mgr.create({ gameId: 'highcard', ownerId: 'b', seats: 3, options: {} })
    expect(mgr.list()).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./room.js`。

- [ ] **Step 3: 实现 room.ts**

```ts
import { randomUUID, randomInt } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { assertZeroSum, type GameEvent, type SeatInfo } from '@cardgame/shared'
import { getEngine } from './registry.js'
import { postTransaction, userAccount } from '../domain/ledger.js'
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
```

- [ ] **Step 4: 建立 manager.ts 单例**

`packages/server/src/room/manager.ts`：

```ts
import { RoomManager } from './room.js'

export const rooms = new RoomManager()
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(server): 房间状态机与结算落账"
```

---

### Task 12: 随机对局不变量自测框架

**Files:**
- Create: `packages/server/src/testing/fuzz.ts`
- Test: `packages/server/src/testing/fuzz.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `Engine`/`assertZeroSum`；Task 10 的 `highCard`
- Produces:
  - `interface FuzzResult { rounds: number; actions: number }`
  - `function fuzzEngine(engine, opts: { rounds: number; players: string[]; options?: Record<string, unknown>; maxSteps?: number }): FuzzResult` — 随机对局，逐局断言三项不变量，任一违反即抛异常

**说明：** 这是 spec 第 9 节要求的「10 万局随机对局自测」的实现。本期用 `highcard` 验证框架本身；1 期起每款玩法上线前必须跑通此框架。

- [ ] **Step 1: 写失败测试**

`packages/server/src/testing/fuzz.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { Engine } from '@cardgame/shared'
import { highCard } from '../games/highcard.js'
import { fuzzEngine } from './fuzz.js'

describe('fuzzEngine', () => {
  it('highcard 通过 2000 局随机对局', () => {
    const r = fuzzEngine(highCard, { rounds: 2000, players: ['a', 'b', 'c'], options: { ante: 100 } })
    expect(r.rounds).toBe(2000)
    expect(r.actions).toBeGreaterThan(0)
  })

  it('两人局同样通过', () => {
    expect(fuzzEngine(highCard, { rounds: 500, players: ['a', 'b'] }).rounds).toBe(500)
  })

  it('检测出违反零和的引擎', () => {
    const broken: Engine<{ done: boolean }, { type: 'go' }> = {
      id: 'broken-sum',
      init: () => ({ done: false }),
      legalActions: (s) => (s.done ? [] : [{ type: 'go' }]),
      apply: () => ({ state: { done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 100, b: 0 } }),
      view: (s) => s,
    }
    expect(() => fuzzEngine(broken, { rounds: 1, players: ['a', 'b'] })).toThrow(/零和/)
  })

  it('检测出死锁的引擎', () => {
    const stuck: Engine<{ n: number }, { type: 'go' }> = {
      id: 'broken-deadlock',
      init: () => ({ n: 0 }),
      legalActions: () => [],
      apply: (s) => ({ state: s, events: [] }),
      isOver: () => false,
      settle: () => ({ deltas: {} }),
      view: (s) => s,
    }
    expect(() => fuzzEngine(stuck, { rounds: 1, players: ['a', 'b'] })).toThrow(/死锁/)
  })

  it('检测出接受非法动作的引擎', () => {
    const permissive: Engine<{ n: number }, { type: string }> = {
      id: 'broken-illegal',
      init: () => ({ n: 0 }),
      legalActions: () => [{ type: 'only' }],
      apply: (s) => ({ state: { n: s.n + 1 }, events: [] }),
      isOver: (s) => s.n >= 1,
      settle: () => ({ deltas: {} }),
      view: (s) => s,
    }
    expect(() =>
      fuzzEngine(permissive, { rounds: 1, players: ['a', 'b'], probeIllegal: true }),
    ).toThrow(/非法动作/)
  })

  it('视图裁剪泄漏会被检出', () => {
    const leaky: Engine<{ secret: string; done: boolean }, { type: 'go' }> = {
      id: 'broken-leak',
      init: () => ({ secret: 'SECRET-b', done: false }),
      legalActions: (s) => (s.done ? [] : [{ type: 'go' }]),
      apply: (s) => ({ state: { ...s, done: true }, events: [] }),
      isOver: (s) => s.done,
      settle: () => ({ deltas: { a: 0, b: 0 } }),
      view: (s) => s, // 未裁剪，直接返回内部状态
    }
    expect(() =>
      fuzzEngine(leaky, { rounds: 1, players: ['a', 'b'], secretProbe: 'SECRET-b', secretOwner: 'b' }),
    ).toThrow(/视图泄漏/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./fuzz.js`。

- [ ] **Step 3: 实现 fuzz.ts**

```ts
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
      if (steps++ > maxSteps) {
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
  }

  return { rounds: opts.rounds, actions: actionCount }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 加一条独立的长跑脚本**

在根 `package.json` 的 scripts 增加：

```json
"fuzz": "node --experimental-sqlite --experimental-strip-types packages/server/src/testing/run-fuzz.ts"
```

创建 `packages/server/src/testing/run-fuzz.ts`：

```ts
import { highCard } from '../games/highcard.js'
import { fuzzEngine } from './fuzz.js'

const rounds = Number(process.argv[2] ?? 100000)
const started = Date.now()
const result = fuzzEngine(highCard, {
  rounds,
  players: ['a', 'b', 'c'],
  options: { ante: 100 },
})
console.log(
  `通过 ${result.rounds} 局，共 ${result.actions} 个动作，耗时 ${Date.now() - started}ms`,
)
```

- [ ] **Step 6: 跑一次 10 万局长跑**

Run: `pnpm fuzz 100000`
Expected: 输出「通过 100000 局」，进程退出码 0。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "test(server): 随机对局不变量自测框架"
```

---

### Task 13: HTTP 接口

**Files:**
- Create: `packages/server/src/http/routes.ts`
- Create: `packages/server/src/main.ts`
- Test: `packages/server/src/http/routes.test.ts`

**Interfaces:**
- Consumes: Task 6-9 的全部 domain 函数；Task 11 的 `RoomManager`
- Produces:
  - `function buildApp(deps: { db: DatabaseSync; rooms: RoomManager }): FastifyInstance`
  - 路由：
    - `POST /api/register` `{nickname, password, inviteCode}` → `{user, token}`
    - `POST /api/login` `{nickname, password}` → `{user, token}`
    - `POST /api/logout` → `{ok:true}`
    - `GET  /api/me` → `{user, netWorth}`
    - `POST /api/invite` → `{code}`
    - `GET  /api/friends` → `{friends, pending}`
    - `POST /api/friends/request` `{toUserId}` → `{id}`
    - `POST /api/friends/accept` `{requestId}` → `{ok:true}`
    - `POST /api/friends/reject` `{requestId}` → `{ok:true}`
    - `GET  /api/users/search?q=` → `{users}`
    - `GET  /api/loans` → `{asLender, asBorrower}`
    - `POST /api/loans` `{borrowerId, amount}` → `{loan}`
    - `POST /api/loans/repay` `{loanId, amount}` → `{loan}`
    - `POST /api/daily` → `{claimed, amount}`
    - `GET  /api/ranking` → `{ranking}`
    - `POST /api/rooms` `{gameId, seats, options}` → `{roomId}`
    - `GET  /api/rooms` → `{rooms}`
  - 除 `register`/`login` 外全部要求 `Authorization: Bearer <token>`

- [ ] **Step 1: 写失败测试**

`packages/server/src/http/routes.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode } from '../domain/users.js'
import { RoomManager } from '../room/room.js'
import { registerEngine } from '../room/registry.js'
import { highCard } from '../games/highcard.js'
import { buildApp } from './routes.js'

registerEngine(highCard)

function boot() {
  const db = openTestDb()
  const app = buildApp({ db, rooms: new RoomManager() })
  return { db, app }
}

async function newUser(app: ReturnType<typeof buildApp>, db: ReturnType<typeof openTestDb>, nickname: string) {
  const code = createInviteCode(db, null)
  const res = await app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { nickname, password: 'pw123456', inviteCode: code },
  })
  return res.json() as { user: { id: string }; token: string }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('注册与登录', () => {
  it('注册返回 token', async () => {
    const { db, app } = boot()
    const r = await newUser(app, db, '甲')
    expect(r.token).toBeTruthy()
  })

  it('邀请码无效时返回 400', async () => {
    const { app } = boot()
    const res = await app.inject({
      method: 'POST', url: '/api/register',
      payload: { nickname: '甲', password: 'pw123456', inviteCode: 'BAD' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/邀请码无效/)
  })

  it('登录成功返回 token', async () => {
    const { db, app } = boot()
    await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/login', payload: { nickname: '甲', password: 'pw123456' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBeTruthy()
  })

  it('密码错误返回 401', async () => {
    const { db, app } = boot()
    await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/login', payload: { nickname: '甲', password: 'wrongpw' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('鉴权', () => {
  it('无 token 访问 /api/me 返回 401', async () => {
    const { app } = boot()
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)
  })

  it('带 token 返回用户与净资产', async () => {
    const { db, app } = boot()
    const u = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().netWorth.net).toBe(10000)
  })

  it('登出后 token 失效', async () => {
    const { db, app } = boot()
    const u = await newUser(app, db, '甲')
    await app.inject({ method: 'POST', url: '/api/logout', headers: auth(u.token) })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })).statusCode).toBe(401)
  })
})

describe('好友接口', () => {
  it('完整走通请求与接受', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const b = await newUser(app, db, '乙')

    const req = await app.inject({
      method: 'POST', url: '/api/friends/request',
      headers: auth(a.token), payload: { toUserId: b.user.id },
    })
    expect(req.statusCode).toBe(200)

    const pending = await app.inject({ method: 'GET', url: '/api/friends', headers: auth(b.token) })
    expect(pending.json().pending).toHaveLength(1)

    await app.inject({
      method: 'POST', url: '/api/friends/accept',
      headers: auth(b.token), payload: { requestId: req.json().id },
    })
    const list = await app.inject({ method: 'GET', url: '/api/friends', headers: auth(a.token) })
    expect(list.json().friends).toHaveLength(1)
  })

  it('搜索用户按昵称匹配', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    await newUser(app, db, '乙丙')
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=乙', headers: auth(a.token) })
    expect(res.json().users).toHaveLength(1)
  })

  it('搜索结果不含自己', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/users/search?q=甲', headers: auth(a.token) })
    expect(res.json().users).toHaveLength(0)
  })
})

describe('借条接口', () => {
  it('非好友借款返回 400', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const b = await newUser(app, db, '乙')
    const res = await app.inject({
      method: 'POST', url: '/api/loans',
      headers: auth(a.token), payload: { borrowerId: b.user.id, amount: 100 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/好友|7 天/)
  })

  it('借条列表初始为空', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/loans', headers: auth(a.token) })
    expect(res.json()).toEqual({ asLender: [], asBorrower: [] })
  })
})

describe('签到与排行', () => {
  it('首次签到成功、重复签到返回未领取', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    expect((await app.inject({ method: 'POST', url: '/api/daily', headers: auth(a.token) })).json().claimed).toBe(true)
    expect((await app.inject({ method: 'POST', url: '/api/daily', headers: auth(a.token) })).json().claimed).toBe(false)
  })

  it('排行榜返回净资产字段', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({ method: 'GET', url: '/api/ranking', headers: auth(a.token) })
    expect(res.json().ranking[0].net).toBe(10000)
  })
})

describe('房间接口', () => {
  it('创建房间返回 6 位房号', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: 'highcard', seats: 3, options: { ante: 100 } },
    })
    expect(res.json().roomId).toMatch(/^\d{6}$/)
  })

  it('未知玩法返回 400', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    const res = await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: '不存在', seats: 3, options: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('房间列表包含已创建房间', async () => {
    const { db, app } = boot()
    const a = await newUser(app, db, '甲')
    await app.inject({
      method: 'POST', url: '/api/rooms',
      headers: auth(a.token), payload: { gameId: 'highcard', seats: 3, options: {} },
    })
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: auth(a.token) })
    expect(res.json().rooms).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./routes.js`。

- [ ] **Step 3: 实现 routes.ts**

```ts
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  registerUser, login, logout, verifyToken, createInviteCode, type User,
} from '../domain/users.js'
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  listPendingRequests, listFriends,
} from '../domain/friends.js'
import { createLoan, repayLoan, listLoans, netWorth } from '../domain/loans.js'
import { claimDaily, ranking } from '../domain/ranking.js'
import { getEngine } from '../room/registry.js'
import type { RoomManager } from '../room/room.js'

export interface Deps {
  db: DatabaseSync
  rooms: RoomManager
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice(7)
}

export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false })
  const { db, rooms } = deps

  const requireUser = (req: FastifyRequest): User => {
    const token = bearer(req)
    const user = token ? verifyToken(db, token) : null
    if (!user) {
      const err = new Error('未登录') as Error & { statusCode?: number }
      err.statusCode = 401
      throw err
    }
    return user
  }

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 400
    reply.status(status).send({ error: err.message })
  })

  app.post('/api/register', async (req) => {
    const body = req.body as { nickname: string; password: string; inviteCode: string }
    const user = registerUser(db, body)
    const r = login(db, body.nickname, body.password)!
    return { user, token: r.token }
  })

  app.post('/api/login', async (req, reply) => {
    const body = req.body as { nickname: string; password: string }
    const r = login(db, body.nickname, body.password)
    if (!r) return reply.status(401).send({ error: '昵称或密码错误' })
    return { user: r.user, token: r.token }
  })

  app.post('/api/logout', async (req) => {
    requireUser(req)
    const token = bearer(req)!
    logout(db, token)
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    const user = requireUser(req)
    return { user, netWorth: netWorth(db, user.id) }
  })

  app.post('/api/invite', async (req) => {
    const user = requireUser(req)
    return { code: createInviteCode(db, user.id) }
  })

  app.get('/api/friends', async (req) => {
    const user = requireUser(req)
    return { friends: listFriends(db, user.id), pending: listPendingRequests(db, user.id) }
  })

  app.post('/api/friends/request', async (req) => {
    const user = requireUser(req)
    const { toUserId } = req.body as { toUserId: string }
    return { id: sendFriendRequest(db, user.id, toUserId) }
  })

  app.post('/api/friends/accept', async (req) => {
    const user = requireUser(req)
    const { requestId } = req.body as { requestId: string }
    acceptFriendRequest(db, requestId, user.id)
    return { ok: true }
  })

  app.post('/api/friends/reject', async (req) => {
    const user = requireUser(req)
    const { requestId } = req.body as { requestId: string }
    rejectFriendRequest(db, requestId, user.id)
    return { ok: true }
  })

  app.get('/api/users/search', async (req) => {
    const user = requireUser(req)
    const q = (req.query as { q?: string }).q ?? ''
    if (q.trim() === '') return { users: [] }
    const users = db
      .prepare('SELECT id, nickname FROM users WHERE nickname LIKE ? AND id <> ? LIMIT 20')
      .all(`%${q}%`, user.id)
    return { users }
  })

  app.get('/api/loans', async (req) => {
    const user = requireUser(req)
    return listLoans(db, user.id)
  })

  app.post('/api/loans', async (req) => {
    const user = requireUser(req)
    const { borrowerId, amount } = req.body as { borrowerId: string; amount: number }
    return { loan: createLoan(db, user.id, borrowerId, amount) }
  })

  app.post('/api/loans/repay', async (req) => {
    const user = requireUser(req)
    const { loanId, amount } = req.body as { loanId: string; amount: number }
    return { loan: repayLoan(db, loanId, user.id, amount) }
  })

  app.post('/api/daily', async (req) => {
    const user = requireUser(req)
    return claimDaily(db, user.id)
  })

  app.get('/api/ranking', async (req) => {
    requireUser(req)
    return { ranking: ranking(db) }
  })

  app.post('/api/rooms', async (req) => {
    const user = requireUser(req)
    const { gameId, seats, options } = req.body as {
      gameId: string
      seats: number
      options: Record<string, unknown>
    }
    getEngine(gameId) // 未注册则抛错，交给错误处理器转 400
    const room = rooms.create({ gameId, ownerId: user.id, seats, options: options ?? {} })
    db.prepare('INSERT INTO rooms (id, game_id, owner_id, options, created_at) VALUES (?,?,?,?,?)')
      .run(room.id, gameId, user.id, JSON.stringify(options ?? {}), Date.now())
    return { roomId: room.id }
  })

  app.get('/api/rooms', async (req) => {
    requireUser(req)
    return {
      rooms: rooms.list().map((r) => ({
        id: r.id,
        gameId: r.gameId,
        started: r.isStarted(),
        seats: r.seatInfos(),
      })),
    }
  })

  return app
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(server): HTTP 接口"
```

---

### Task 14: WebSocket 网关与服务启动

**Files:**
- Create: `packages/server/src/ws/gateway.ts`
- Modify: `packages/server/src/main.ts`
- Test: `packages/server/src/ws/gateway.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `verifyToken`；Task 11 的 `Room`/`RoomManager`/`settleToLedger`；Task 3 的 `ClientMessage`/`ServerMessage`
- Produces:
  - `function attachGateway(server: http.Server, deps: { db; rooms }): { close(): void }`
  - `function handleMessage(ctx: ConnCtx, raw: string): ServerMessage[]` — 纯函数式消息处理，便于单测；`ConnCtx` 为 `{ db; rooms; userId: string | null; roomId: string | null }`
  - 广播语义：任一玩家动作后，向房间内每个连接单独下发经 `view()` 裁剪的 `gameView`

- [ ] **Step 1: 写失败测试**

`packages/server/src/ws/gateway.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser, login } from '../domain/users.js'
import { checkGlobalInvariant } from '../domain/ledger.js'
import { RoomManager } from '../room/room.js'
import { registerEngine } from '../room/registry.js'
import { highCard } from '../games/highcard.js'
import { handleMessage, type ConnCtx } from './gateway.js'

beforeAll(() => registerEngine(highCard))

function boot() {
  const db = openTestDb()
  const rooms = new RoomManager()
  const mk = (n: string) => {
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
    return login(db, n, 'pw123456')!
  }
  return { db, rooms, mk }
}

function ctx(db: ReturnType<typeof openTestDb>, rooms: RoomManager): ConnCtx {
  return { db, rooms, userId: null, roomId: null }
}

describe('鉴权消息', () => {
  it('有效 token 返回 authOk', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    const out = handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(out[0]).toEqual({ t: 'authOk', userId: a.user.id })
    expect(c.userId).toBe(a.user.id)
  })

  it('无效 token 返回 error', () => {
    const { db, rooms } = boot()
    const out = handleMessage(ctx(db, rooms), JSON.stringify({ t: 'auth', token: 'bad' }))
    expect(out[0]!.t).toBe('error')
  })

  it('未鉴权时其他消息被拒绝', () => {
    const { db, rooms } = boot()
    const out = handleMessage(ctx(db, rooms), JSON.stringify({ t: 'join', roomId: '123456' }))
    expect(out[0]).toMatchObject({ t: 'error', code: 'UNAUTHENTICATED' })
  })

  it('非法 JSON 返回 error 而不抛出', () => {
    const { db, rooms } = boot()
    expect(() => handleMessage(ctx(db, rooms), '{ 不是 json')).not.toThrow()
    expect(handleMessage(ctx(db, rooms), '{ 不是 json')[0]!.t).toBe('error')
  })

  it('未知消息类型返回 error', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(handleMessage(c, JSON.stringify({ t: '未知' }))[0]!.t).toBe('error')
  })
})

describe('加入房间', () => {
  function authed() {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 3, options: { ante: 100 } })
    const ca = ctx(db, rooms)
    const cb = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    handleMessage(cb, JSON.stringify({ t: 'auth', token: b.token }))
    return { db, rooms, room, ca, cb, a, b }
  }

  it('加入后返回房间状态', () => {
    const { room, ca } = authed()
    const out = handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    expect(out.find((m) => m.t === 'roomState')).toBeTruthy()
    expect(ca.roomId).toBe(room.id)
  })

  it('加入不存在的房间返回 error', () => {
    const { ca } = authed()
    const out = handleMessage(ca, JSON.stringify({ t: 'join', roomId: '000000' }))
    expect(out[0]).toMatchObject({ t: 'error', code: 'ROOM_NOT_FOUND' })
  })

  it('离开后 roomId 清空', () => {
    const { room, ca } = authed()
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    handleMessage(ca, JSON.stringify({ t: 'leave' }))
    expect(ca.roomId).toBeNull()
  })

  it('ping 回 pong', () => {
    const { ca } = authed()
    expect(handleMessage(ca, JSON.stringify({ t: 'ping' }))[0]).toEqual({ t: 'pong' })
  })
})

describe('对局动作', () => {
  function playing() {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const b = mk('乙')
    const room = rooms.create({ gameId: 'highcard', ownerId: a.user.id, seats: 2, options: { ante: 100 } })
    const ca = ctx(db, rooms)
    const cb = ctx(db, rooms)
    handleMessage(ca, JSON.stringify({ t: 'auth', token: a.token }))
    handleMessage(cb, JSON.stringify({ t: 'auth', token: b.token }))
    handleMessage(ca, JSON.stringify({ t: 'join', roomId: room.id }))
    handleMessage(cb, JSON.stringify({ t: 'join', roomId: room.id }))
    room.start()
    return { db, room, ca, cb, a, b }
  }

  it('动作返回事件与自己的裁剪视图', () => {
    const { ca } = playing()
    const out = handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(out.some((m) => m.t === 'events')).toBe(true)
    const view = out.find((m) => m.t === 'gameView') as { view: { hands: Record<string, unknown> } }
    expect(Object.keys(view.view.hands)).toHaveLength(1)
  })

  it('未加入房间时行动返回 error', () => {
    const { db, rooms, mk } = boot()
    const a = mk('甲')
    const c = ctx(db, rooms)
    handleMessage(c, JSON.stringify({ t: 'auth', token: a.token }))
    expect(handleMessage(c, JSON.stringify({ t: 'action', action: { type: 'call' } }))[0])
      .toMatchObject({ t: 'error', code: 'NOT_IN_ROOM' })
  })

  it('非法动作返回 error 且不影响对局', () => {
    const { ca, room } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const out = handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(out[0]!.t).toBe('error')
    expect(room.isStarted()).toBe(true)
  })

  it('对局结束后下发 settled 并落账', () => {
    const { db, ca, cb, a, b } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const out = handleMessage(cb, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    const settled = out.find((m) => m.t === 'settled') as { deltas: Record<string, number> }
    expect(settled).toBeTruthy()
    expect(Object.values(settled.deltas).reduce((x, y) => x + y, 0)).toBe(0)

    const row = db.prepare('SELECT COUNT(*) AS n FROM match_records').get() as { n: number }
    expect(row.n).toBe(1)
    void a; void b
  })

  it('结算后账本仍满足全局零和', () => {
    const { db, ca, cb } = playing()
    handleMessage(ca, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    handleMessage(cb, JSON.stringify({ t: 'action', action: { type: 'call' } }))
    expect(checkGlobalInvariant(db).ok).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./gateway.js`。

- [ ] **Step 3: 实现 gateway.ts**

```ts
import type * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { DatabaseSync } from 'node:sqlite'
import type { ClientMessage, ServerMessage } from '@cardgame/shared'
import { verifyToken, getUser } from '../domain/users.js'
import { settleToLedger, type RoomManager } from '../room/room.js'

export interface ConnCtx {
  db: DatabaseSync
  rooms: RoomManager
  userId: string | null
  roomId: string | null
}

function err(code: string, message: string): ServerMessage {
  return { t: 'error', code, message }
}

/**
 * 处理一条客户端消息，返回应下发给「本连接」的消息列表。
 * 需要广播给他人的部分由 attachGateway 负责重新裁剪后分发。
 */
export function handleMessage(ctx: ConnCtx, raw: string): ServerMessage[] {
  let msg: ClientMessage
  try {
    msg = JSON.parse(raw) as ClientMessage
  } catch {
    return [err('BAD_JSON', '消息不是合法 JSON')]
  }

  if (msg.t === 'auth') {
    const user = verifyToken(ctx.db, msg.token)
    if (!user) return [err('BAD_TOKEN', '登录凭证无效')]
    ctx.userId = user.id
    return [{ t: 'authOk', userId: user.id }]
  }

  if (ctx.userId === null) return [err('UNAUTHENTICATED', '请先完成鉴权')]

  switch (msg.t) {
    case 'ping':
      return [{ t: 'pong' }]

    case 'join': {
      const room = ctx.rooms.get(msg.roomId)
      if (!room) return [err('ROOM_NOT_FOUND', '房间不存在')]
      if (!room.players().includes(ctx.userId)) {
        try {
          room.sit(ctx.userId)
        } catch (e) {
          return [err('JOIN_FAILED', (e as Error).message)]
        }
      } else {
        room.setOnline(ctx.userId, true)
      }
      const user = getUser(ctx.db, ctx.userId)
      if (user) room.setNickname(user.id, user.nickname)
      ctx.roomId = room.id
      const out: ServerMessage[] = [
        { t: 'roomState', roomId: room.id, seats: room.seatInfos(), started: room.isStarted() },
      ]
      if (room.isStarted()) out.push({ t: 'gameView', view: room.viewFor(ctx.userId) })
      return out
    }

    case 'leave': {
      if (ctx.roomId) {
        ctx.rooms.get(ctx.roomId)?.leave(ctx.userId)
        ctx.roomId = null
      }
      return [{ t: 'roomState', roomId: '', seats: [], started: false }]
    }

    case 'action': {
      if (!ctx.roomId) return [err('NOT_IN_ROOM', '你不在任何房间中')]
      const room = ctx.rooms.get(ctx.roomId)
      if (!room) return [err('ROOM_NOT_FOUND', '房间不存在')]

      let events
      try {
        events = room.act(ctx.userId, msg.action).events
      } catch (e) {
        return [err('ILLEGAL_ACTION', (e as Error).message)]
      }

      const out: ServerMessage[] = [
        { t: 'events', events },
        { t: 'gameView', view: room.viewFor(ctx.userId) },
      ]

      const settlement = room.takeSettlement()
      if (settlement) {
        settleToLedger(ctx.db, settlement)
        out.push({ t: 'settled', deltas: settlement.deltas })
      }
      return out
    }

    default:
      return [err('UNKNOWN_TYPE', '未知的消息类型')]
  }
}

export function attachGateway(
  server: http.Server,
  deps: { db: DatabaseSync; rooms: RoomManager },
): { close(): void } {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const conns = new Map<WebSocket, ConnCtx>()

  const broadcast = (roomId: string, except: WebSocket): void => {
    const room = deps.rooms.get(roomId)
    if (!room) return
    for (const [sock, c] of conns) {
      if (sock === except || c.roomId !== roomId || sock.readyState !== WebSocket.OPEN) continue
      // 每个连接单独裁剪，绝不复用他人视图
      sock.send(JSON.stringify({ t: 'gameView', view: room.viewFor(c.userId) }))
      sock.send(JSON.stringify({
        t: 'roomState', roomId, seats: room.seatInfos(), started: room.isStarted(),
      }))
    }
  }

  wss.on('connection', (sock) => {
    const ctx: ConnCtx = { db: deps.db, rooms: deps.rooms, userId: null, roomId: null }
    conns.set(sock, ctx)

    sock.on('message', (data) => {
      const before = ctx.roomId
      const out = handleMessage(ctx, data.toString())
      for (const m of out) sock.send(JSON.stringify(m))
      const roomId = ctx.roomId ?? before
      if (roomId) broadcast(roomId, sock)
    })

    sock.on('close', () => {
      if (ctx.roomId && ctx.userId) {
        deps.rooms.get(ctx.roomId)?.setOnline(ctx.userId, false)
        broadcast(ctx.roomId, sock)
      }
      conns.delete(sock)
    })
  })

  return { close: () => wss.close() }
}
```

- [ ] **Step 4: 实现 main.ts**

```ts
import { openDb } from './db/open.js'
import { buildApp } from './http/routes.js'
import { RoomManager } from './room/room.js'
import { registerEngine } from './room/registry.js'
import { highCard } from './games/highcard.js'
import { attachGateway } from './ws/gateway.js'
import { checkGlobalInvariant } from './domain/ledger.js'

const DB_PATH = process.env.CARDGAME_DB ?? '/opt/cardgame/data/cardgame.db'
const PORT = Number(process.env.PORT ?? 3100)
const HOST = process.env.HOST ?? '127.0.0.1'

const db = openDb(DB_PATH)

const invariant = checkGlobalInvariant(db)
if (!invariant.ok) {
  console.error(`账本零和不变量被破坏，总和为 ${invariant.total}，拒绝启动`)
  process.exit(1)
}

registerEngine(highCard)

const rooms = new RoomManager()
const app = buildApp({ db, rooms })

await app.listen({ port: PORT, host: HOST })
attachGateway(app.server, { db, rooms })
console.log(`cardgame 已启动：http://${HOST}:${PORT}`)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 6: 手工冒烟**

Run: `CARDGAME_DB=/tmp/smoke.db pnpm --filter @cardgame/server dev`
另开终端：`curl -s -X POST localhost:3100/api/login -H 'content-type: application/json' -d '{"nickname":"x","password":"y"}'`
Expected: 返回 `{"error":"昵称或密码错误"}`，HTTP 401。确认后 Ctrl-C 停止并 `rm /tmp/smoke.db*`。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(server): WebSocket 网关与服务启动"
```

---

### Task 15: SVG 牌面组件与前端网络层

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/ui/Card.tsx`
- Create: `packages/web/src/net/api.ts`
- Create: `packages/web/src/net/socket.ts`
- Test: `packages/web/src/ui/Card.test.tsx`
- Test: `packages/web/src/net/socket.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Card`/`cardId`；Task 3 的 `ClientMessage`/`ServerMessage`
- Produces:
  - `function CardView(props: { card: Card | null; width?: number }): JSX.Element` — `card` 为 null 时渲染牌背
  - `class ApiClient` — `setToken(t)`、`get(path)`、`post(path, body)`，401 时抛 `ApiError`
  - `class GameSocket` — 构造 `new GameSocket(url, { token, onMessage, wsFactory? })`；方法 `connect()`、`send(msg)`、`close()`；断线后按 1s→2s→4s→8s→最长 15s 退避重连，重连成功自动重发 auth 与 join

- [ ] **Step 1: 创建 web 包配置**

`packages/web/package.json`：

```json
{
  "name": "@cardgame/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@cardgame/shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "gsap": "^3.12.5"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.21.0"
  }
}
```

`packages/web/vite.config.ts`：

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '牌局',
        short_name: '牌局',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/ws': { target: 'ws://127.0.0.1:3100', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
```

`packages/web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>牌局</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: 写牌面组件的失败测试**

`packages/web/src/ui/Card.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CardView } from './Card.js'

describe('CardView', () => {
  it('渲染为 svg 元素', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('黑桃 A 显示 A 与黑桃符号', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    const text = container.textContent ?? ''
    expect(text).toContain('A')
    expect(text).toContain('♠')
  })

  it('红桃显示红色', () => {
    const { container } = render(<CardView card={{ suit: 'h', rank: 10 }} />)
    expect(container.innerHTML).toContain('#dc2626')
  })

  it('数字牌显示点数', () => {
    const { container } = render(<CardView card={{ suit: 'c', rank: 7 }} />)
    expect(container.textContent).toContain('7')
  })

  it('K Q J 显示对应字母', () => {
    for (const [rank, letter] of [[13, 'K'], [12, 'Q'], [11, 'J']] as const) {
      const { container } = render(<CardView card={{ suit: 'd', rank }} />)
      expect(container.textContent).toContain(letter)
    }
  })

  it('大小王显示王字', () => {
    const { container } = render(<CardView card={{ suit: 'j', rank: 16 }} />)
    expect(container.textContent).toContain('王')
  })

  it('card 为 null 时渲染牌背且不含任何点数', () => {
    const { container } = render(<CardView card={null} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.textContent).toBe('')
  })

  it('不含任何 img 标签（禁止位图）', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
```

- [ ] **Step 3: 写 socket 的失败测试**

`packages/web/src/net/socket.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage } from '@cardgame/shared'
import { GameSocket } from './socket.js'

class FakeWs {
  static instances: FakeWs[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null

  constructor(public url: string) {
    FakeWs.instances.push(this)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  emit(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

function make(onMessage = vi.fn()) {
  FakeWs.instances = []
  const s = new GameSocket('ws://x/ws', {
    token: 'T',
    onMessage,
    wsFactory: (url) => new FakeWs(url) as unknown as WebSocket,
  })
  s.connect()
  return { s, onMessage, last: () => FakeWs.instances[FakeWs.instances.length - 1]! }
}

describe('GameSocket', () => {
  it('连接建立后自动发送 auth', () => {
    const { last } = make()
    last().open()
    expect(JSON.parse(last().sent[0]!)).toEqual({ t: 'auth', token: 'T' })
  })

  it('收到 authOk 后回放待发消息', () => {
    const { s, last } = make()
    s.send({ t: 'join', roomId: '123456' })
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    const types = last().sent.map((x) => JSON.parse(x).t)
    expect(types).toEqual(['auth', 'join'])
  })

  it('未连接时发送的消息进入队列而非丢弃', () => {
    const { s, last } = make()
    s.send({ t: 'ping' })
    expect(last().sent).toHaveLength(0)
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    expect(last().sent.map((x) => JSON.parse(x).t)).toContain('ping')
  })

  it('转发服务端消息给 onMessage', () => {
    const { onMessage, last } = make()
    last().open()
    last().emit({ t: 'pong' })
    expect(onMessage).toHaveBeenCalledWith({ t: 'pong' })
  })

  it('断线后按退避重连', async () => {
    vi.useFakeTimers()
    const { last } = make()
    last().open()
    last().close()
    expect(FakeWs.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWs.instances).toHaveLength(2)
    FakeWs.instances[1]!.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWs.instances).toHaveLength(3)
    vi.useRealTimers()
  })

  it('重连后自动重新加入原房间', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    last().emit({ t: 'authOk', userId: 'u1' })
    s.send({ t: 'join', roomId: '654321' })
    last().close()
    await vi.advanceTimersByTimeAsync(1000)
    const fresh = last()
    fresh.open()
    fresh.emit({ t: 'authOk', userId: 'u1' })
    const joins = fresh.sent.map((x) => JSON.parse(x)).filter((m) => m.t === 'join')
    expect(joins[0]).toEqual({ t: 'join', roomId: '654321' })
    vi.useRealTimers()
  })

  it('主动 close 后不再重连', async () => {
    vi.useFakeTimers()
    const { s, last } = make()
    last().open()
    s.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeWs.instances).toHaveLength(1)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./Card.js` 与 `./socket.js`。

- [ ] **Step 5: 实现 Card.tsx**

```tsx
import type { Card } from '@cardgame/shared'

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const RED = '#dc2626'
const BLACK = '#0f172a'

function rankLabel(rank: number): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function CardView({ card, width = 64 }: { card: Card | null; width?: number }) {
  const height = Math.round(width * 1.4)

  if (card === null) {
    return (
      <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label="牌背">
        <rect x="1" y="1" width="62" height="88" rx="6" fill="#1e3a8a" stroke="#0f172a" />
        <rect x="7" y="7" width="50" height="76" rx="4" fill="none" stroke="#60a5fa" strokeWidth="2" />
      </svg>
    )
  }

  if (card.suit === 'j') {
    const color = card.rank === 16 ? RED : BLACK
    return (
      <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label="王牌">
        <rect x="1" y="1" width="62" height="88" rx="6" fill="#ffffff" stroke="#94a3b8" />
        <text x="32" y="52" textAnchor="middle" fontSize="26" fill={color}>王</text>
      </svg>
    )
  }

  const color = card.suit === 'h' || card.suit === 'd' ? RED : BLACK
  const label = rankLabel(card.rank)
  const symbol = SUIT_SYMBOL[card.suit] ?? ''

  return (
    <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label={`${symbol}${label}`}>
      <rect x="1" y="1" width="62" height="88" rx="6" fill="#ffffff" stroke="#94a3b8" />
      <text x="8" y="22" fontSize="16" fill={color}>{label}</text>
      <text x="8" y="36" fontSize="14" fill={color}>{symbol}</text>
      <text x="32" y="58" textAnchor="middle" fontSize="26" fill={color}>{symbol}</text>
    </svg>
  )
}
```

- [ ] **Step 6: 实现 socket.ts**

```ts
import type { ClientMessage, ServerMessage } from '@cardgame/shared'

export interface GameSocketOpts {
  token: string
  onMessage: (msg: ServerMessage) => void
  wsFactory?: (url: string) => WebSocket
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

export class GameSocket {
  private ws: WebSocket | null = null
  private queue: ClientMessage[] = []
  private authed = false
  private closedByUser = false
  private attempt = 0
  private currentRoomId: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private url: string, private opts: GameSocketOpts) {}

  connect(): void {
    this.closedByUser = false
    const factory = this.opts.wsFactory ?? ((u: string) => new WebSocket(u))
    const ws = factory(this.url)
    this.ws = ws
    this.authed = false

    ws.onopen = () => {
      this.attempt = 0
      ws.send(JSON.stringify({ t: 'auth', token: this.opts.token } satisfies ClientMessage))
    }

    ws.onmessage = (e: MessageEvent | { data: string }) => {
      const msg = JSON.parse(String((e as { data: string }).data)) as ServerMessage
      if (msg.t === 'authOk') {
        this.authed = true
        if (this.currentRoomId) {
          this.rawSend({ t: 'join', roomId: this.currentRoomId })
        }
        const pending = this.queue
        this.queue = []
        for (const m of pending) this.rawSend(m)
      }
      this.opts.onMessage(msg)
    }

    ws.onclose = () => {
      this.authed = false
      if (this.closedByUser) return
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!
      this.attempt++
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  private rawSend(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  send(msg: ClientMessage): void {
    if (msg.t === 'join') this.currentRoomId = msg.roomId
    if (msg.t === 'leave') this.currentRoomId = null
    if (this.authed && this.ws) {
      this.rawSend(msg)
    } else {
      this.queue.push(msg)
    }
  }

  close(): void {
    this.closedByUser = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}
```

- [ ] **Step 7: 实现 api.ts**

```ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class ApiClient {
  private token: string | null = null

  constructor(private base = '') {}

  setToken(token: string | null): void {
    this.token = token
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) h.authorization = `Bearer ${this.token}`
    return h
  }

  private async parse(res: Response): Promise<unknown> {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new ApiError(data.error ?? '请求失败', res.status)
    return data
  }

  async get<T>(path: string): Promise<T> {
    return (await this.parse(await fetch(this.base + path, { headers: this.headers() }))) as T
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body ?? {}),
    })
    return (await this.parse(res)) as T
  }
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat(web): SVG 牌面组件与网络层"
```

---

### Task 16: 前端页面与首屏体积门禁

**Files:**
- Create: `packages/web/src/store.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/pages/Login.tsx`
- Create: `packages/web/src/pages/Lobby.tsx`
- Create: `packages/web/src/pages/Friends.tsx`
- Create: `packages/web/src/pages/Loans.tsx`
- Create: `packages/web/src/pages/Ranking.tsx`
- Create: `packages/web/src/pages/Table.tsx`
- Create: `packages/web/src/styles.css`
- Create: `scripts/check-bundle-size.mjs`
- Test: `packages/web/src/store.test.ts`

**Interfaces:**
- Consumes: Task 15 的 `ApiClient`、`GameSocket`、`CardView`
- Produces:
  - `useStore` — Zustand store，字段 `token`、`user`、`netWorth`、`view`、`seats`、`lastSettlement`、`error`；方法 `login`、`register`、`logout`、`refreshMe`、`joinRoom`、`act`、`applyServerMessage`
  - `pnpm check-size` — 构建后校验首屏 gzip 体积 ≤ 300KB，超出则退出码 1

- [ ] **Step 1: 写 store 的失败测试**

`packages/web/src/store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store.js'

beforeEach(() => useStore.getState().reset())

describe('applyServerMessage', () => {
  it('authOk 不改变已登录用户', () => {
    useStore.getState().applyServerMessage({ t: 'authOk', userId: 'u1' })
    expect(useStore.getState().error).toBeNull()
  })

  it('gameView 写入视图', () => {
    useStore.getState().applyServerMessage({ t: 'gameView', view: { pot: 300 } })
    expect(useStore.getState().view).toEqual({ pot: 300 })
  })

  it('roomState 写入座位', () => {
    useStore.getState().applyServerMessage({
      t: 'roomState', roomId: '123456',
      seats: [{ index: 0, userId: 'u1', nickname: '甲', online: true, isAi: false }],
      started: false,
    })
    expect(useStore.getState().seats).toHaveLength(1)
    expect(useStore.getState().roomId).toBe('123456')
  })

  it('settled 写入结算结果', () => {
    useStore.getState().applyServerMessage({ t: 'settled', deltas: { u1: 200, u2: -200 } })
    expect(useStore.getState().lastSettlement).toEqual({ u1: 200, u2: -200 })
  })

  it('error 写入错误信息', () => {
    useStore.getState().applyServerMessage({ t: 'error', code: 'X', message: '出错了' })
    expect(useStore.getState().error).toBe('出错了')
  })

  it('新的 gameView 会清空上一条错误', () => {
    useStore.getState().applyServerMessage({ t: 'error', code: 'X', message: '出错了' })
    useStore.getState().applyServerMessage({ t: 'gameView', view: {} })
    expect(useStore.getState().error).toBeNull()
  })

  it('pong 不改变任何状态', () => {
    const before = useStore.getState().view
    useStore.getState().applyServerMessage({ t: 'pong' })
    expect(useStore.getState().view).toBe(before)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，找不到 `./store.js`。

- [ ] **Step 3: 实现 store.ts**

```ts
import { create } from 'zustand'
import type { SeatInfo, ServerMessage } from '@cardgame/shared'
import { ApiClient } from './net/api.js'
import { GameSocket } from './net/socket.js'

export interface NetWorth {
  balance: number
  receivable: number
  payable: number
  net: number
}

export interface User {
  id: string
  nickname: string
}

interface State {
  api: ApiClient
  socket: GameSocket | null
  token: string | null
  user: User | null
  netWorth: NetWorth | null
  roomId: string | null
  seats: SeatInfo[]
  view: unknown
  lastSettlement: Record<string, number> | null
  error: string | null

  reset(): void
  applyServerMessage(msg: ServerMessage): void
  register(nickname: string, password: string, inviteCode: string): Promise<void>
  login(nickname: string, password: string): Promise<void>
  logout(): Promise<void>
  refreshMe(): Promise<void>
  connect(): void
  joinRoom(roomId: string): void
  act(action: unknown): void
}

const api = new ApiClient('')

export const useStore = create<State>((set, get) => ({
  api,
  socket: null,
  token: localStorage.getItem('token'),
  user: null,
  netWorth: null,
  roomId: null,
  seats: [],
  view: null,
  lastSettlement: null,
  error: null,

  reset() {
    set({
      user: null, netWorth: null, roomId: null, seats: [],
      view: null, lastSettlement: null, error: null,
    })
  },

  applyServerMessage(msg) {
    switch (msg.t) {
      case 'gameView':
        set({ view: msg.view, error: null })
        break
      case 'roomState':
        set({ roomId: msg.roomId || null, seats: msg.seats, error: null })
        break
      case 'settled':
        set({ lastSettlement: msg.deltas })
        void get().refreshMe()
        break
      case 'error':
        set({ error: msg.message })
        break
      default:
        break
    }
  },

  async register(nickname, password, inviteCode) {
    const r = await api.post<{ user: User; token: string }>('/api/register', {
      nickname, password, inviteCode,
    })
    localStorage.setItem('token', r.token)
    api.setToken(r.token)
    set({ token: r.token, user: r.user })
    get().connect()
    await get().refreshMe()
  },

  async login(nickname, password) {
    const r = await api.post<{ user: User; token: string }>('/api/login', { nickname, password })
    localStorage.setItem('token', r.token)
    api.setToken(r.token)
    set({ token: r.token, user: r.user })
    get().connect()
    await get().refreshMe()
  },

  async logout() {
    await api.post('/api/logout')
    localStorage.removeItem('token')
    api.setToken(null)
    get().socket?.close()
    set({ token: null, socket: null })
    get().reset()
  },

  async refreshMe() {
    const r = await api.get<{ user: User; netWorth: NetWorth }>('/api/me')
    set({ user: r.user, netWorth: r.netWorth })
  },

  connect() {
    const token = get().token
    if (!token || get().socket) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new GameSocket(`${proto}://${location.host}/ws`, {
      token,
      onMessage: (m) => get().applyServerMessage(m),
    })
    socket.connect()
    set({ socket })
  },

  joinRoom(roomId) {
    get().socket?.send({ t: 'join', roomId })
  },

  act(action) {
    get().socket?.send({ t: 'action', action })
  },
}))
```

- [ ] **Step 4: 运行 store 测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 实现页面**

`packages/web/src/styles.css`：

```css
@import 'tailwindcss';
```

`packages/web/src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`packages/web/src/pages/Login.tsx`：

```tsx
import { useState } from 'react'
import { useStore } from '../store.js'

export function Login() {
  const { login, register } = useStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      if (mode === 'login') await login(nickname, password)
      else await register(nickname, password, inviteCode)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-20 flex w-72 flex-col gap-3">
      <h1 className="text-center text-2xl">牌局</h1>
      <input className="rounded border p-2" placeholder="昵称"
        value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <input className="rounded border p-2" type="password" placeholder="密码"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {mode === 'register' && (
        <input className="rounded border p-2" placeholder="邀请码"
          value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="rounded bg-blue-600 p-2 text-white" type="submit">
        {mode === 'login' ? '登录' : '注册'}
      </button>
      <button type="button" className="text-sm text-blue-600"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? '用邀请码注册' : '已有账号，去登录'}
      </button>
    </form>
  )
}
```

`packages/web/src/pages/Lobby.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store.js'

export function Lobby({ onEnterRoom }: { onEnterRoom: (roomId: string) => void }) {
  const { api, user, netWorth, refreshMe, logout } = useStore()
  const [roomId, setRoomId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { void refreshMe() }, [refreshMe])

  async function createRoom() {
    const r = await api.post<{ roomId: string }>('/api/rooms', {
      gameId: 'highcard', seats: 3, options: { ante: 100 },
    })
    onEnterRoom(r.roomId)
  }

  async function claim() {
    const r = await api.post<{ claimed: boolean; amount: number }>('/api/daily')
    setMsg(r.claimed ? `签到成功，获得 ${r.amount}` : '今天已经签到过了')
    await refreshMe()
  }

  async function makeInvite() {
    const r = await api.post<{ code: string }>('/api/invite')
    setMsg(`邀请码：${r.code}`)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg">{user?.nickname}</span>
        <button className="text-sm text-slate-500" onClick={() => void logout()}>退出</button>
      </div>
      {netWorth && (
        <div className="rounded bg-slate-100 p-3 text-sm">
          <div>净资产 {netWorth.net}</div>
          <div className="text-slate-500">
            余额 {netWorth.balance} · 应收 {netWorth.receivable} · 应付 {netWorth.payable}
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-blue-700">{msg}</p>}
      <button className="rounded bg-blue-600 p-2 text-white" onClick={() => void createRoom()}>
        创建房间
      </button>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="6 位房间号"
          value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        <button className="rounded border px-3" onClick={() => onEnterRoom(roomId)}>加入</button>
      </div>
      <button className="rounded border p-2" onClick={() => void claim()}>每日签到</button>
      <button className="rounded border p-2" onClick={() => void makeInvite()}>生成邀请码</button>
    </div>
  )
}
```

`packages/web/src/pages/Friends.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Friend { id: string; nickname: string }
interface Pending { id: string; fromUser: string; nickname: string }

export function Friends() {
  const { api } = useStore()
  const [friends, setFriends] = useState<Friend[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Friend[]>([])

  const load = useCallback(async () => {
    const r = await api.get<{ friends: Friend[]; pending: Pending[] }>('/api/friends')
    setFriends(r.friends)
    setPending(r.pending)
  }, [api])

  useEffect(() => { void load() }, [load])

  async function search() {
    const r = await api.get<{ users: Friend[] }>(`/api/users/search?q=${encodeURIComponent(q)}`)
    setFound(r.users)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h2 className="text-lg">好友</h2>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="搜索昵称"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded border px-3" onClick={() => void search()}>搜索</button>
      </div>
      {found.map((u) => (
        <div key={u.id} className="flex justify-between rounded border p-2">
          <span>{u.nickname}</span>
          <button className="text-blue-600"
            onClick={async () => { await api.post('/api/friends/request', { toUserId: u.id }); await load() }}>
            加好友
          </button>
        </div>
      ))}
      {pending.length > 0 && <h3 className="mt-2 text-sm text-slate-500">待处理请求</h3>}
      {pending.map((p) => (
        <div key={p.id} className="flex justify-between rounded border p-2">
          <span>{p.nickname}</span>
          <span className="flex gap-3">
            <button className="text-blue-600"
              onClick={async () => { await api.post('/api/friends/accept', { requestId: p.id }); await load() }}>
              接受
            </button>
            <button className="text-slate-500"
              onClick={async () => { await api.post('/api/friends/reject', { requestId: p.id }); await load() }}>
              拒绝
            </button>
          </span>
        </div>
      ))}
      <h3 className="mt-2 text-sm text-slate-500">我的好友</h3>
      {friends.map((f) => <div key={f.id} className="rounded border p-2">{f.nickname}</div>)}
    </div>
  )
}
```

`packages/web/src/pages/Loans.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Loan {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  outstanding: number
  status: 'open' | 'settled'
}
interface Friend { id: string; nickname: string }

export function Loans() {
  const { api, refreshMe } = useStore()
  const [asLender, setAsLender] = useState<Loan[]>([])
  const [asBorrower, setAsBorrower] = useState<Loan[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [target, setTarget] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.get<{ asLender: Loan[]; asBorrower: Loan[] }>('/api/loans')
    setAsLender(r.asLender)
    setAsBorrower(r.asBorrower)
    const f = await api.get<{ friends: Friend[] }>('/api/friends')
    setFriends(f.friends)
  }, [api])

  useEffect(() => { void load() }, [load])

  async function lend() {
    setErr(null)
    try {
      await api.post('/api/loans', { borrowerId: target, amount: Number(amount) })
      await load()
      await refreshMe()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function repay(loan: Loan) {
    setErr(null)
    try {
      await api.post('/api/loans/repay', { loanId: loan.id, amount: loan.outstanding })
      await load()
      await refreshMe()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h2 className="text-lg">借条</h2>
      <p className="text-xs text-slate-500">借条仅限好友之间，无利息、无期限，全部借条对好友公开。</p>
      <div className="flex gap-2">
        <select className="flex-1 rounded border p-2" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">选择好友</option>
          {friends.map((f) => <option key={f.id} value={f.id}>{f.nickname}</option>)}
        </select>
        <input className="w-24 rounded border p-2" placeholder="金额"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="rounded border px-3" onClick={() => void lend()}>借出</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <h3 className="text-sm text-slate-500">我借出的</h3>
      {asLender.map((l) => (
        <div key={l.id} className="rounded border p-2 text-sm">
          待收回 {l.outstanding} / 本金 {l.principal} · {l.status === 'open' ? '未结清' : '已结清'}
        </div>
      ))}
      <h3 className="text-sm text-slate-500">我欠的</h3>
      {asBorrower.map((l) => (
        <div key={l.id} className="flex justify-between rounded border p-2 text-sm">
          <span>待还 {l.outstanding} / 本金 {l.principal}</span>
          {l.status === 'open' && (
            <button className="text-blue-600" onClick={() => void repay(l)}>全额还款</button>
          )}
        </div>
      ))}
    </div>
  )
}
```

`packages/web/src/pages/Ranking.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Row {
  userId: string
  nickname: string
  net: number
  balance: number
  payable: number
}

export function Ranking() {
  const { api } = useStore()
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    void api.get<{ ranking: Row[] }>('/api/ranking').then((r) => setRows(r.ranking))
  }, [api])

  return (
    <div className="mx-auto max-w-md p-4">
      <h2 className="mb-2 text-lg">资产排行</h2>
      <p className="mb-2 text-xs text-slate-500">按净资产排序（余额 + 应收 − 应付），借款不影响排名。</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th>玩家</th><th className="text-right">净资产</th>
            <th className="text-right">余额</th><th className="text-right">负债</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t">
              <td>{r.nickname}</td>
              <td className="text-right">{r.net}</td>
              <td className="text-right text-slate-500">{r.balance}</td>
              <td className="text-right text-red-600">{r.payable || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

`packages/web/src/pages/Table.tsx`：

```tsx
import { useStore } from '../store.js'
import { CardView } from '../ui/Card.js'
import type { Card } from '@cardgame/shared'

interface HighCardView {
  pot: number
  players: string[]
  folded: string[]
  acted: string[]
  over: boolean
  hands: Record<string, Card>
}

export function Table({ onLeave }: { onLeave: () => void }) {
  const { view, seats, roomId, act, error, lastSettlement, user } = useStore()
  const v = view as HighCardView | null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <div className="flex justify-between">
        <span>房间 {roomId}</span>
        <button className="text-sm text-slate-500" onClick={onLeave}>离开</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {seats.map((s) => (
          <span key={s.index} className={`rounded border px-2 py-1 text-sm ${s.online ? '' : 'text-slate-400'}`}>
            {s.nickname ?? '空位'}{s.isAi ? '（托管）' : ''}
          </span>
        ))}
      </div>

      {v === null ? (
        <p className="text-slate-500">等待开局……</p>
      ) : (
        <>
          <p className="text-sm">底池 {v.pot}</p>
          <div className="flex gap-2">
            {v.players.map((p) => (
              <CardView key={p} card={v.hands[p] ?? null} />
            ))}
          </div>
          {!v.over && user && !v.acted.includes(user.id) && (
            <div className="flex gap-2">
              <button className="rounded bg-blue-600 px-4 py-2 text-white"
                onClick={() => act({ type: 'call' })}>跟注</button>
              <button className="rounded border px-4 py-2" onClick={() => act({ type: 'fold' })}>弃牌</button>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {lastSettlement && (
        <div className="rounded bg-slate-100 p-2 text-sm">
          本局结算：{Object.entries(lastSettlement).map(([id, d]) => `${id.slice(0, 4)} ${d > 0 ? '+' : ''}${d}`).join('，')}
        </div>
      )}
    </div>
  )
}
```

`packages/web/src/App.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useStore } from './store.js'
import { Login } from './pages/Login.js'
import { Lobby } from './pages/Lobby.js'
import { Friends } from './pages/Friends.js'
import { Loans } from './pages/Loans.js'
import { Ranking } from './pages/Ranking.js'
import { Table } from './pages/Table.js'

type Tab = 'lobby' | 'friends' | 'loans' | 'ranking' | 'table'

export function App() {
  const { token, api, connect, joinRoom } = useStore()
  const [tab, setTab] = useState<Tab>('lobby')

  useEffect(() => {
    if (token) {
      api.setToken(token)
      connect()
    }
  }, [token, api, connect])

  if (!token) return <Login />

  return (
    <div className="pb-16">
      {tab === 'lobby' && (
        <Lobby onEnterRoom={(id) => { joinRoom(id); setTab('table') }} />
      )}
      {tab === 'friends' && <Friends />}
      {tab === 'loans' && <Loans />}
      {tab === 'ranking' && <Ranking />}
      {tab === 'table' && <Table onLeave={() => setTab('lobby')} />}

      <nav className="fixed inset-x-0 bottom-0 flex border-t bg-white">
        {([['lobby', '大厅'], ['friends', '好友'], ['loans', '借条'], ['ranking', '排行']] as const).map(
          ([key, label]) => (
            <button key={key} className={`flex-1 p-3 text-sm ${tab === key ? 'text-blue-600' : ''}`}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ),
        )}
      </nav>
    </div>
  )
}
```

- [ ] **Step 6: 实现首屏体积门禁**

`scripts/check-bundle-size.mjs`：

```js
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const LIMIT = 300 * 1024
const dir = 'packages/web/dist/assets'

let total = 0
for (const name of readdirSync(dir)) {
  if (!/\.(js|css)$/.test(name)) continue
  const path = join(dir, name)
  if (!statSync(path).isFile()) continue
  const gz = gzipSync(readFileSync(path)).length
  total += gz
  console.log(`${name}  ${(gz / 1024).toFixed(1)} KB (gzip)`)
}

console.log(`合计 ${(total / 1024).toFixed(1)} KB / 上限 ${(LIMIT / 1024).toFixed(0)} KB`)
if (total > LIMIT) {
  console.error('首屏体积超出上限')
  process.exit(1)
}
```

在根 `package.json` scripts 增加：

```json
"check-size": "pnpm --filter @cardgame/web build && node scripts/check-bundle-size.mjs"
```

- [ ] **Step 7: 运行体积门禁**

Run: `pnpm check-size`
Expected: 输出各文件体积与合计，进程退出码 0。若超限，把 `Friends`/`Loans`/`Ranking` 改为 `React.lazy` 动态导入后重跑。

- [ ] **Step 8: 端到端手工验证**

启动服务端：`CARDGAME_DB=/tmp/e2e.db pnpm --filter @cardgame/server dev`
另开终端启动前端：`pnpm --filter @cardgame/web dev`

按顺序验证：

1. 用 `node -e` 生成一个邀请码：
   `node --experimental-sqlite -e "const {openDb}=await import('./packages/server/dist/db/open.js');const {createInviteCode}=await import('./packages/server/dist/domain/users.js');console.log(createInviteCode(openDb('/tmp/e2e.db'),null))"`
2. 浏览器打开 `http://localhost:5173`，用该邀请码注册「甲」
3. 大厅显示净资产 10000
4. 点「每日签到」，净资产变为 10200
5. 点「生成邀请码」，用无痕窗口注册「乙」
6. 甲创建房间，记下 6 位房号；乙输入房号加入
7. 两人各点「跟注」，牌面翻开、显示结算，双方净资产之和保持 20200

Expected: 全部符合。验证后 `rm /tmp/e2e.db*`。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat(web): 页面、PWA 外壳与首屏体积门禁"
```

---

### Task 17: 部署到 119.29.198.188

**Files:**
- Create: `deploy/cardgame.service`
- Create: `deploy/cardgame.nginx.conf`
- Create: `deploy/install.sh`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: Task 14 的 `main.ts`（监听 `127.0.0.1:3100`）；Task 16 的 `packages/web/dist`
- Produces: 线上可访问的 `https://poker.tyyunan.com`，现有 `agent-hub` 与 `console_site` 不受影响

**前置风险提示：** 本任务是全计划中唯一触碰共享资源（nginx 配置）的部分。Step 5 之前的所有步骤都是纯新增，零风险；Step 5 必须严格按备份 → 校验 → 重载 → 验证的顺序执行。

- [ ] **Step 1: 验证 glibc-217 版 Node 能在目标机运行**

这是整个部署方案唯一的技术不确定点，必须最先消掉。在服务器上执行（全程在 `/tmp`，不安装、不改配置）：

```bash
cd /tmp
curl -fsSLO https://unofficial-builds.nodejs.org/download/release/v22.14.0/node-v22.14.0-linux-x64-glibc-217.tar.xz
tar xf node-v22.14.0-linux-x64-glibc-217.tar.xz
./node-v22.14.0-linux-x64-glibc-217/bin/node -v
./node-v22.14.0-linux-x64-glibc-217/bin/node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE t(x)');d.prepare('INSERT INTO t VALUES (1)').run();console.log(d.prepare('SELECT SUM(x) s FROM t').get())"
```

Expected: 先输出 `v22.14.0`，再输出 `{ s: 1 }`。

**若任一步失败，停止本任务并升级方案**：改用 Go 重写服务端（spec 8.2 已记录该备选），或改为购买新服务器。不要试图在 CentOS 7 上编译 Node。

- [ ] **Step 2: 建立隔离的运行环境**

```bash
useradd -r -s /sbin/nologin -d /opt/cardgame cardgame
mkdir -p /opt/cardgame/{app,data,node,logs}
mv /tmp/node-v22.14.0-linux-x64-glibc-217/* /opt/cardgame/node/
chown -R cardgame:cardgame /opt/cardgame
/opt/cardgame/node/bin/node -v
```

Expected: 输出 `v22.14.0`。注意 Node 不进系统 PATH，只在 `/opt/cardgame/node` 内。

- [ ] **Step 3: 部署代码**

在本地构建并上传（服务器上没有 git，也不打算装）：

```bash
pnpm -r build
tar czf /tmp/cardgame-dist.tar.gz \
  packages/shared/dist packages/shared/package.json \
  packages/server/dist packages/server/package.json \
  packages/web/dist package.json pnpm-lock.yaml
scp /tmp/cardgame-dist.tar.gz root@119.29.198.188:/tmp/
ssh root@119.29.198.188 'cd /opt/cardgame/app && tar xzf /tmp/cardgame-dist.tar.gz && chown -R cardgame:cardgame /opt/cardgame/app'
```

服务端依赖（fastify、ws）需要在服务器上安装。用 Node 自带的 npm，且只装生产依赖：

```bash
ssh root@119.29.198.188 'cd /opt/cardgame/app && /opt/cardgame/node/bin/npm install --omit=dev --no-audit --no-fund fastify@5 ws@8'
```

Expected: 安装完成且无编译步骤（fastify 与 ws 均为纯 JS）。若出现 node-gyp 相关输出，说明误引入了原生模块，须排查后再继续。

- [ ] **Step 4: 配置 systemd（含资源上限）**

`deploy/cardgame.service`：

```ini
[Unit]
Description=Cardgame Server
After=network.target

[Service]
Type=simple
User=cardgame
Group=cardgame
WorkingDirectory=/opt/cardgame/app
Environment=NODE_ENV=production
Environment=CARDGAME_DB=/opt/cardgame/data/cardgame.db
Environment=PORT=3100
Environment=HOST=127.0.0.1
ExecStart=/opt/cardgame/node/bin/node --experimental-sqlite packages/server/dist/main.js
Restart=on-failure
RestartSec=5

# 资源上限：保证最坏情况下只有本服务被 OOM kill，不波及 agent-hub
MemoryMax=1G
CPUQuota=80%

# 最小权限
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/cardgame/data /opt/cardgame/logs

StandardOutput=append:/opt/cardgame/logs/out.log
StandardError=append:/opt/cardgame/logs/err.log

[Install]
WantedBy=multi-user.target
```

安装并启动：

```bash
scp deploy/cardgame.service root@119.29.198.188:/etc/systemd/system/
ssh root@119.29.198.188 'systemctl daemon-reload && systemctl enable --now cardgame && sleep 2 && systemctl is-active cardgame && curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3100/api/login -H "content-type: application/json" -d "{\"nickname\":\"x\",\"password\":\"y\"}"'
```

Expected: 输出 `active` 与 `401`。

同时确认没有影响现有服务：

```bash
ssh root@119.29.198.188 'systemctl is-active nginx 2>/dev/null; ps -p $(pgrep -f agent-hub/hub.py) -o pid,rss,cmd'
```

Expected: agent-hub 进程仍在，PID 未变。

- [ ] **Step 5: 接入 nginx（唯一触碰共享资源的步骤）**

`deploy/cardgame.nginx.conf`（放到 `/usr/local/nginx/conf/`）：

```nginx
server {
    listen 443 ssl;
    server_name poker.tyyunan.com;

    ssl_certificate     /opt/cardgame/certs/fullchain.pem;
    ssl_certificate_key /opt/cardgame/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 静态资源由 CDN 承载，此处仅作回源兜底
    location / {
        root /opt/cardgame/app/packages/web/dist;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

执行顺序**不可调换**：

```bash
# 1) 备份
ssh root@119.29.198.188 'cp /usr/local/nginx/conf/nginx.conf /usr/local/nginx/conf/nginx.conf.bak.$(date +%s)'

# 2) 上传新配置文件（纯新增，此时还未被引用）
scp deploy/cardgame.nginx.conf root@119.29.198.188:/usr/local/nginx/conf/

# 3) 在 nginx.conf 的 http 段末尾加一行 include（用编辑器手工加，不要用 sed 盲改）
#    include cardgame.nginx.conf;

# 4) 校验语法 —— 未通过则不得继续
ssh root@119.29.198.188 '/usr/local/nginx/sbin/nginx -t'

# 5) 优雅重载（agent-hub 零停机）
ssh root@119.29.198.188 '/usr/local/nginx/sbin/nginx -s reload'

# 6) 验证现有服务未受影响
ssh root@119.29.198.188 'curl -sk -o /dev/null -w "agent-hub: %{http_code}\n" https://127.0.0.1/ ; curl -sk -o /dev/null -w "console: %{http_code}\n" https://127.0.0.1:8443/'
```

Expected: 第 4 步输出 `syntax is ok` / `test is successful`；第 6 步两个状态码与改动前一致。

**回滚方式**（30 秒）：删掉 nginx.conf 里那一行 include，再执行 `nginx -t && nginx -s reload`。

- [ ] **Step 6: 申请 TLS 证书（DNS-01，不占 80 端口）**

在**本地**执行，避免在服务器上安装 certbot：

```bash
# 用支持 DNS-01 的客户端签发 poker.tyyunan.com 的证书，
# 按提示在 tyyunan.com 的 DNS 处添加 _acme-challenge TXT 记录
certbot certonly --manual --preferred-challenges dns -d poker.tyyunan.com
```

签发完成后上传：

```bash
ssh root@119.29.198.188 'mkdir -p /opt/cardgame/certs'
scp /etc/letsencrypt/live/poker.tyyunan.com/fullchain.pem root@119.29.198.188:/opt/cardgame/certs/
scp /etc/letsencrypt/live/poker.tyyunan.com/privkey.pem root@119.29.198.188:/opt/cardgame/certs/
ssh root@119.29.198.188 'chmod 600 /opt/cardgame/certs/privkey.pem && /usr/local/nginx/sbin/nginx -s reload'
```

并把 `poker.tyyunan.com` 的 A 记录指向 `119.29.198.188`。

Expected: 浏览器打开 `https://poker.tyyunan.com` 显示登录页，证书有效无警告。

**注意：** Let's Encrypt 证书 90 天到期。在 `deploy/README.md` 中记录续期步骤，并设置到期前的提醒。手动 DNS-01 无法自动续期——这是为「不碰现有 nginx 的 80 端口」付出的代价。

- [ ] **Step 7: 静态资源上 CDN（硬性要求）**

服务器出站带宽实测仅 4.5 Mbps 且与 agent-hub 共享，静态资源必须外置：

```bash
# 1) 在腾讯云 COS 建桶（如 cardgame-static），开启静态网站与 CDN 加速
# 2) 上传构建产物
coscmd upload -r packages/web/dist/ /
# 3) 在 vite.config.ts 中设置 base 为 CDN 域名后重新构建并上传
```

`packages/web/vite.config.ts` 增加：

```ts
export default defineConfig({
  base: process.env.CDN_BASE ?? '/',
  // ...其余配置不变
})
```

构建命令改为：`CDN_BASE=https://<你的CDN域名>/ pnpm --filter @cardgame/web build`

验证：

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://<你的CDN域名>/assets/index-*.js
```

Expected: 200 且体积与本地产物一致。随后在浏览器 DevTools 的 Network 面板确认 JS/CSS 全部来自 CDN 域名，只有 `/api` 与 `/ws` 走 `poker.tyyunan.com`。

- [ ] **Step 8: 上线后核对**

```bash
ssh root@119.29.198.188 'free -h; systemctl status cardgame --no-pager | head -12; ls -la /opt/cardgame/data/'
```

Expected：
- 剩余可用内存仍在 2G 以上
- cardgame 服务 active，内存占用 < 200M
- 数据库文件已生成

再核对账本不变量（服务启动时已自检，此处二次确认）：

```bash
ssh root@119.29.198.188 '/opt/cardgame/node/bin/node --experimental-sqlite -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"/opt/cardgame/data/cardgame.db\");console.log(d.prepare(\"SELECT COALESCE(SUM(delta),0) AS total FROM ledger_entries\").get())"'
```

Expected: `{ total: 0 }`。

- [ ] **Step 9: 写部署文档**

`deploy/README.md` 需包含：Node 版本与下载地址、目录布局、systemd 常用命令（start/stop/restart/日志位置）、nginx 那一行 include 的位置与回滚方法、证书到期日与续期步骤、CDN 上传命令、数据库备份命令（`sqlite3` 不可用，用 `cp /opt/cardgame/data/cardgame.db* /backup/`，需先 `systemctl stop cardgame` 或使用 WAL checkpoint）。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "chore: 部署脚本与文档"
```

---

## 完成标准

0 期视为完成，需同时满足：

1. `pnpm test` 全绿
2. `pnpm fuzz 100000` 通过，无零和/非法动作/死锁违规
3. `pnpm check-size` 通过，首屏 gzip ≤ 300KB
4. Task 16 Step 8 的端到端手工验证 7 项全部符合
5. `https://poker.tyyunan.com` 可注册、加好友、打借条、开房、完成一局 highcard，排行按净资产展示
6. 服务器上 agent-hub 与 console_site 状态与部署前一致

## 下一步

0 期完成后，用 brainstorming → writing-plans 流程为 **1 期（炸金花 + 德州扑克）** 单独立项。1 期将：

- 用炸金花与德州替换 `highcard` 占位玩法（`highcard` 保留作参照实现与 fuzz 框架的回归用例）
- 新增共享的下注轮与彩池/边池模块
- 新增牌力评估器（3 张与 7 选 5）
- 每款玩法上线前必须跑通 `fuzzEngine` 的 10 万局自测
