// 面额与拆分、落点计算 —— 直接移植自 docs/design/table-ui/chips.js

export interface Denom {
  v: number
  cls: string
}

const DENOMS: Denom[] = [
  { v: 1000, cls: 'd1000' },
  { v: 500, cls: 'd500' },
  { v: 100, cls: 'd100' },
  { v: 25, cls: 'd25' },
  { v: 5, cls: 'd5' },
]

/** 拆分金额为筹码序列（大面额优先），最多 cap 枚 */
export function breakdown(amount: number, cap = 40): Denom[] {
  const out: Denom[] = []
  let left = amount
  for (const d of DENOMS) {
    while (left >= d.v && out.length < cap) {
      out.push(d)
      left -= d.v
    }
  }
  return out
}

export interface Placement {
  x: number
  y: number
  lift: number
  spin: number
}

export interface PlacementOpts {
  w: number
  cap: number
  boxW: number
}

/**
 * 计算第 i 枚筹码在堆中的落点。
 * 位置只依赖 i，不依赖总数 —— 所以后来的筹码不会挤动先前的。
 */
export function chipPlacement(i: number, opts: PlacementOpts): Placement {
  const { w, cap, boxW } = opts
  const R = boxW / 2 - w / 2 - 2
  const r = R * Math.sqrt((i + 0.5) / cap)
  const a = i * 2.39996 // 黄金角
  const jx = ((i * 41) % 11 - 5) * 0.45
  const jy = ((i * 67) % 9 - 4) * 0.3
  return {
    x: Math.cos(a) * r + jx,
    y: Math.sin(a) * r * 0.4 + jy, // 压扁成椭圆 → 俯视透视
    lift: (1 - r / R) * (w * 0.5), // 越靠中心越高
    spin: (i * 53) % 360,
  }
}
