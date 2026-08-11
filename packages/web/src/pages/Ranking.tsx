import { useEffect, useState } from 'react'
import { useStore } from '../store.js'

interface Row {
  userId: string
  nickname: string
  net: number
  balance: number
  payable: number
}

export function Ranking() {
  const { api } = useStore()
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    void api.get<{ ranking: Row[] }>('/api/ranking').then((r) => setRows(r.ranking))
  }, [api])

  return (
    <div className="mx-auto max-w-md p-4">
      <h2 className="mb-2 text-lg">资产排行</h2>
      <p className="mb-2 text-xs text-slate-500">按净资产排序（余额 + 应收 − 应付），借款不影响排名。</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th>玩家</th><th className="text-right">净资产</th>
            <th className="text-right">余额</th><th className="text-right">负债</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t">
              <td>{r.nickname}</td>
              <td className="text-right">{r.net}</td>
              <td className="text-right text-slate-500">{r.balance}</td>
              <td className="text-right text-red-600">{r.payable || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
