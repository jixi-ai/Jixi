# @jixi/svelte

## What This Package Does

Svelte stores for Jixi. Provides a writable store holding a `JixiClient` and a derived workflow state store. This is a minimal v1 implementation — streaming is not yet implemented here.

**Requires Svelte 4+.**

All wire protocol, SSE, auth, and error handling lives in `@jixi/js`. This package is a thin Svelte-idiomatic wrapper.

## Public API

Exported from `src/index.ts`.

### `createJixiStore(config?: JixiConfig)`

Creates a writable Svelte store whose value is a `JixiClient` instance.

```ts
const jixiStore = createJixiStore({ baseUrl: 'https://api.jixi.ai', apiKey: '...' })
// Access client: $jixiStore or jixiStore.client
```

Returns `{ subscribe, set, client }`.

### `workflowStore<T>()`

Creates a store bundle for tracking workflow execution state.

```ts
const { state, loading, error, data } = workflowStore<ResultType>()
```

- `state` — `Writable<WorkflowState<T>>` with shape `{ data, loading, error }`
- `loading` — `Derived<boolean>`
- `error` — `Derived<Error | null>`
- `data` — `Derived<WorkflowResult<T> | null>`

Manage execution by updating `state` directly. There is no built-in `run()` function — call `JixiClient` methods and update `state` in your component.

## For Streaming

Streaming stores are not yet implemented in `@jixi/svelte`. For streaming in Svelte, use `@jixi/js` directly with Svelte's reactive assignments:

```ts
let text = ''
const stream = await client.runWorkflowStream('my_workflow', input)
for await (const event of stream) {
  if (event.type === 'content_chunk') text += event.data.chunk
}
```

## Running Tests

```bash
# From packages/svelte/
npm run test
npm run typecheck
```

## Not in Scope for v1

- Streaming store (`workflowStreamStore`, `textStreamStore`)
- Auto-cancel on component destroy
- Event-level derived stores
