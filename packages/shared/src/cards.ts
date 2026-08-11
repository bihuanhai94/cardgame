export type Suit = 's' | 'h' | 'd' | 'c' | 'j'
export type Rank = number

export interface Card {
  suit: Suit
  rank: Rank
}

const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c']
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function createDeck(opts: { jokers?: boolean; decks?: number } = {}): Card[] {
  const { jokers = false, decks = 1 } = opts
  const out: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) out.push({ suit, rank })
    }
    if (jokers) {
      out.push({ suit: 'j', rank: 15 })
      out.push({ suit: 'j', rank: 16 })
    }
  }
  return out
}

export function cardId(c: Card): string {
  return `${c.suit}${c.rank}`
}

export function parseCard(id: string): Card {
  const suit = id[0] as Suit
  const rank = Number(id.slice(1))
  const validSuit = suit === 'j' ? true : SUITS.includes(suit)
  const validRank = suit === 'j' ? rank === 15 || rank === 16 : RANKS.includes(rank)
  if (!validSuit || !validRank) throw new Error(`非法牌面 id: ${id}`)
  return { suit, rank }
}
