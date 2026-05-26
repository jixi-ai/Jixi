import { describe, it, expect } from 'vitest'
import { createJixiStream } from '../stream'
import type { WorkflowRunEvent } from '../types'

const encoder = new TextEncoder()

function makeResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const chunk of chunks) ctrl.enqueue(encoder.encode(chunk))
      ctrl.close()
    },
  })
  return new Response(body, { status: 200 })
}

function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

const startedEvent: WorkflowRunEvent = {
  type: 'workflow_started',
  runId: 'run-abc',
  seq: 0,
  timestamp: '2024-01-01T00:00:00Z',
}

const completedEvent: WorkflowRunEvent = {
  type: 'workflow_completed',
  runId: 'run-abc',
  seq: 1,
  timestamp: '2024-01-01T00:00:01Z',
}

describe('createJixiStream', () => {
  it('exposes the runId', () => {
    const stream = createJixiStream('run-xyz', makeResponse([]))
    expect(stream.runId).toBe('run-xyz')
  })

  it('yields WorkflowRunEvents in order', async () => {
    const response = makeResponse([
      sseFrame(startedEvent),
      sseFrame(completedEvent),
    ])
    const stream = createJixiStream('run-abc', response)
    const events: WorkflowRunEvent[] = []
    for await (const event of stream) events.push(event)
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(startedEvent)
    expect(events[1]).toEqual(completedEvent)
  })

  it('filters out heartbeat events', async () => {
    const response = makeResponse([
      sseFrame({ type: 'heartbeat' }),
      sseFrame(startedEvent),
      sseFrame({ type: 'heartbeat' }),
      sseFrame(completedEvent),
    ])
    const stream = createJixiStream('run-abc', response)
    const events: WorkflowRunEvent[] = []
    for await (const event of stream) events.push(event)
    expect(events).toHaveLength(2)
    expect(events.every(e => e.type !== 'heartbeat')).toBe(true)
  })

  it('cancel() can be called without throwing', () => {
    const stream = createJixiStream('run-abc', makeResponse([]))
    expect(() => stream.cancel()).not.toThrow()
  })

  it('cancel() stops iteration', async () => {
    let enqueue: ReadableStreamDefaultController<Uint8Array>['enqueue']
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) { enqueue = ctrl.enqueue.bind(ctrl) },
    })
    const response = new Response(body, { status: 200 })
    const stream = createJixiStream('run-abc', response)

    const events: WorkflowRunEvent[] = []
    const done = (async () => {
      for await (const event of stream) {
        events.push(event)
        stream.cancel()
      }
    })()

    enqueue!(encoder.encode(sseFrame(startedEvent)))
    await done
    expect(events).toHaveLength(1)
  })

  it('propagates stream errors as JixiError(stream_interrupted)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrl.error(new Error('connection dropped')) },
    })
    const response = new Response(body, { status: 200 })
    const stream = createJixiStream('run-abc', response)

    const collecting = (async () => {
      const events = []
      for await (const event of stream) events.push(event)
      return events
    })()

    await expect(collecting).rejects.toMatchObject({ code: 'stream_interrupted' })
  })

  it('completes normally when body is null', async () => {
    const response = new Response(null, { status: 200 })
    const stream = createJixiStream('run-abc', response)
    const events: WorkflowRunEvent[] = []
    for await (const event of stream) events.push(event)
    expect(events).toHaveLength(0)
  })
})
