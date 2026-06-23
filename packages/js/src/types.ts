export type SessionTokenProvider = () => Promise<string>

export type JixiClientConfig = {
  baseUrl?: string
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
  force?: boolean
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

// ─── Audio Stream Types ───────────────────────────────────────────────────────

export type AudioStreamEventType =
  | 'session_started'
  | 'transcript_interim'
  | 'transcript_final'
  | 'chunk_indexed'
  | 'chunk_failed'
  | 'session_completed'
  | 'session_failed'

export interface AudioStreamEvent {
  type: AudioStreamEventType
  sessionId: string
  seq: number
  timestamp: string
  data?: Record<string, unknown>
}

export type AudioStreamOptions = {
  transport?: 'websocket' | 'http' | 'auto'
  signal?: AbortSignal
  lastSeenSeq?: number
  dedupe?: boolean
  name?: string
  encoding?: 'linear16' | 'opus' | 'webm' | 'mulaw' | 'flac'
  sampleRateHz?: number
  folders?: string[]
  diarize?: boolean
  /** Map of Deepgram speaker ID (e.g. '0', '1') to display name. Stored in chunk content. */
  speakerNames?: Record<string, string>
  /** Boost recognition of domain-specific words/acronyms. Format: ["word:boost", ...]
   *  where boost is 1–10. Example: ["HbA1c:3", "COPD:2"]. Uses Deepgram keywords API. */
  keywords?: string[]
  languageHint?: string
  interimResults?: boolean
  autoDeidentify?: boolean
}

export interface SessionStartedData {
  fileId: string
  provider: 'deepgram'
  encoding: string
  diarize: boolean
}

export interface TranscriptInterimData {
  text: string
  speaker?: string
  startMs: number
  endMs: number
}

export interface TranscriptFinalData {
  chunkId: string
  seq: number
  text: string
  speakers: string[]
  startMs: number
  endMs: number
  deidentified: boolean
  redactionCount?: number
}

export interface ChunkIndexedData {
  chunkId: string
  seq: number
}

export interface ChunkFailedData {
  seq: number
  error: string
}

export interface SessionCompletedData {
  fileId: string
  url: string
  totalChunks: number
  durationMs: number
  fullTranscript: string
}

export interface SessionFailedData {
  error: string
}

// ─── File Types ──────────────────────────────────────────────────────────────

export type JixiFileType = 'File' | 'Folder'
export type JixiFileStatus = 'Processing' | 'Ready' | 'Failed'

export interface JixiFile {
  _id?: string
  id?: string
  name: string
  type: JixiFileType
  parent?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  size?: number
  status?: JixiFileStatus
  folders?: string[]
  source?: string
  [key: string]: unknown
}

export interface CreateFileInput {
  name: string
  type: JixiFileType
  parent?: string
  url?: string
  status?: JixiFileStatus
  size?: number
  folders?: string[]
}

export type UpdateFileInput = Partial<CreateFileInput>

export interface WriteFileInput {
  filePath: string
  content: unknown
  allowOverwrite?: boolean
  fromUrl?: boolean
  waitForIngest?: boolean
}

export interface UploadFileOptions {
  filename?: string
}

export interface FileDownloadUrlOptions {
  disposition?: 'inline' | 'attachment'
  filename?: string
  expiresIn?: number
}

export interface FileFrameUrlOptions {
  expiresIn?: number
}

export interface FileChunkQuery {
  page?: number
  perPage?: number
}

export interface FileChunkSeekQuery {
  limit?: number
  afterSeq?: number
  afterId?: string
}

export interface JixiFileChunk {
  _id?: string
  id?: string
  fileId?: string
  seq?: number
  text?: string
  content?: string
  [key: string]: unknown
}

export interface JixiFileIngestEvent {
  type: string
  id?: string
  fileId?: string
  appId?: string
  status?: JixiFileStatus
  updatedAt?: string
  stage?: string
  progress?: number
  detail?: string
  error?: string
}
