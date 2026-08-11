import { useEffect, useState } from 'react'
import { useStore } from '../store.js'

export function Lobby({ onEnterRoom }: { onEnterRoom: (roomId: string) => void }) {
  const { api, user, netWorth, refreshMe, logout } = useStore()
  const [roomId, setRoomId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { void refreshMe() }, [refreshMe])

  async function createRoom() {
    const r = await api.post<{ roomId: string }>('/api/rooms', {
      gameId: 'highcard', seats: 3, options: { ante: 100 },
    })
    onEnterRoom(r.roomId)
  }

  async function claim() {
    const r = await api.post<{ claimed: boolean; amount: number }>('/api/daily')
    setMsg(r.claimed ? `签到成功，获得 ${r.amount}` : '今天已经签到过了')
    await refreshMe()
  }

  async function makeInvite() {
    const r = await api.post<{ code: string }>('/api/invite')
    setMsg(`邀请码：${r.code}`)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg">{user?.nickname}</span>
        <button className="text-sm text-slate-500" onClick={() => void logout()}>退出</button>
      </div>
      {netWorth && (
        <div className="rounded bg-slate-100 p-3 text-sm">
          <div>净资产 {netWorth.net}</div>
          <div className="text-slate-500">
            余额 {netWorth.balance} · 应收 {netWorth.receivable} · 应付 {netWorth.payable}
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-blue-700">{msg}</p>}
      <button className="rounded bg-blue-600 p-2 text-white" onClick={() => void createRoom()}>
        创建房间
      </button>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="6 位房间号"
          value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        <button className="rounded border px-3" onClick={() => onEnterRoom(roomId)}>加入</button>
      </div>
      <button className="rounded border p-2" onClick={() => void claim()}>每日签到</button>
      <button className="rounded border p-2" onClick={() => void makeInvite()}>生成邀请码</button>
    </div>
  )
}
