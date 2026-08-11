import { forwardRef, useImperativeHandle, useRef } from 'react'
import { breakdown, chipPlacement, type Denom } from './denoms.js'

export interface ChipHeapHandle {
  /** 推入一批筹码；只追加 DOM 节点，绝不重建已有的。 */
  add(denoms: Denom[]): void
  clear(): void
  readonly count: number
}

export interface ChipHeapOpts {
  w?: number
  cap?: number
  boxW?: number
  boxH?: number
}

interface HeapChip {
  denom: Denom
  node: HTMLDivElement
}

/**
 * 累积式底池（乱堆）。
 *
 * 池子保存的是「实际被推进来的那些筹码」，不是按总额重算的结果——
 * 所以飞进来什么颜色，落下就是什么颜色（约束 2）。
 *
 * 内部直接操作 DOM 而非走 React state/diff：add() 时只
 * appendChild 新节点，永不重建已有节点（约束 3）；
 * 因此暴露为命令式 ref handle，而不是由 amount prop 派生渲染——
 * 这正是"累积、不重算"这条约束在 React 里的自然表达。
 */
export const ChipHeap = forwardRef<ChipHeapHandle, ChipHeapOpts>(function ChipHeap(
  { w = 20, cap = 46, boxW = 190, boxH = 88 },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const chipsRef = useRef<HeapChip[]>([])

  function makeNode(denom: Denom, placement: ReturnType<typeof chipPlacement>, animate: boolean) {
    const n = document.createElement('div')
    n.className = 'chip3d ' + denom.cls + (animate ? ' new' : '')
    n.style.cssText =
      `--cw:${w}px;--spin:${placement.spin}deg;` +
      `left:calc(50% + ${placement.x.toFixed(1)}px - ${w / 2}px);` +
      `top:calc(50% + ${(placement.y - placement.lift).toFixed(1)}px);` +
      `z-index:${Math.round(100 + placement.y - placement.lift)};`
    return n
  }

  function sizeShadow() {
    if (!elRef.current) return
    elRef.current.style.setProperty(
      '--hw',
      Math.min(boxW, 40 + chipsRef.current.length * 3.2) + 'px',
    )
  }

  /** 换大筹码：池子太满时把最早的一批小面额并成大面额（荷官的 color up） */
  function colorUp() {
    const el = elRef.current
    if (!el) return
    let guard = 0
    while (chipsRef.current.length > cap && guard++ < 20) {
      const before = chipsRef.current.length
      const gone = chipsRef.current.splice(0, 6)
      gone.forEach((c) => c.node.remove())
      const sum = gone.reduce((s, c) => s + c.denom.v, 0)
      breakdown(sum, 6).forEach((d) => chipsRef.current.push({ denom: d, node: document.createElement('div') }))
      if (chipsRef.current.length >= before) break
    }
    // 重排落点并整体重绘（这一步很少发生）
    el.innerHTML = ''
    chipsRef.current = chipsRef.current.map((c, i) => {
      const placement = chipPlacement(i, { w, cap, boxW })
      const node = makeNode(c.denom, placement, false)
      el.appendChild(node)
      return { denom: c.denom, node }
    })
    sizeShadow()
  }

  useImperativeHandle(
    ref,
    () => ({
      add(denoms: Denom[]) {
        const el = elRef.current
        if (!el) return
        let delay = 0
        for (const denom of denoms) {
          const placement = chipPlacement(chipsRef.current.length, { w, cap, boxW })
          const node = makeNode(denom, placement, true)
          node.style.animationDelay = delay + 'ms'
          delay += 38
          chipsRef.current.push({ denom, node })
          el.appendChild(node) // 只追加，不碰已有节点
        }
        if (chipsRef.current.length > cap) colorUp()
        sizeShadow()
      },
      clear() {
        chipsRef.current = []
        if (elRef.current) elRef.current.innerHTML = ''
        sizeShadow()
      },
      get count() {
        return chipsRef.current.length
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, cap, boxW],
  )

  return <div ref={elRef} className="heap" style={{ width: boxW, height: boxH }} />
})
