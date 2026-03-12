# @agntk/client

[![npm version](https://img.shields.io/npm/v/@agntk/client.svg)](https://www.npmjs.com/package/@agntk/client)
[![license](https://img.shields.io/npm/l/@agntk/client.svg)](https://github.com/agntk/agntk/blob/main/LICENSE)

HTTP/WebSocket client for connecting to an [@agntk/server](https://www.npmjs.com/package/@agntk/server) instance.

## Install

```bash
npm install @agntk/client
```

## Quick Start

### HTTP — Synchronous

```typescript
import { AgentHttpClient } from '@agntk/client';

const client = new AgentHttpClient('http://localhost:3001');

const result = await client.generate({
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(result);
```

### HTTP — Streaming (SSE)

```typescript
for await (const event of client.generateStream({
  messages: [{ role: 'user', content: 'Tell me a story' }],
})) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}
```

### Chat Client — Callbacks + Session Management

```typescript
import { AgentHttpClient, ChatClient, SessionManager } from '@agntk/client';

const http = new AgentHttpClient('http://localhost:3001');
const sessions = new SessionManager();
const chat = new ChatClient(http, { sessionManager: sessions });

await chat.stream(
  { messages: [{ role: 'user', content: 'Summarize this repo' }], sessionId: 'session-1' },
  {
    onTextDelta: (text) => process.stdout.write(text),
    onToolCall: (id, name, args) => console.log(`Tool: ${name}`),
    onToolResult: (id, name, result) => console.log(`Result: ${name}`),
    onComplete: ({ text, usage }) => console.log('\nDone', usage),
    onError: (err) => console.error(err),
  },
);
```

### WebSocket Client

```typescript
import { AgentWebSocketClient } from '@agntk/client';

const ws = new AgentWebSocketClient({
  url: 'ws://localhost:3001/ws',
  reconnect: true,
  maxReconnectAttempts: 5,
});

await ws.connect();

ws.onConnectionStateChange((state) => {
  console.log('Connection:', state); // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
});

ws.send(
  { role: 'user', content: 'Hello via WebSocket' },
  {
    onTextDelta: (text) => process.stdout.write(text),
    onComplete: ({ text }) => console.log('\nDone'),
    onError: (err) => console.error(err),
  },
);
```

### Resumable Streams

Durable agents return a workflow run ID. Use it to reconnect after a disconnect:

```typescript
const stream = client.generateStream(request);

for await (const event of stream) {
  if (event.type === 'text-delta') process.stdout.write(event.textDelta);
}

// After disconnect, resume from where you left off:
const metadata = client.lastStreamMetadata;
const resumed = client.generateStream(request, {
  workflowRunId: metadata?.workflowRunId,
  lastEventId: metadata?.lastEventId,
});
```

## API Reference

### `AgentHttpClient`

| Method                              | Returns                       | Description                                      |
| ----------------------------------- | ----------------------------- | ------------------------------------------------ |
| `generate(request)`                 | `Promise<ChatResponse>`       | Synchronous generation                           |
| `generateStream(request, options?)` | `AsyncGenerator<StreamEvent>` | SSE streaming generation                         |
| `getSession(sessionId)`             | `Promise<SessionResponse>`    | Get session details                              |
| `getHistory(sessionId)`             | `Promise<HistoryResponse>`    | Get session message history                      |
| `lastStreamMetadata`                | `StreamMetadata \| undefined` | Workflow run ID + last event ID for reconnection |

### `ChatClient`

| Method                                 | Returns                       | Description                                 |
| -------------------------------------- | ----------------------------- | ------------------------------------------- |
| `stream(request, callbacks, options?)` | `Promise<void>`               | Stream with callbacks and auto-reconnection |
| `lastStreamMetadata`                   | `StreamMetadata \| undefined` | Metadata from last stream                   |

### `AgentWebSocketClient`

| Method                             | Returns           | Description                             |
| ---------------------------------- | ----------------- | --------------------------------------- |
| `connect()`                        | `Promise<void>`   | Open WebSocket connection               |
| `send(message, callbacks)`         | `void`            | Send message and handle response events |
| `getState()`                       | `ConnectionState` | Current connection state                |
| `onConnectionStateChange(handler)` | `void`            | Listen for state changes                |
| `disconnect()`                     | `void`            | Close connection                        |

### Stream Event Types

| Event         | Fields                             | Description            |
| ------------- | ---------------------------------- | ---------------------- |
| `text-delta`  | `textDelta`                        | Incremental text chunk |
| `tool-call`   | `toolCallId`, `toolName`, `args`   | Tool invocation        |
| `tool-result` | `toolCallId`, `toolName`, `result` | Tool response          |
| `step-start`  | `stepIndex`                        | Tool loop step began   |
| `step-finish` | `stepIndex`, `finishReason`        | Tool loop step ended   |
| `finish`      | `text`, `usage`                    | Generation complete    |
| `error`       | `error`                            | Error occurred         |

## Documentation

See the [main repository](https://github.com/agntk/agntk) for full documentation.

## License

MIT
