# @jixi/vue

## What This Package Does

Vue 3 composables for Jixi. Provides provide/inject-based client provisioning and a basic non-streaming workflow composable. This is a minimal v1 implementation — streaming is not yet implemented here.

**Requires Vue 3+.**

All wire protocol, SSE, auth, and error handling lives in `@jixi/js`. This package is a thin Vue-idiomatic wrapper.

## Public API

Exported from `src/index.ts`.

### `provideJixi(config?: JixiConfig): JixiClient`

Call once in a parent component (e.g. `App.vue`) to create a `JixiClient` and make it available to all descendants via Vue's `provide`/`inject`. Returns the client instance.

Uses a `Symbol('jixi')` key internally — do not use `inject` directly; use `injectJixi()`.

### `injectJixi(): JixiClient`

Retrieves the client from the nearest `provideJixi` ancestor. Throws if called outside a providing ancestor.

### `useJixi(): JixiClient`

Convenience alias for `injectJixi()`. Returns the `JixiClient` for direct use.

### `useWorkflow<T>(payload: WorkflowPayload)`

Non-streaming composable. Wraps `JixiClient.runWorkflow`.

```ts
const { data, loading, error, run } = useWorkflow<Result>(payload)
```

- `data` — `Ref<WorkflowResult<T> | null>`
- `loading` — `Ref<boolean>`
- `error` — `Ref<Error | null>`
- `run()` — executes the workflow

## For Streaming

Streaming composables are not yet implemented in `@jixi/vue`. For streaming in Vue, use `@jixi/js` directly:

```ts
const client = injectJixi()
const stream = await client.runWorkflowStream('my_workflow', input)
for await (const event of stream) { ... }
```

## Running Tests

```bash
# From packages/vue/
npm run test
npm run typecheck
```

## Not in Scope for v1

- Streaming composable (`useJixiStream`, `useJixiTextStream`)
- Auto-cancel on component unmount
- Typed event-level composables
