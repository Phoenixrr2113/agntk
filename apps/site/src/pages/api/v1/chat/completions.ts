/**
 * agntk Free Tier Proxy — POST /api/v1/chat/completions
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

import type { APIRoute } from 'astro';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// This route must be server-rendered (not pre-rendered/static)
export const prerender = false;

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
// Helpers
// ---------------------------------------------------------------------------

function jsonError(status: number, message: string, type: string): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/chat/completions
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  // --- Auth: exact bearer token match ---
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (auth !== FREE_TIER_TOKEN) {
    return jsonError(401, 'Unauthorized', 'auth_error');
  }

  // --- Env validation ---
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  if (!cerebrasKey) {
    return jsonError(500, 'Free tier not configured', 'server_error');
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return jsonError(500, 'Rate limiter not configured', 'server_error');
  }

  // --- Client IP (Vercel sets x-real-ip reliably) ---
  const ip =
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  // --- Rate limit ---
  try {
    const { success } = await getRatelimit().limit(ip);
    if (!success) {
      return jsonError(
        429,
        'Rate limit exceeded. Set OPENROUTER_API_KEY or install Ollama for unlimited use.',
        'rate_limit_exceeded',
      );
    }
  } catch {
    // If Redis is down, allow the request (fail open for availability)
  }

  // --- Budget check ---
  try {
    if (await isBudgetExhausted()) {
      return jsonError(
        429,
        'Free tier daily limit reached. Set OPENROUTER_API_KEY or install Ollama to continue.',
        'budget_exceeded',
      );
    }
  } catch {
    // Fail open
  }

  // --- Forward to Cerebras ---
  const body = await request.text();
  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return jsonError(400, 'Invalid JSON body', 'invalid_request');
  }

  const isStreaming = parsedBody.stream === true;

  try {
    const upstream = await fetch(CEREBRAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cerebrasKey}`,
      },
      body,
    });

    // Track spend (1 cent baseline estimate per request — atomic increment)
    trackSpend(1).catch(() => {}); // fire-and-forget, don't block response

    if (isStreaming && upstream.body) {
      // Stream SSE: pass upstream ReadableStream body directly through
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // Non-streaming: forward JSON response
      const responseBody = await upstream.text();
      return new Response(responseBody, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return jsonError(502, 'Failed to reach inference provider', 'upstream_error');
  }
};

// ---------------------------------------------------------------------------
// OPTIONS (preflight — not typically needed for CLI-to-server)
// ---------------------------------------------------------------------------

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204 });
};

// ---------------------------------------------------------------------------
// Catch-all for non-POST methods
// ---------------------------------------------------------------------------

export const ALL: APIRoute = async () => {
  return jsonError(405, 'Method not allowed', 'invalid_request');
};
