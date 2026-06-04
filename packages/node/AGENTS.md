# @jixi/node

## What This Package Does

Server-side Jixi client. Extends `JixiClient` from `@jixi/js` for Node.js backends.

Use this package in Node.js backends (API routes, serverless functions) to:
1. Execute workflows server-side using `runWorkflow` / `runWorkflowStream` (inherited from `JixiClient`)

## Public API

Exported from `src/index.ts`.

### `JixiNodeClient`

Extends `JixiClient`. All methods from `@jixi/js` are available (`runWorkflow`, `runWorkflowStream`).

```ts
const client = new JixiNodeClient({
  apiKey: process.env.JIXI_API_KEY,
  secret: process.env.JIXI_SECRET,
})
```

Constructor config extends `JixiClientConfig` with:
- `secret?: string` — used to sign session tokens

Set `JIXI_API_KEY` in the server environment. Create keys at https://app.jixi.ai/security. `baseUrl` defaults to `https://api.jixi.ai`.

## Running Tests

```bash
# From packages/node/
npm run test
npm run typecheck
```

## Inherited Behavior

All wire protocol, SSE parsing, token management, and error handling is inherited from `@jixi/js`. See `packages/js/AGENTS.md` for those details.
