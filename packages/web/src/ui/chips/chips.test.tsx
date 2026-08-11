import { describe, it, expect } from 'vitest'
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
  it('落点只依赖序号，不依赖池子总数（同一序号在不同 cap 下位置一致）', () => {
    const opts1 = { w: 20, cap: 46, boxW: 190 }
    const opts2 = { w: 20, cap: 46, boxW: 190 }
    // 同一 opts 下，第 3 枚的落点在池子只有 4 枚还是 40 枚时必须相同——
    // 因为该函数本身不接收"当前总数"，只接收自身序号 i。
    const p1 = chipPlacement(3, opts1)
    const p2 = chipPlacement(3, opts2)
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

  it('可以在 jsdom 零尺寸布局下运行，并通过注入 measure 得到确定坐标', async () => {
    const from = document.createElement('div')
    const to = document.createElement('div')
    document.body.appendChild(from)
    document.body.appendChild(to)

    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [from, { left: 0, top: 0, width: 40, height: 12 }],
      [to, { left: 200, top: 100, width: 40, height: 12 }],
    ])

    const flown = await flyChips(from, to, 100, {
      dur: 5,
      stagger: 1,
      measure: (el) => rects.get(el)!,
      random: () => 0.5, // 去掉随机抖动，坐标可预测
    })
    expect(flown.length).toBeGreaterThan(0)

    from.remove()
    to.remove()
  })
})
