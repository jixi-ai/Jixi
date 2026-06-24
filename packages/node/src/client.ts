import { JixiClient, type JixiClientConfig } from '@jixi/js'
import type { MintSessionTokenOptions } from './types'

export interface JixiNodeConfig extends JixiClientConfig {}

export class JixiNodeClient extends JixiClient {
  private readonly apiKey: string | undefined
  private readonly baseUrl: string

  constructor(config: JixiNodeConfig = {}) {
    super(config)
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? 'https://api.jixi.ai').replace(/\/$/, '')
  }

  async mintSessionToken(options: MintSessionTokenOptions): Promise<string> {
    if (!this.apiKey) throw new Error('apiKey is required to mint session tokens')

    const response = await fetch(`${this.baseUrl}/session-tokens`, {
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
      const body = await response.text().catch(() => '')
      const suffix = body ? ` ${body}` : ''
      throw new Error(`Failed to mint session token: ${response.status} ${response.statusText}${suffix}`)
    }

    const data = await response.json() as { token?: string }
    if (!data.token) throw new Error('Failed to mint session token: missing token')
    return data.token
  }
}
