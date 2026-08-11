import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Friend { id: string; nickname: string }
interface Pending { id: string; fromUser: string; nickname: string }

export function Friends() {
  const { api } = useStore()
  const [friends, setFriends] = useState<Friend[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Friend[]>([])

  const load = useCallback(async () => {
    const r = await api.get<{ friends: Friend[]; pending: Pending[] }>('/api/friends')
    setFriends(r.friends)
    setPending(r.pending)
  }, [api])

  useEffect(() => { void load() }, [load])

  async function search() {
    const r = await api.get<{ users: Friend[] }>(`/api/users/search?q=${encodeURIComponent(q)}`)
    setFound(r.users)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h2 className="text-lg">好友</h2>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="搜索昵称"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded border px-3" onClick={() => void search()}>搜索</button>
      </div>
      {found.map((u) => (
        <div key={u.id} className="flex justify-between rounded border p-2">
          <span>{u.nickname}</span>
          <button className="text-blue-600"
            onClick={async () => { await api.post('/api/friends/request', { toUserId: u.id }); await load() }}>
            加好友
          </button>
        </div>
      ))}
      {pending.length > 0 && <h3 className="mt-2 text-sm text-slate-500">待处理请求</h3>}
      {pending.map((p) => (
        <div key={p.id} className="flex justify-between rounded border p-2">
          <span>{p.nickname}</span>
          <span className="flex gap-3">
            <button className="text-blue-600"
              onClick={async () => { await api.post('/api/friends/accept', { requestId: p.id }); await load() }}>
              接受
            </button>
            <button className="text-slate-500"
              onClick={async () => { await api.post('/api/friends/reject', { requestId: p.id }); await load() }}>
              拒绝
            </button>
          </span>
        </div>
      ))}
      <h3 className="mt-2 text-sm text-slate-500">我的好友</h3>
      {friends.map((f) => <div key={f.id} className="rounded border p-2">{f.nickname}</div>)}
    </div>
  )
}
