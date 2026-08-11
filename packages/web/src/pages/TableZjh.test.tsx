import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useStore } from '../store.js'
import { TableZjh } from './TableZjh.js'
import type { ZjhView } from './TableZjh.js'

const ME = 'u-me'
const OPP1 = 'u-opp1'
const OPP2 = 'u-opp2'

function baseView(overrides: Partial<ZjhView> = {}): ZjhView {
  return {
    players: [ME, OPP1, OPP2],
    ante: 100,
    maxRounds: 10,
    looked: [],
    folded: [],
    round: 0,
    pot: 300,
    over: false,
    winner: null,
    turn: ME,
    currentBet: 100,
    compares: [],
    hands: {},
    ...overrides,
  }
}

function setup(view: ZjhView, extra: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    user: { id: ME, nickname: '我' },
    view,
    roomId: 'R1',
    gameId: 'zhajinhua',
    ownerId: ME,
    started: true,
    seats: [
      { index: 0, userId: ME, nickname: '我', online: true, isAi: false },
      { index: 1, userId: OPP1, nickname: '老王', online: true, isAi: false },
      { index: 2, userId: OPP2, nickname: '阿杰', online: true, isAi: false },
    ],
    lastSettlement: null,
    error: null,
    ...extra,
  })
  return render(<TableZjh onLeave={() => {}} />)
}

beforeEach(() => {
  useStore.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('TableZjh：闷牌与看牌', () => {
  it('未看牌时自己的两张牌渲染为牌背，DOM 中不含自己的点数', () => {
    setup(baseView({ hands: {} }))
    // 牌背 svg 的 aria-label 是"牌背"
    const backs = screen.getAllByRole('img', { name: '牌背' })
    expect(backs.length).toBeGreaterThanOrEqual(2)
    // 不应该出现任何点数文字（A/K/Q/J 或数字牌面），因为服务端压根没下发
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.queryByText('K')).toBeNull()
  })

  it('点击「看牌」发出 {type:"look"}', () => {
    const act = vi.fn()
    setup(baseView(), { act })
    fireEvent.click(screen.getByRole('button', { name: '看牌' }))
    expect(act).toHaveBeenCalledWith({ type: 'look' })
  })

  it('看牌后（服务端下发手牌）牌面翻开，不再是牌背', () => {
    setup(baseView({ looked: [ME], hands: { [ME]: [{ suit: 's', rank: 14 }, { suit: 'h', rank: 13 }, { suit: 'd', rank: 2 }] } }))
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('K')).toBeTruthy()
  })
})

describe('TableZjh：回合与操作区禁用', () => {
  it('不是自己回合时，操作区按钮全部禁用', () => {
    setup(baseView({ turn: OPP1 }))
    for (const btn of screen.getAllByRole('button', { name: /看牌|跟注|加注|弃牌|比牌/ })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('轮到自己时，操作区按钮可点', () => {
    setup(baseView({ turn: ME }))
    expect((screen.getByRole('button', { name: '看牌' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '弃牌' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('TableZjh：封顶', () => {
  it('round 达到 maxRounds 时加注按钮禁用并提示已封顶', () => {
    setup(baseView({ turn: ME, round: 10, maxRounds: 10, looked: [ME], hands: { [ME]: [{ suit: 's', rank: 14 }, { suit: 'h', rank: 13 }, { suit: 'd', rank: 2 }] } }))
    expect((screen.getByRole('button', { name: '加注' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/已封顶/)).toBeTruthy()
  })

  it('未到封顶时加注按钮可点', () => {
    setup(baseView({ turn: ME, round: 0, maxRounds: 10, looked: [ME], hands: { [ME]: [{ suit: 's', rank: 14 }, { suit: 'h', rank: 13 }, { suit: 'd', rank: 2 }] } }))
    expect((screen.getByRole('button', { name: '加注' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('TableZjh：比牌选人', () => {
  it('只有已看牌且未弃牌的对手可被选中比牌；点击后发出 compare', () => {
    const act = vi.fn()
    setup(
      baseView({
        turn: ME,
        looked: [ME, OPP1], // OPP2 未看牌
        folded: [],
        hands: { [ME]: [{ suit: 's', rank: 14 }, { suit: 'h', rank: 13 }, { suit: 'd', rank: 2 }] },
      }),
      { act },
    )
    fireEvent.click(screen.getByRole('button', { name: '比牌' }))

    // OPP1 已看牌未弃牌 -> 可选
    const opp1Target = screen.getByTestId(`seat-target-${OPP1}`)
    expect((opp1Target as HTMLButtonElement).disabled).toBe(false)

    // OPP2 未看牌 -> 不可选
    const opp2Target = screen.getByTestId(`seat-target-${OPP2}`)
    expect((opp2Target as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(opp1Target)
    expect(act).toHaveBeenCalledWith({ type: 'compare', targetId: OPP1 })
  })

  it('已看牌但已弃牌的对手不可被选中', () => {
    setup(
      baseView({
        turn: ME,
        looked: [ME, OPP1],
        folded: [OPP1],
        hands: { [ME]: [{ suit: 's', rank: 14 }, { suit: 'h', rank: 13 }, { suit: 'd', rank: 2 }] },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '比牌' }))
    expect((screen.getByTestId(`seat-target-${OPP1}`) as HTMLButtonElement).disabled).toBe(true)
  })

  it('未看牌时不显示比牌按钮', () => {
    setup(baseView({ turn: ME, looked: [] }))
    expect(screen.queryByRole('button', { name: '比牌' })).toBeNull()
  })
})

describe('TableZjh：结算', () => {
  it('收到 settled 后展示结算结果并刷新净资产', async () => {
    const refreshMe = vi.fn().mockResolvedValue(undefined)
    setup(baseView({ over: true, winner: ME }), { refreshMe })
    useStore.getState().applyServerMessage({ t: 'settled', deltas: { [ME]: 200, [OPP1]: -200 } })

    expect(await screen.findByText(/结算/)).toBeTruthy()
    expect(refreshMe).toHaveBeenCalled()
  })
})
