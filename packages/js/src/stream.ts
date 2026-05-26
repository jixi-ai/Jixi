import { parseSSEStream } from './sse-parser'
import type { WorkflowRunEvent } from './types'

export interface JixiStream extends AsyncIterable<WorkflowRunEvent> {
  readonly runId: string
  cancel(): void
}

export function createJixiStream(runId: string, response: Response): JixiStream {
  const ctrl = new AbortController()

  return {
    runId,

    cancel() {
      ctrl.abort()
    },

    [Symbol.asyncIterator]() {
      const body = response.body

      if (!body) {
        return (async function* () {})()
      }

      return (async function* () {
        for await (const event of parseSSEStream(body, ctrl.signal)) {
          if (event.type === 'heartbeat') continue
          yield event as WorkflowRunEvent
        }
      })()
    },
  }
}
