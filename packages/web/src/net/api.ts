export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class ApiClient {
  private token: string | null = null
  /**
   * 401 时的回调：由调用方（store）设置，用于在这里清理 token 之后通知外层
   * 状态跟着复位。刻意用回调而非直接 import store，避免 api.ts <-> store.ts
   * 循环依赖。
   */
  onUnauthorized: (() => void) | null = null

  constructor(private base = '') {}

  setToken(token: string | null): void {
    this.token = token
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) h.authorization = `Bearer ${this.token}`
    return h
  }

  private async parse(res: Response): Promise<unknown> {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      if (res.status === 401) {
        // 陈旧/失效的 token：清掉它，否则调用方永远拿着一个必 401 的 token 反复重试，
        // 且唯一的"退出"按钮本身也要调用带鉴权的接口，会自我锁死。
        this.token = null
        this.onUnauthorized?.()
      }
      throw new ApiError(data.error ?? '请求失败', res.status)
    }
    return data
  }

  async get<T>(path: string): Promise<T> {
    return (await this.parse(await fetch(this.base + path, { headers: this.headers() }))) as T
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body ?? {}),
    })
    return (await this.parse(res)) as T
  }
}
