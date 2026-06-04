import { TokenManager } from './token-manager'
import { _request } from './request'
import { createJixiStream } from './stream'
import { JixiError } from './errors'
import { AudioStream } from './audio-stream'
import type { JixiClientConfig, RunWorkflowOptions, AudioStreamOptions, AudioStreamEvent } from './types'
import type { JixiStream } from './stream'

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

    const eventsUrl = `${this._baseUrl()}/wf/${workflowName}/runs/${runId}/events`
    const response = await fetch(eventsUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`,
      },
      signal: options?.signal,
    })

    if (!response.ok) {
      const code = response.status === 401 ? 'auth_failed'
        : response.status >= 500 ? 'server_error'
        : 'unknown'
      throw new JixiError(
        `Events request failed: ${response.status} ${response.statusText}`,
        code,
        { status: response.status, workflowName, runId }
      )
    }

    return createJixiStream(runId, response)
  }

  async startAudioStream(appId: string, options?: AudioStreamOptions): Promise<AudioStream> {
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
        ws.send(JSON.stringify({ type: 'start', ...options }))
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
}
