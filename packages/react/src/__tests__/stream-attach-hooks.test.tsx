import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiError } from '@jixi/js'
import type {
  AudioSessionEventStream,
  AudioStreamEvent,
  JixiStream,
  WorkflowRunEvent,
} from '@jixi/js'
import { JixiProvider } from '../context'
import { useJixiRunEvents } from '../use-jixi-run-events'
import { useJixiAudioSessionEvents } from '../use-jixi-audio-session-events'
import { useJixiAudioStream } from '../use-jixi-audio-stream'

const { mockGetWorkflowRunEvents, mockGetAudioSessionEvents, mockStartAudioStream } = vi.hoisted(() => ({
  mockGetWorkflowRunEvents: vi.fn(),
  mockGetAudioSessionEvents: vi.fn(),
  mockStartAudioStream: vi.fn(),
}))

vi.mock('@jixi/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jixi/js')>()
  return {
    ...actual,
    JixiClient: vi.fn().mockImplementation(() => ({
      getWorkflowRunEvents: mockGetWorkflowRunEvents,
      getAudioSessionEvents: mockGetAudioSessionEvents,
      startAudioStream: mockStartAudioStream,
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

function makeWorkflowStream(events: WorkflowRunEvent[]): JixiStream {
  return {
    runId: 'run-1',
    cancel() {},
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
        await Promise.resolve()
      }
    },
  }
}

function makeAudioStream(events: AudioStreamEvent[]): AudioSessionEventStream {
  return {
    sessionId: 'sess-1',
    cancel() {},
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
        await Promise.resolve()
      }
    },
  }
}

const workflowMessage: WorkflowRunEvent = {
  type: 'workflow_message',
  runId: 'run-1',
  seq: 0,
  timestamp: 't',
  data: { message: 'Working', stepIndex: 0, actionType: 'generate_response' },
}

const workflowCompleted: WorkflowRunEvent = {
  type: 'workflow_completed',
  runId: 'run-1',
  seq: 1,
  timestamp: 't',
  data: { result: {}, durationMs: 1, analytics: {} },
}

const sessionStarted: AudioStreamEvent = {
  type: 'session_started',
  sessionId: 'sess-1',
  seq: 0,
  timestamp: 't',
  data: { fileId: 'file-1' },
}

const transcriptFinal: AudioStreamEvent = {
  type: 'transcript_final',
  sessionId: 'sess-1',
  seq: 1,
  timestamp: 't',
  data: {
    chunkId: 'chunk-1',
    seq: 0,
    text: '[Speaker 0] Hello',
    speakers: ['0'],
    startMs: 0,
    endMs: 100,
    deidentified: false,
  },
}

const sessionCompleted: AudioStreamEvent = {
  type: 'session_completed',
  sessionId: 'sess-1',
  seq: 2,
  timestamp: 't',
  data: { fileId: 'file-1', url: 's3://x', totalChunks: 1, durationMs: 1, fullTranscript: 'Hello' },
}

describe('stream attach hooks', () => {
  beforeEach(() => {
    mockGetWorkflowRunEvents.mockReset()
    mockGetAudioSessionEvents.mockReset()
    mockStartAudioStream.mockReset()
  })

  it('useJixiRunEvents attaches to a run and updates state', async () => {
    mockGetWorkflowRunEvents.mockResolvedValueOnce(makeWorkflowStream([workflowMessage, workflowCompleted]))

    const { result } = renderHook(() => useJixiRunEvents('my_flow', 'run-1'), { wrapper })

    await waitFor(() => expect(result.current.isComplete).toBe(true))
    expect(mockGetWorkflowRunEvents).toHaveBeenCalledWith('my_flow', 'run-1', undefined)
    expect(result.current.latestMessage).toBe('Working')
    expect(result.current.events).toHaveLength(2)
  })

  it('useJixiAudioSessionEvents attaches to a session and aggregates transcript', async () => {
    mockGetAudioSessionEvents.mockResolvedValueOnce(
      makeAudioStream([sessionStarted, transcriptFinal, sessionCompleted]),
    )

    const { result } = renderHook(() => useJixiAudioSessionEvents('app-1', 'sess-1'), { wrapper })

    await waitFor(() => expect(result.current.isComplete).toBe(true))
    expect(mockGetAudioSessionEvents).toHaveBeenCalledWith('app-1', 'sess-1', undefined)
    expect(result.current.fileId).toBe('file-1')
    expect(result.current.transcript).toBe('[Speaker 0] Hello')
  })

  it('useJixiAudioStream passes HTTP transport options through startAudioStream', async () => {
    mockStartAudioStream.mockResolvedValueOnce(
      makeAudioStream([sessionStarted, transcriptFinal, sessionCompleted]),
    )

    const options = { transport: 'http' as const, encoding: 'webm' as const, sampleRateHz: 48000 }
    const { result } = renderHook(() => useJixiAudioStream('app-1', options), { wrapper })

    await act(async () => {
      await result.current.start()
    })

    expect(mockStartAudioStream).toHaveBeenCalledWith('app-1', options)
    expect(result.current.sessionId).toBe('sess-1')
    expect(result.current.fileId).toBe('file-1')
    expect(result.current.transcript).toBe('[Speaker 0] Hello')
    expect(result.current.error).toBeNull()
  })

  it('useJixiAudioSessionEvents surfaces session_failed as JixiError', async () => {
    mockGetAudioSessionEvents.mockResolvedValueOnce(
      makeAudioStream([
        {
          type: 'session_failed',
          sessionId: 'sess-1',
          seq: 0,
          timestamp: 't',
          data: { error: 'backpressure_inbound' },
        },
      ]),
    )

    const { result } = renderHook(() => useJixiAudioSessionEvents('app-1', 'sess-1'), { wrapper })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(JixiError))
    expect(result.current.error?.message).toBe('backpressure_inbound')
  })
})
