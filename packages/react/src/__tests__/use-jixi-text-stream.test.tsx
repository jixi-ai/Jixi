import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiError } from '@jixi/js'
import type { JixiStream, WorkflowRunEvent } from '@jixi/js'
import { JixiProvider } from '../context'
import { useJixiTextStream } from '../use-jixi-text-stream'

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

function textChunk(chunk: string, done: boolean, seq: number): WorkflowRunEvent {
  return {
    type: 'content_chunk',
    runId: 'test-run',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    data: { stepIndex: 0, contentType: 'text', encoding: 'utf-8', chunk, index: seq, done },
  }
}

function audioChunk(seq: number): WorkflowRunEvent {
  return {
    type: 'content_chunk',
    runId: 'test-run',
    seq,
    timestamp: '2026-01-01T00:00:00Z',
    data: { stepIndex: 0, contentType: 'audio', encoding: 'base64', chunk: 'abc123', index: seq, done: true },
  }
}

const workflowCompleted: WorkflowRunEvent = {
  type: 'workflow_completed',
  runId: 'test-run',
  seq: 99,
  timestamp: '2026-01-01T00:00:10Z',
  data: { result: {}, durationMs: 1000, analytics: {} },
}

describe('useJixiTextStream', () => {
  beforeEach(() => {
    mockRunWorkflowStream.mockReset()
  })

  it('starts with text="", isDone=false, isStreaming=false, isComplete=false', () => {
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })
    expect(result.current.text).toBe('')
    expect(result.current.isDone).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('assembles text chunks progressively in arrival order', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([
        textChunk('Hello', false, 0),
        textChunk(', ', false, 1),
        textChunk('world!', true, 2),
        workflowCompleted,
      ]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.text).toBe('Hello, world!')
  })

  it('isDone becomes true when a chunk with done=true is received', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([
        textChunk('Hello', false, 0),
        textChunk(' world', true, 1),
        workflowCompleted,
      ]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.isDone).toBe(true)
  })

  it('isComplete becomes true only after workflow_completed (after isDone)', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([textChunk('final', true, 0), workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.isDone).toBe(true)
    expect(result.current.isComplete).toBe(true)
  })

  it('audio chunks are ignored — text unchanged', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([
        textChunk('Hi', false, 0),
        audioChunk(1),
        textChunk('!', true, 2),
        workflowCompleted,
      ]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.text).toBe('Hi!')
    expect(result.current.isDone).toBe(true)
  })

  it('audio chunk with done=true does not set isDone', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([audioChunk(0), workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })

    expect(result.current.isDone).toBe(false)
    expect(result.current.text).toBe('')
  })

  it('reset() clears text, isDone, and all other state', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(
      makeStream([textChunk('Hello', true, 0), workflowCompleted]),
    )
    const { result } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })
    expect(result.current.text).toBe('Hello')
    expect(result.current.isDone).toBe(true)

    act(() => { result.current.reset() })

    expect(result.current.text).toBe('')
    expect(result.current.isDone).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('unmount cancels active stream without throwing', async () => {
    let cancelled = false
    const longStream: JixiStream = {
      runId: 'test-run',
      cancel() { cancelled = true },
      async *[Symbol.asyncIterator]() {
        yield textChunk('partial', false, 0)
        await Promise.resolve()
        while (!cancelled) {
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new JixiError('aborted', 'aborted')
      },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(longStream)

    const { result, unmount } = renderHook(() => useJixiTextStream('my_workflow'), { wrapper })

    act(() => { result.current.run({}) })
    await act(async () => { await Promise.resolve() })
    unmount()

    expect(cancelled).toBe(true)
  })
})
