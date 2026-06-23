import { TokenManager } from './token-manager'
import { _request } from './request'
import { createEventStream, createJixiStream, type EventStreamOptions } from './stream'
import { JixiError } from './errors'
import { AudioStream } from './audio-stream'
import { AudioHttpStream } from './audio-http-stream'
import type { JixiClientConfig, RunWorkflowOptions, AudioStreamOptions, AudioStreamEvent } from './types'
import type { JixiStream } from './stream'

export interface AudioSessionEventStream extends AsyncIterable<AudioStreamEvent> {
  readonly sessionId: string
  cancel(): void
}

type AudioSessionResponse = {
  sessionId: string
  fileId: string
  ingestUrl: string
  finalizeUrl: string
  eventsUrl: string
}

export class JixiClient {
  private readonly tokenManager: TokenManager
  private readonly config: JixiClientConfig

  constructor(config: JixiClientConfig = {}) {
    if (!config.apiKey && !config.sessionTokenProvider) {
      throw new TypeError(
        'JixiClient requires apiKey. Set JIXI_API_KEY in your environment, or get an API key from https://app.jixi.ai/security.',
      )
    }
    this.config = { ...config, baseUrl: config.baseUrl ?? 'https://api.jixi.ai' }
    this.tokenManager = new TokenManager(this.config)
  }

  async runWorkflow<TIn, TOut>(
    workflowName: string,
    input: TIn,
    options?: RunWorkflowOptions
  ): Promise<TOut> {
    let token = await this.tokenManager.getToken()
    const url = this._buildUrl(`/wf/${workflowName}`, options)
    const body = JSON.stringify(input)

    try {
      return await _request<TOut>(url, { method: 'POST', body }, {
        workflowName,
        timeoutMs: this.config.timeoutMs ?? 30_000,
        externalSignal: options?.signal,
        token,
      })
    } catch (err) {
      if (err instanceof JixiError && err.code === 'auth_failed') {
        this.tokenManager.invalidate()
        token = await this.tokenManager.getToken()
        return _request<TOut>(url, { method: 'POST', body }, {
          workflowName,
          timeoutMs: this.config.timeoutMs ?? 30_000,
          externalSignal: options?.signal,
          token,
        })
      }
      throw err
    }
  }

  async runWorkflowStream<TIn>(
    workflowName: string,
    input: TIn,
    options?: RunWorkflowOptions
  ): Promise<JixiStream> {
    let token = await this.tokenManager.getToken()
    const streamUrl = this._buildUrl(`/wf/${workflowName}/stream`, options)
    const body = JSON.stringify(input)

    let runId: string
    try {
      const result = await _request<{ runId: string }>(streamUrl, { method: 'POST', body }, {
        workflowName,
        timeoutMs: this.config.timeoutMs ?? 30_000,
        externalSignal: options?.signal,
        token,
      })
      runId = result.runId
    } catch (err) {
      if (err instanceof JixiError && err.code === 'auth_failed') {
        this.tokenManager.invalidate()
        token = await this.tokenManager.getToken()
        const result = await _request<{ runId: string }>(streamUrl, { method: 'POST', body }, {
          workflowName,
          timeoutMs: this.config.timeoutMs ?? 30_000,
          externalSignal: options?.signal,
          token,
        })
        runId = result.runId
      } else {
        throw err
      }
    }

    return this._getWorkflowRunEventsWithToken(workflowName, runId, token, options)
  }

  async getWorkflowRunEvents(
    workflowName: string,
    runId: string,
    options?: RunWorkflowOptions & EventStreamOptions,
  ): Promise<JixiStream> {
    const token = await this.tokenManager.getToken()
    return this._getWorkflowRunEventsWithToken(workflowName, runId, token, options)
  }

  async startAudioStream(appId: string, options?: AudioStreamOptions & { transport?: 'websocket' }): Promise<AudioStream>
  async startAudioStream(appId: string, options: AudioStreamOptions & { transport: 'http' }): Promise<AudioHttpStream>
  async startAudioStream(appId: string, options: AudioStreamOptions & { transport: 'auto' }): Promise<AudioStream | AudioHttpStream>
  async startAudioStream(appId: string, options?: AudioStreamOptions): Promise<AudioStream | AudioHttpStream>
  async startAudioStream(appId: string, options?: AudioStreamOptions): Promise<AudioStream | AudioHttpStream> {
    const transport = options?.transport ?? 'websocket'
    if (transport === 'http') return this.startAudioStreamHttp(appId, options)

    try {
      return await this._startAudioStreamWebSocket(appId, options)
    } catch (err) {
      if (transport !== 'auto') throw err
      return this.startAudioStreamHttp(appId, options)
    }
  }

  async startAudioStreamHttp(
    appId: string,
    options?: AudioStreamOptions & EventStreamOptions,
  ): Promise<AudioHttpStream> {
    const token = await this.tokenManager.getToken()
    const {
      transport: _transport,
      signal: _signal,
      dedupe: _dedupe,
      lastSeenSeq: _lastSeenSeq,
      ...sessionOptions
    } = options ?? {}
    const session = await _request<AudioSessionResponse>(
      `${this._baseUrl()}/applications/${appId}/aiStream/audio/sessions`,
      { method: 'POST', body: JSON.stringify(sessionOptions) },
      {
        workflowName: `audio:${appId}`,
        timeoutMs: this.config.timeoutMs ?? 30_000,
        externalSignal: options?.signal,
        token,
      },
    )

    const response = await this._fetchEventStream(
      this._absoluteUrl(session.eventsUrl),
      token,
      options?.signal,
      { workflowName: `audio:${appId}`, sessionId: session.sessionId },
    )

    return new AudioHttpStream(
      {
        appId,
        baseUrl: this._baseUrl(),
        getToken: () => this.tokenManager.getToken(),
        invalidateToken: () => this.tokenManager.invalidate(),
        timeoutMs: this.config.timeoutMs ?? 30_000,
        signal: options?.signal,
        ...session,
      },
      response,
      options,
    )
  }

  async getAudioSessionEvents(
    appId: string,
    sessionId: string,
    options?: Pick<AudioStreamOptions, 'signal'> & EventStreamOptions,
  ): Promise<AudioSessionEventStream> {
    const token = await this.tokenManager.getToken()
    const response = await this._fetchEventStream(
      `${this._baseUrl()}/applications/${appId}/aiStream/audio/sessions/${sessionId}/events`,
      token,
      options?.signal,
      { workflowName: `audio:${appId}`, sessionId },
    )
    const events = createEventStream<AudioStreamEvent>(response, options)

    return {
      sessionId,
      cancel: () => events.cancel(),
      [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
    }
  }

  private async _startAudioStreamWebSocket(appId: string, options?: AudioStreamOptions): Promise<AudioStream> {
    if (typeof WebSocket === 'undefined') {
      throw new JixiError(
        'WebSocket is not available. Audio streaming requires a WebSocket-capable environment.',
        'unknown',
      )
    }

    const token = await this.tokenManager.getToken()
    const wsUrl = this._buildWsUrl(`/applications/${appId}/aiStream/audio`, token)

    return new Promise<AudioStream>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      const stream = new AudioStream(ws)
      let settled = false

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      ws.onopen = () => {
        const { transport: _transport, signal: _signal, ...startOptions } = options ?? {}
        ws.send(JSON.stringify({ type: 'start', ...startOptions }))
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return
        let event: AudioStreamEvent
        try {
          event = JSON.parse(ev.data) as AudioStreamEvent
        } catch {
          return
        }

        stream._push(event)

        if (!settled) {
          if (event.type === 'session_started') {
            stream.sessionId = event.sessionId
            stream.fileId = (event.data as { fileId: string }).fileId
            settle(() => resolve(stream))
          } else if (event.type === 'session_failed') {
            settle(() =>
              reject(
                new JixiError(
                  ((event.data as { error?: string }).error) ?? 'session_failed',
                  'server_error',
                ),
              ),
            )
          }
        }
      }

      ws.onclose = (ev: CloseEvent) => {
        if (!settled) {
          const code = ev.code === 4001 ? 'auth_failed' : 'stream_interrupted'
          settle(() =>
            reject(new JixiError(`WebSocket closed before session started (${ev.code})`, code)),
          )
        }
        stream._done()
      }

      ws.onerror = () => {
        // onerror is always followed by onclose in browsers; _done() called there
        if (!settled) {
          settle(() =>
            reject(new JixiError('WebSocket connection error', 'stream_interrupted')),
          )
        }
      }
    })
  }

  private _buildUrl(path: string, options?: RunWorkflowOptions): string {
    const url = new URL(`${this._baseUrl()}${path}`)
    if (options?.environment) url.searchParams.set('environment', options.environment)
    if (options?.versionId) url.searchParams.set('versionId', options.versionId)
    if (options?.draft) url.searchParams.set('draft', 'true')
    if (options?.force) url.searchParams.set('force', 'true')
    return url.toString()
  }

  private _buildWsUrl(path: string, token: string): string {
    const base = this._baseUrl()
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
    const url = new URL(`${base}${path}`)
    url.searchParams.set('token', token)
    return url.toString()
  }

  private _baseUrl(): string {
    return this.config.baseUrl!.replace(/\/$/, '')
  }

  private async _getWorkflowRunEventsWithToken(
    workflowName: string,
    runId: string,
    token: string,
    options?: RunWorkflowOptions & EventStreamOptions,
  ): Promise<JixiStream> {
    const response = await this._fetchEventStream(
      `${this._baseUrl()}/wf/${workflowName}/runs/${runId}/events`,
      token,
      options?.signal,
      { workflowName, runId },
    )
    return createJixiStream(runId, response, options)
  }

  private async _fetchEventStream(
    url: string,
    token: string,
    signal: AbortSignal | undefined,
    context: { workflowName?: string; runId?: string; sessionId?: string },
  ): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`,
      },
      signal,
    })

    if (!response.ok) {
      const code = response.status === 401 ? 'auth_failed'
        : response.status >= 500 ? 'server_error'
        : 'unknown'
      throw new JixiError(
        `Events request failed: ${response.status} ${response.statusText}`,
        code,
        { status: response.status, workflowName: context.workflowName, runId: context.runId },
      )
    }

    return response
  }

  private _absoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
    return `${this._baseUrl()}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
  }
}
