import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../session'

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T
}

function verifySignature(token: string, secret: string): boolean {
  const [header, payload, signature] = token.split('.')
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return signature === expected
}

describe('createSessionToken', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'))
  })

  it('creates a signed HS256 JWT with default expiry', async () => {
    const token = await createSessionToken('secret-123', { userId: 'user-1' })
    const parts = token.split('.')

    expect(parts).toHaveLength(3)
    expect(decodePart(parts[0])).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(decodePart(parts[1])).toEqual({
      sub: 'user-1',
      userId: 'user-1',
      iat: 1782216000,
      exp: 1782216300,
    })
    expect(verifySignature(token, 'secret-123')).toBe(true)
  })

  it('honors explicit expiry and scoped permissions', async () => {
    const token = await createSessionToken('secret-123', {
      userId: 'user-2',
      expiresIn: 900,
      permissions: {
        workflows: ['support_answer'],
        readOnly: true,
      },
    })

    expect(decodePart(token.split('.')[1])).toEqual({
      sub: 'user-2',
      userId: 'user-2',
      iat: 1782216000,
      exp: 1782216900,
      permissions: {
        workflows: ['support_answer'],
        readOnly: true,
      },
    })
    expect(verifySignature(token, 'secret-123')).toBe(true)
  })

  it('requires a secret', async () => {
    await expect(createSessionToken('', { userId: 'user-1' })).rejects.toThrow(
      'secret is required to create session tokens',
    )
  })

  it('requires a userId', async () => {
    await expect(createSessionToken('secret-123', { userId: '' })).rejects.toThrow(
      'userId is required to create a session token',
    )
  })
})
