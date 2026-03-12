# @agntk/logger

[![npm version](https://img.shields.io/npm/v/@agntk/logger.svg)](https://www.npmjs.com/package/@agntk/logger)
[![license](https://img.shields.io/npm/l/@agntk/logger.svg)](https://github.com/agntk/agntk/blob/main/LICENSE)

Zero-dependency structured logging with namespace filtering, file output, and SSE support.

## Install

```bash
npm install @agntk/logger
```

## Quick Start

```typescript
import { createLogger } from '@agntk/logger';

const log = createLogger('@myapp:feature');
log.info('Request processed', { userId: '123', durationMs: 45 });
log.warn('Rate limit approaching');
log.error('Failed to connect', { error: err.message });
log.debug('Cache hit', { key: 'user:123' });
```

## Namespace Filtering

```bash
DEBUG=@agntk/core:* node app.js
DEBUG=@agntk/*,-@agntk/core:verbose node app.js
```

## Transports

```typescript
import {
  createConsoleTransport,
  createFileTransport,
  createSSETransport,
  addTransport,
} from '@agntk/logger';

addTransport(createConsoleTransport({ colorize: true }));
addTransport(createFileTransport({ path: './logs/agent.log' }));
```

## Features

- **Zero dependencies** — Lightweight and fast
- **Namespace filtering** — Enable/disable loggers by pattern
- **Transports** — Console, file, and SSE output
- **Formatters** — Pretty, JSON, and SSE formats
- **Timing** — Built-in duration helpers

## Documentation

See the [main repository](https://github.com/agntk/agntk) for full documentation.

## License

MIT
