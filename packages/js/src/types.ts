export type SessionTokenProvider = () => Promise<string>

export type JixiClientConfig = {
  baseUrl: string
  apiKey?: string
  sessionTokenProvider?: SessionTokenProvider
  timeoutMs?: number
  tokenTtlMs?: number
  appId?: string
}

export type RunWorkflowOptions = {
  environment?: string
  versionId?: string
  draft?: boolean
  signal?: AbortSignal
}

export type TokenState = {
  token: string
  fetchedAt: number
}

export type WorkflowRunEventType =
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'workflow_message'
  | 'content_chunk'

export interface WorkflowRunEvent {
  type: WorkflowRunEventType
  runId: string
  seq: number
  timestamp: string
  data?: Record<string, unknown>
}

export interface WorkflowStartedData {
  workflowId: string
  workflowName: string
  appId: string
}

export interface WorkflowCompletedData {
  result: unknown
  durationMs: number
  analytics: {
    tokenCount?: number
    cost?: number
    model?: string
  }
}

export interface WorkflowFailedData {
  error: string
  durationMs?: number
}

export interface StepStartedData {
  stepIndex: number
  actionName: string
  actionType: string
}

export interface StepCompletedData {
  stepIndex: number
  actionName: string
  actionType: string
  ok: true
  outputType?: string
  durationMs?: number
}

export interface StepFailedData {
  stepIndex: number
  actionName: string
  actionType: string
  ok: false
  error: string
  durationMs?: number
}

export interface WorkflowMessageData {
  message: string
  stepIndex: number
  actionType: string
}

export interface ContentChunkData {
  stepIndex: number
  contentType: 'text' | 'audio'
  encoding: 'utf-8' | 'base64'
  chunk: string
  index: number
  done: boolean
}

export type HeartbeatEvent = { type: 'heartbeat' }
