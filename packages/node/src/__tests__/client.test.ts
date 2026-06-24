import { afterEach, describe, expect, it, vi } from 'vitest'
import { JixiNodeClient } from '../client'

describe('JixiNodeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('constructs with inherited apiKey auth', () => {
    expect(() => new JixiNodeClient({ apiKey: 'jx_pub_test' })).not.toThrow()
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
      expiresIn: 120,
      permissions: { workflows: ['support_answer'] },
    })

    expect(token).toBe('session-token')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.test/session-tokens',
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

    await expect(client.mintSessionToken({ userId: 'user-1' })).rejects.toThrow(
      'apiKey is required to mint session tokens',
    )
  })

  it('includes response body when hosted session-token minting fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'User not found' }), {
        status: 404,
        statusText: 'Not Found',
      }),
    ))

    const client = new JixiNodeClient({
      apiKey: 'jx_pub_test',
    })

    await expect(client.mintSessionToken({ userId: 'external-user' })).rejects.toThrow(
      'Failed to mint session token: 404 Not Found {"message":"User not found"}',
    )
  })
})
