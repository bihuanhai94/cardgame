import { ChipPile } from '../../ui/chips/ChipPile.js'

/**
 * 座位与桌心之间的下注展示。下注额在牌桌上是公开信息——引擎 view() 现在
 * 下发每一家本轮的 committed（裁剪边界管的是牌，不是钱）——所以这里如实
 * 按 demo.html 的 bet-area 位置放一小摞筹码（ChipPile）+ 数字标签。
 */
export function BetArea({ amount }: { amount: number }) {
  if (amount <= 0) return null
  return (
    <div className="bet-area flex items-end gap-1">
      <ChipPile amount={amount} w={14} perCol={4} cap={8} />
      <span className="text-[10px] text-amber-200">{amount}</span>
    </div>
  )
}
