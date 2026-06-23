import { JixiClient, type JixiClientConfig } from '@jixi/js'
import type { SessionOptions } from './types'
import { createSessionToken } from './session'

export interface JixiNodeConfig extends JixiClientConfig {
  secret?: string
}

export class JixiNodeClient extends JixiClient {
  private secret: string | undefined

  constructor(config: JixiNodeConfig = {}) {
    super(config)
    this.secret = config.secret
  }

  async createSessionToken(options: SessionOptions): Promise<string> {
    if (!this.secret) throw new Error('secret is required to create session tokens')
    return createSessionToken(this.secret, options)
  }
}
