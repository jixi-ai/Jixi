import { describe, it, expect, vi, afterEach } from 'vitest'
import { TokenManager } from '../token-manager'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TokenManager — apiKey mode', () => {
  it('returns apiKey directly without calling any provider', async () => {
    const provider = vi.fn()
    const tm = new TokenManager({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx_pub_abc' })
    const token = await tm.getToken()
    expect(token).toBe('jx_pub_abc')
    expect(provider).not.toHaveBeenCalled()
  })

  it('invalidate() is a no-op (apiKey always returned directly)', async () => {
    const tm = new TokenManager({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx_pub_abc' })
    tm.invalidate()
    expect(await tm.getToken()).toBe('jx_pub_abc')
  })
})

describe('TokenManager — sessionTokenProvider mode', () => {
  it('calls provider on first use', async () => {
    const provider = vi.fn().mockResolvedValue('tok-1')
    const tm = new TokenManager({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    const token = await tm.getToken()
    expect(token).toBe('tok-1')
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('returns cached token on subsequent calls within TTL', async () => {
    const provider = vi.fn().mockResolvedValue('tok-1')
    const tm = new TokenManager({
      baseUrl: 'https://api.jixi.ai',
      sessionTokenProvider: provider,
      tokenTtlMs: 60_000,
    })
    vi.spyOn(Date, 'now').mockReturnValue(0)
    await tm.getToken()
    vi.spyOn(Date, 'now').mockReturnValue(59_999)
    await tm.getToken()
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when cache is stale', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce('tok-1')
      .mockResolvedValueOnce('tok-2')
    const tm = new TokenManager({
      baseUrl: 'https://api.jixi.ai',
      sessionTokenProvider: provider,
      tokenTtlMs: 60_000,
    })
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const t1 = await tm.getToken()
    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    const t2 = await tm.getToken()
    expect(t1).toBe('tok-1')
    expect(t2).toBe('tok-2')
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('uses 240s default TTL', async () => {
    const provider = vi.fn().mockResolvedValue('tok-1')
    const tm = new TokenManager({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    vi.spyOn(Date, 'now').mockReturnValue(0)
    await tm.getToken()
    vi.spyOn(Date, 'now').mockReturnValue(239_999)
    await tm.getToken()
    expect(provider).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(240_000)
    await tm.getToken()
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces re-fetch on next getToken()', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce('tok-1')
      .mockResolvedValueOnce('tok-2')
    const tm = new TokenManager({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    await tm.getToken()
    tm.invalidate()
    const t2 = await tm.getToken()
    expect(t2).toBe('tok-2')
    expect(provider).toHaveBeenCalledTimes(2)
  })
})
