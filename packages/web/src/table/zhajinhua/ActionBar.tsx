export interface ActionBarProps {
  /** 是否轮到本玩家（不是自己回合时，一切操作都要禁用——服务端也不会接受） */
  isMyTurn: boolean
  looked: boolean
  /** round >= maxRounds：服务端已不再接受 call/raise，只能比牌或弃牌 */
  cappedOut: boolean
  callAmount: number
  raiseAmount: number
  compareMode: boolean
  onLook: () => void
  onCall: () => void
  onRaise: () => void
  onFold: () => void
  onToggleCompare: () => void
}

export function ActionBar({
  isMyTurn,
  looked,
  cappedOut,
  callAmount,
  raiseAmount,
  compareMode,
  onLook,
  onCall,
  onRaise,
  onFold,
  onToggleCompare,
}: ActionBarProps) {
  const disabled = !isMyTurn
  return (
    <div className={`actions flex gap-2 p-2 ${isMyTurn ? 'live' : ''}`}>
      {!looked && (
        <button type="button" className="flex-1 rounded bg-slate-700 py-2 text-white disabled:opacity-40"
          disabled={disabled} onClick={onLook}>
          看牌
        </button>
      )}
      <button type="button" className="fold flex-1 rounded border py-2 disabled:opacity-40"
        disabled={disabled} onClick={onFold}>
        弃牌
      </button>
      <button type="button" className="call flex-1 rounded bg-green-700 py-2 text-white disabled:opacity-40"
        disabled={disabled || cappedOut} onClick={onCall}>
        跟注 {callAmount}
      </button>
      <div className="flex flex-1 flex-col items-center">
        <button type="button" className="raise w-full rounded bg-amber-600 py-2 text-white disabled:opacity-40"
          disabled={disabled || cappedOut} onClick={onRaise}>
          加注
        </button>
        <span className="text-[10px] text-amber-200">到 {raiseAmount}</span>
      </div>
      {looked && (
        <button type="button" className="flex-1 rounded border py-2 disabled:opacity-40"
          disabled={disabled} onClick={onToggleCompare}>
          {compareMode ? '取消比牌' : '比牌'}
        </button>
      )}
      {cappedOut && <p className="w-full text-center text-xs text-amber-300">已封顶，只能弃牌或比牌</p>}
    </div>
  )
}
