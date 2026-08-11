import { describe, it, expect } from 'vitest'
import { openTestDb } from '../db/open.js'
import { createInviteCode, registerUser } from './users.js'
import {
  sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
  listPendingRequests, areFriends, listFriends,
} from './friends.js'

function setup() {
  const db = openTestDb()
  const mk = (n: string) =>
    registerUser(db, { nickname: n, password: 'pw123456', inviteCode: createInviteCode(db, null) })
  return { db, a: mk('甲'), b: mk('乙'), c: mk('丙') }
}

describe('好友请求', () => {
  it('发出请求后对方能看到', () => {
    const { db, a, b } = setup()
    sendFriendRequest(db, a.id, b.id)
    const pending = listPendingRequests(db, b.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.fromUser).toBe(a.id)
    expect(pending[0]!.nickname).toBe('甲')
  })

  it('接受后双向成为好友', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(areFriends(db, a.id, b.id)).toBe(true)
    expect(areFriends(db, b.id, a.id)).toBe(true)
  })

  it('拒绝后不成为好友', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    rejectFriendRequest(db, id, b.id)
    expect(areFriends(db, a.id, b.id)).toBe(false)
  })

  it('处理后请求从待办列表消失', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(listPendingRequests(db, b.id)).toHaveLength(0)
  })

  it('不能加自己为好友', () => {
    const { db, a } = setup()
    expect(() => sendFriendRequest(db, a.id, a.id)).toThrow(/不能添加自己/)
  })

  it('不能重复发送待处理请求', () => {
    const { db, a, b } = setup()
    sendFriendRequest(db, a.id, b.id)
    expect(() => sendFriendRequest(db, a.id, b.id)).toThrow(/请求已存在/)
  })

  it('已是好友时不能再发请求', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(() => sendFriendRequest(db, a.id, b.id)).toThrow(/已经是好友/)
  })

  it('非接收方不能接受请求', () => {
    const { db, a, b, c } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    expect(() => acceptFriendRequest(db, id, c.id)).toThrow(/无权/)
  })

  it('不能重复处理同一请求', () => {
    const { db, a, b } = setup()
    const id = sendFriendRequest(db, a.id, b.id)
    acceptFriendRequest(db, id, b.id)
    expect(() => acceptFriendRequest(db, id, b.id)).toThrow(/请求不存在或已处理/)
  })
})

describe('areFriends / listFriends', () => {
  it('陌生人不是好友', () => {
    const { db, a, c } = setup()
    expect(areFriends(db, a.id, c.id)).toBe(false)
  })

  it('好友列表包含双向关系', () => {
    const { db, a, b } = setup()
    acceptFriendRequest(db, sendFriendRequest(db, a.id, b.id), b.id)
    expect(listFriends(db, a.id).map((f) => f.nickname)).toEqual(['乙'])
    expect(listFriends(db, b.id).map((f) => f.nickname)).toEqual(['甲'])
  })

  it('无好友时返回空数组', () => {
    const { db, c } = setup()
    expect(listFriends(db, c.id)).toEqual([])
  })
})
