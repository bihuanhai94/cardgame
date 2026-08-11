import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { CardView } from '../ui/Card.js'
import { ChipHeap, type ChipHeapHandle } from '../ui/chips/ChipHeap.js'
import { breakdown } from '../ui/chips/denoms.js'
import { useRollup } from '../ui/useRollup.js'
import { Seat } from '../table/zhajinhua/Seat.js'
import { BetArea } from '../table/zhajinhua/BetArea.js'
import { ActionBar } from '../table/zhajinhua/ActionBar.js'
import { SFX } from '../sfx/index.js'
import type { Card } from '@cardgame/shared'

/**
 * 炸金花引擎 view() 的形状（packages/server/src/games/zhajinhua.ts）。
 * 逐字对齐该函数 return 的字段，一个不多一个不少——这是脱敏边界，
 * 客户端拿不到、也不该猜测更多信息（比如别人的下注额、未看牌玩家的手牌）。
 */
export interface ZjhView {
  players: string[]
  ante: number
  maxRounds: number
  looked: string[]
  folded: string[]
  round: number
  pot: number
  over: boolean
  winner: string | null
  turn: string | null
  currentBet: number
  compares: Array<{ from: string; to: string; winner: string }>
  hands: Record<string, Card[]>
  /** 各家本轮已投入——下注额是牌桌上的公开信息，所有 viewer（含未看牌者、观战者）都能看到。 */
  committed: Record<string, number>
}

/** 音效环境可能完全没有 WebAudio（jsdom、部分浏览器）；音效永远不该让交互崩溃。 */
function safe(fn: () => void): void {
  try {
    fn()
  } catch {
    // 静音失败：没有声音，但游戏继续。
  }
}

/**
 * 炸金花是这个牌桌特有的动作词汇（看牌/跟注/加注/弃牌/比牌）——不属于
 * store 那个跨玩法共享的 State。放在这里而不是 store.ts，是为了不让
 * store 的公共接口随着以后每加一种玩法（德州、斗地主……）就再堆一批
 * 只有自己用的动词。它们全部只是 act(...) 的薄封装，没有任何自身状态。
 */
function useZjhActions() {
  const act = useStore((s) => s.act)
  return {
    look: () => act({ type: 'look' }),
    callBet: () => act({ type: 'call' }),
    raiseTo: (to: number) => act({ type: 'raise', to }),
    foldHand: () => act({ type: 'fold' }),
    compareWith: (targetId: string) => act({ type: 'compare', targetId }),
  }
}

export function TableZjh({ onLeave }: { onLeave: () => void }) {
  const { view, seats, roomId, user, error, lastSettlement } = useStore()
  const { look, callBet, raiseTo, foldHand, compareWith } = useZjhActions()
  const v = view as ZjhView | null
  const heapRef = useRef<ChipHeapHandle>(null)
  const prevPot = useRef(0)
  const [compareMode, setCompareMode] = useState(false)

  const nicknameOf = (id: string): string =>
    seats.find((s) => s.userId === id)?.nickname ?? id.slice(0, 4)

  const potDisplay = useRollup(v?.pot ?? 0)

  useEffect(() => {
    if (!v) return
    const delta = v.pot - prevPot.current
    if (delta > 0) heapRef.current?.add(breakdown(delta, 8))
    prevPot.current = v.pot
  }, [v?.pot])

  const prevTurn = useRef<string | null>(null)
  useEffect(() => {
    if (v && user && v.turn === user.id && prevTurn.current !== user.id) {
      safe(() => SFX.turn())
    }
    prevTurn.current = v?.turn ?? null
  }, [v?.turn, user])

  useEffect(() => {
    setCompareMode(false)
  }, [v?.turn])

  if (v === null || user === null) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
        <div className="flex justify-between">
          <span>房间 {roomId}</span>
          <button className="text-sm text-slate-500" onClick={onLeave}>离开</button>
        </div>
        <p className="text-slate-500">等待开局……</p>
      </div>
    )
  }

  const isMyTurn = v.turn === user.id
  const iLooked = v.looked.includes(user.id)
  const myFolded = v.folded.includes(user.id)
  const cappedOut = v.round >= v.maxRounds
  const opponents = v.players.filter((p) => p !== user.id)

  const eligibleTargets = new Set(
    v.players.filter((p) => p !== user.id && v.looked.includes(p) && !v.folded.includes(p)),
  )

  function handleFold(): void {
    safe(() => SFX.fold())
    foldHand()
  }

  function handleLook(): void {
    safe(() => SFX.deal())
    look()
  }

  function handleSelectTarget(targetId: string): void {
    compareWith(targetId)
    setCompareMode(false)
  }

  return (
    <div className="table-wrap mx-auto flex max-w-md flex-col gap-2 p-2 text-slate-100">
      <div className="flex justify-between text-sm">
        <span>房间 {roomId}</span>
        <button className="text-slate-400" onClick={onLeave}>离开</button>
      </div>

      <div className="pot mx-auto rounded-full bg-black/40 px-4 py-1 text-sm">
        底池 {potDisplay}
      </div>
      <div className="mx-auto"><ChipHeap ref={heapRef} boxW={140} boxH={64} /></div>

      <div className="flex flex-wrap justify-center gap-4">
        {opponents.map((id) => (
          <div key={id} className="flex flex-col items-center gap-1">
            <Seat
              id={id}
              nickname={nicknameOf(id)}
              isTurn={v.turn === id}
              folded={v.folded.includes(id)}
              cards={v.hands[id]}
              selectable={compareMode ? eligibleTargets.has(id) : undefined}
              onSelect={compareMode ? handleSelectTarget : undefined}
            />
            <BetArea amount={v.committed[id] ?? 0} />
          </div>
        ))}
      </div>

      <div className="own mx-auto flex flex-col items-center gap-1">
        <div className="flex gap-2">
          {/* 判据是 v.hands[user.id] 在不在，不是「自己看没看过牌」——
              服务端才是可见性的权威：摊牌/结算揭示时即便从未看牌也会下发。 */}
          {(v.hands[user.id] ?? [null, null, null]).map((c, i) => <CardView key={i} card={c ?? null} width={54} />)}
        </div>
        <BetArea amount={v.committed[user.id] ?? 0} />
      </div>

      <ActionBar
        isMyTurn={isMyTurn && !myFolded}
        looked={iLooked}
        cappedOut={cappedOut}
        callAmount={v.currentBet}
        raiseAmount={v.currentBet + v.ante}
        compareMode={compareMode}
        onLook={handleLook}
        onCall={callBet}
        onRaise={() => raiseTo(v.currentBet + v.ante)}
        onFold={handleFold}
        onToggleCompare={() => setCompareMode((m) => !m)}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {lastSettlement && (
        <div className="rounded bg-slate-800 p-2 text-sm">
          本局结算：{Object.entries(lastSettlement).map(([id, d]) => `${nicknameOf(id)} ${d > 0 ? '+' : ''}${d}`).join('，')}
        </div>
      )}
    </div>
  )
}
