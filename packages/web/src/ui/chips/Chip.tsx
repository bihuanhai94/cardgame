import type { CSSProperties } from 'react'
import type { Denom } from './denoms.js'

/**
 * 单枚筹码：俯视的扁椭圆。
 * 本体永不 2D 旋转 —— 只有表面条纹通过 --spin 变量转动。
 */
export function Chip({
  denom,
  w,
  spin,
  isNew = false,
  animationDelayMs = 0,
  style,
  className = '',
}: {
  denom: Denom
  w: number
  spin: number
  isNew?: boolean
  animationDelayMs?: number
  style?: CSSProperties
  className?: string
}) {
  const chipStyle: CSSProperties = {
    ...style,
    '--cw': `${w}px`,
    '--spin': `${spin}deg`,
    animationDelay: `${animationDelayMs}ms`,
  } as CSSProperties

  return (
    <div
      className={`chip3d ${denom.cls}${isNew ? ' new' : ''}${className ? ` ${className}` : ''}`}
      style={chipStyle}
    />
  )
}
