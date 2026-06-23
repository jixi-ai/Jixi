import { createHmac } from 'node:crypto'
import type { SessionOptions } from './types'

const DEFAULT_EXPIRES_IN_SECONDS = 300

export async function createSessionToken(secret: string, options: SessionOptions): Promise<string> {
  if (!secret) throw new TypeError('secret is required to create session tokens')
  if (!options.userId) throw new TypeError('userId is required to create a session token')
  if (!options.appId) throw new TypeError('appId is required to create a session token')

  const now = Math.floor(Date.now() / 1000)
  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS
  const payload = {
    sub: options.userId,
    userId: options.userId,
    appId: options.appId,
    iat: now,
    exp: now + expiresIn,
    ...(options.permissions ? { permissions: options.permissions } : {}),
  }

  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url')
}
