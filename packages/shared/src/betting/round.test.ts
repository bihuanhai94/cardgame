import { describe, it, expect } from 'vitest'
import {
  startRound, toCall, isLegalBet, applyBet, isRoundOver, type BetSeat,
} from './round.js'

function seats(...specs: Array<[string, number, number?]>): BetSeat[] {
  return specs.map(([id, stack, f]) => ({
    id, stack, committed: 0, folded: false, allin: false, stakeFactor: f ?? 1,
  }))
}

describe('startRound', () => {
  it('记录起始跟注额与最小加注', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(rs.currentBet).toBe(20)
    expect(rs.minRaise).toBe(20)
    expect(rs.turn).toBe(0)
  })
})

describe('toCall', () => {
  it('未投入时等于当前跟注额', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(toCall(rs, 'a')).toBe(20)
  })

  it('闷牌者只需一半', () => {
    const rs = startRound(seats(['a', 1000, 0.5], ['b', 1000]), 0, 20, 20)
    expect(toCall(rs, 'a')).toBe(10)
  })

  it('折算出小数时向上取整', () => {
    const rs = startRound(seats(['a', 1000, 0.5], ['b', 1000]), 0, 25, 25)
    expect(toCall(rs, 'a')).toBe(13)
  })

  it('已投入部分要扣掉', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    expect(toCall(rs, 'a')).toBe(0)
  })
})

describe('isLegalBet', () => {
  it('非当前行动者一律非法', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'b', { type: 'call' })).toBe(false)
  })

  it('已弃牌者非法', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'fold' })
    expect(isLegalBet(rs, 'a', { type: 'call' })).toBe(false)
  })

  it('加注必须达到最小加注幅度', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 39 })).toBe(false)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 40 })).toBe(true)
  })

  it('筹码不足以完成加注时非法（应改为全下跟注）', () => {
    const rs = startRound(seats(['a', 30], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'raise', to: 40 })).toBe(false)
  })

  it('筹码不足以跟注时仍可跟（全下）', () => {
    const rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    expect(isLegalBet(rs, 'a', { type: 'call' })).toBe(true)
  })
})

describe('applyBet', () => {
  it('跟注扣筹码并累加投入', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    const a = rs.seats.find((s) => s.id === 'a')!
    expect(a.stack).toBe(980)
    expect(a.committed).toBe(20)
  })

  it('筹码不足时跟注变成全下', () => {
    let rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    const a = rs.seats.find((s) => s.id === 'a')!
    expect(a.stack).toBe(0)
    expect(a.allin).toBe(true)
    expect(a.committed).toBe(12)
  })

  it('加注抬高 currentBet 与 minRaise', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'raise', to: 60 })
    expect(rs.currentBet).toBe(60)
    expect(rs.minRaise).toBe(40)
  })

  it('加注重新开放其他人的行动权', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000], ['c', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'call' })
    rs = applyBet(rs, 'c', { type: 'raise', to: 60 })
    expect(isRoundOver(rs)).toBe(false)
    expect(rs.actedSinceRaise).toEqual(['c'])
  })

  it('不修改传入的状态', () => {
    const rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    const snapshot = JSON.stringify(rs)
    applyBet(rs, 'a', { type: 'call' })
    expect(JSON.stringify(rs)).toBe(snapshot)
  })
})

describe('isRoundOver', () => {
  it('所有未弃牌者都行动过且投入相等时结束', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'call' })
    expect(isRoundOver(rs)).toBe(true)
  })

  it('只剩一人时结束', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'fold' })
    expect(isRoundOver(rs)).toBe(true)
  })

  it('全下者不阻塞轮结束', () => {
    let rs = startRound(seats(['a', 12], ['b', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })   // 全下 12
    rs = applyBet(rs, 'b', { type: 'call' })
    expect(isRoundOver(rs)).toBe(true)
  })
})

describe('轮转', () => {
  it('跳过已弃牌与全下的座位', () => {
    let rs = startRound(seats(['a', 1000], ['b', 1000], ['c', 1000]), 0, 20, 20)
    rs = applyBet(rs, 'a', { type: 'call' })
    rs = applyBet(rs, 'b', { type: 'fold' })
    expect(rs.seats[rs.turn]!.id).toBe('c')
  })
})
