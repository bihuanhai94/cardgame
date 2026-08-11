import { CardView } from '../../ui/Card.js'
import type { Card } from '@cardgame/shared'

export interface SeatProps {
  id: string
  nickname: string
  isTurn: boolean
  folded: boolean
  /**
   * 服务端下发的手牌，服务端才是可见性的权威：闷牌时不下发（cards 为
   * undefined），摊牌/结算揭示时会下发——即便这名玩家从未看过自己的牌。
   * 所以这里只看数据在不在，绝不用「看没看过牌」去反推是否该显示牌背。
   */
  cards?: Card[]
  /** 处于比牌选人状态时，该座位是否可以被选为目标 */
  selectable?: boolean
  onSelect?: (id: string) => void
}

export function Seat({ id, nickname, isTurn, folded, cards, selectable, onSelect }: SeatProps) {
  return (
    <div className={`seat flex flex-col items-center gap-0.5 text-center ${folded ? 'opacity-30' : ''}`}>
      <div className="flex gap-0.5" style={{ minHeight: 28 }}>
        {(cards ?? [null, null, null]).map((c, i) => <CardView key={i} card={c ?? null} width={20} />)}
      </div>
      <div
        className={`avatar flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm ${
          isTurn ? 'border-yellow-400 shadow-[0_0_8px_rgba(255,215,94,.6)]' : 'border-slate-500'
        }`}
      >
        {nickname.slice(0, 1)}
      </div>
      <span className="text-xs text-slate-300">{nickname}</span>
      {onSelect && (
        <button
          type="button"
          data-testid={`seat-target-${id}`}
          disabled={!selectable}
          className="rounded border px-2 py-0.5 text-xs disabled:opacity-30"
          onClick={() => onSelect(id)}
        >
          比这家
        </button>
      )}
    </div>
  )
}
