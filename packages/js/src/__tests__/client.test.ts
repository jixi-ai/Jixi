import { describe, it, expect, vi, afterEach } from 'vitest'
import { JixiClient } from '../client'
import { JixiError } from '../errors'

const encoder = new TextEncoder()

function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function makeJsonResponse(data: unknown, status = 200): Response {
  const text = JSON.stringify(data)
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeErrorResponse(status: number, body = ''): Response {
  return new Response(body, { status })
}

function makeSseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const chunk of chunks) ctrl.enqueue(encoder.encode(chunk))
      ctrl.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function abortAwareFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      if (signal?.aborted) {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      })
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('JixiClient constructor', () => {
  it('throws TypeError eagerly with API key setup help when no auth is configured', () => {
    expect(() => new JixiClient()).toThrow(
      'JixiClient requires apiKey. Set JIXI_API_KEY in your environment, or get an API key from https://app.jixi.ai/security.',
    )
  })

  it('accepts apiKey', () => {
    expect(() => new JixiClient({ apiKey: 'jx_pub_x' })).not.toThrow()
  })

  it('defaults baseUrl to the Jixi API', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ apiKey: 'jx_pub_x' })
    await client.runWorkflow('foo', {})

    const [url] = mockFetch.mock.calls[0]
    expect(url).toMatch(/^https:\/\/api\.jixi\.ai\/wf\/foo/)
  })

  it('accepts sessionTokenProvider', () => {
    expect(() =>
      new JixiClient({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: async () => 'tok' })
    ).not.toThrow()
  })
})

describe('JixiClient.runWorkflow', () => {
  it('posts to the correct URL and returns parsed result', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ answer: 42 }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx_pub_x' })
    const result = await client.runWorkflow('get_answer', { q: 'hello' })

    expect(result).toEqual({ answer: 42 })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/^https:\/\/api\.jixi\.ai\/wf\/get_answer/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ q: 'hello' })
  })

  it('appends environment, versionId, draft query params when set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse({})))

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx_pub_x' })
    await client.runWorkflow('foo', {}, { environment: 'staging', versionId: 'v2', draft: true })

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('environment=staging')
    expect(url).toContain('versionId=v2')
    expect(url).toContain('draft=true')
  })

  it('omits unset query params', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse({})))

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx_pub_x' })
    await client.runWorkflow('foo', {})

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).not.toContain('environment')
    expect(url).not.toContain('versionId')
    expect(url).not.toContain('draft')
  })

  it('retries with fresh token after 401', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce('tok-stale')
      .mockResolvedValueOnce('tok-fresh')
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    const result = await client.runWorkflow('foo', {})

    expect(result).toEqual({ ok: true })
    expect(provider).toHaveBeenCalledTimes(2)
    const secondCallHeader = mockFetch.mock.calls[1][1].headers['Authorization']
    expect(secondCallHeader).toBe('Bearer tok-fresh')
  })

  it('throws JixiError(auth_failed) if retry also returns 401', async () => {
    const provider = vi.fn().mockResolvedValue('tok')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(401)))

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    await expect(client.runWorkflow('foo', {})).rejects.toMatchObject({ code: 'auth_failed' })
  })

  it('throws JixiError(timeout) on timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', abortAwareFetch())

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx', timeoutMs: 3_000 })
    await Promise.all([
      expect(client.runWorkflow('foo', {})).rejects.toMatchObject({ code: 'timeout' }),
      vi.advanceTimersByTimeAsync(3_000),
    ])
  })

  it('throws JixiError(aborted) on external signal', async () => {
    vi.stubGlobal('fetch', abortAwareFetch())
    const ctrl = new AbortController()

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    const promise = client.runWorkflow('foo', {}, { signal: ctrl.signal })
    ctrl.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('JixiClient.runWorkflowStream', () => {
  it('posts to /stream and then GETs the events endpoint', async () => {
    const startedEvent = { type: 'workflow_started', runId: 'run-1', seq: 0, timestamp: 't' }
    const completedEvent = { type: 'workflow_completed', runId: 'run-1', seq: 1, timestamp: 't' }

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ runId: 'run-1' }))
      .mockResolvedValueOnce(makeSseResponse([
        sseFrame(startedEvent),
        sseFrame(completedEvent),
      ]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    const stream = await client.runWorkflowStream('my_flow', { input: 1 })

    expect(stream.runId).toBe('run-1')

    const [postUrl, postInit] = mockFetch.mock.calls[0]
    expect(postUrl).toMatch(/\/wf\/my_flow\/stream/)
    expect(postInit.method).toBe('POST')

    const [getUrl, getInit] = mockFetch.mock.calls[1]
    expect(getUrl).toMatch(/\/wf\/my_flow\/runs\/run-1\/events/)
    expect(getInit.headers['Accept']).toBe('text/event-stream')
    expect(getInit.headers['Authorization']).toBe('Bearer jx')

    const events = []
    for await (const event of stream) events.push(event)
    expect(events).toHaveLength(2)
  })

  it('retries POST to /stream with fresh token after 401', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce('tok-stale')
      .mockResolvedValueOnce('tok-fresh')

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeJsonResponse({ runId: 'run-2' }))
      .mockResolvedValueOnce(makeSseResponse([sseFrame({ type: 'workflow_completed', runId: 'run-2', seq: 0, timestamp: 't' })]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    const stream = await client.runWorkflowStream('my_flow', {})

    expect(stream.runId).toBe('run-2')
    expect(provider).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer tok-fresh')
  })

  it('throws JixiError(auth_failed) when events GET returns 401', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ runId: 'run-3' }))
      .mockResolvedValueOnce(makeErrorResponse(401))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    await expect(client.runWorkflowStream('my_flow', {})).rejects.toMatchObject({
      code: 'auth_failed',
      status: 401,
    })
  })

  it('cancel() ends stream iteration', async () => {
    let enqueue: ReadableStreamDefaultController<Uint8Array>['enqueue']
    const sseBody = new ReadableStream<Uint8Array>({
      start(ctrl) { enqueue = ctrl.enqueue.bind(ctrl) },
    })

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ runId: 'run-4' }))
      .mockResolvedValueOnce(new Response(sseBody, { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    const stream = await client.runWorkflowStream('my_flow', {})

    const events: unknown[] = []
    const done = (async () => {
      for await (const event of stream) {
        events.push(event)
        stream.cancel()
      }
    })()

    const startedEvent = { type: 'workflow_started', runId: 'run-4', seq: 0, timestamp: 't' }
    enqueue!(encoder.encode(sseFrame(startedEvent)))
    await done
    expect(events).toHaveLength(1)
  })

  it('throws JixiError(timeout) if POST to /stream times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', abortAwareFetch())

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx', timeoutMs: 2_000 })
    await Promise.all([
      expect(client.runWorkflowStream('my_flow', {})).rejects.toMatchObject({ code: 'timeout' }),
      vi.advanceTimersByTimeAsync(2_000),
    ])
  })
})
