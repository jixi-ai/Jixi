# @jixi/react

## What This Package Does

React hooks and provider for Jixi workflows. Wraps `@jixi/js` with React lifecycle integration: manages streaming state, cancels on unmount, and exposes ergonomic hooks for sync and streaming workflow execution.

**Requires React 18 or newer. Client components only — not compatible with React Server Components.**

This package never reimplements wire protocol, SSE parsing, token management, or error handling. All of that lives in `@jixi/js`.

## Public API

Exported from `src/index.ts`.

### `JixiProvider`

Wrap your app (or a subtree) once. Creates a single `JixiClient` and stores it in context.

```tsx
<JixiProvider
  appId="ak_app_123"
  apiKey={process.env.NEXT_PUBLIC_JIXI_API_KEY}
>
  {children}
</JixiProvider>
```

Props (`JixiProviderProps`): `children`, `baseUrl?`, `apiKey?`, `appId?`, `timeoutMs?`, `tokenTtlMs?`. `baseUrl` defaults to `https://api.jixi.ai`.

Client apps must provide `apiKey`. For Next.js client components, use `NEXT_PUBLIC_JIXI_API_KEY`. For Vite, use `VITE_JIXI_API_KEY`. Create keys at https://app.jixi.ai/security.

Client is created via `useMemo` keyed on all config props. In practice it is created once per app lifetime because env vars and static functions do not change.

### `useJixiClient(): JixiClient`

Returns the `JixiClient` from context. Throws with a clear message if called outside a `JixiProvider`. Intended for advanced use — most callers should use a workflow hook.

### `useJixiWorkflow<TIn, TOut>(workflowName, options?)`

Non-streaming. Use for workflows that return a single result.

```ts
const { run, data, isLoading, error, reset } = useJixiWorkflow<Payload, Result>('my_workflow')
```

- `run(input)` — stable across renders (`useCallback`). Cancels any in-flight request before starting a new one.
- `data` — `TOut | null`; set on success
- `isLoading` — `boolean`
- `error` — `JixiError | null`
- `reset()` — clears `data`, `error`, `isLoading` to initial state

### `useJixiStream<TIn>(workflowName, options?)`

Streaming. Accumulates all events as they arrive.

```ts
const { run, events, latestMessage, contentChunks, isStreaming, isComplete, error, reset, cancel } =
  useJixiStream<Payload>('my_workflow')
```

- `events` — `WorkflowRunEvent[]` accumulated in arrival order
- `latestMessage` — `string | null`; extracted from the most recent `workflow_message` event
- `contentChunks` — `ContentChunkData[]`; accumulated from all `content_chunk` events across all steps
- `isStreaming` — true while the stream is open
- `isComplete` — true after `workflow_completed` is received
- `cancel()` — stops the stream; `isStreaming` → false, `error` stays null, `isComplete` stays false
- Unmount cancels any active stream automatically.
- Calling `run()` while streaming cancels the previous stream before starting a new one.

### `useJixiEventStream<TIn>(workflowName, eventType, options?)`

Streaming, filtered to one event type. Returns only the most recent event of `eventType`. Use when you only care about one event (e.g. `'workflow_completed'` or `'workflow_message'`).

```ts
const { run, event, isStreaming, error, reset, cancel } =
  useJixiEventStream<Payload>('my_workflow', 'workflow_completed')
```

- `event` — `WorkflowRunEvent | null`; the most recent event matching `eventType`

### `useJixiRunEvents(workflowName, runId, options?)`

Attaches to an existing workflow run SSE stream without starting a new run.

```ts
const { events, latestMessage, contentChunks, isStreaming, isComplete, error, reset, cancel } =
  useJixiRunEvents('my_workflow', runId)
```

- `runId` may be `null`/`undefined`; the hook stays reset until a value is supplied.
- Replayed events are deduped by `seq`.
- Unmount cancels the active SSE stream automatically.

### `useJixiAudioStream(appId, options?)`

Live audio streaming session. Manages transport lifecycle and surfaces transcript events as React state. Defaults to WebSocket; pass `transport: 'http'` for HTTP/SSE fallback or `transport: 'auto'` to try WebSocket first. The caller is responsible for capturing audio (e.g. via `MediaRecorder`) and piping it in via `sendAudio`.

```ts
const {
  start,        // () => Promise<void> — opens WebSocket, starts session
  sendAudio,    // (buf: ArrayBuffer | Uint8Array) => void — forward audio frame to server
  flush,        // () => void — ask Deepgram to finalise pending transcript
  finalize,     // () => void — end recording; waits for session_completed
  cancel,       // () => void — abort immediately
  reset,        // () => void — clear all state
  events,       // AudioStreamEvent[] — all events in arrival order
  transcript,   // string — accumulated final transcript (newline-separated chunks)
  interimText,  // string — latest interim transcript; cleared on each final chunk
  sessionId,    // string | null
  fileId,       // string | null
  isStreaming,  // boolean
  isComplete,   // boolean — true after session_completed
  error,        // JixiError | null
} = useJixiAudioStream('app_123', { encoding: 'webm', sampleRateHz: 48000 })
```

Example with `MediaRecorder`:
```tsx
const { start, sendAudio, finalize, transcript, isStreaming } = useJixiAudioStream(appId)

const handleRecord = async () => {
  await start()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
  recorder.ondataavailable = async e => sendAudio(await e.data.arrayBuffer())
  recorder.start(250)  // 250ms chunks
  setRecorder(recorder)
}

const handleStop = () => {
  recorderRef.current?.stop()
  finalize()
}
```

- `transcript` is the concatenation of `transcript_final.data.text` values, separated by `\n`. Diarized content (`[Speaker N] ...`) is included as-is.
- `interimText` reflects the latest `transcript_interim` text; cleared to `''` on each `transcript_final` and `session_completed`.
- `finalize()` sets `isStreaming = false` immediately (caller has stopped sending) but the for-await loop continues until `session_completed` arrives and `isComplete` flips to `true`.
- Unmount cancels any active stream automatically.

### `useJixiAudioSessionEvents(appId, sessionId, options?)`

Attaches to an existing audio session SSE stream without creating a new session.

```ts
const { events, transcript, interimText, fileId, isStreaming, isComplete, error, reset, cancel } =
  useJixiAudioSessionEvents(appId, sessionId)
```

- `sessionId` may be `null`/`undefined`; the hook stays reset until a value is supplied.
- Replayed events are deduped by `seq`.
- Transcript aggregation matches `useJixiAudioStream`.

### `useJixiTextStream<TIn>(workflowName, options?)`

Streaming, assembles `content_chunk` text tokens into a progressive string. Use for LLM text output.

```ts
const { run, text, isDone, isStreaming, isComplete, error, reset, cancel } =
  useJixiTextStream<Payload>('my_workflow')
```

- `text` — concatenated `chunk` strings from all `content_chunk` events with `contentType === 'text'`, across all steps
- `isDone` — true when a chunk with `done: true` arrives (final token received)
- `isComplete` — true after `workflow_completed` (after `isDone`; gap represents server finalizing)
- Audio chunks (`contentType === 'audio'`) are ignored — this hook is text-only

## Internal Patterns — Follow These When Modifying

### optionsRef pattern

`RunWorkflowOptions` passed to a hook is stored in a `useRef` and updated each render:

```ts
const optionsRef = useRef(options)
optionsRef.current = options  // sync on every render, no re-run of effects
```

The `run` callback reads `optionsRef.current` at call time. **Do not put `options` in `useCallback` deps** — that would cause `run` to be recreated on every render when options is an inline object.

### processedRef pattern

Used in `useJixiEventStream` and `useJixiTextStream` to avoid reprocessing events on re-render:

```ts
const processedRef = useRef(0)

useEffect(() => {
  const newEvents = base.events.slice(processedRef.current)
  processedRef.current = base.events.length
  for (const e of newEvents) { /* process only new events */ }
}, [base.events])
```

When `eventType` changes in `useJixiEventStream`, reset `processedRef.current = 0` and clear state so the scan restarts from the beginning of the current event array.

### Functional setState for accumulation

All setters that accumulate values across async callbacks use the functional update form. Never use captured state inside async callbacks.

```ts
setEvents(prev => [...prev, event])
setContentChunks(prev => [...prev, chunk])
setText(prev => prev + chunk.chunk)
```

### Silent swallow of `'aborted'` errors

When a `JixiError` with `code === 'aborted'` is caught inside any hook's async callback, it is silently ignored. Two cases trigger this: component unmount (setting state on an unmounted component) and a superseding `run()` call (result is stale). All other `JixiError` codes surface via `error` state.

```ts
} catch (err) {
  if (err instanceof JixiError && err.code === 'aborted') return  // silent
  setError(err as JixiError)
  setIsStreaming(false)
}
```

### Stream ref + cleanup

Every streaming hook holds the active `JixiStream` in a `useRef`:

```ts
const streamRef = useRef<JixiStream | null>(null)
```

Before starting a new stream: `streamRef.current?.cancel()`. On unmount (effect cleanup): `streamRef.current?.cancel()`. The `'aborted'` swallow above handles the error that `cancel()` causes in the async iteration.

## What Is Internal (Do Not Export)

- `JixiContext` and `JixiContextValue` — used only between `context.tsx` and the hooks
- `useJixiTextStream` and `useJixiEventStream` compose on top of `useJixiStream` internally; the base stream state is not re-exposed

## Running Tests

```bash
# From packages/react/
npm run test          # vitest run (jsdom environment)
npm run test:watch    # interactive watch mode
npm run typecheck     # tsc --noEmit
```

Six test files in `src/__tests__/`: `context`, `use-jixi-workflow`, `use-jixi-stream`, `use-jixi-event-stream`, `use-jixi-text-stream`, `stream-attach-hooks`.

Uses `@testing-library/react` with `vi.mock('@jixi/js')`. Fake `JixiStream` instances are implemented as async generators in tests. Mock `JixiClient` is configured per test to return specific event sequences.

## Known Constraints and Gotchas

- **Client components only** — hooks use `useEffect`, `useCallback`, `useRef`. No RSC support.
- **React 18+ only** — no compatibility shims for React 17.
- **`useJixiTextStream` is text-only** — audio chunks are silently ignored. For audio, use `useJixiStream` and handle `content_chunk` events with `contentType === 'audio'` directly.
- **No cross-instance deduplication** — two components calling the same workflow each manage independent state.
- **`workflow_failed` is an event, not an error** — `useJixiStream` sets `isStreaming=false` and `error` from the event's `data.error` string. It is not thrown by `@jixi/js`.

## Not in Scope for v1

- React Server Component support
- Suspense integration (`use()` hook or `<Suspense>` boundaries)
- Optimistic updates
- Global loading/error state at the provider level
- React Native support
- Streaming result caching or persistence across remounts
- Request deduplication across hook instances

See `specs/jixi-react-spec.md` for the full specification.
