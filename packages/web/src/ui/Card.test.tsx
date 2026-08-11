import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CardView } from './Card.js'

describe('CardView', () => {
  it('渲染为 svg 元素', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('黑桃 A 显示 A 与黑桃符号', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    const text = container.textContent ?? ''
    expect(text).toContain('A')
    expect(text).toContain('♠')
  })

  it('红桃显示红色', () => {
    const { container } = render(<CardView card={{ suit: 'h', rank: 10 }} />)
    expect(container.innerHTML).toContain('#dc2626')
  })

  it('数字牌显示点数', () => {
    const { container } = render(<CardView card={{ suit: 'c', rank: 7 }} />)
    expect(container.textContent).toContain('7')
  })

  it('K Q J 显示对应字母', () => {
    for (const [rank, letter] of [[13, 'K'], [12, 'Q'], [11, 'J']] as const) {
      const { container } = render(<CardView card={{ suit: 'd', rank }} />)
      expect(container.textContent).toContain(letter)
    }
  })

  it('大小王显示王字', () => {
    const { container } = render(<CardView card={{ suit: 'j', rank: 16 }} />)
    expect(container.textContent).toContain('王')
  })

  it('小王（rank 15）显示王字且为黑色，与大王（红色）区分', () => {
    const { container: small } = render(<CardView card={{ suit: 'j', rank: 15 }} />)
    expect(small.textContent).toContain('王')
    expect(small.innerHTML).not.toContain('#dc2626')

    const { container: big } = render(<CardView card={{ suit: 'j', rank: 16 }} />)
    expect(big.innerHTML).toContain('#dc2626')
  })

  it('card 为 null 时渲染牌背且不含任何点数', () => {
    const { container } = render(<CardView card={null} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.textContent).toBe('')
  })

  it('不含任何 img 标签（禁止位图）', () => {
    const { container } = render(<CardView card={{ suit: 's', rank: 14 }} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
