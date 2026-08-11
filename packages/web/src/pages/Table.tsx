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
  const { view, seats, roomId, ownerId, started, act, startGame, error, lastSettlement, user } = useStore()
  const v = view as HighCardView | null
  const isOwner = user !== null && user.id === ownerId

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

      {!started && isOwner && (
        <button className="rounded bg-green-600 px-4 py-2 text-white" onClick={startGame}>
          开始本局
        </button>
      )}

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
