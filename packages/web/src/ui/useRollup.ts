import { useEffect, useRef, useState } from 'react'

const raf: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number

const caf: (id: number) => void =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => clearTimeout(id)

/**
 * 数字滚动 —— value 变化时，从旧值缓动滚到新值，返回格式化后的字符串。
 * 移植自 docs/design/table-ui/chips.js 的 rollTo。
 */
export function useRollup(value: number, ms = 700): string {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    const t0 = performance.now()

    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (to - from) * e))
      if (p < 1) {
        rafRef.current = raf(step)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = raf(step)

    return () => {
      if (rafRef.current !== null) caf(rafRef.current)
      fromRef.current = to
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms])

  return display.toLocaleString()
}
