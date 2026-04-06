/**
 * @agntk/server - Server Factory
 * Creates and manages the agent HTTP server with optional WebSocket support
 */

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { createLogger } from '@agntk/logger';
import { createAgentRoutes } from './routes';
import type { AgentServerOptions } from './types';

const log = createLogger('@agntk/server');

export interface AgentServer {
  /** Hono routes instance */
  routes: ReturnType<typeof createAgentRoutes>;

  /** Start the HTTP server */
  start: () => void;

  /** Get the server port */
  port: number;
}

/**
 * Create an agent server with HTTP and WebSocket endpoints
 *
 * @example
 * ```typescript
 * import { createAgentServer } from '@agntk/server';
 * import { createAgent } from '@agntk/core';
 *
 * const agent = createAgent({ name: 'my-agent', instructions: 'You are a helpful coding assistant.' });
 * const server = createAgentServer({ agent, port: 3001 });
 * server.start();
 * ```
 *
 * @param options - Server configuration
 * @returns Server instance with routes and start method
 */
export function createAgentServer(options: AgentServerOptions = {}): AgentServer {
  const port = options.port ?? 3000;

  log.debug('Creating agent server', { port, hasAgent: !!options.agent });

  // Create agent if options provided but no agent instance
  const agent = options.agent;
  if (!agent && options.agentOptions) {
    log.warn(
      'agentOptions provided but no agent instance. Agent will need to be created separately.',
    );
  }

  // Create a base Hono app for WebSocket support
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  const routes = createAgentRoutes({
    ...options,
    agent,
    upgradeWebSocket,
  });

  // Mount the routes on the base app
  app.route('/', routes);

  const start = () => {
    const server = serve({
      fetch: app.fetch,
      port,
    });

    // Inject WebSocket handler into the HTTP server
    injectWebSocket(server);

    log.info('Agent server started', { port, url: `http://localhost:${port}` });
  };

  return {
    routes,
    start,
    port,
  };
}

/**
 * Quick start helper - creates agent and server in one call
 * @example
 * ```typescript
 * import { quickStart } from '@agntk/server';
 *
 * quickStart({ port: 3001 });
 * ```
 * @param options - Server configuration options
 * @param options.port - Port number for the server (default: 3000)
 * @param options.workspaceRoot - Root directory for the workspace
 * @returns Promise resolving to the server instance
 */
export async function quickStart(
  options: {
    port?: number;
    workspaceRoot?: string;
  } = {},
) {
  log.info('quickStart called', { options });

  const server = createAgentServer({ port: options.port });
  server.start();
  return server;
}
