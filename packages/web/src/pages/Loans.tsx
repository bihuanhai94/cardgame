import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Loan {
  id: string
  lender: string
  borrower: string
  principal: number
  repaid: number
  outstanding: number
  status: 'open' | 'settled'
}
interface Friend { id: string; nickname: string }

export function Loans() {
  const { api, refreshMe } = useStore()
  const [asLender, setAsLender] = useState<Loan[]>([])
  const [asBorrower, setAsBorrower] = useState<Loan[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [target, setTarget] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.get<{ asLender: Loan[]; asBorrower: Loan[] }>('/api/loans')
    setAsLender(r.asLender)
    setAsBorrower(r.asBorrower)
    const f = await api.get<{ friends: Friend[] }>('/api/friends')
    setFriends(f.friends)
  }, [api])

  useEffect(() => { void load() }, [load])

  async function lend() {
    setErr(null)
    try {
      await api.post('/api/loans', { borrowerId: target, amount: Number(amount) })
      await load()
      await refreshMe()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function repay(loan: Loan) {
    setErr(null)
    try {
      await api.post('/api/loans/repay', { loanId: loan.id, amount: loan.outstanding })
      await load()
      await refreshMe()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
      <h2 className="text-lg">借条</h2>
      <p className="text-xs text-slate-500">借条仅限好友之间，无利息、无期限，全部借条对好友公开。</p>
      <div className="flex gap-2">
        <select className="flex-1 rounded border p-2" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">选择好友</option>
          {friends.map((f) => <option key={f.id} value={f.id}>{f.nickname}</option>)}
        </select>
        <input className="w-24 rounded border p-2" placeholder="金额"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="rounded border px-3" onClick={() => void lend()}>借出</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <h3 className="text-sm text-slate-500">我借出的</h3>
      {asLender.map((l) => (
        <div key={l.id} className="rounded border p-2 text-sm">
          待收回 {l.outstanding} / 本金 {l.principal} · {l.status === 'open' ? '未结清' : '已结清'}
        </div>
      ))}
      <h3 className="text-sm text-slate-500">我欠的</h3>
      {asBorrower.map((l) => (
        <div key={l.id} className="flex justify-between rounded border p-2 text-sm">
          <span>待还 {l.outstanding} / 本金 {l.principal}</span>
          {l.status === 'open' && (
            <button className="text-blue-600" onClick={() => void repay(l)}>全额还款</button>
          )}
        </div>
      ))}
    </div>
  )
}
