import type { AudioStreamEvent } from './types'

type Resolver = (value: IteratorResult<AudioStreamEvent>) => void
type Rejecter = (reason: unknown) => void

export class AudioStream implements AsyncIterable<AudioStreamEvent> {
  sessionId = ''
  fileId = ''

  private readonly _ws: WebSocket
  private readonly _queue: AudioStreamEvent[] = []
  private _pending: { resolve: Resolver; reject: Rejecter } | null = null
  private _closed = false
  private _error: unknown = undefined

  constructor(ws: WebSocket) {
    this._ws = ws
  }

  _push(event: AudioStreamEvent): void {
    if (this._closed) return
    if (this._pending) {
      const { resolve } = this._pending
      this._pending = null
      resolve({ value: event, done: false })
    } else {
      this._queue.push(event)
    }
  }

  _done(err?: unknown): void {
    if (this._closed) return
    this._closed = true
    this._error = err
    if (this._pending) {
      const { resolve, reject } = this._pending
      this._pending = null
      if (err !== undefined) {
        reject(err)
      } else {
        resolve({ value: undefined as unknown as AudioStreamEvent, done: true })
      }
    }
  }

  sendAudio(buf: ArrayBuffer | Uint8Array): void {
    if (this._closed) return
    this._ws.send(buf)
  }

  flush(): void {
    if (this._closed) return
    this._ws.send(JSON.stringify({ type: 'flush' }))
  }

  finalize(): void {
    if (this._closed) return
    this._ws.send(JSON.stringify({ type: 'close' }))
    // WebSocket stays open; server sends session_completed then closes
  }

  cancel(): void {
    if (this._closed) return
    this._ws.close(1000)
    // onclose fires → _done() called there
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioStreamEvent> {
    return {
      next: (): Promise<IteratorResult<AudioStreamEvent>> => {
        if (this._queue.length > 0) {
          return Promise.resolve({ value: this._queue.shift()!, done: false })
        }
        if (this._closed) {
          if (this._error !== undefined) return Promise.reject(this._error)
          return Promise.resolve({ value: undefined as unknown as AudioStreamEvent, done: true })
        }
        return new Promise<IteratorResult<AudioStreamEvent>>((resolve, reject) => {
          this._pending = { resolve, reject }
        })
      },
      return: (): Promise<IteratorResult<AudioStreamEvent>> => {
        this.cancel()
        return Promise.resolve({ value: undefined as unknown as AudioStreamEvent, done: true })
      },
    }
  }
}
