import { describe, it, expect, vi, afterEach } from 'vitest'
import { _request } from '../request'

function abortAwareFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      if (signal?.aborted) {
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      })
    })
  })
}

function makeJsonFetch(data: unknown, status = 200): ReturnType<typeof vi.fn> {
  const text = JSON.stringify(data)
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response)
}

function makeErrorFetch(status: number, body = ''): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: String(status),
    headers: new Headers(),
    text: async () => body,
  } as unknown as Response)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const baseOpts = { workflowName: 'my_workflow', timeoutMs: 30_000, token: 'tok-123' }

describe('_request', () => {
  it('attaches Authorization and Content-Type headers', async () => {
    vi.stubGlobal('fetch', makeJsonFetch({ result: 1 }))
    await _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer tok-123')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', makeJsonFetch({ answer: 42 }))
    const result = await _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    expect(result).toEqual({ answer: 42 })
  })

  it('maps 401 to JixiError(auth_failed)', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(401))
    await expect(
      _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    ).rejects.toMatchObject({ code: 'auth_failed', status: 401 })
  })

  it('maps 404 to JixiError(workflow_not_found)', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(404))
    await expect(
      _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    ).rejects.toMatchObject({ code: 'workflow_not_found', status: 404 })
  })

  it('maps 400 with credits body to JixiError(credits_depleted)', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(400, 'insufficient credits'))
    await expect(
      _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    ).rejects.toMatchObject({ code: 'credits_depleted' })
  })

  it('maps 500 to JixiError(server_error)', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(500))
    await expect(
      _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, baseOpts)
    ).rejects.toMatchObject({ code: 'server_error', status: 500 })
  })

  it('throws JixiError(timeout) when timeout fires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', abortAwareFetch())

    await Promise.all([
      expect(
        _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, {
          ...baseOpts,
          timeoutMs: 5_000,
        })
      ).rejects.toMatchObject({ code: 'timeout' }),
      vi.advanceTimersByTimeAsync(5_000),
    ])
  })

  it('throws JixiError(aborted) when external signal fires', async () => {
    vi.stubGlobal('fetch', abortAwareFetch())
    const ctrl = new AbortController()

    const promise = _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, {
      ...baseOpts,
      externalSignal: ctrl.signal,
    })
    ctrl.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })

  it('throws JixiError(aborted) when signal is already aborted', async () => {
    vi.stubGlobal('fetch', abortAwareFetch())
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(
      _request('https://api.test/wf/foo', { method: 'POST', body: '{}' }, {
        ...baseOpts,
        externalSignal: ctrl.signal,
      })
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  it('logs success line matching spec format', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', makeJsonFetch({ answer: 'yes', score: 1 }))

    await _request('https://api.test/wf/myWorkflow', { method: 'POST', body: '{}' }, {
      ...baseOpts,
      workflowName: 'myWorkflow',
    })

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[jixi\] myWorkflow status=200 ms=\d+ len=\d+$/)
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[jixi\] parsedKeys=answer,score$/)
    )
  })

  it('logs error line matching spec format on timeout', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', abortAwareFetch())

    await Promise.all([
      expect(
        _request('https://api.test/wf/myWorkflow', { method: 'POST', body: '{}' }, {
          ...baseOpts,
          workflowName: 'myWorkflow',
          timeoutMs: 5_000,
        })
      ).rejects.toMatchObject({ code: 'timeout' }),
      vi.advanceTimersByTimeAsync(5_000),
    ])

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[jixi\] myWorkflow ERROR ms=\d+ timeoutMs=5000 aborted=false timedOut=true$/)
    )
  })
})
