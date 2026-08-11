import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { breakdown, chipPlacement } from './denoms.js'
import { ChipPile } from './ChipPile.js'
import { ChipHeap, type ChipHeapHandle } from './ChipHeap.js'
import { flyChips } from './flyChips.js'

describe('breakdown', () => {
  it('8420 拆分为 8×1000 + 4×100 + 4×5（大面额优先，8000+400+20=8420）', () => {
    const chips = breakdown(8420, 40)
    const counts: Record<number, number> = {}
    for (const c of chips) counts[c.v] = (counts[c.v] ?? 0) + 1
    expect(counts[1000]).toBe(8)
    expect(counts[100]).toBe(4)
    expect(counts[5]).toBe(4)
    expect(counts[500] ?? 0).toBe(0)
    expect(counts[25] ?? 0).toBe(0)
    expect(chips.length).toBe(16)
    expect(chips.reduce((s, c) => s + c.v, 0)).toBe(8420)
  })
})

describe('chipPlacement', () => {
  it('同一序号、同一（固定）配置下调用两次结果一致（函数是纯函数，无隐藏状态）', () => {
    // 注意：cap 与 boxW 是"这个堆的固定配置"，不是"当前已有筹码数"——
    // chipPlacement 的公式本身用到 cap/boxW 来算半径缩放（r = R·sqrt((i+0.5)/cap)），
    // 所以改变 cap 或 boxW 会合法地改变落点（已用脚本验证：cap 从 46 改到 100，
    // 或 boxW 从 190 改到 250，同一 i=3 的 x/y 都会变）。真正要验证的"不依赖
    // 池子总数"指的是：函数签名里根本没有"当前已有多少枚筹码"这个输入——
    // 这条测试只证明纯函数无隐藏状态；对"新增筹码不会挤动已有筹码位置"
    // 这一实际约束的验证见下面 ChipHeap 的集成测试。
    const opts = { w: 20, cap: 46, boxW: 190 }
    const p1 = chipPlacement(3, opts)
    const p2 = chipPlacement(3, opts)
    expect(p1).toEqual(p2)
  })
})

describe('ChipPile', () => {
  it('渲染筹码元素，超过 perCol 自动开新摞', () => {
    const { container } = render(<ChipPile amount={2000} w={22} perCol={9} cap={40} />)
    const cols = container.querySelectorAll('.col')
    // 2000 拆成 2 枚 1000，perCol=9 应该只有一摞
    expect(cols.length).toBe(1)

    const { container: c2 } = render(<ChipPile amount={9500} w={22} perCol={9} cap={40} />)
    // 9500 = 9*1000 + 500 => 10 枚，perCol=9 应该开出第二摞
    const cols2 = c2.querySelectorAll('.col')
    expect(cols2.length).toBe(2)
    expect(cols2[0]!.querySelectorAll('.chip3d').length).toBe(9)
    expect(cols2[1]!.querySelectorAll('.chip3d').length).toBe(1)
  })

  it('筹码元素上不出现 transform: rotate（本体不旋转）', () => {
    const { container } = render(<ChipPile amount={8420} w={22} perCol={9} cap={40} />)
    const chips = container.querySelectorAll<HTMLDivElement>('.chip3d')
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      expect(chip.style.transform).not.toContain('rotate')
    }
  })
})

describe('ChipHeap', () => {
  it('add 只追加 DOM 节点，不重建已有节点', () => {
    const ref = createRef<ChipHeapHandle>()
    const { container } = render(<ChipHeap ref={ref} boxW={190} boxH={88} />)
    const heapEl = container.querySelector('.heap')!

    ref.current!.add(breakdown(500, 24))
    const firstBatchNodes = Array.from(heapEl.children)
    expect(firstBatchNodes.length).toBeGreaterThan(0)

    ref.current!.add(breakdown(300, 24))
    const afterSecondAdd = Array.from(heapEl.children)

    // 第一批的节点对象仍然原样存在（同一引用），未被替换
    for (const node of firstBatchNodes) {
      expect(afterSecondAdd).toContain(node)
    }
    expect(afterSecondAdd.length).toBeGreaterThan(firstBatchNodes.length)
  })

  it('堆里的筹码元素不含 transform: rotate', () => {
    const ref = createRef<ChipHeapHandle>()
    const { container } = render(<ChipHeap ref={ref} boxW={190} boxH={88} />)
    ref.current!.add(breakdown(8420, 24))
    const chips = container.querySelectorAll<HTMLDivElement>('.chip3d')
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      expect(chip.style.transform).not.toContain('rotate')
    }
  })

  it('已落地筹码的位置（left/top）在池子继续增大后保持不变（约束 4 的实际表现）', () => {
    const ref = createRef<ChipHeapHandle>()
    const { container } = render(<ChipHeap ref={ref} boxW={190} boxH={88} cap={46} />)
    const heapEl = container.querySelector('.heap')!

    ref.current!.add(breakdown(500, 24)) // 少量筹码
    const earlyNodes = Array.from(heapEl.children) as HTMLDivElement[]
    const earlySnapshot = earlyNodes.map((n) => ({ left: n.style.left, top: n.style.top }))

    ref.current!.add(breakdown(8000, 24)) // 池子总数大幅增长

    // 之前那批筹码的 left/top 必须和刚落地时完全一样——
    // 如果落点依赖了"当前总数"而不是只依赖自身序号，这里就会漂移。
    earlyNodes.forEach((n, idx) => {
      expect(n.style.left).toBe(earlySnapshot[idx]!.left)
      expect(n.style.top).toBe(earlySnapshot[idx]!.top)
    })
  })

  it('clear 清空堆', () => {
    const ref = createRef<ChipHeapHandle>()
    const { container } = render(<ChipHeap ref={ref} boxW={190} boxH={88} />)
    ref.current!.add(breakdown(500, 24))
    ref.current!.clear()
    expect(ref.current!.count).toBe(0)
    expect(container.querySelectorAll('.chip3d').length).toBe(0)
  })
})

describe('flyChips', () => {
  it('返回它实际飞了哪些面额', async () => {
    const from = document.createElement('div')
    const to = document.createElement('div')
    document.body.appendChild(from)
    document.body.appendChild(to)

    const flown = await flyChips(from, to, 8420, { count: 6, dur: 10, stagger: 1 })
    const total = flown.reduce((s, c) => s + c.v, 0)
    // count=6 时 breakdown 只能拆出 6 枚最大面额优先的筹码：6×1000
    expect(flown.length).toBe(6)
    expect(total).toBe(6000)

    from.remove()
    to.remove()
  })

  it('金额不足一枚最小面额时返回空数组', async () => {
    const from = document.createElement('div')
    const to = document.createElement('div')
    document.body.appendChild(from)
    document.body.appendChild(to)

    const flown = await flyChips(from, to, 0, { dur: 5 })
    expect(flown).toEqual([])

    from.remove()
    to.remove()
  })

  it('注入确定的 measure/random 时，飞行元素的 transform 必须等于该坐标下唯一正确的位移', async () => {
    vi.useFakeTimers()
    try {
      const from = document.createElement('div')
      const to = document.createElement('div')
      document.body.appendChild(from)
      document.body.appendChild(to)

      const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
        [from, { left: 0, top: 0, width: 40, height: 12 }],
        [to, { left: 200, top: 100, width: 40, height: 12 }],
      ])

      const promise = flyChips(from, to, 100, {
        count: 5,
        dur: 200,
        stagger: 1,
        w: 20,
        measure: (el) => rects.get(el)!,
        random: () => 0.5, // 去掉随机抖动 → jx=jy=0，位移可预测
      })

      // vitest 的 fake timers 也接管了 requestAnimationFrame，它按帧（约 16ms）触发，
      // 不是在 0ms——推进一帧，让 transform 真正被写入 style。
      await vi.advanceTimersByTimeAsync(16)

      const flyer = document.querySelector<HTMLDivElement>('.flyer')
      expect(flyer).toBeTruthy()
      // 期望值是手算出来的常量，不是用实现里同一套表达式再算一遍——
      // dx = (200 + 40/2 - 20/2) - (0 + 40/2 - 20/2) = 210 - 10 = 200
      // dy = (100 + 12/2)        - (0 + 12/2)        = 106 - 6   = 100
      expect(flyer!.style.transform).toBe('translate(200px, 100px)')

      // 推进到全部飞完，让 promise 真正 resolve，避免挂起的定时器影响后续用例。
      await vi.advanceTimersByTimeAsync(2000)
      await promise

      from.remove()
      to.remove()
    } finally {
      vi.useRealTimers()
    }
  })
})
