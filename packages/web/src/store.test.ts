import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from './store.js'

beforeEach(() => useStore.getState().reset())

describe('applyServerMessage', () => {
  it('authOk 不改变已登录用户', () => {
    useStore.getState().applyServerMessage({ t: 'authOk', userId: 'u1' })
    expect(useStore.getState().error).toBeNull()
  })

  it('gameView 写入视图', () => {
    useStore.getState().applyServerMessage({ t: 'gameView', view: { pot: 300 } })
    expect(useStore.getState().view).toEqual({ pot: 300 })
  })

  it('roomState 写入座位', () => {
    useStore.getState().applyServerMessage({
      t: 'roomState', roomId: '123456', ownerId: 'u1',
      seats: [{ index: 0, userId: 'u1', nickname: '甲', online: true, isAi: false }],
      started: false,
    })
    expect(useStore.getState().seats).toHaveLength(1)
    expect(useStore.getState().roomId).toBe('123456')
  })

  it('settled 写入结算结果', () => {
    useStore.getState().applyServerMessage({ t: 'settled', deltas: { u1: 200, u2: -200 } })
    expect(useStore.getState().lastSettlement).toEqual({ u1: 200, u2: -200 })
  })

  it('error 写入错误信息', () => {
    useStore.getState().applyServerMessage({ t: 'error', code: 'X', message: '出错了' })
    expect(useStore.getState().error).toBe('出错了')
  })

  it('新的 gameView 会清空上一条错误', () => {
    useStore.getState().applyServerMessage({ t: 'error', code: 'X', message: '出错了' })
    useStore.getState().applyServerMessage({ t: 'gameView', view: {} })
    expect(useStore.getState().error).toBeNull()
  })

  it('pong 不改变任何状态', () => {
    const before = useStore.getState().view
    useStore.getState().applyServerMessage({ t: 'pong' })
    expect(useStore.getState().view).toBe(before)
  })
})

describe('陈旧 token 的处理', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('任意接口 401 时清空本地 token，回到未登录状态', async () => {
    useStore.setState({ token: 'stale-token', user: { id: 'u1', nickname: '甲' } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: '登录凭证无效' }),
      }),
    )

    await expect(useStore.getState().refreshMe()).rejects.toThrow()

    expect(useStore.getState().token).toBeNull()
    expect(useStore.getState().user).toBeNull()
  })

  it('logout() 即使接口请求失败也会清空本地状态', async () => {
    useStore.setState({ token: 'stale-token', user: { id: 'u1', nickname: '甲' } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: '登录凭证无效' }),
      }),
    )

    await useStore.getState().logout().catch(() => {})

    expect(useStore.getState().token).toBeNull()
    expect(useStore.getState().user).toBeNull()
  })
})
