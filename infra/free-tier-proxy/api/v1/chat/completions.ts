/**
 * agntk Free Tier Proxy — POST /v1/chat/completions
 *
 * Forwards OpenAI-compatible chat completion requests to Cerebras.
 * Holds the real CEREBRAS_API_KEY server-side so users never need one.
 *
 * Security:
 *   - Static bearer token validation (exact match)
 *   - Per-IP sliding-window rate limiting via Upstash
 *   - Daily spend budget tracking via Upstash
 *   - No CORS (CLI-to-server only, not browser-facing)
 *
 * Environment variables (set in Vercel dashboard):
 *   CEREBRAS_API_KEY        — Cerebras API key (use Sensitive env var)
 *   UPSTASH_REDIS_REST_URL  — auto-set when Upstash Redis is linked
 *   UPSTASH_REDIS_REST_TOKEN— auto-set when Upstash Redis is linked
 *   DAILY_BUDGET_CENTS      — daily budget in cents (default: 1000 = $10)
 *   FREE_TIER_TOKEN         — the static bearer token clients send (default: agntk-free-v1)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const DAILY_BUDGET_CENTS = parseInt(process.env.DAILY_BUDGET_CENTS || '1000', 10);
const FREE_TIER_TOKEN = process.env.FREE_TIER_TOKEN || 'agntk-free-v1';

// ---------------------------------------------------------------------------
// Upstash Redis + Rate Limiter (declared outside handler for warm-instance reuse)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

function getRatelimit(): Ratelimit {
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: getRedis(),
      // Sliding window: 10 requests per 60 seconds per IP
      limiter: Ratelimit.slidingWindow(10, '60 s'),
      analytics: false,
      prefix: 'agntk:rl',
    });
  }
  return ratelimit;
}

// ---------------------------------------------------------------------------
// Daily Budget
// ---------------------------------------------------------------------------

function todayKey(): string {
  return `agntk:budget:${new Date().toISOString().slice(0, 10)}`;
}

async function isBudgetExhausted(): Promise<boolean> {
  const r = getRedis();
  const spent = (await r.get<number>(todayKey())) ?? 0;
  return spent >= DAILY_BUDGET_CENTS;
}

async function trackSpend(cents: number): Promise<void> {
  const r = getRedis();
  const key = todayKey();
  // INCRBY is atomic — safe under concurrency
  await r.incrby(key, cents);
  // Set expiry only if it doesn't already have one (first request of the day)
  await r.expire(key, 86400 * 2);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only POST
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed', type: 'invalid_request' } });
  }

  // --- Auth: exact bearer token match ---
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (auth !== FREE_TIER_TOKEN) {
    return res.status(401).json({ error: { message: 'Unauthorized', type: 'auth_error' } });
  }

  // --- Env validation ---
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  if (!cerebrasKey) {
    return res.status(500).json({ error: { message: 'Free tier not configured', type: 'server_error' } });
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ error: { message: 'Rate limiter not configured', type: 'server_error' } });
  }

  // --- Client IP (Vercel sets x-real-ip reliably) ---
  const ip = (req.headers['x-real-ip'] as string)
    || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || 'unknown';

  // --- Rate limit ---
  try {
    const { success, remaining } = await getRatelimit().limit(ip);
    if (!success) {
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded. Set OPENROUTER_API_KEY or install Ollama for unlimited use.',
          type: 'rate_limit_exceeded',
        },
      });
    }
  } catch {
    // If Redis is down, allow the request (fail open for availability)
  }

  // --- Budget check ---
  try {
    if (await isBudgetExhausted()) {
      return res.status(429).json({
        error: {
          message: 'Free tier daily limit reached. Set OPENROUTER_API_KEY or install Ollama to continue.',
          type: 'budget_exceeded',
        },
      });
    }
  } catch {
    // Fail open
  }

  // --- Forward to Cerebras ---
  const isStreaming = req.body?.stream === true;

  try {
    const upstream = await fetch(CEREBRAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cerebrasKey}`,
      },
      body: JSON.stringify(req.body),
    });

    // Track spend (1 cent baseline estimate per request — atomic increment)
    trackSpend(1).catch(() => {}); // fire-and-forget, don't block response

    if (isStreaming && upstream.body) {
      // Stream SSE through
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.status(upstream.status);

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } catch {
        // Client disconnected or upstream closed
      } finally {
        res.end();
      }
    } else {
      // Non-streaming: forward JSON response
      const body = await upstream.text();
      res.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
    }
  } catch {
    return res.status(502).json({
      error: { message: 'Failed to reach inference provider', type: 'upstream_error' },
    });
  }
}
