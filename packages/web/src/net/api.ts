export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class ApiClient {
  private token: string | null = null

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
    if (!res.ok) throw new ApiError(data.error ?? '请求失败', res.status)
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
