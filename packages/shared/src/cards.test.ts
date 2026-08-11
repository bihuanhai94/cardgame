import { describe, it, expect } from 'vitest'
import { createDeck, cardId, parseCard } from './cards.js'

describe('createDeck', () => {
  it('不含王时为 52 张', () => {
    expect(createDeck()).toHaveLength(52)
  })

  it('含王时为 54 张', () => {
    expect(createDeck({ jokers: true })).toHaveLength(54)
  })

  it('两副牌含王为 108 张', () => {
    expect(createDeck({ jokers: true, decks: 2 })).toHaveLength(108)
  })

  it('单副牌无重复', () => {
    const ids = createDeck({ jokers: true }).map(cardId)
    expect(new Set(ids).size).toBe(54)
  })

  it('每门花色 13 张', () => {
    const deck = createDeck()
    for (const s of ['s', 'h', 'd', 'c']) {
      expect(deck.filter((c) => c.suit === s)).toHaveLength(13)
    }
  })
})

describe('cardId / parseCard', () => {
  it('往返转换保持一致', () => {
    for (const card of createDeck({ jokers: true })) {
      expect(parseCard(cardId(card))).toEqual(card)
    }
  })

  it('黑桃 A 的 id 为 s14', () => {
    expect(cardId({ suit: 's', rank: 14 })).toBe('s14')
  })

  it('大王的 id 为 j16', () => {
    expect(cardId({ suit: 'j', rank: 16 })).toBe('j16')
  })

  it('非法 id 抛异常', () => {
    expect(() => parseCard('x99')).toThrow()
  })
})
