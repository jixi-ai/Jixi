# @jixi/js

## What This Package Does

The core browser/Node.js Jixi client. It is the single source of truth for the Jixi wire protocol. All other Jixi packages (`@jixi/react`, `@jixi/vue`, `@jixi/svelte`, `@jixi/node`) import from here and never re-implement any of these concerns.

**Zero runtime dependencies.** Uses only native `fetch`, `AbortController`, `ReadableStream`, and `TextDecoder`.

## Public API

Exported from `src/index.ts`. Do not add new exports without updating the index.

### `JixiClient`

```ts
class JixiClient {
  constructor(config: JixiClientConfig)
  runWorkflow<TIn, TOut>(name: string, input: TIn, options?: RunWorkflowOptions): Promise<TOut>
  runWorkflowStream<TIn>(name: string, input: TIn, options?: RunWorkflowOptions): Promise<JixiStream>
  getWorkflowRunEvents(name: string, runId: string, options?: RunWorkflowOptions & EventStreamOptions): Promise<JixiStream>
  startAudioStream(appId: string, options?: AudioStreamOptions): Promise<AudioStream | AudioHttpStream>
  startAudioStreamHttp(appId: string, options?: AudioStreamOptions & EventStreamOptions): Promise<AudioHttpStream>
  getAudioSessionEvents(appId: string, sessionId: string, options?: { signal?: AbortSignal } & EventStreamOptions): Promise<AudioSessionEventStream>
  listFiles(appId: string): Promise<JixiFile[]>
  getFile(appId: string, fileId: string): Promise<JixiFile>
  createFile(appId: string, input: CreateFileInput): Promise<JixiFile>
  writeFile(appId: string, input: WriteFileInput): Promise<JixiFile>
  uploadFile(appId: string, fileId: string, file: Blob, options?: UploadFileOptions): Promise<JixiFile>
  updateFile(appId: string, fileId: string, input: UpdateFileInput): Promise<JixiFile>
  deleteFile(appId: string, fileId: string): Promise<unknown>
  listFileChunks(appId: string, fileId: string, options?: FileChunkQuery): Promise<JixiFileChunk[]>
  getFileEvents(appId: string, options?: EventStreamOptions): Promise<FileEventStream>
}
```

- **`runWorkflow`** — synchronous execution; waits for the full workflow result. `POST /wf/:name`.
- **`runWorkflowStream`** — streaming execution via 2-step SSE protocol. Returns a `JixiStream`.
- **`getWorkflowRunEvents`** — attaches to an existing workflow run SSE stream and replays buffered events.
- **`startAudioStream`** — opens a live audio streaming session. Defaults to WebSocket; can use HTTP/SSE with `transport: 'http'` or startup fallback with `transport: 'auto'`.
- **`startAudioStreamHttp`** — creates an HTTP fallback audio session, uploads chunks with POST, and receives events over SSE.
- **`getAudioSessionEvents`** — attaches to an existing audio session SSE stream and replays buffered events.

### `JixiClientConfig`

```ts
type JixiClientConfig = {
  baseUrl?: string                        // default: https://api.jixi.ai
  apiKey?: string
  sessionTokenProvider?: () => Promise<string>
  timeoutMs?: number                      // default: 30_000
  appId?: string                          // required for session token mode
  tokenTtlMs?: number                     // token cache TTL, default: 240_000 (4 min)
}
```

Server-side code can pass `apiKey: process.env.JIXI_API_KEY`. Production browser apps should use `sessionTokenProvider` to fetch short-lived tokens minted by a backend with `@jixi/node`; avoid exposing long-lived API keys in browser env vars.

### `RunWorkflowOptions`

```ts
type RunWorkflowOptions = {
  environment?: string   // workflow version alias
  versionId?: string     // pin to a specific compiled version
  draft?: boolean        // run draft (unversioned) actions
  force?: boolean        // force recompilation
  signal?: AbortSignal   // caller-controlled cancellation
}
```

### `AudioStream`

Returned by `startAudioStream` when using the default WebSocket transport. Async iterable of `AudioStreamEvent`. Wraps a WebSocket connection.

```ts
class AudioStream implements AsyncIterable<AudioStreamEvent> {
  sessionId: string      // populated before the promise resolves
  fileId: string         // populated before the promise resolves
  sendAudio(buf: ArrayBuffer | Uint8Array): void   // send binary audio frame
  flush(): void          // send { type: 'flush' } — ask Deepgram to finalise pending transcript
  finalize(): void       // send { type: 'close' } — end recording; iterator continues until session_completed/failed
  cancel(): void         // close WebSocket with code 1000; iterator completes immediately
}
```

### `AudioHttpStream`

Returned by `startAudioStreamHttp` or `startAudioStream(..., { transport: 'http' })`.
Async iterable of `AudioStreamEvent`. Uses HTTP chunk upload plus SSE events.

### File Methods

The core client includes first-class file calls for browser and Node runtimes.
They use the same auth configuration as workflows/audio, including session
tokens from `sessionTokenProvider`.

```ts
const files = await client.listFiles(appId)
const file = await client.getFile(appId, fileId)
const created = await client.createFile(appId, {
  name: 'notes.txt',
  type: 'File',
  parent: appId,
  status: 'Processing',
})

await client.uploadFile(appId, created.id!, fileBlob, { filename: 'notes.txt' })
const chunks = await client.listFileChunks(appId, created.id!, { page: 1, perPage: 50 })
await client.deleteFile(appId, created.id!)
```

Additional methods cover hierarchy/children, write by path, upload string data,
replace content, download URL generation, frame URL generation, chunk counts,
chunk pages, cursor chunk seek, all chunks, and file ingest events.

```ts
class AudioHttpStream implements AsyncIterable<AudioStreamEvent> {
  sessionId: string
  fileId: string
  sendAudio(buf: ArrayBuffer | Uint8Array): Promise<void>
  flush(): void          // no-op for HTTP fallback; finalize drains pending segments
  finalize(): Promise<void>
  cancel(): void
}
```

Usage:
```ts
const stream = await client.startAudioStream('appId123', { encoding: 'webm', sampleRateHz: 48000 })
mediaRecorder.ondataavailable = e => stream.sendAudio(await e.data.arrayBuffer())

for await (const event of stream) {
  if (event.type === 'transcript_interim') { /* show live text */ }
  if (event.type === 'transcript_final')   { /* accumulate transcript */ }
  if (event.type === 'session_completed')  { /* done */ }
}
```

### Audio Event Types

`AudioStreamEvent` carries `type`, `sessionId`, `seq`, `timestamp`, and `data`.

| `type` | When | `data` fields |
|--------|------|---------------|
| `session_started` | Session initialised | `fileId`, `provider: 'deepgram'`, `encoding`, `diarize` |
| `transcript_interim` | Deepgram interim result | `text`, `speaker?`, `startMs`, `endMs` |
| `transcript_final` | Utterance group flushed and indexed | `chunkId`, `seq`, `text`, `speakers`, `startMs`, `endMs`, `deidentified`, `redactionCount?` |
| `chunk_indexed` | Immediately after `transcript_final` | `chunkId`, `seq` |
| `chunk_failed` | De-id or RAG pipeline failed for one chunk | `seq`, `error` |
| `session_completed` | S3 upload done, File marked Ready | `fileId`, `url`, `totalChunks`, `durationMs`, `fullTranscript` |
| `session_failed` | Backpressure or unrecoverable error | `error` |

Typed data interfaces (`SessionStartedData`, `TranscriptInterimData`, `TranscriptFinalData`, `ChunkIndexedData`, `ChunkFailedData`, `SessionCompletedData`, `SessionFailedData`) are exported from `src/index.ts`.

### `JixiStream`

Returned by `runWorkflowStream`. Async iterable of `WorkflowRunEvent`. Exposes `runId` for logging.

```ts
interface JixiStream extends AsyncIterable<WorkflowRunEvent> {
  readonly runId: string
  cancel(): void
}
```

Usage:
```ts
const stream = await client.runWorkflowStream('my_workflow', input)
for await (const event of stream) {
  if (event.type === 'content_chunk') { ... }
  if (event.type === 'workflow_completed') { ... }
}
```

### `JixiError`

All errors from the client are `JixiError` instances.

```ts
class JixiError extends Error {
  code: JixiErrorCode
  status?: number        // HTTP status if applicable
  workflowName?: string
  runId?: string
  durationMs?: number
}

type JixiErrorCode =
  | 'auth_failed'          // 401
  | 'workflow_not_found'   // 404
  | 'credits_depleted'     // 400 with "credit" in body
  | 'timeout'              // internal AbortController fired
  | 'aborted'              // caller's AbortSignal fired
  | 'stream_interrupted'   // SSE connection dropped mid-stream
  | 'parse_error'          // unexpected response format
  | 'server_error'         // 5xx
  | 'unknown'
```

`timeout` and `aborted` are distinct so callers can handle them differently (timeout may warrant retry; abort was intentional).

### Event Types

`WorkflowRunEvent` is a discriminated union on `.type`. All events also carry `runId`, `seq`, and `timestamp`.

| `type` | Intent |
|--------|--------|
| `workflow_started` | Run has begun; `data` has `workflowId`, `workflowName`, `appId` |
| `workflow_completed` | Run finished successfully; `data.result` is the final output |
| `workflow_failed` | Run failed server-side; `data.error` is a string description — **not thrown, yielded** |
| `step_started` | A step began; `data` has `stepIndex`, `actionName`, `actionType` |
| `step_completed` | A step finished ok; `data` has `stepIndex`, `outputType`, `durationMs` |
| `step_failed` | A step failed; `data` has `stepIndex`, `error` |
| `workflow_message` | Human-readable status string from the workflow; `data.message` |
| `content_chunk` | Partial LLM text token or audio frame from a streaming step |

`content_chunk` details:
```ts
interface ContentChunkData {
  stepIndex: number
  contentType: 'text' | 'audio'
  encoding: 'utf-8' | 'base64'   // utf-8 for text tokens, base64 for audio frames
  chunk: string
  index: number                   // ordinal within this step (0, 1, 2, …)
  done: boolean                   // true on the final chunk; step_completed follows shortly
}
```

`content_chunk` events are only emitted for steps with `config.streaming: true` and have no replay. The assembled value is always available in `step_completed.data`.

## Wire Protocol

**Synchronous:** `POST /wf/:name` with JSON body + query params → JSON response body.

**Streaming (2 steps):**
1. `POST /wf/:name/stream` with JSON body → `{ runId: string }`
2. `GET /wf/:name/runs/:runId/events` with `Accept: text/event-stream` → SSE stream

Query params (`environment`, `versionId`, `draft`, `force`) go on workflow requests. Base URL trailing slashes are stripped before building paths.

**Workflow attach:** `GET /wf/:name/runs/:runId/events` returns the same SSE event stream without starting a new run.

**Audio WebSocket:** `ws(s)://host/applications/:appId/aiStream/audio?token=<jwt>` sends a `start` frame followed by binary audio frames.

**Audio HTTP fallback:**
1. `POST /applications/:appId/aiStream/audio/sessions` → session URLs
2. `POST /applications/:appId/aiStream/audio/sessions/:sessionId/chunks` with `application/octet-stream`
3. `POST /applications/:appId/aiStream/audio/sessions/:sessionId/finalize`
4. `GET /applications/:appId/aiStream/audio/sessions/:sessionId/events` with `Accept: text/event-stream`

## Internal Patterns — Follow These When Modifying

### `_request()` in `request.ts`

All HTTP requests go through `_request`. It handles: auth header attachment, timeout via internal `AbortController`, external `AbortSignal` propagation, status-to-error-code mapping, JSON parsing, and structured console logging. **Do not bypass it.**

**Timeout + abort pattern** — no `AbortSignal.any()` (not universally supported):
```ts
// Internal timeout controller
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), timeoutMs)

// External signal propagated manually
if (options?.signal) {
  options.signal.addEventListener('abort', () => ctrl.abort())
}
```
Tracks `timedOut` and `aborted` booleans separately to distinguish error codes.

**Logging format:**
```
[jixi] workflowName status=200 ms=342 len=1204
[jixi] workflowName ERROR ms=5001 timeoutMs=30000 aborted=true timedOut=false
```

### SSE parser in `sse-parser.ts`

Uses `fetch` with `Authorization: Bearer` — not `EventSource` (EventSource doesn't support custom headers).

**Abort pattern** — again no `AbortSignal.any()`:
```ts
const abortPromise = new Promise<null>(resolve => signal?.addEventListener('abort', () => resolve(null)))
const result = await Promise.race([readPromise, abortPromise])
```

Frame buffer: accumulate decoded bytes, split on `\n\n`, parse `data:` line. Skip `:` comment lines and empty frames. Malformed JSON frames are silently dropped (don't throw).

### `JixiStream` in `stream.ts`

Creates an internal `AbortController` for `cancel()`. Filters heartbeat events (`{ type: 'heartbeat' }`) before yielding — callers never see them.

### Token manager in `token-manager.ts`

Session tokens cached for `tokenTtlMs` (default 240s). On `auth_failed` response: call `invalidate()` to clear cache, then retry once via `_getToken()`. `apiKey` mode: no caching, return directly.

## What Is Internal (Do Not Export)

- `_request()` — private method on `JixiClient`
- `parseSSEStream()` — internal to `sse-parser.ts`
- `TokenManager` class — internal to `token-manager.ts`
- `HeartbeatEvent` type — filtered in `stream.ts`, never reaches callers

## Running Tests

```bash
# From packages/js/
npm run test          # vitest run (one-shot)
npm run test:watch    # interactive watch mode
npm run typecheck     # tsc --noEmit
```

Six test files in `src/__tests__/`: `errors`, `token-manager`, `request`, `sse-parser`, `stream`, `client`. All use vitest with `vi.stubGlobal` for `fetch` and mocked `ReadableStream`/`Response`. Uses `vi.useFakeTimers` for timeout tests.

## Known Constraints and Gotchas

- **No `AbortSignal.any()`** — not supported in all target environments. Use manual `addEventListener('abort', ...)` pattern.
- **No `EventSource`** — cannot send `Authorization` header. Always use `fetch` + `ReadableStream` for SSE.
- **No auto-reconnect loop** — if SSE drops mid-stream, `JixiStream` throws `stream_interrupted`. Use `getWorkflowRunEvents()` or `getAudioSessionEvents()` with `lastSeenSeq` to manually reconnect and dedupe replay.
- **`workflow_failed` is not thrown** — it is yielded as a normal event. Only transport-level failures throw `JixiError`.
- **Heartbeats are filtered** — `{ type: 'heartbeat' }` frames are consumed in `stream.ts` and never reach callers or framework wrappers.
- **Logging is always on in v1** — no `debug: false` config option yet.
- **Replay is transport-buffer dependent** — workflow and audio attach helpers consume whatever the server still has buffered and drop duplicate `seq` values by default.
- **Base URL** — constructor strips trailing slash; don't add it again when building paths.
- **No WebSocket in Node.js < 22** — `startAudioStream()` throws a `JixiError` with `code: 'unknown'` if `typeof WebSocket === 'undefined'`. Use Node.js 22+ or provide a WebSocket polyfill. Audio streaming is primarily a browser use case.
- **`finalize()` does not close the WebSocket** — it sends a `{ type: 'close' }` text frame. The WebSocket stays open until the server sends `session_completed` and closes the connection. The iterator completes naturally.
- **`AudioStream` is single-consumer** — calling `[Symbol.asyncIterator]()` more than once shares the same internal queue; only one consumer should iterate.

## Not in Scope for v1

- File upload (multipart/form-data workflow inputs)
- Run history API (`GET /applications/:appId/workflows/:workflowId/runs`)
- Automatic SSE reconnect loop
- Request interceptors or middleware pattern
- Metrics or telemetry hooks
- `debug: false` config option

See `specs/jixi-js-spec.md` for the full specification.
