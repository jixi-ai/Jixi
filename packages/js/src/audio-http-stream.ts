import { _request } from './request'
import { JixiError } from './errors'
import { createEventStream, type EventStreamOptions } from './stream'
import type { AudioStreamEvent } from './types'

export type AudioHttpStreamConfig = {
  appId: string
  baseUrl: string
  getToken: () => Promise<string>
  invalidateToken: () => void
  timeoutMs: number
  signal?: AbortSignal
  sessionId: string
  fileId: string
  ingestUrl: string
  finalizeUrl: string
}

export class AudioHttpStream implements AsyncIterable<AudioStreamEvent> {
  readonly sessionId: string
  readonly fileId: string

  private readonly config: AudioHttpStreamConfig
  private readonly events: ReturnType<typeof createEventStream<AudioStreamEvent>>

  constructor(config: AudioHttpStreamConfig, response: Response, options?: EventStreamOptions) {
    this.config = config
    this.sessionId = config.sessionId
    this.fileId = config.fileId
    this.events = createEventStream<AudioStreamEvent>(response, options)
  }

  async sendAudio(buf: ArrayBuffer | Uint8Array): Promise<void> {
    const body = buf instanceof Uint8Array
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      : buf

    await this._requestWithTokenRetry<void>(
      this._absoluteUrl(this.config.ingestUrl),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      },
    )
  }

  flush(): void {
    // The HTTP fallback transport has no flush endpoint; finalization still drains pending segments.
  }

  async finalize(): Promise<void> {
    await this._requestWithTokenRetry<{ ok: true }>(
      this._absoluteUrl(this.config.finalizeUrl),
      { method: 'POST' },
    )
  }

  cancel(): void {
    this.events.cancel()
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioStreamEvent> {
    return this.events[Symbol.asyncIterator]()
  }

  private async _requestWithTokenRetry<T>(url: string, init: RequestInit): Promise<T> {
    let token = await this.config.getToken()
    try {
      return await _request<T>(url, init, this._requestOptions(token))
    } catch (err) {
      if (err instanceof JixiError && err.code === 'auth_failed') {
        this.config.invalidateToken()
        token = await this.config.getToken()
        return _request<T>(url, init, this._requestOptions(token))
      }
      throw err
    }
  }

  private _requestOptions(token: string) {
    return {
      workflowName: `audio:${this.config.appId}`,
      timeoutMs: this.config.timeoutMs,
      externalSignal: this.config.signal,
      token,
    }
  }

  private _absoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
    return `${this.config.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
  }
}
