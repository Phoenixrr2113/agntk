# @agntk/server

[![npm version](https://img.shields.io/npm/v/@agntk/server.svg)](https://www.npmjs.com/package/@agntk/server)
[![license](https://img.shields.io/npm/l/@agntk/server.svg)](https://github.com/agntk/agntk/blob/main/LICENSE)

Hono-based HTTP server for [@agntk/core](https://www.npmjs.com/package/@agntk/core) agents. Exposes REST, SSE streaming, and WebSocket endpoints.

## Install

```bash
npm install @agntk/server @agntk/core
```

## Quick Start

```typescript
import { createAgentServer } from '@agntk/server';
import { createAgent } from '@agntk/core';

const agent = createAgent({ name: 'server-agent', instructions: 'You are a helpful assistant.' });
const server = createAgentServer({ agent, port: 3001 });
server.start();
// Server running at http://localhost:3001
```

## Endpoints

| Method | Path                 | Description                                             |
| ------ | -------------------- | ------------------------------------------------------- |
| `GET`  | `/health`            | Health check — returns `{ status: 'ok' }`               |
| `GET`  | `/status`            | Agent info (name, tools, model)                         |
| `GET`  | `/queue`             | Concurrency queue stats                                 |
| `GET`  | `/config`            | Read config file                                        |
| `PUT`  | `/config`            | Update config file                                      |
| `GET`  | `/logs`              | SSE stream of log entries                               |
| `POST` | `/generate`          | Synchronous generation                                  |
| `POST` | `/stream`            | SSE streaming generation                                |
| `POST` | `/chat`              | Stateful chat with SSE streaming                        |
| `GET`  | `/hooks`             | List workflow hooks (filterable by `?status=suspended`) |
| `GET`  | `/hooks/:id`         | Get specific hook details                               |
| `POST` | `/hooks/:id/resume`  | Resume a suspended workflow hook                        |
| `POST` | `/hooks/:id/reject`  | Reject a suspended workflow hook                        |
| `WS`   | `/ws/browser-stream` | Real-time browser viewport streaming                    |

### POST `/generate`

Synchronous generation — waits for the full response.

```bash
curl -X POST http://localhost:3001/generate \
  -H 'Content-Type: application/json' \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

### POST `/stream`

SSE streaming generation — streams events as they arrive.

```bash
curl -N -X POST http://localhost:3001/stream \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"messages": [{"role": "user", "content": "Tell me a story"}]}'
```

Events follow the format: `data: {"type": "text-delta", "textDelta": "Once"}`.

### POST `/chat`

Stateful chat — maintains conversation history per session.

```bash
curl -N -X POST http://localhost:3001/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "my-session", "messages": [{"role": "user", "content": "Hi"}]}'
```

## Middleware

Built-in middleware for production deployments:

```typescript
import {
  createAgentServer,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createAuthMiddleware,
} from '@agntk/server';
import { createAgent } from '@agntk/core';

const agent = createAgent({ name: 'api-agent', instructions: 'You help with API tasks.' });

const server = createAgentServer({
  agent,
  port: 3001,
  middleware: [
    createLoggingMiddleware(),
    createRateLimitMiddleware({ windowMs: 60_000, max: 100 }),
    createAuthMiddleware({ apiKey: process.env.API_KEY }),
  ],
});

server.start();
```

| Middleware                           | Description                             |
| ------------------------------------ | --------------------------------------- |
| `createLoggingMiddleware()`          | Request/response logging with duration  |
| `createRateLimitMiddleware(options)` | In-memory rate limiting per IP          |
| `createAuthMiddleware(options)`      | API key authentication (timing-safe)    |
| `createBodyLimitMiddleware(options)` | Request body size limit (default: 1 MB) |

## Custom Routes

Mount agent routes in your own Hono app:

```typescript
import { Hono } from 'hono';
import { createAgentRoutes } from '@agntk/server';
import { createAgent } from '@agntk/core';

const app = new Hono();
const agent = createAgent({ name: 'my-agent', instructions: '...' });

app.route('/agent', createAgentRoutes({ agent }));
app.get('/', (c) => c.text('My App'));

export default app;
```

## Exports

| Export                      | Description                     |
| --------------------------- | ------------------------------- |
| `createAgentServer`         | Create and start a full server  |
| `quickStart`                | One-line server setup           |
| `createAgentRoutes`         | Hono routes (for embedding)     |
| `createLoggingMiddleware`   | Request logging                 |
| `createRateLimitMiddleware` | Rate limiting                   |
| `createAuthMiddleware`      | API key auth                    |
| `createBodyLimitMiddleware` | Body size limit                 |
| `ConcurrencyQueue`          | Request queue with backpressure |
| `StreamEventBuffer`         | Buffered event delivery         |

## Documentation

See the [main repository](https://github.com/agntk/agntk) for full documentation.

## License

MIT
