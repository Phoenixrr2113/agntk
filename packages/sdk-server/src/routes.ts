/**
 * @agntk/server - HTTP Routes
 * Hono routes for agent HTTP API with SSE streaming
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { bearerAuth } from 'hono/bearer-auth';
import { createLogger, getLogEmitter } from '@agntk/logger';
import { createLoggingMiddleware, createRateLimitMiddleware, createBodyLimitMiddleware } from './middleware';
import { ConcurrencyQueue, QueueFullError, QueueTimeoutError } from './queue';
import { StreamEventBuffer } from './stream-buffer';
import type { AgentServerOptions, DurableAgentInstance } from './types';
import { getHookRegistry, HookNotFoundError, HookNotPendingError } from '@agntk/core/advanced';
import * as fs from 'node:fs';
import * as path from 'node:path';

const log = createLogger('@agntk/server:routes');

/**
 * Chat message format
 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request body for generate endpoint
 */
interface GenerateRequest {
  prompt?: string;
  messages?: ChatMessage[];
  options?: {
    userId?: string;
    sessionId?: string;
    enabledTools?: string[];
    workspaceRoot?: string;
  };
}

/**
 * Request body for stream endpoint
 */
interface StreamRequest {
  prompt?: string;
  messages?: ChatMessage[];
  options?: GenerateRequest['options'];
}

/**
 * Create agent HTTP routes with Hono
 * 
 * @param serverOptions - Server configuration options
 * @returns Hono app with agent routes
 */
export function createAgentRoutes(serverOptions: AgentServerOptions = {}) {
  const app = new Hono();

  // Configure CORS
  const corsOrigin = serverOptions.corsOrigin ?? '*';
  app.use('/*', cors({
    origin: Array.isArray(corsOrigin) ? corsOrigin : corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-workflow-run-id', 'Last-Event-ID'],
    exposeHeaders: ['x-workflow-run-id'],
  }));

  // Configure Middleware
  app.use('*', createLoggingMiddleware());
  app.use('*', createBodyLimitMiddleware({ maxSize: serverOptions.maxBodySize }));

  if (!serverOptions.apiKey) {
    log.warn(
      '⚠️  No apiKey configured — all server endpoints are publicly accessible. ' +
      'Set apiKey in AgentServerOptions for production use.',
    );
  }

  // Rate limiter shared instance
  const rateLimiter = createRateLimitMiddleware({ windowMs: 60000, max: 100 });

  // Auth middleware: prefer Hono's built-in bearerAuth over our custom impl.
  // Accepts both `Authorization: Bearer <token>` and `x-api-key: <token>`.
  const authMiddleware = serverOptions.apiKey
    ? bearerAuth({
      verifyToken: (token) => token === serverOptions.apiKey,
    })
    : null;

  // Apply rate limiting to all agent endpoints
  app.use('/generate', rateLimiter);
  app.use('/stream', rateLimiter);
  app.use('/chat', rateLimiter);

  // Apply auth to ALL sensitive endpoints when apiKey is configured.
  // Previously only /generate, /stream, /chat were protected — this extends
  // coverage to config r/w, logs streaming, and hook approval endpoints.
  if (authMiddleware) {
    const PROTECTED_ROUTES = [
      '/generate', '/stream', '/chat',
      '/status', '/config',
      '/logs',
      '/hooks', '/hooks/*',
      '/queue',
    ];
    for (const route of PROTECTED_ROUTES) {
      app.use(route, authMiddleware);
    }
  }

  // Create concurrency queue
  const queue = serverOptions.queue ? new ConcurrencyQueue(serverOptions.queue) : null;

  // Create stream event buffer for resumable streams
  const streamBuffer = new StreamEventBuffer(serverOptions.streamBuffer);

  // Queue stats endpoint
  app.get('/queue', (c) => c.json(queue?.getStats() ?? { active: 0, queued: 0, available: Infinity }));

  // Health check endpoint
  app.get('/health', (c) => c.json({ 
    status: 'ok', 
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // ============================================================================
  // Dashboard Endpoints
  // ============================================================================

  // Status endpoint - agent info
  app.get('/status', (c) => {
    const agent = serverOptions.agent as {
      name?: string;
      tools?: { name: string }[];
      model?: string;
    } | undefined;

    return c.json({
      name: agent?.name ?? 'unknown',
      tools: agent?.tools?.map(t => t.name) ?? [],
      model: agent?.model ?? 'unknown',
      version: '0.1.0',
    });
  });

  // Config endpoint - GET
  app.get('/config', async (c) => {
    try {
      const configPath = serverOptions.configPath ?? path.join(process.cwd(), 'agent-sdk.config.yaml');
      if (!fs.existsSync(configPath)) {
        return c.text('# No config file found', 200);
      }
      const content = fs.readFileSync(configPath, 'utf-8');
      return c.text(content, 200, { 'Content-Type': 'text/yaml' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Config endpoint - PUT
  app.put('/config', async (c) => {
    try {
      const configPath = serverOptions.configPath ?? path.join(process.cwd(), 'agent-sdk.config.yaml');
      const body = await c.req.text();
      fs.writeFileSync(configPath, body, 'utf-8');
      log.info('Config updated', { path: configPath });
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Logs endpoint - SSE stream
  app.get('/logs', (c) => {
    return streamSSE(c, async (stream) => {
      const emitter = getLogEmitter();

      const handler = (logEntry: unknown) => {
        stream.writeSSE({ data: JSON.stringify(logEntry) });
      };

      emitter.on('log', handler);

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: 'heartbeat', data: '' });
      }, 30000);

      // Wait for client disconnect
      try {
        await new Promise((resolve) => {
          c.req.raw.signal.addEventListener('abort', resolve);
        });
      } finally {
        clearInterval(heartbeat);
        emitter.off('log', handler);
      }
    });
  });

  // ============================================================================
  // Agent Endpoints
  // ============================================================================

  // Generate endpoint - synchronous completion
  app.post('/generate', async (c) => {
    try {
      const body = await c.req.json<GenerateRequest>();
      
      const prompt = body.prompt ?? body.messages?.map(m => `${m.role}: ${m.content}`).join('\n') ?? '';
      
      if (!prompt) {
        return c.json({ error: 'prompt or messages is required' }, 400);
      }

      const agent = serverOptions.agent;
      if (!agent) {
        return c.json({ 
          error: 'Agent not configured. Provide agent or agentOptions to createAgentServer.',
        }, 500);
      }

      // Acquire queue slot
      if (queue) {
        try {
          await queue.acquire();
        } catch (error) {
          if (error instanceof QueueFullError) {
            return c.json({ error: error.message }, 503);
          }
          if (error instanceof QueueTimeoutError) {
            return c.json({ error: error.message }, 408);
          }
          throw error;
        }
      }

      const agentInstance = agent as {
        stream: (opts: { prompt: string; options?: unknown }) => Promise<{
          fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
          text: Promise<string>;
          usage: Promise<unknown>;
        }>;
      };

      try {
        const result = await agentInstance.stream({
          prompt,
          options: body.options,
        });

        // Drain the stream to completion
        for await (const _chunk of result.fullStream) { /* drain */ }
        const text = await result.text;

        return c.json({
          text,
          success: true,
        });
      } finally {
        queue?.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message, success: false }, 500);
    }
  });

  // Stream endpoint - SSE streaming (uses generate internally, streams response)
  app.post('/stream', async (c) => {
    try {
      const body = await c.req.json<StreamRequest>();

      // Check for reconnection headers
      const reconnectRunId = c.req.header('x-workflow-run-id');
      const lastEventId = c.req.header('Last-Event-ID');

      // Handle reconnection: replay buffered events
      if (reconnectRunId && streamBuffer.has(reconnectRunId)) {
        log.info('Resumable stream reconnection', { runId: reconnectRunId, lastEventId });

        return streamSSE(c, async (stream) => {
          // Set the run-id header for client tracking
          c.header('x-workflow-run-id', reconnectRunId);

          const events = lastEventId
            ? streamBuffer.getEventsAfter(reconnectRunId, lastEventId)
            : streamBuffer.getAllEvents(reconnectRunId);

          log.info('Replaying buffered events', { runId: reconnectRunId, count: events.length });

          for (const buffered of events) {
            await stream.writeSSE({
              id: buffered.id,
              event: buffered.event,
              data: buffered.data,
            });
          }

          // If the run is complete, send done event
          if (streamBuffer.isCompleted(reconnectRunId)) {
            await stream.writeSSE({ event: 'done', data: '' });
          }
          // Otherwise, the stream stays open for live events
          // (in a production impl, this would subscribe to live updates)
        });
      }

      const prompt = body.prompt ?? body.messages?.map(m => `${m.role}: ${m.content}`).join('\n') ?? '';
      
      if (!prompt) {
        return c.json({ error: 'prompt or messages is required' }, 400);
      }

      const agent = serverOptions.agent;
      if (!agent) {
        return c.json({ 
          error: 'Agent not configured. Provide agent or agentOptions to createAgentServer.',
        }, 500);
      }

      // Duck-type check for durable agent
      const durableAgent = agent as DurableAgentInstance;
      const isDurable = typeof durableAgent.workflowRunId === 'string' || durableAgent.isWorkflowActive === true;
      const runId = isDurable ? (durableAgent.workflowRunId ?? crypto.randomUUID()) : undefined;

      const agentInstance = agent as {
        stream: (opts: { prompt: string; options?: unknown }) => Promise<{
          fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
          text: Promise<string>;
          usage: Promise<unknown>;
        }>;
      };

      // Set run-id header if durable
      if (runId) {
        c.header('x-workflow-run-id', runId);
        log.info('Durable stream started', { runId });
      }

      return streamSSE(c, async (stream) => {
        try {
          const result = await agentInstance.stream({
            prompt,
            options: body.options,
          });

          // Stream events from the agent's fullStream
          for await (const chunk of result.fullStream) {
            if (chunk.type === 'text-delta') {
              const textDelta = (chunk as { textDelta?: string }).textDelta ?? '';
              const eventData = JSON.stringify({ type: 'text-delta', textDelta });
              const eventId = runId ? streamBuffer.store(runId, 'text-delta', eventData) : undefined;

              await stream.writeSSE({
                id: eventId,
                event: 'text-delta',
                data: eventData,
              });
            }
          }

          // Send final
          const text = await result.text;
          const doneData = JSON.stringify({ text });
          if (runId) {
            streamBuffer.store(runId, 'done', doneData);
            streamBuffer.markCompleted(runId);
          }

          await stream.writeSSE({
            event: 'done',
            data: doneData,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Stream error';
          log.error('Stream error', { error: message });
          const errorData = JSON.stringify({ error: message });
          if (runId) {
            streamBuffer.store(runId, 'error', errorData);
          }
          await stream.writeSSE({
            event: 'error',
            data: errorData,
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Chat endpoint (stateful with session)
  app.post('/chat', async (c) => {
    try {
      const body = await c.req.json<StreamRequest & { sessionId?: string }>();
      
      const prompt = body.prompt ?? body.messages?.map(m => `${m.role}: ${m.content}`).join('\n') ?? '';
      
      if (!prompt) {
        return c.json({ error: 'prompt or messages is required' }, 400);
      }

      const agent = serverOptions.agent;
      if (!agent) {
        return c.json({ error: 'Agent not configured' }, 500);
      }

      const agentInstance = agent as {
        stream: (opts: { prompt: string; options?: unknown }) => Promise<{
          fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
          text: Promise<string>;
        }>;
      };

      return streamSSE(c, async (stream) => {
        const response = await agentInstance.stream({
          prompt,
          options: { ...body.options, sessionId: body.sessionId },
        });

        for await (const chunk of response.fullStream) {
          await stream.writeSSE({ 
            event: chunk.type, 
            data: JSON.stringify(chunk),
          });
        }

        await stream.writeSSE({ event: 'done', data: '' });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ============================================================================
  // Hook Endpoints (Human-in-the-Loop)
  // ============================================================================

  // List all hooks (optionally filtered by status)
  app.get('/hooks', (c) => {
    const registry = getHookRegistry();
    const status = c.req.query('status');
    const hooks = status
      ? registry.list(status as 'pending' | 'resolved' | 'rejected' | 'timed_out')
      : registry.list();

    return c.json({
      hooks: hooks.map((h) => ({
        id: h.id,
        name: h.name,
        description: h.description,
        status: h.status,
        payload: h.payload,
        createdAt: h.createdAt.toISOString(),
        resolvedAt: h.resolvedAt?.toISOString(),
        timeoutMs: h.timeoutMs,
      })),
      total: hooks.length,
    });
  });

  // Get a specific hook by ID
  app.get('/hooks/:id', (c) => {
    const registry = getHookRegistry();
    const hook = registry.get(c.req.param('id'));

    if (!hook) {
      return c.json({ error: `Hook "${c.req.param('id')}" not found` }, 404);
    }

    return c.json({
      id: hook.id,
      name: hook.name,
      description: hook.description,
      status: hook.status,
      payload: hook.payload,
      result: hook.result,
      createdAt: hook.createdAt.toISOString(),
      resolvedAt: hook.resolvedAt?.toISOString(),
      timeoutMs: hook.timeoutMs,
    });
  });

  // Resume a suspended hook with a payload
  app.post('/hooks/:id/resume', async (c) => {
    try {
      const hookId = c.req.param('id');
      const body = await c.req.json<{ payload?: unknown }>().catch(() => ({} as { payload?: unknown }));
      const registry = getHookRegistry();

      log.info('Hook resume requested', { hookId });

      const hook = await registry.resume(hookId, body.payload);

      return c.json({
        success: true,
        hook: {
          id: hook.id,
          name: hook.name,
          status: hook.status,
          resolvedAt: hook.resolvedAt?.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof HookNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof HookNotPendingError) {
        return c.json({ error: error.message }, 409);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Reject a suspended hook
  app.post('/hooks/:id/reject', async (c) => {
    try {
      const hookId = c.req.param('id');
      const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
      const registry = getHookRegistry();

      log.info('Hook rejection requested', { hookId });

      const hook = registry.reject(hookId, body.reason ?? 'Rejected by user');

      return c.json({
        success: true,
        hook: {
          id: hook.id,
          name: hook.name,
          status: hook.status,
          resolvedAt: hook.resolvedAt?.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof HookNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof HookNotPendingError) {
        return c.json({ error: error.message }, 409);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // ============================================================================
  // Browser Viewport Streaming (WebSocket)
  // ============================================================================

  const upgradeWebSocket = serverOptions.upgradeWebSocket;

  if (upgradeWebSocket) {
    app.get(
      '/ws/browser-stream',
      upgradeWebSocket((_c: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let streamEmitter: any = null;

        return {
          onOpen: (_evt: unknown, ws: any) => {
            log.info('Browser stream WebSocket connected');

            // Dynamically import to avoid hard dependency if browser tool isn't used
            import('@agntk/core/advanced').then(({ createBrowserStream }) => {
              const streamConfig = {
                fps: serverOptions.browserStream?.fps ?? 2,
                quality: serverOptions.browserStream?.quality ?? 60,
              };

              streamEmitter = createBrowserStream(streamConfig);

              // Forward frames to WebSocket client
              streamEmitter.on('frame', (frame: any) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'frame',
                    data: frame.data,
                    timestamp: frame.timestamp,
                    sequence: frame.sequence,
                  }));
                }
              });

              // Forward errors
              streamEmitter.on('error', (errorMsg: string) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'error', error: errorMsg }));
                }
              });

              // Notify started
              streamEmitter.on('started', (config: any) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'started', config }));
                }
              });

              // Notify stopped
              streamEmitter.on('stopped', () => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'stopped' }));
                }
              });

              // Input acknowledgments
              streamEmitter.on('input-ack', (inputType: string, success: boolean, error?: string) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'input-ack', inputType, success, error }));
                }
              });

              // Auto-start the stream
              streamEmitter.start().catch((err: Error) => {
                log.error('Failed to start browser stream', { error: err.message });
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'error', error: `Failed to start: ${err.message}` }));
                }
              });
            }).catch((err: Error) => {
              log.error('Failed to load browser stream module', { error: err.message });
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', error: 'Browser stream module unavailable' }));
              }
            });
          },

          onMessage: (evt: { data: unknown }, ws: any) => {
            if (!streamEmitter) return;

            try {
              const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
              const msg = JSON.parse(raw) as Record<string, unknown>;

              switch (msg.type) {
                case 'click':
                  streamEmitter.injectInput({
                    type: 'click',
                    x: msg.x as number,
                    y: msg.y as number,
                  });
                  break;

                case 'type':
                  streamEmitter.injectInput({
                    type: 'type',
                    text: msg.text as string,
                    selector: msg.selector as string | undefined,
                  });
                  break;

                case 'press':
                  streamEmitter.injectInput({
                    type: 'press',
                    key: msg.key as string,
                  });
                  break;

                case 'scroll':
                  streamEmitter.injectInput({
                    type: 'scroll',
                    direction: msg.direction as 'up' | 'down' | 'left' | 'right',
                    pixels: msg.pixels as number | undefined,
                  });
                  break;

                case 'fill':
                  streamEmitter.injectInput({
                    type: 'fill',
                    selector: msg.selector as string,
                    text: msg.text as string,
                  });
                  break;

                case 'config':
                  streamEmitter.setConfig({
                    fps: msg.fps as number | undefined,
                    quality: msg.quality as number | undefined,
                    width: msg.width as number | undefined,
                    height: msg.height as number | undefined,
                  });
                  if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'config-ack', config: streamEmitter.getConfig() }));
                  }
                  break;

                case 'stop':
                  streamEmitter.stop();
                  break;

                case 'start':
                  streamEmitter.start();
                  break;

                default:
                  log.warn('Unknown browser stream message type', { type: msg.type });
              }
            } catch (err) {
              log.error('Failed to parse browser stream message', { error: String(err) });
            }
          },

          onClose: (_evt: unknown, _ws: any) => {
            log.info('Browser stream WebSocket disconnected');
            if (streamEmitter) {
              streamEmitter.stop();
              streamEmitter.removeAllListeners();
              streamEmitter = null;
            }
          },

          onError: (evt: unknown, _ws: any) => {
            log.error('Browser stream WebSocket error', { error: String(evt) });
            if (streamEmitter) {
              streamEmitter.stop();
              streamEmitter.removeAllListeners();
              streamEmitter = null;
            }
          },
        };
      }),
    );
  }

  return app;
}
