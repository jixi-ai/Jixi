import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiError } from '@jixi/js'
import type { JixiStream, WorkflowRunEvent } from '@jixi/js'
import { JixiProvider } from '../context'
import { useJixiEventStream } from '../use-jixi-event-stream'

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

const msg1: WorkflowRunEvent = {
  type: 'workflow_message',
  runId: 'test-run',
  seq: 0,
  timestamp: '2026-01-01T00:00:00Z',
  data: { message: 'First', stepIndex: 0, actionType: 'llm' },
}

const msg2: WorkflowRunEvent = {
  type: 'workflow_message',
  runId: 'test-run',
  seq: 1,
  timestamp: '2026-01-01T00:00:01Z',
  data: { message: 'Second', stepIndex: 0, actionType: 'llm' },
}

const completed: WorkflowRunEvent = {
  type: 'workflow_completed',
  runId: 'test-run',
  seq: 2,
  timestamp: '2026-01-01T00:00:02Z',
  data: { result: {}, durationMs: 500, analytics: {} },
}

describe('useJixiEventStream', () => {
  beforeEach(() => {
    mockRunWorkflowStream.mockReset()
  })

  it('exposes only the most recent event of the given type', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(makeStream([msg1, msg2, completed]))
    const { result } = renderHook(
      () => useJixiEventStream('my_workflow', 'workflow_message'),
      { wrapper },
    )

    await act(async () => { await result.current.run({}) })

    expect(result.current.event?.data).toMatchObject({ message: 'Second' })
  })

  it('ignores events of other types', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(makeStream([msg1, completed]))
    const { result } = renderHook(
      () => useJixiEventStream('my_workflow', 'workflow_completed'),
      { wrapper },
    )

    await act(async () => { await result.current.run({}) })

    expect(result.current.event?.type).toBe('workflow_completed')
  })

  it('reset() clears event and resets internal counter', async () => {
    mockRunWorkflowStream.mockResolvedValueOnce(makeStream([msg1, completed]))
    const { result } = renderHook(
      () => useJixiEventStream('my_workflow', 'workflow_message'),
      { wrapper },
    )

    await act(async () => { await result.current.run({}) })
    expect(result.current.event).not.toBeNull()

    act(() => { result.current.reset() })
    expect(result.current.event).toBeNull()
  })

  it('cancel() stops stream: isStreaming=false, error=null', async () => {
    let cancelled = false
    const pauseStream: JixiStream = {
      runId: 'test-run',
      cancel() { cancelled = true },
      async *[Symbol.asyncIterator]() {
        yield msg1
        await Promise.resolve()
        if (cancelled) throw new JixiError('aborted', 'aborted')
        yield completed
      },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(pauseStream)

    const { result } = renderHook(
      () => useJixiEventStream('my_workflow', 'workflow_message'),
      { wrapper },
    )

    await act(async () => {
      const runPromise = result.current.run({})
      await Promise.resolve()
      await Promise.resolve()
      result.current.cancel()
      await runPromise
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('unmount cancels stream without throwing', async () => {
    let cancelled = false
    const longStream: JixiStream = {
      runId: 'test-run',
      cancel() { cancelled = true },
      async *[Symbol.asyncIterator]() {
        yield msg1
        await Promise.resolve()
        while (!cancelled) {
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new JixiError('aborted', 'aborted')
      },
    }
    mockRunWorkflowStream.mockResolvedValueOnce(longStream)

    const { result, unmount } = renderHook(
      () => useJixiEventStream('my_workflow', 'workflow_message'),
      { wrapper },
    )

    act(() => { result.current.run({}) })
    await act(async () => { await Promise.resolve() })
    unmount()

    expect(cancelled).toBe(true)
  })

  it('changing eventType between calls scans from the beginning', async () => {
    mockRunWorkflowStream
      .mockResolvedValueOnce(makeStream([msg1, completed]))
      .mockResolvedValueOnce(makeStream([msg2, completed]))

    let eventType: 'workflow_message' | 'workflow_completed' = 'workflow_message'

    const { result, rerender } = renderHook(
      () => useJixiEventStream('my_workflow', eventType),
      { wrapper },
    )

    // First run — subscribe to workflow_message
    await act(async () => { await result.current.run({}) })
    expect(result.current.event?.data).toMatchObject({ message: 'First' })

    // Switch eventType, reset, and run again
    eventType = 'workflow_completed'
    act(() => { rerender() })
    act(() => { result.current.reset() })

    await act(async () => { await result.current.run({}) })
    expect(result.current.event?.type).toBe('workflow_completed')
  })
})
