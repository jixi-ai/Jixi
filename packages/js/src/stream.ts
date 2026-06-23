import { parseSSEStream } from './sse-parser'
import type { WorkflowRunEvent } from './types'

export interface JixiStream extends AsyncIterable<WorkflowRunEvent> {
  readonly runId: string
  cancel(): void
}

export type EventStreamOptions = {
  lastSeenSeq?: number
  dedupe?: boolean
}

export interface EventStream<TEvent extends { type: string; seq?: number }> extends AsyncIterable<TEvent> {
  cancel(): void
}

export function createEventStream<TEvent extends { type: string; seq?: number }>(
  response: Response,
  options: EventStreamOptions = {},
): EventStream<TEvent> {
  const ctrl = new AbortController()
  let lastSeenSeq = options.lastSeenSeq ?? -1
  const dedupe = options.dedupe !== false

  return {
    cancel() {
      ctrl.abort()
    },

    [Symbol.asyncIterator]() {
      const body = response.body

      if (!body) {
        return (async function* () {})()
      }

      return (async function* () {
        for await (const event of parseSSEStream<TEvent>(body, ctrl.signal)) {
          if (event.type === 'heartbeat') continue
          const streamEvent = event as TEvent
          if (dedupe && typeof streamEvent.seq === 'number') {
            if (streamEvent.seq <= lastSeenSeq) continue
            lastSeenSeq = streamEvent.seq
          }
          yield streamEvent
        }
      })()
    },
  }
}

export function createJixiStream(
  runId: string,
  response: Response,
  options?: EventStreamOptions,
): JixiStream {
  const events = createEventStream<WorkflowRunEvent>(response, options)

  return {
    runId,
    cancel: () => events.cancel(),
    [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
  }
}
