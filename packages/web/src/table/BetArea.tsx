/**
 * 座位与桌心之间的下注提示。引擎的 view 并不下发每位玩家本轮已投入的具体筹码数
 * （那是 apply/settle 内部账本，不是 redaction 边界要暴露的东西），所以这里只能
 * 呈现 view 里真实有的信息：轮到该玩家时，他这一手要跟注多少。
 */
export function BetArea({ active, amountToCall }: { active: boolean; amountToCall: number }) {
  if (!active) return null
  return (
    <div className="bet-area rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-amber-200">
      跟注 {amountToCall}
    </div>
  )
}
