# agntk Free Tier Proxy — Deployment Guide

The free tier proxy sits between `npx agntk` and Cerebras, holding the real API key server-side. Users get zero-config access; the proxy rate-limits per IP and enforces a daily budget.

---

## Architecture

```
npx agntk (user's machine)
    │
    │  POST /v1/chat/completions
    │  Authorization: Bearer agntk-free-v1
    ▼
api.agntk.dev (Vercel, Node.js runtime)
    │
    │  - validates static bearer token
    │  - rate-limits per IP (Upstash sliding window)
    │  - checks daily budget (Upstash counter)
    │  - injects real CEREBRAS_API_KEY
    │  - streams SSE response back
    ▼
api.cerebras.ai/v1/chat/completions
```

---

## Prerequisites

- Vercel account (Hobby plan is fine — 1M invocations/month free)
- Cerebras API key (get one at https://cloud.cerebras.ai)
- The agntK repo connected to Vercel

---

## Step 1: Create a New Vercel Project

The proxy is a **separate Vercel project** from the docs site. Vercel supports multiple projects from one repo.

1. Go to https://vercel.com/new
2. Select the **agntK** repository
3. **Set Root Directory** to `infra/free-tier-proxy`
4. Framework Preset: **Other** (no framework)
5. Click **Deploy**

---

## Step 2: Add Upstash Redis

Vercel KV is deprecated. Use Upstash Redis instead.

1. In your Vercel project, go to **Storage** tab
2. Click **Connect Store** → **Upstash Redis** (via Vercel Marketplace)
3. Create a new Redis database (free tier: 10K requests/day, 256MB)
4. Link it to the proxy project

This auto-sets two environment variables:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

---

## Step 3: Set Environment Variables

Go to **Settings → Environment Variables** and add:

| Variable | Value | Type |
|----------|-------|------|
| `CEREBRAS_API_KEY` | `csk-your-actual-key` | **Sensitive** (not readable after creation) |
| `DAILY_BUDGET_CENTS` | `1000` | Standard |
| `FREE_TIER_TOKEN` | `agntk-free-v1` | Standard |

> **Important:** Use Vercel's "Sensitive" type for the Cerebras key. This encrypts it so it's only available at runtime, not visible in the dashboard.

---

## Step 4: Add Custom Domain

1. Go to **Settings → Domains**
2. Add `api.agntk.dev`
3. In your DNS provider, add a CNAME record:
   ```
   api.agntk.dev  →  cname.vercel-dns.com
   ```
4. Wait for SSL provisioning (usually < 5 minutes)

---

## Step 5: Verify Deployment

Test the proxy is working:

```bash
curl -X POST https://api.agntk.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer agntk-free-v1" \
  -d '{
    "model": "gpt-oss-120b",
    "messages": [{"role": "user", "content": "say hello"}],
    "max_tokens": 50
  }'
```

Expected: a JSON response with a chat completion from Cerebras.

Test rate limiting:
```bash
for i in {1..12}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.agntk.dev/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer agntk-free-v1" \
    -d '{"model":"gpt-oss-120b","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
done
```

Expected: first 10 return `200`, last 2 return `429`.

---

## Monitoring

### Check daily spend

The proxy stores spend in Upstash Redis as `agntk:budget:YYYY-MM-DD`.

In the Upstash dashboard (or via CLI):
```bash
# Install Upstash CLI or use the dashboard
# Key format: agntk:budget:2026-02-27
```

### Check rate limit state

Rate limit keys: `agntk:rl:*` (managed by @upstash/ratelimit)

---

## Configuration Reference

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CEREBRAS_API_KEY` | (required) | Real Cerebras API key |
| `UPSTASH_REDIS_REST_URL` | (auto-set) | Upstash Redis endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | (auto-set) | Upstash Redis auth token |
| `DAILY_BUDGET_CENTS` | `1000` | Daily budget in cents ($10) |
| `FREE_TIER_TOKEN` | `agntk-free-v1` | Static bearer token clients send |

---

## Cost Estimates

### Vercel (Hobby plan — free)
- 1M function invocations/month
- 100 GB-hours compute
- Active CPU pricing: you only pay for CPU time, not I/O wait (streaming)

### Upstash Redis (free tier)
- 10K requests/day (each API call = ~2-3 Redis ops for rate limit + budget)
- Supports ~3,000-5,000 proxy requests/day on free tier
- Pay-as-you-go: $0.2 per 100K requests if you need more

### Cerebras
- GPT OSS 120B: ~$0.35/M input tokens, ~$0.75/M output tokens
- $10/day budget ≈ 10,000-15,000 short requests or 2,000-3,000 agent sessions

---

## Security Notes

- The Cerebras API key NEVER leaves the server. It is injected into upstream requests at runtime only.
- No CORS headers are sent. The proxy is CLI-to-server only, not browser-facing.
- Auth uses exact bearer token match (not `.includes()`).
- Rate limiting uses Vercel's `x-real-ip` header (set by Vercel's edge network, not spoofable by clients).
- Budget tracking uses atomic `INCRBY` operations in Redis (safe under concurrency).
- If Redis is down, requests fail open (availability over strictness). This is intentional — a Redis outage shouldn't block all free tier users.

---

## Updating the Budget

To change the daily budget:
1. Go to Vercel → Settings → Environment Variables
2. Update `DAILY_BUDGET_CENTS` (e.g., `2500` for $25/day)
3. Redeploy (or wait for next deployment)

The budget resets automatically at midnight UTC each day (Redis key TTL).

---

## CI/CD — Automated Deployment

The proxy auto-deploys to Vercel when changes are pushed to `main` that touch `infra/free-tier-proxy/`. This is handled by `.github/workflows/deploy-proxy.yml`.

### Required GitHub Secrets

| Secret | How to get it |
|--------|---------------|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → Create Token |
| `VERCEL_ORG_ID` | Run `vercel link` in `infra/free-tier-proxy/`, then check `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Same as above — in `.vercel/project.json` after linking |

### Manual Deploy (CLI)

```bash
cd infra/free-tier-proxy
vercel login
vercel link          # links to your Vercel project
vercel --prod        # deploys to production
```

### First-Time Setup

1. Run `vercel login` to authenticate
2. `cd infra/free-tier-proxy && vercel link` to connect to the Vercel project
3. Copy `orgId` and `projectId` from `.vercel/project.json`
4. Add them as GitHub secrets (along with VERCEL_TOKEN)
5. Push changes — the workflow handles the rest
