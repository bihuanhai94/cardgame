/**
 * 座位与桌心之间的下注展示。下注额在牌桌上是公开信息——引擎 view() 现在
 * 下发每一家本轮的 committed（裁剪边界管的是牌，不是钱）——所以这里可以
 * 如实按 demo.html 的 bet-area 位置放一小摞筹码 + 数字。
 */
export function BetArea({ amount }: { amount: number }) {
  if (amount <= 0) return null
  return (
    <div className="bet-area rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-amber-200">
      {amount}
    </div>
  )
}
