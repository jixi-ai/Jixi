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
      'JixiClient requires apiKey or sessionTokenProvider. Use @jixi/node to mint browser session tokens, or set JIXI_API_KEY for server-side usage.',
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

describe('JixiClient streaming attach helpers', () => {
  it('sends force=true on workflow requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    await client.runWorkflow('foo', {}, { force: true })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('force=true')
  })

  it('attaches to an existing workflow run event stream and dedupes replay', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSseResponse([
      sseFrame({ type: 'workflow_started', runId: 'run-5', seq: 0, timestamp: 't' }),
      sseFrame({ type: 'workflow_started', runId: 'run-5', seq: 0, timestamp: 't' }),
      sseFrame({ type: 'workflow_completed', runId: 'run-5', seq: 1, timestamp: 't' }),
    ]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    const stream = await client.getWorkflowRunEvents('my_flow', 'run-5')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.jixi.ai/wf/my_flow/runs/run-5/events')
    expect(init.headers['Accept']).toBe('text/event-stream')

    const events = []
    for await (const event of stream) events.push(event)
    expect(events.map((event) => event.seq)).toEqual([0, 1])
  })
})

describe('JixiClient.startAudioStreamHttp', () => {
  it('creates a session, uploads chunks, finalizes, and yields SSE events', async () => {
    const startedEvent = {
      type: 'session_started',
      sessionId: 'sess-1',
      seq: 0,
      timestamp: 't',
      data: { fileId: 'file-1' },
    }
    const completedEvent = {
      type: 'session_completed',
      sessionId: 'sess-1',
      seq: 1,
      timestamp: 't',
      data: { fileId: 'file-1' },
    }
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({
        sessionId: 'sess-1',
        fileId: 'file-1',
        ingestUrl: '/applications/app-1/aiStream/audio/sessions/sess-1/chunks',
        finalizeUrl: '/applications/app-1/aiStream/audio/sessions/sess-1/finalize',
        eventsUrl: '/applications/app-1/aiStream/audio/sessions/sess-1/events',
      }, 201))
      .mockResolvedValueOnce(makeSseResponse([
        sseFrame(startedEvent),
        sseFrame({ type: 'heartbeat', sessionId: 'sess-1' }),
        sseFrame(completedEvent),
      ]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jwt' })
    const stream = await client.startAudioStreamHttp('app-1', {
      name: 'meeting.webm',
      encoding: 'webm',
      sampleRateHz: 48000,
    })

    expect(stream.sessionId).toBe('sess-1')
    expect(stream.fileId).toBe('file-1')

    await stream.sendAudio(new Uint8Array([1, 2, 3]))
    await stream.finalize()

    const [sessionUrl, sessionInit] = mockFetch.mock.calls[0]
    expect(sessionUrl).toBe('https://api.jixi.ai/applications/app-1/aiStream/audio/sessions')
    expect(JSON.parse(sessionInit.body)).toMatchObject({ name: 'meeting.webm', encoding: 'webm' })

    const [eventsUrl, eventsInit] = mockFetch.mock.calls[1]
    expect(eventsUrl).toBe('https://api.jixi.ai/applications/app-1/aiStream/audio/sessions/sess-1/events')
    expect(eventsInit.headers['Accept']).toBe('text/event-stream')

    const [chunkUrl, chunkInit] = mockFetch.mock.calls[2]
    expect(chunkUrl).toBe('https://api.jixi.ai/applications/app-1/aiStream/audio/sessions/sess-1/chunks')
    expect(chunkInit.method).toBe('POST')
    expect(chunkInit.headers['Content-Type']).toBe('application/octet-stream')

    const [finalizeUrl, finalizeInit] = mockFetch.mock.calls[3]
    expect(finalizeUrl).toBe('https://api.jixi.ai/applications/app-1/aiStream/audio/sessions/sess-1/finalize')
    expect(finalizeInit.method).toBe('POST')

    const events = []
    for await (const event of stream) events.push(event)
    expect(events).toEqual([startedEvent, completedEvent])
  })

  it('attaches to audio session events', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSseResponse([
      sseFrame({ type: 'session_started', sessionId: 'sess-2', seq: 0, timestamp: 't' }),
    ]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jwt' })
    const stream = await client.getAudioSessionEvents('app-1', 'sess-2')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.jixi.ai/applications/app-1/aiStream/audio/sessions/sess-2/events')

    const events = []
    for await (const event of stream) events.push(event)
    expect(events).toHaveLength(1)
  })
})

describe('JixiClient file methods', () => {
  it('lists, reads, and deletes files with bearer auth', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse([{ id: 'file-1', name: 'a.txt', type: 'File' }]))
      .mockResolvedValueOnce(makeJsonResponse({ id: 'file-1', name: 'a.txt', type: 'File' }))
      .mockResolvedValueOnce(makeJsonResponse({ deleted: true }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })

    await expect(client.listFiles('app-1')).resolves.toHaveLength(1)
    await expect(client.getFile('app-1', 'file-1')).resolves.toMatchObject({ id: 'file-1' })
    await expect(client.deleteFile('app-1', 'file-1')).resolves.toEqual({ deleted: true })

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.jixi.ai/applications/app-1/aiFiles')
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jx')
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.jixi.ai/applications/app-1/aiFiles/file-1')
    expect(mockFetch.mock.calls[2][1].method).toBe('DELETE')
  })

  it('uploads multipart file content without forcing JSON content-type', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ id: 'file-1', name: 'a.txt', type: 'File' }))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    await client.uploadFile('app-1', 'file-1', new Blob(['hello'], { type: 'text/plain' }), {
      filename: 'a.txt',
    })

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.jixi.ai/applications/app-1/aiFiles/file-1/upload')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jx')
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('retries file requests with a fresh session token after 401', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce('tok-stale')
      .mockResolvedValueOnce('tok-fresh')
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeJsonResponse([{ id: 'file-1', name: 'a.txt', type: 'File' }]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', sessionTokenProvider: provider })
    await expect(client.listFiles('app-1')).resolves.toHaveLength(1)

    expect(provider).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-fresh')
  })

  it('opens the file ingest event stream', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSseResponse([
      sseFrame({ fileId: 'file-1', appId: 'app-1', status: 'Processing' }),
    ]))
    vi.stubGlobal('fetch', mockFetch)

    const client = new JixiClient({ baseUrl: 'https://api.jixi.ai', apiKey: 'jx' })
    const stream = await client.getFileEvents('app-1')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.jixi.ai/applications/app-1/aiFiles/events/stream')
    expect(init.headers.Accept).toBe('text/event-stream')

    const events = []
    for await (const event of stream) events.push(event)
    expect(events).toEqual([{ fileId: 'file-1', appId: 'app-1', status: 'Processing' }])
  })
})
