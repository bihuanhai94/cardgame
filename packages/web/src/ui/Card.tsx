import type { Card } from '@cardgame/shared'

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const RED = '#dc2626'
const BLACK = '#0f172a'

function rankLabel(rank: number): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function CardView({ card, width = 64 }: { card: Card | null; width?: number }) {
  const height = Math.round(width * 1.4)

  if (card === null) {
    return (
      <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label="牌背">
        <rect x="1" y="1" width="62" height="88" rx="6" fill="#1e3a8a" stroke="#0f172a" />
        <rect x="7" y="7" width="50" height="76" rx="4" fill="none" stroke="#60a5fa" strokeWidth="2" />
      </svg>
    )
  }

  if (card.suit === 'j') {
    const color = card.rank === 16 ? RED : BLACK
    return (
      <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label="王牌">
        <rect x="1" y="1" width="62" height="88" rx="6" fill="#ffffff" stroke="#94a3b8" />
        <text x="32" y="52" textAnchor="middle" fontSize="26" fill={color}>王</text>
      </svg>
    )
  }

  const color = card.suit === 'h' || card.suit === 'd' ? RED : BLACK
  const label = rankLabel(card.rank)
  const symbol = SUIT_SYMBOL[card.suit] ?? ''

  return (
    <svg width={width} height={height} viewBox="0 0 64 90" role="img" aria-label={`${symbol}${label}`}>
      <rect x="1" y="1" width="62" height="88" rx="6" fill="#ffffff" stroke="#94a3b8" />
      <text x="8" y="22" fontSize="16" fill={color}>{label}</text>
      <text x="8" y="36" fontSize="14" fill={color}>{symbol}</text>
      <text x="32" y="58" textAnchor="middle" fontSize="26" fill={color}>{symbol}</text>
    </svg>
  )
}
