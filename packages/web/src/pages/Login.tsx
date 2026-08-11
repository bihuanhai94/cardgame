import { useState } from 'react'
import { useStore } from '../store.js'

export function Login() {
  const { login, register } = useStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      if (mode === 'login') await login(nickname, password)
      else await register(nickname, password, inviteCode)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-20 flex w-72 flex-col gap-3">
      <h1 className="text-center text-2xl">牌局</h1>
      <input className="rounded border p-2" placeholder="昵称"
        value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <input className="rounded border p-2" type="password" placeholder="密码"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {mode === 'register' && (
        <input className="rounded border p-2" placeholder="邀请码"
          value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="rounded bg-blue-600 p-2 text-white" type="submit">
        {mode === 'login' ? '登录' : '注册'}
      </button>
      <button type="button" className="text-sm text-blue-600"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? '用邀请码注册' : '已有账号，去登录'}
      </button>
    </form>
  )
}
