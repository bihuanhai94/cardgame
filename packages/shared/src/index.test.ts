import { describe, it, expect } from 'vitest'
import { VERSION } from './index.js'

describe('shared 包', () => {
  it('导出版本号', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
