import { breakdown } from './denoms.js'
import { Chip } from './Chip.js'

/**
 * 码成摞 —— 玩家自己的筹码。每摞最多 perCol 枚，满了开新摞。
 * 元素不旋转，只微调条纹角度（--spin）与手码错位（marginLeft）。
 */
export function ChipPile({
  amount,
  w = 22,
  perCol = 9,
  cap = 40,
  animateFrom = null,
}: {
  amount: number
  w?: number
  perCol?: number
  cap?: number
  animateFrom?: number | null
}) {
  const chips = breakdown(amount, cap)
  const lift = w * 0.155

  const cols: (typeof chips)[] = []
  for (let i = 0; i < chips.length; i += perCol) cols.push(chips.slice(i, i + perCol))

  return (
    <span className="pile">
      {cols.map((col, ci) => {
        const h = w * 0.3 + lift * (col.length - 1)
        return (
          <span key={ci} className="col" style={{ width: w, height: h }}>
            {col.map((c, i) => {
              const idx = ci * perCol + i
              const isNew = animateFrom !== null && idx >= animateFrom
              const jx = ((idx * 37) % 7 - 3) * 0.4
              const spin = (idx * 47) % 360
              return (
                <Chip
                  key={idx}
                  denom={c}
                  w={w}
                  spin={spin}
                  isNew={isNew}
                  animationDelayMs={isNew ? (idx - (animateFrom ?? 0)) * 45 : 0}
                  style={{ bottom: i * lift, marginLeft: jx }}
                />
              )
            })}
          </span>
        )
      })}
    </span>
  )
}
