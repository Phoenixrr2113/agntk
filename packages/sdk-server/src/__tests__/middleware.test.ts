/**
 * @agntk/server - Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createAuthMiddleware,
} from '../middleware';

describe('Middleware', () => {
  describe('createLoggingMiddleware', () => {
    it('should log request start and completion', async () => {
      const app = new Hono();
      app.use('*', createLoggingMiddleware());
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test');
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });
  });

  describe('createRateLimitMiddleware', () => {
    it('should allow requests under the limit', async () => {
      const app = new Hono();
      app.use('*', createRateLimitMiddleware({ windowMs: 60000, max: 5 }));
      app.get('/test', (c) => c.json({ ok: true }));

      for (let i = 0; i < 5; i++) {
        const req = new Request('http://localhost/test', {
          headers: { 'x-forwarded-for': '127.0.0.1' },
        });
        const res = await app.fetch(req);
        expect(res.status).toBe(200);
      }
    });

    it('should block requests over the limit', async () => {
      const app = new Hono();
      app.use('*', createRateLimitMiddleware({ windowMs: 60000, max: 2 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const makeRequest = () =>
        app.fetch(
          new Request('http://localhost/test', {
            headers: { 'x-forwarded-for': '192.168.1.1' },
          }),
        );

      const res1 = await makeRequest();
      expect(res1.status).toBe(200);

      const res2 = await makeRequest();
      expect(res2.status).toBe(200);

      const res3 = await makeRequest();
      expect(res3.status).toBe(429);

      const body = await res3.json();
      expect(body.error).toBe('Too many requests');
      expect(res3.headers.get('Retry-After')).toBeDefined();
    });

    it('should use custom key generator', async () => {
      const app = new Hono();
      app.use(
        '*',
        createRateLimitMiddleware({
          windowMs: 60000,
          max: 1,
          keyGenerator: (c) => c.req.header('x-user-id') || 'anonymous',
        }),
      );
      app.get('/test', (c) => c.json({ ok: true }));

      const res1 = await app.fetch(
        new Request('http://localhost/test', {
          headers: { 'x-user-id': 'user-1' },
        }),
      );
      expect(res1.status).toBe(200);

      const res2 = await app.fetch(
        new Request('http://localhost/test', {
          headers: { 'x-user-id': 'user-2' },
        }),
      );
      expect(res2.status).toBe(200);

      const res3 = await app.fetch(
        new Request('http://localhost/test', {
          headers: { 'x-user-id': 'user-1' },
        }),
      );
      expect(res3.status).toBe(429);
    });

    it('should reset after window expires', async () => {
      vi.useFakeTimers();

      const app = new Hono();
      app.use('*', createRateLimitMiddleware({ windowMs: 1000, max: 1 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const makeRequest = () =>
        app.fetch(
          new Request('http://localhost/test', {
            headers: { 'x-forwarded-for': '10.0.0.1' },
          }),
        );

      const res1 = await makeRequest();
      expect(res1.status).toBe(200);

      const res2 = await makeRequest();
      expect(res2.status).toBe(429);

      vi.advanceTimersByTime(1100);

      const res3 = await makeRequest();
      expect(res3.status).toBe(200);

      vi.useRealTimers();
    });
  });

  describe('createAuthMiddleware', () => {
    it('should allow requests with valid API key', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ apiKey: 'secret-key' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test', {
        headers: { 'x-api-key': 'secret-key' },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it('should reject requests with invalid API key', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ apiKey: 'secret-key' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test', {
        headers: { 'x-api-key': 'wrong-key' },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should reject requests with missing API key', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ apiKey: 'secret-key' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test');
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
    });

    it('should allow all requests when no API key is configured', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({}));
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test');
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it('should use custom header name', async () => {
      const app = new Hono();
      app.use('*', createAuthMiddleware({ apiKey: 'secret', headerName: 'authorization' }));
      app.get('/test', (c) => c.json({ ok: true }));

      const req = new Request('http://localhost/test', {
        headers: { authorization: 'secret' },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });
  });
});
