import { useId } from 'react'
import type { Card } from '@cardgame/shared'

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const RED = '#dc2626'
const BLACK = '#0f172a'

// 牌背底色与花纹色：菱形网格花纹 + 中心徽记，绝不能泄漏点数或花色。
const BACK_FILL = '#7a1f24'
const BACK_EDGE = '#f0e0b8'

function latticePaths(): string[] {
  const paths: string[] = []
  for (let k = -70; k <= 70; k += 5) {
    paths.push(`M${k} 0 L${k + 70} 70`)
    paths.push(`M${k} 70 L${k + 70} 0`)
  }
  return paths
}

function rankLabel(rank: number): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function CardView({ card, width = 64 }: { card: Card | null; width?: number }) {
  const height = Math.round(width * 1.4)
  const clipId = useId()

  if (card === null) {
    return (
      <svg width={width} height={height} viewBox="0 0 50 70" role="img" aria-label="牌背">
        <defs>
          <clipPath id={clipId}>
            <rect x="5" y="5" width="40" height="60" rx="3" />
          </clipPath>
        </defs>
        <rect x="1" y="1" width="48" height="68" rx="5" fill={BACK_FILL} stroke={BACK_EDGE} strokeWidth="1.5" />
        <g clipPath={`url(#${clipId})`} stroke={BACK_EDGE} strokeOpacity="0.28" strokeWidth="0.8" fill="none">
          {latticePaths().map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <rect x="5" y="5" width="40" height="60" rx="3" fill="none" stroke={BACK_EDGE} strokeOpacity="0.7" />
        <g transform="translate(25 35)">
          <path d="M0 -9 L6.5 0 L0 9 L-6.5 0 Z" fill={BACK_EDGE} fillOpacity="0.85" />
          <path d="M0 -5 L3.6 0 L0 5 L-3.6 0 Z" fill={BACK_FILL} />
        </g>
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
