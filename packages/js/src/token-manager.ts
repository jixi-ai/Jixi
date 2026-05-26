import type { JixiClientConfig, TokenState } from './types'

const DEFAULT_TOKEN_TTL_MS = 240_000

export class TokenManager {
  private cache: TokenState | null = null
  private readonly tokenTtlMs: number

  constructor(private readonly config: JixiClientConfig) {
    this.tokenTtlMs = config.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS
  }

  async getToken(): Promise<string> {
    if (this.config.apiKey) {
      return this.config.apiKey
    }

    const provider = this.config.sessionTokenProvider!
    if (!this.cache || Date.now() - this.cache.fetchedAt >= this.tokenTtlMs) {
      const token = await provider()
      this.cache = { token, fetchedAt: Date.now() }
    }

    return this.cache.token
  }

  invalidate(): void {
    this.cache = null
  }
}
