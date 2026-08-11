import { describe, it, expect } from 'vitest'
import { createRng, shuffle } from './rng.js'

describe('createRng', () => {
  it('同种子产生相同序列', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同种子产生不同序列', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('输出落在 [0,1) 区间', () => {
    const r = createRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('同种子洗出相同顺序', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(items, createRng(7))).toEqual(shuffle(items, createRng(7)))
  })

  it('不修改入参', () => {
    const items = [1, 2, 3, 4, 5]
    shuffle(items, createRng(1))
    expect(items).toEqual([1, 2, 3, 4, 5])
  })

  it('保留全部元素', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    const out = shuffle(items, createRng(3))
    expect([...out].sort((a, b) => a - b)).toEqual(items)
  })

  it('确实改变了顺序', () => {
    const items = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffle(items, createRng(3))).not.toEqual(items)
  })
})
