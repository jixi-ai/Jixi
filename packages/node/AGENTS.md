# @jixi/node

## What This Package Does

Server-side Jixi client. Extends `JixiClient` from `@jixi/js` with one additional capability: `createSessionToken()`, which lets a backend issue short-lived tokens that browser clients can use with `sessionTokenProvider`.

Use this package in Node.js backends (API routes, serverless functions) to:
1. Execute workflows server-side using `runWorkflow` / `runWorkflowStream` (inherited from `JixiClient`)
2. Issue scoped session tokens for browser clients

## Public API

Exported from `src/index.ts`.

### `JixiNodeClient`

Extends `JixiClient`. All methods from `@jixi/js` are available (`runWorkflow`, `runWorkflowStream`).

```ts
const client = new JixiNodeClient({
  baseUrl: 'https://api.jixi.ai',
  apiKey: process.env.JIXI_API_KEY,
  secret: process.env.JIXI_SECRET,
})
```

Constructor config extends `JixiClientConfig` with:
- `secret?: string` — used to sign session tokens

### `createSessionToken(secret, options): Promise<string>`

Issues a short-lived session token for a browser client.

```ts
const token = await client.createSessionToken({
  userId: 'user_123',
  permissions: { workflows: ['support_answer'], readOnly: false },
  expiresIn: 300,  // seconds
})
```

`options` shape (`SessionOptions`):
```ts
{
  userId: string
  permissions?: ScopedPermissions
  expiresIn?: number
}

type ScopedPermissions = {
  workflows?: string[]   // allowlist of workflow names
  readOnly?: boolean
}
```

**Current status: `createSessionToken` is a stub** (`throw new Error('Not implemented')`). Implementation goes in `src/session.ts`.

## Implementation Note

When implementing `session.ts`, it should sign a JWT or similar structure using `secret` and encode `userId`, `permissions`, and expiry. The token is then passed by the browser client as the return value of `sessionTokenProvider`.

## Running Tests

```bash
# From packages/node/
npm run test
npm run typecheck
```

## Inherited Behavior

All wire protocol, SSE parsing, token management, and error handling is inherited from `@jixi/js`. See `packages/js/AGENTS.md` for those details.
