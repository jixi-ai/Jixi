import { JixiClient, type JixiClientConfig } from '@jixi/js'
import type { SessionOptions } from './types'
import { createSessionToken } from './session'

export interface JixiNodeConfig extends JixiClientConfig {
  secret?: string
}

export class JixiNodeClient extends JixiClient {
  private secret: string | undefined
  private readonly apiKey: string | undefined
  private readonly baseUrl: string

  constructor(config: JixiNodeConfig = {}) {
    super(config)
    this.secret = config.secret
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? 'https://api.jixi.ai').replace(/\/$/, '')
  }

  async mintSessionToken(options: SessionOptions): Promise<string> {
    if (!this.apiKey) throw new Error('apiKey is required to mint session tokens')
    if (!options.appId) throw new TypeError('appId is required to create a session token')

    const response = await fetch(`${this.baseUrl}/applications/${options.appId}/session-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        userId: options.userId,
        permissions: options.permissions,
        expiresIn: options.expiresIn,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to mint session token: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { token?: string }
    if (!data.token) throw new Error('Failed to mint session token: missing token')
    return data.token
  }

  async createSessionToken(options: SessionOptions): Promise<string> {
    if (!this.secret) throw new Error('secret is required to create session tokens')
    return createSessionToken(this.secret, options)
  }
}
