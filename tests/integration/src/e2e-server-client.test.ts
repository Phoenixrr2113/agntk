import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { tool } from 'ai';
import { createAgent } from '@agntk/core';
import { createAgentServer } from '@agntk/server';
import { AgentHttpClient } from '@agntk/client';
import { createMockToolModel, createMockStreamModel } from './setup';

const E2E_PORT = 4599;

describe('E2E: Server + Client with Tools', () => {
  let server: ReturnType<typeof createAgentServer>;
  let client: AgentHttpClient;

  beforeAll(() => {
    const calculatorTool = tool({
      description: 'Perform a math calculation',
      parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply']),
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ operation, a, b }) => {
        switch (operation) {
          case 'add':
            return { result: a + b };
          case 'subtract':
            return { result: a - b };
          case 'multiply':
            return { result: a * b };
        }
      },
    });

    const model = createMockToolModel(
      [{ id: 'call-1', name: 'calculator', args: { operation: 'add', a: 5, b: 3 } }],
      'The result of 5 + 3 is 8.',
    );

    const agent = createAgent({
      name: 'e2e-calculator-agent',
      model,
      instructions: 'You are a calculator assistant.',
      tools: { calculator: calculatorTool },
      maxSteps: 3,
    });

    server = createAgentServer({
      agent,
      port: E2E_PORT,
    });

    server.start();
    client = new AgentHttpClient(`http://localhost:${E2E_PORT}`);
  });

  afterAll(() => {
    void 0;
  });

  describe('generate with tool execution', () => {
    it('should execute tool and return final result via HTTP', async () => {
      const response = await fetch(`http://localhost:${E2E_PORT}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Calculate 5 + 3' }),
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.text).toContain('8');
      expect(body.success).toBe(true);
    });

    it('should work via AgentHttpClient', async () => {
      const result = await client.generate({
        messages: [{ role: 'user', content: 'What is 5 + 3?' }],
      });

      expect(result.text).toContain('8');
      expect(result.success).toBe(true);
    });
  });

  describe('streaming with tool execution', () => {
    it('should stream events including tool-related ones', async () => {
      const response = await fetch(`http://localhost:${E2E_PORT}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ prompt: 'Calculate 5 + 3' }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should return 400 for empty prompt', async () => {
      const response = await fetch(`http://localhost:${E2E_PORT}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`http://localhost:${E2E_PORT}/unknown-route`);
      expect(response.status).toBe(404);
    });
  });
});

describe('E2E: Server with streaming-only agent', () => {
  const STREAM_PORT = 4598;
  let streamServer: ReturnType<typeof createAgentServer>;

  beforeAll(() => {
    const agent = createAgent({
      name: 'e2e-stream-agent',
      model: createMockStreamModel('Streaming response from the server agent'),
      instructions: 'You are a streaming test agent.',
      maxSteps: 1,
    });

    streamServer = createAgentServer({
      agent,
      port: STREAM_PORT,
    });

    streamServer.start();
  });

  it('should stream text deltas via SSE', async () => {
    const response = await fetch(`http://localhost:${STREAM_PORT}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ prompt: 'Stream me something' }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toContain('event:');
  });
});
