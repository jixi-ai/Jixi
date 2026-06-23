import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { JixiNodeClient } from '../client'

function signatureIsValid(token: string, secret: string): boolean {
  const [header, payload, signature] = token.split('.')
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return signature === expected
}

describe('JixiNodeClient', () => {
  it('constructs with inherited apiKey auth', () => {
    expect(() => new JixiNodeClient({ apiKey: 'jx_pub_test' })).not.toThrow()
  })

  it('creates session tokens when secret is configured', async () => {
    const client = new JixiNodeClient({ apiKey: 'jx_pub_test', secret: 'secret-123' })
    const token = await client.createSessionToken({ userId: 'user-1' })

    expect(token.split('.')).toHaveLength(3)
    expect(signatureIsValid(token, 'secret-123')).toBe(true)
  })

  it('requires a secret for client session token creation', async () => {
    const client = new JixiNodeClient({ apiKey: 'jx_pub_test' })

    await expect(client.createSessionToken({ userId: 'user-1' })).rejects.toThrow(
      'secret is required to create session tokens',
    )
  })
})
