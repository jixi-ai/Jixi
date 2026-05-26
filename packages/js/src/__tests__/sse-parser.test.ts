import { describe, it, expect } from 'vitest'
import { parseSSEStream } from '../sse-parser'
import type { WorkflowRunEvent } from '../types'

const encoder = new TextEncoder()

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      for (const chunk of chunks) ctrl.enqueue(encoder.encode(chunk))
      ctrl.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<(WorkflowRunEvent | { type: string })[]> {
  const results = []
  for await (const event of parseSSEStream(stream)) results.push(event)
  return results
}

const baseEvent: WorkflowRunEvent = {
  type: 'workflow_started',
  runId: 'r1',
  seq: 0,
  timestamp: '2024-01-01T00:00:00Z',
}

describe('parseSSEStream', () => {
  it('yields parsed event from a single complete frame', async () => {
    const stream = makeStream([`data: ${JSON.stringify(baseEvent)}\n\n`])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(baseEvent)
  })

  it('stitches a frame split across two chunks', async () => {
    const raw = `data: ${JSON.stringify(baseEvent)}\n\n`
    const mid = Math.floor(raw.length / 2)
    const stream = makeStream([raw.slice(0, mid), raw.slice(mid)])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(baseEvent)
  })

  it('yields multiple frames from a single chunk', async () => {
    const e1 = { ...baseEvent, seq: 0 }
    const e2 = { ...baseEvent, type: 'workflow_completed' as const, seq: 1 }
    const stream = makeStream([`data: ${JSON.stringify(e1)}\n\ndata: ${JSON.stringify(e2)}\n\n`])
    const results = await collect(stream)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(e1)
    expect(results[1]).toEqual(e2)
  })

  it('yields heartbeat events (filtering is stream.ts responsibility)', async () => {
    const stream = makeStream(['data: {"type":"heartbeat"}\n\n'])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
    expect((results[0] as { type: string }).type).toBe('heartbeat')
  })

  it('skips comment-only frames', async () => {
    const stream = makeStream([`: keepalive\n\ndata: ${JSON.stringify(baseEvent)}\n\n`])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(baseEvent)
  })

  it('skips frames without a data: line', async () => {
    const stream = makeStream(['event: ping\n\n'])
    const results = await collect(stream)
    expect(results).toHaveLength(0)
  })

  it('skips empty frames between valid frames', async () => {
    const stream = makeStream([`\n\ndata: ${JSON.stringify(baseEvent)}\n\n`])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
  })

  it('skips frames with malformed JSON', async () => {
    const stream = makeStream(['data: {not-json}\n\ndata: ' + JSON.stringify(baseEvent) + '\n\n'])
    const results = await collect(stream)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(baseEvent)
  })

  it('throws JixiError(stream_interrupted) when the reader errors', async () => {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.error(new Error('network failure'))
      },
    })
    await expect(collect(stream)).rejects.toMatchObject({ code: 'stream_interrupted' })
  })

  it('stops yielding when abort signal fires', async () => {
    const ctrl = new AbortController()
    const results: unknown[] = []

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify(baseEvent)}\n\n`))
        // stream stays open; abort will interrupt
      },
    })

    const iterating = (async () => {
      for await (const event of parseSSEStream(stream, ctrl.signal)) {
        results.push(event)
        ctrl.abort()
      }
    })()

    await iterating
    expect(results).toHaveLength(1)
  })
})
