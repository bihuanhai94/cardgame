import { describe, it, expect } from 'vitest'
import { evalThree, compareThree } from './three.js'
import type { Card } from '../cards.js'
import { createDeck } from '../cards.js'
import { createRng, shuffle } from '../rng.js'

const C = (s: string): Card[] =>
  s.split(' ').map((t) => ({ suit: t[0] as Card['suit'], rank: Number(t.slice(1)) }))

const ev = (s: string) => evalThree(C(s))
const gt = (a: string, b: string) => expect(compareThree(ev(a), ev(b))).toBeGreaterThan(0)

describe('牌型识别', () => {
  it('豹子', () => { expect(ev('s9 h9 d9').category).toBe('trips') })
  it('顺金', () => { expect(ev('s9 s10 s11').category).toBe('straightFlush') })
  it('金花', () => { expect(ev('s2 s7 s13').category).toBe('flush') })
  it('顺子', () => { expect(ev('s9 h10 d11').category).toBe('straight') })
  it('对子', () => { expect(ev('s9 h9 d4').category).toBe('pair') })
  it('单张', () => { expect(ev('s2 h7 d13').category).toBe('high') })

  it('AKQ 是顺子', () => { expect(ev('s14 h13 d12').category).toBe('straight') })
  it('A23 是顺子', () => { expect(ev('s14 h2 d3').category).toBe('straight') })
  it('AKQ 同花是顺金', () => { expect(ev('s14 s13 s12').category).toBe('straightFlush') })
  it('A23 同花是顺金', () => { expect(ev('s14 s2 s3').category).toBe('straightFlush') })
  it('QKA 之外的 A 高组合不是顺子', () => { expect(ev('s14 h13 d11').category).toBe('high') })
  it('K A 2 不是顺子', () => { expect(ev('s13 h14 d2').category).toBe('high') })
})

describe('牌型之间的大小（国际标准：顺子 > 金花）', () => {
  it('豹子 > 顺金', () => gt('s2 h2 d2', 's14 s13 s12'))
  it('顺金 > 顺子', () => gt('s9 s10 s11', 's14 h13 d12'))
  it('顺子 > 金花', () => gt('s14 h13 d12', 's14 s13 s11'))
  it('最小的顺子 > 最大的金花', () => gt('s14 h2 d3', 's14 s13 s11'))
  it('金花 > 对子', () => gt('s2 s5 s9', 's14 h14 d13'))
  it('对子 > 单张', () => gt('s2 h2 d3', 's14 h13 d11'))
})

describe('同牌型比较', () => {
  it('豹子比点数', () => gt('s14 h14 d14', 's13 h13 d13'))
  it('AKQ 是最大顺子', () => gt('s14 h13 d12', 's11 h12 d13'))
  it('A23 是最小顺子', () => gt('s2 h3 d4', 's14 h2 d3'))
  it('AKQ 同花是最大顺金', () => gt('s14 s13 s12', 's11 s12 s13'))
  it('A23 同花是最小顺金', () => gt('s2 s3 s4', 's14 s2 s3'))
  it('金花逐张比', () => gt('s14 s5 s2', 's13 s9 s4'))
  it('对子先比对子点数', () => gt('s3 h3 d2', 's2 h2 d14'))
  it('对子相同再比单张', () => gt('s9 h9 d14', 's9 c9 d13'))
  it('单张逐张比', () => gt('s14 h5 d2', 's13 h9 d4'))
})

describe('平局（国际标准：不用花色决胜）', () => {
  it('点数相同、花色不同的金花判平局', () => {
    expect(compareThree(ev('s14 s13 s11'), ev('h14 h13 h11'))).toBe(0)
  })
  it('点数相同的对子判平局', () => {
    expect(compareThree(ev('s9 h9 d14'), ev('c9 d9 h14'))).toBe(0)
  })
  it('点数相同的单张判平局', () => {
    expect(compareThree(ev('s14 h13 d11'), ev('c14 d13 s11'))).toBe(0)
  })
  it('花色不参与比较：交换花色不改变分数', () => {
    expect(ev('s14 h13 d11').score).toBe(ev('d14 c13 h11').score)
  })
})

describe('入参校验', () => {
  it('不是 3 张时抛错', () => {
    expect(() => evalThree(C('s2 h3'))).toThrow(/3 张/)
    expect(() => evalThree(C('s2 h3 d4 c5'))).toThrow(/3 张/)
  })
})

describe('随机一致性', () => {
  it('随机 5000 对：比较结果严格反对称', () => {
    const deck = createDeck()
    const rng = createRng(1)
    const pick = () => {
      const s = shuffle(deck, rng).slice(0, 3)
      return evalThree(s)
    }
    for (let i = 0; i < 5000; i++) {
      const a = pick(), b = pick()
      const ab = compareThree(a, b), ba = compareThree(b, a)
      if (ab === 0) {
        expect(ba).toBe(0)
      } else {
        expect(Math.sign(ab)).toBe(-Math.sign(ba))
      }
    }
  })
})
