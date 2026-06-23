# @jixi/node

## What This Package Does

Server-side Jixi client for Node.js backends: Express, NestJS, serverless functions,
queues, workers, webhooks, and API routes.

Use this package on the server to:
1. Generate short-lived session tokens for browser clients.
2. Execute workflows server-side using inherited `@jixi/js` methods.
3. Consume workflow and audio SSE streams from backend code.
4. Own workflow definitions, prompts, and tests in backend repos.

This package is separate from `@jixi/react` by runtime context, not by feature tier:

| Package | Runs in | Typical project |
|---------|---------|-----------------|
| `@jixi/react` | Browser | React SPA or separated frontend |
| `@jixi/node` | Server | Node API, worker, queue, webhook, serverless function |
| `@jixi/next` | Future mixed runtime | Next.js, Remix, full-stack meta-frameworks |

`@jixi/node` never reimplements wire protocol, SSE parsing, token caching, audio
transport, or error handling. Those concerns live entirely in `@jixi/js`.

## Public API

Exported from `src/index.ts`.

### `JixiNodeClient`

Extends `JixiClient` from `@jixi/js`. All core runtime methods are inherited:

```ts
runWorkflow<TIn, TOut>(workflowName, input, options?)
runWorkflowStream<TIn>(workflowName, input, options?)
getWorkflowRunEvents(workflowName, runId, options?)
startAudioStream(appId, options?)
startAudioStreamHttp(appId, options?)
getAudioSessionEvents(appId, sessionId, options?)
```

Constructor config extends `JixiClientConfig` with:

```ts
type JixiNodeConfig = JixiClientConfig & {
  secret?: string
}
```

Example:

```ts
import { JixiNodeClient } from '@jixi/node'

const client = new JixiNodeClient({
  apiKey: process.env.JIXI_API_KEY,
  secret: process.env.JIXI_SECRET,
})
```

Set `JIXI_API_KEY` and `JIXI_SECRET` in the server environment. `baseUrl`
defaults to `https://api.jixi.ai`.

### `createSessionToken(secret, options)`

Creates a short-lived JWT session token for browser clients.

```ts
const token = await createSessionToken(process.env.JIXI_SECRET!, {
  userId: user.id,
  expiresIn: 300,
  permissions: {
    workflows: ['support_answer'],
    readOnly: true,
  },
})
```

`SessionOptions`:

```ts
type SessionOptions = {
  userId: string
  permissions?: {
    workflows?: string[]
    readOnly?: boolean
  }
  expiresIn?: number
}
```

- `expiresIn` is seconds.
- Default `expiresIn` is `300` seconds.
- The JWT is signed with HS256 using Node `crypto`.
- Payload includes `sub`, `userId`, `iat`, `exp`, and optional `permissions`.

You can also call `client.createSessionToken(options)` when the client was
constructed with `secret`.

## Backend Usage

### Mint a browser session token

```ts
app.post('/api/jixi/session', async (req, res) => {
  const token = await client.createSessionToken({
    userId: req.user.id,
    expiresIn: 300,
    permissions: { readOnly: true },
  })

  res.json({ token })
})
```

The browser app then uses `@jixi/react` with `sessionTokenProvider`.

### Run a workflow from an API handler

```ts
app.post('/api/support-answer', async (req, res) => {
  const result = await client.runWorkflow('support_answer', req.body)
  res.json(result)
})
```

### Consume a server-side stream

```ts
const stream = await client.runWorkflowStream('support_answer', payload)

for await (const event of stream) {
  if (event.type === 'content_chunk') {
    // Pipe partial output, enqueue follow-up work, or log progress.
  }

  if (event.type === 'workflow_completed') {
    // React to completion.
  }
}
```

## Package Separation and Repo Ownership

A common setup has a React frontend repo and Node backend repo connected to the
same Jixi app. Each repo can run `jixi init` independently and maintain its own
local `jixi.yml`, prompt files, test files, and `AGENTS.md`.

The backend is usually the source of truth for workflow definitions, prompts,
and tests. The frontend usually consumes workflows and pulls shared app state.
This is a team convention, not a technical enforcement.

When multiple repos point at the same Jixi app, use pull-before-push discipline:
run `jixi pull` before making workflow or prompt changes, and `jixi push` after.
Avoid having frontend and backend repos both push edits to the same workflow; the
last push wins.

`AGENTS.md` files are scoped to each repo and never conflict with each other.

## Internal Patterns

- Keep `JixiNodeClient` thin. It should extend `JixiClient` and add only
  server-specific helpers.
- Do not add HTTP request logic to this package. Put protocol changes in
  `@jixi/js`.
- Do not add SSE parser, token cache, reconnect, audio transport, or error
  mapping logic here. Use inherited `@jixi/js` behavior.
- Keep session-token signing dependency-free unless there is a concrete reason
  to introduce a runtime dependency.
- Node.js 18+ is the minimum runtime.

## Running Tests

```bash
# From packages/node/
npm run test
npm run typecheck
npm run build
```

Tests live in `src/__tests__/` and should cover only Node-specific behavior:
session token signing, exports, and `JixiNodeClient` server helpers. Inherited
workflow, SSE, audio, auth retry, and request behavior is tested in `@jixi/js`.

## Known Constraints

- `JixiNodeClient` construction still follows `@jixi/js` auth rules: provide
  `apiKey` or `sessionTokenProvider`.
- `secret` is required only for creating session tokens.
- `@jixi/node` is for server code. Do not use it in browser bundles.
- `@jixi/next` is a future package for mixed client/server frameworks; do not
  fold that behavior into `@jixi/node`.
