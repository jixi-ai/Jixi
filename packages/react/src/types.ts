import type {
  JixiError,
  EventStreamOptions,
  RunWorkflowOptions,
  WorkflowRunEvent,
  WorkflowRunEventType,
  ContentChunkData,
  SessionTokenProvider,
  AudioStreamEvent,
  AudioStreamOptions,
} from '@jixi/js'
import type { ReactNode } from 'react'

export type JixiProviderProps = {
  children: ReactNode
  baseUrl?: string
  apiKey?: string
  sessionTokenProvider?: SessionTokenProvider
  appId?: string
  timeoutMs?: number
  tokenTtlMs?: number
}

export type JixiWorkflowResult<TIn, TOut> = {
  run: (input: TIn) => Promise<void>
  data: TOut | null
  isLoading: boolean
  error: JixiError | null
  reset: () => void
}

export type JixiStreamResult<TIn> = {
  run: (input: TIn) => Promise<void>
  events: WorkflowRunEvent[]
  latestMessage: string | null
  contentChunks: ContentChunkData[]
  isStreaming: boolean
  isComplete: boolean
  error: JixiError | null
  reset: () => void
  cancel: () => void
}

export type JixiRunEventsResult = {
  events: WorkflowRunEvent[]
  latestMessage: string | null
  contentChunks: ContentChunkData[]
  isStreaming: boolean
  isComplete: boolean
  error: JixiError | null
  reset: () => void
  cancel: () => void
}

export type JixiEventStreamResult<TIn> = {
  run: (input: TIn) => Promise<void>
  event: WorkflowRunEvent | null
  isStreaming: boolean
  error: JixiError | null
  reset: () => void
  cancel: () => void
}

export type JixiTextStreamResult<TIn> = {
  run: (input: TIn) => Promise<void>
  text: string
  isDone: boolean
  isStreaming: boolean
  isComplete: boolean
  error: JixiError | null
  reset: () => void
  cancel: () => void
}

export type { RunWorkflowOptions, WorkflowRunEvent, WorkflowRunEventType, ContentChunkData }

export type JixiAudioStreamResult = {
  start: () => Promise<void>
  sendAudio: (buf: ArrayBuffer | Uint8Array) => void
  flush: () => void
  finalize: () => void
  cancel: () => void
  reset: () => void
  events: AudioStreamEvent[]
  transcript: string
  interimText: string
  sessionId: string | null
  fileId: string | null
  isStreaming: boolean
  isComplete: boolean
  error: JixiError | null
}

export type JixiAudioSessionEventsResult = {
  events: AudioStreamEvent[]
  transcript: string
  interimText: string
  sessionId: string | null
  fileId: string | null
  isStreaming: boolean
  isComplete: boolean
  error: JixiError | null
  reset: () => void
  cancel: () => void
}

export type { AudioStreamEvent, AudioStreamOptions, EventStreamOptions }
