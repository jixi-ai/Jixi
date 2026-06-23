import { JixiError } from './errors'
import type { WorkflowRunEvent, HeartbeatEvent } from './types'

export async function* parseSSEStream<TEvent = WorkflowRunEvent>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<TEvent | HeartbeatEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const abortPromise = signal
    ? new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ done: true, value: undefined }),
          { once: true }
        )
      })
    : null

  try {
    while (true) {
      const readPromise = reader.read()
      const { done, value } = abortPromise
        ? await Promise.race([readPromise, abortPromise])
        : await readPromise

      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const event = parseFrame(frame)
        if (event) yield event as TEvent | HeartbeatEvent
      }
    }

    // flush decoder and process any remaining buffer
    const tail = buffer + decoder.decode()
    if (tail.trim()) {
      const event = parseFrame(tail)
      if (event) yield event as TEvent | HeartbeatEvent
    }
  } catch (err) {
    if (err instanceof JixiError) throw err
    throw new JixiError(
      err instanceof Error ? err.message : 'SSE stream interrupted',
      'stream_interrupted'
    )
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(frame: string): WorkflowRunEvent | HeartbeatEvent | null {
  if (!frame.trim()) return null

  let dataLine: string | undefined

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) {
      dataLine = line.slice(5).trim()
      break
    }
  }

  if (dataLine === undefined) return null

  try {
    return JSON.parse(dataLine) as WorkflowRunEvent | HeartbeatEvent
  } catch {
    return null
  }
}
