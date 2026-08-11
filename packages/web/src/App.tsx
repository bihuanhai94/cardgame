import { useEffect, useState } from 'react'
import { useStore } from './store.js'
import { Login } from './pages/Login.js'
import { Lobby } from './pages/Lobby.js'
import { Friends } from './pages/Friends.js'
import { Loans } from './pages/Loans.js'
import { Ranking } from './pages/Ranking.js'
import { Table } from './pages/Table.js'

type Tab = 'lobby' | 'friends' | 'loans' | 'ranking' | 'table'

export function App() {
  const { token, api, connect, joinRoom } = useStore()
  const [tab, setTab] = useState<Tab>('lobby')

  useEffect(() => {
    if (token) {
      api.setToken(token)
      connect()
    }
  }, [token, api, connect])

  if (!token) return <Login />

  return (
    <div className="pb-16">
      {tab === 'lobby' && (
        <Lobby onEnterRoom={(id) => { joinRoom(id); setTab('table') }} />
      )}
      {tab === 'friends' && <Friends />}
      {tab === 'loans' && <Loans />}
      {tab === 'ranking' && <Ranking />}
      {tab === 'table' && <Table onLeave={() => setTab('lobby')} />}

      <nav className="fixed inset-x-0 bottom-0 flex border-t bg-white">
        {([['lobby', '大厅'], ['friends', '好友'], ['loans', '借条'], ['ranking', '排行']] as const).map(
          ([key, label]) => (
            <button key={key} className={`flex-1 p-3 text-sm ${tab === key ? 'text-blue-600' : ''}`}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ),
        )}
      </nav>
    </div>
  )
}
