/**
 * @agntk/server - Routes Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentRoutes } from '../routes';

describe('createAgentRoutes', () => {
  it('should create a Hono app', () => {
    const routes = createAgentRoutes();
    expect(routes).toBeDefined();
    expect(routes.fetch).toBeInstanceOf(Function);
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/health');
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('POST /generate', () => {
    it('should return 400 if prompt is missing', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await routes.fetch(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('prompt');
    });

    it('should return 500 if agent not configured', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello' }),
      });

      const res = await routes.fetch(req);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toContain('Agent not configured');
    });

    it('should call agent.stream and return result', async () => {
      const mockAgent = {
        stream: vi.fn().mockResolvedValue({
          fullStream: (async function* () {})(),
          text: Promise.resolve('Generated response'),
          usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
        }),
      };

      const routes = createAgentRoutes({ agent: mockAgent });

      const req = new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello' }),
      });

      const res = await routes.fetch(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.text).toBe('Generated response');
      expect(body.success).toBe(true);

      expect(mockAgent.stream).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Hello' }));
    });

    it('should pass options to agent', async () => {
      const mockAgent = {
        stream: vi.fn().mockResolvedValue({
          fullStream: (async function* () {})(),
          text: Promise.resolve('OK'),
          usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
        }),
      };

      const routes = createAgentRoutes({ agent: mockAgent });

      const req = new Request('http://localhost/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Hello',
          options: { userId: 'user-123' },
        }),
      });

      await routes.fetch(req);

      expect(mockAgent.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Hello',
          options: expect.objectContaining({ userId: 'user-123' }),
        }),
      );
    });
  });

  describe('POST /stream', () => {
    it('should return 400 if prompt is missing', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await routes.fetch(req);
      expect(res.status).toBe(400);
    });

    it('should return 500 if agent not configured', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello' }),
      });

      const res = await routes.fetch(req);
      expect(res.status).toBe(500);
    });
  });

  describe('CORS', () => {
    it('should set CORS headers', async () => {
      const routes = createAgentRoutes();

      const req = new Request('http://localhost/health', {
        headers: { Origin: 'http://example.com' },
      });

      const res = await routes.fetch(req);

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });
  });
});
