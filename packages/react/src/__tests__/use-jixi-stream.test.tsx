import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiError } from '@jixi/js'
import type { JixiStream, WorkflowRunEvent } from '@jixi/js'
import { JixiProvider } from '../context'
import { useJixiStream } from '../use-jixi-stream'

const { mockRunWorkflowStream } = vi.hoisted(() => ({
  mockRunWorkflowStream: vi.fn(),
}))

vi.mock('@jixi/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jixi/js')>()
  return {
    ...actual,
    JixiClient: vi.fn().mockImplementation(() => ({
      runWorkflowStream: mockRunWorkflowStream,
    })),
  }
})

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <JixiProvider baseUrl="https://api.jixi.ai" apiKey="test_key">
      {children}
    </JixiProvider>
  )
}

function makeStream(events: WorkflowRunEvent[]): JixiStream {
  let cancelled = false
  return {
    runId: 'test-run',
    cancel() { cancelled = true },
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (cancelled) throw new JixiError('aborted', 'aborted')
        yield event
        await Promise.resolve()
      }
    },
  }
}

const workflowStarted: WorkflowRunEvent = {
  type: 'workflow_started',
  runId: 'test-run',
  seq: 0,
  timestamp: '2026-01-01T00:00:00Z',
  data: { workflowId: 'wf1', workflowName: 'my_workflow', appId: 'app1' },
}

const workflowMessage: WorkflowRunEvent = {
  type: 'workflow_message',
  runId: 'test-run',
  seq: 1,
  timestamp: '2026-01-01T00:00:01Z',
  data: { message: 'Processing...', stepIndex: 0, actionType: 'llm' },
}

const contentChunkText: WorkflowRunEvent = {
  type: 'content_chunk',
  runId: 'test-run',
  seq: 2,
  timestamp: '2026-01-01T00:00:02Z',
  data: { stepIndex: 0, contentType: 'text', encoding: 'utf-8', chunk: 'Hello', index: 0, done: false },
}

const contentChunkDone: WorkflowRunEvent = {
  type: 'content_chunk',
  runId: 'test-run',
  seq: 3,
  timestamp: '2026-01-01T00:00:03Z',
  data: { stepIndex: 0, contentType: 'text', encoding: 'utf-8', chunk: ' world', index: 1, done: true },
}

const workflowCompleted: WorkflowRunEvent = {
  type: 'workflow_completed',
  runId: 'test-run',
  seq: 4,
  timestamp: '2026-01-01T00:00:04Z',
  data: { result: { answer: 42 }, durationMs: 1000, analytics: {} },
}

const workflowFailed: WorkflowRunEvent = {
  type: 'workflow_failed',
  runId: 'test-run',
  seq: 4,
  timestamp: '2026-01-01T00:00:04Z',
  data: { error: 'Something broke', durationMs: 500 },
}

describe('useJixiStream', () => {
  beforeEach(() => {
    mockRunWorkflowStream.mockReset()
  })

  it('starts with empty events, isStreaming=false, isComplete=false', () => {
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })
    expect(result.current.events).toEqual([])
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.contentChunks).toEqual([])
    expect(result.current.latestMessage).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('workflow_completed sets isStreaming=false and isComplete=true', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(makeStream([workflowCompleted]))
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isComplete).toBe(true)
  })

  it('accumulates events in the events array as they arrive', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([workflowStarted, workflowMessage, workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.events).toHaveLength(3)
    expect(result.current.events[0].type).toBe('workflow_started')
    expect(result.current.events[1].type).toBe('workflow_message')
    expect(result.current.events[2].type).toBe('workflow_completed')
  })

  it('updates latestMessage on each workflow_message event', async () => {
    const msg2: WorkflowRunEvent = {
      ...workflowMessage,
      seq: 2,
      data: { message: 'Done!', stepIndex: 1, actionType: 'llm' },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([workflowMessage, msg2, workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.latestMessage).toBe('Done!')
  })

  it('content_chunk events appear in events and contentChunks', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([contentChunkText, contentChunkDone, workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.events.filter((e) => e.type === 'content_chunk')).toHaveLength(2)
    expect(result.current.contentChunks).toHaveLength(2)
    expect(result.current.contentChunks[0]).toMatchObject({ chunk: 'Hello', done: false })
    expect(result.current.contentChunks[1]).toMatchObject({ chunk: ' world', done: true })
  })

  it('contentChunks accumulates in arrival order across multiple steps', async () => {
    const step2Chunk: WorkflowRunEvent = {
      type: 'content_chunk',
      runId: 'test-run',
      seq: 5,
      timestamp: '2026-01-01T00:00:05Z',
      data: { stepIndex: 1, contentType: 'text', encoding: 'utf-8', chunk: '!', index: 0, done: true },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([contentChunkText, step2Chunk, workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.contentChunks[0]).toMatchObject({ stepIndex: 0, chunk: 'Hello' })
    expect(result.current.contentChunks[1]).toMatchObject({ stepIndex: 1, chunk: '!' })
  })

  it('workflow_failed sets isStreaming=false and populates error', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(makeStream([workflowFailed]))
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeInstanceOf(JixiError)
    expect(result.current.error?.message).toBe('Something broke')
  })

  it('cancel() stops the stream: isStreaming=false, error=null, isComplete=false', async () => {
    let cancelled = false
    const pauseStream: JixiStream = {
      runId: 'test-run',
      cancel() { cancelled = true },
      async *[Symbol.asyncIterator]() {
        yield workflowStarted
        await Promise.resolve()
        if (cancelled) throw new JixiError('aborted', 'aborted')
        yield workflowCompleted
      },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(pauseStream)

    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => {
      const runPromise = result.current.run({})
      // Yield twice so the generator can start and emit the first event
      await Promise.resolve()
      await Promise.resolve()
      result.current.cancel()
      await runPromise
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('unmount cancels active stream without error', async () => {
    let cancelled = false
    const neverEndingStream: JixiStream = {
      runId: 'test-run',
      cancel() { cancelled = true },
      async *[Symbol.asyncIterator]() {
        yield workflowStarted
        await Promise.resolve()
        while (!cancelled) {
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new JixiError('aborted', 'aborted')
      },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(neverEndingStream)

    const { result, unmount } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    act(() => { result.current.run({}) })
    await act(async () => { await Promise.resolve() })
    unmount()

    expect(cancelled).toBe(true)
  })

  it('calling run() while streaming cancels the previous stream', async () => {
    let firstCancelled = false
    const slowStream: JixiStream = {
      runId: 'test-run',
      cancel() { firstCancelled = true },
      async *[Symbol.asyncIterator]() {
        yield workflowStarted
        await Promise.resolve()
        if (firstCancelled) throw new JixiError('aborted', 'aborted')
        yield workflowCompleted
      },
    }
    mockRunWorkflowStream
      .mockResolvedValueOnce(slowStream)
      .mockResolvedValueOnce(makeStream([workflowCompleted]))

    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    act(() => { result.current.run({ call: 1 }) })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await result.current.run({ call: 2 }) })

    expect(firstCancelled).toBe(true)
    expect(result.current.isComplete).toBe(true)
  })

  it('reset() clears all state including contentChunks', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([workflowMessage, contentChunkText, workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })
    expect(result.current.events.length).toBeGreaterThan(0)

    act(() => { result.current.reset() })

    expect(result.current.events).toEqual([])
    expect(result.current.contentChunks).toEqual([])
    expect(result.current.latestMessage).toBeNull()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
