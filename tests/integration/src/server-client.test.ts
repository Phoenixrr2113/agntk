import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAgent } from '@agntk/core';
import { createAgentServer } from '@agntk/server';
import { AgentHttpClient } from '@agntk/client';
import { createMockModel } from './setup';

const TEST_PORT = 4567;

describe('Server + Client', () => {
  let server: ReturnType<typeof createAgentServer>;
  let client: AgentHttpClient;

  beforeAll(() => {
    const agent = createAgent({
      name: 'server-test-agent',
      model: createMockModel('Hello from server agent!'),
      instructions: 'You are a test agent running on a server.',
      maxSteps: 1,
    });

    server = createAgentServer({
      agent,
      port: TEST_PORT,
    });

    server.start();
    void 0;
    client = new AgentHttpClient(`http://localhost:${TEST_PORT}`);
  });

  afterAll(() => {
    void 0;
  });

  describe('Health endpoint', () => {
    it('should return status ok', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      expect(response.ok).toBe(true);

      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('POST /generate', () => {
    it('should generate text via the agent', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Say hello' }),
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.text).toBe('Hello from server agent!');
      expect(body.success).toBe(true);
    });

    it('should return 400 when no prompt provided', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /stream', () => {
    it('should stream SSE events', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ prompt: 'Say hello' }),
      });

      expect(response.ok).toBe(true);

      const text = await response.text();

      expect(text).toContain('event: text-delta');
      expect(text).toContain('event: done');
    });
  });

  describe('AgentHttpClient.generate()', () => {
    it('should round-trip through client → server → agent', async () => {
      const result = await client.generate({
        messages: [{ role: 'user', content: 'Say hello' }],
      });

      expect(result.text).toBe('Hello from server agent!');
      expect(result.success).toBe(true);
    });
  });

  describe('AgentHttpClient.generateStream()', () => {
    it('should stream events through client', async () => {
      const events: Array<{ type: string; [key: string]: unknown }> = [];

      for await (const event of client.generateStream({
        messages: [{ role: 'user', content: 'Say hello' }],
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      const textEvents = events.filter((e) => e.type === 'text-delta');
      expect(textEvents.length).toBeGreaterThan(0);
    });
  });
});
