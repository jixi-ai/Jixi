import { TokenManager } from './token-manager'
import { _request } from './request'
import { createJixiStream } from './stream'
import { JixiError } from './errors'
import type { JixiClientConfig, RunWorkflowOptions } from './types'
import type { JixiStream } from './stream'

export class JixiClient {
  private readonly tokenManager: TokenManager
  private readonly config: JixiClientConfig

  constructor(config: JixiClientConfig) {
    if (!config.apiKey && !config.sessionTokenProvider) {
      throw new TypeError('JixiClient requires either apiKey or sessionTokenProvider')
    }
    this.config = config
    this.tokenManager = new TokenManager(config)
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

  private _buildUrl(path: string, options?: RunWorkflowOptions): string {
    const url = new URL(`${this._baseUrl()}${path}`)
    if (options?.environment) url.searchParams.set('environment', options.environment)
    if (options?.versionId) url.searchParams.set('versionId', options.versionId)
    if (options?.draft) url.searchParams.set('draft', 'true')
    return url.toString()
  }

  private _baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '')
  }
}
