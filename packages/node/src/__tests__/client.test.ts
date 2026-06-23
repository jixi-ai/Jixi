import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JixiNodeClient } from '../client'

function signatureIsValid(token: string, secret: string): boolean {
  const [header, payload, signature] = token.split('.')
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return signature === expected
}

describe('JixiNodeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('constructs with inherited apiKey auth', () => {
    expect(() => new JixiNodeClient({ apiKey: 'jx_pub_test' })).not.toThrow()
  })

  it('creates session tokens when secret is configured', async () => {
    const client = new JixiNodeClient({ apiKey: 'jx_pub_test', secret: 'secret-123' })
    const token = await client.createSessionToken({ userId: 'user-1', appId: 'app-1' })

    expect(token.split('.')).toHaveLength(3)
    expect(signatureIsValid(token, 'secret-123')).toBe(true)
  })

  it('requires a secret for client session token creation', async () => {
    const client = new JixiNodeClient({ apiKey: 'jx_pub_test' })

    await expect(client.createSessionToken({ userId: 'user-1', appId: 'app-1' })).rejects.toThrow(
      'secret is required to create session tokens',
    )
  })

  it('mints session tokens through the Jixi API using the configured API key', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'session-token' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiNodeClient({
      baseUrl: 'https://api.example.test/',
      apiKey: 'jx_pub_test',
    })
    const token = await client.mintSessionToken({
      userId: 'user-1',
      appId: 'app-1',
      expiresIn: 120,
      permissions: { workflows: ['support_answer'] },
    })

    expect(token).toBe('session-token')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.test/applications/app-1/session-tokens',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer jx_pub_test',
        },
        body: JSON.stringify({
          userId: 'user-1',
          permissions: { workflows: ['support_answer'] },
          expiresIn: 120,
        }),
      },
    )
  })

  it('requires an API key for hosted session-token minting', async () => {
    const client = new JixiNodeClient({
      sessionTokenProvider: async () => 'session-token',
    })

    await expect(client.mintSessionToken({ userId: 'user-1', appId: 'app-1' })).rejects.toThrow(
      'apiKey is required to mint session tokens',
    )
  })
})
