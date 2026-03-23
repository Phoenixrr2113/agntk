# agntK Roadmap

Production hardening and feature plan. Each phase is independently shippable.

**Current state**: Zero-config provider resolution, free tier proxy, Ollama auto-detection, system-aware model selection — all working (647 tests passing).

---

## Phase 1: Security Hardening

**Goal**: Every dangerous operation gated by default. No SSRF, no privilege escalation, no credential leaks.

### 1.1 — SSRF Protection for Browser Tool

- New `url-validator.ts` — blocks private IPs, link-local, cloud metadata, dangerous schemes
- DNS rebinding defense via `dns.resolve4`
- Gate in browser tool before opening URLs

### 1.2 — Block LD_PRELOAD in Shell Tool

- Add `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH` to blocked env keys
- Add pattern detection for `env LD_PRELOAD=...` and `export DYLD_INSERT_LIBRARIES=...`
- Strip from `buildSanitizedEnv()`

### 1.3 — Approval ON by Default

- `resolveApprovalConfig(undefined)` returns `{ enabled: true }` (currently returns undefined)
- Add `'background'` to `DANGEROUS_TOOLS`
- Only `approval: false` explicitly disables
- **Breaking change**: users relying on approval being off must pass `approval: false`

### 1.4 — Expand Sensitive File Blocklist

Add to `SENSITIVE_PATH_PATTERNS`:

- `.kube/config`, `.docker/config.json`, `.npmrc`, `.yarnrc.yml`, `.pypirc`
- `.gnupg/`, `.gitconfig`, `.git-credentials`
- `.gcloud/`, `.azure/`, `.config/gcloud/`
- `.password-store/`, `.1password/`
- Private key extensions: `.pem`, `.key`, `.p12`, `.pfx`, `.jks`

### 1.5 — Global Agent Timeout

- `maxDuration` option (default: 5 minutes, 0 to disable)
- AbortController + setTimeout wrapping the tool loop
- Prevents runaway agents

---

## Phase 2: Persistent Tasks + Scheduling

**Goal**: Background sessions survive restarts. Agent can schedule future work.

### 2.1 — Persistent Session Store

- `FileSessionStore` class: JSON persistence at `~/.agntk/sessions.json`
- Orphan PID detection on load
- Atomic writes (write .tmp, rename)

### 2.2 — Scheduling Engine

- `Scheduler` class: `schedule()`, `cancel()`, `list()`, `init()`
- One-shot (`runAt: Date`) and recurring (`cron: string`)
- Minimal 5-field cron parser (no npm dependency)
- Persistent store at `~/.agntk/schedules.json`

### 2.3 — Schedule Tool

- Agent-callable tool: schedule, list, cancel actions
- Added to `DANGEROUS_TOOLS` (triggers future agent runs)

**Example UX**:

```
$ npx agntk "remind me to check the build at 3pm"
  ✓ Scheduled: "check the build" at 3:00 PM today

$ npx agntk "run tests every weekday at 9am"
  ✓ Scheduled: "run tests" (recurring: 0 9 * * 1-5)
```

---

## Phase 3: Deep Research Mode

**Goal**: Multi-step research with source validation, self-critique, and intermediate filtering.

### 3.1 — Research Pipeline

- `withDeepResearch(config)` higher-order wrapper
- Pipeline: Query Decomposition → Parallel Search → Cross-Validation → Synthesis → Self-Critique
- Reuses existing `createSpawnAgentTool` and `listWiseJudge`
- Config: `maxIterations` (1-3), `breadth` (2-5), `factCheck`, `selfCritique`

### 3.2 — Research Tool

- Agent-callable tool with depth modes: quick, standard, deep
- Returns: synthesis, confidence score, source count

**Example UX**:

```
$ npx agntk "research the best database for real-time analytics"
  [researching] decomposing into 3 sub-questions...
  [researching] 3 researcher agents running in parallel...
  [validating] cross-checking 12 sources...
  [synthesizing] combining findings...

  ## Research Synthesis (confidence: 0.87)
  Based on 12 sources across 3 research branches...
```

---

## Phase 4: Multi-Agent Orchestration

**Goal**: Async sub-agents, fan-out patterns, sibling coordination.

### 4.1 — Async Sub-Agent Results

- `async: true` on spawn_agent → returns taskId immediately
- `AgentTaskRegistry` tracks running/completed/failed tasks
- New `check_agent_task` tool

### 4.2 — Fan-Out Tool

- Spawns N agents in parallel (max 5), collects all results
- `Promise.allSettled` for partial failure tolerance

### 4.3 — Increase Spawn Depth

- Default spawn depth 2 → 3

---

## Phase 5: Smart Context + Memory

**Goal**: Prevent context overflow, enable semantic search, manage memory lifecycle.

_Informed by [OpenViking](https://github.com/volcengine/OpenViking) tiered context + filesystem-as-context architecture._

### 5.1 — Tiered Context Loading

- Token estimation (4 chars ≈ 1 token)
- Auto-compress memory context when over 80% of window
- **Tiered loading in `MarkdownMemoryStore`**: L0 (section headers only), L1 (first line per entry), L2 (full content)
- Agent requests detail on demand — default to L0/L1, expand to L2 when relevant

### 5.2 — Memory TTL and Pruning

- Date-prefixed entries, configurable TTL (default: 90 days)
- Max entries cap (default: 200)
- Copy-on-write for memory updates (write `.tmp`, rename) — mirrors 2.1 atomic write pattern

### 5.3 — Semantic Memory Search

- Optional Vectra adapter for embedding-based search
- Auto-detected: uses embeddings if vectra installed, keyword search otherwise
- **Directory-recursive retrieval**: narrow to relevant section (memory/decisions/preferences) via intent analysis before semantic search within it

### 5.4 — Cross-Agent Memory Search

- `recall_global` tool — searches all agents' memories
- Read-only access to `~/.agntk/agents/`

### 5.5 — Retrieval Observability

- Extend Langfuse + OpenTelemetry integration to trace memory reads
- Each retrieval logs: path, tier loaded (L0/L1/L2), reason, latency

---

## Phase 6: Evaluation + Red-Teaming

**Goal**: Systematic testing of agent prompts, model comparison, and proactive vulnerability discovery.

_Powered by [PromptFoo](https://github.com/promptfoo/promptfoo) as the evaluation backend (wrapped, not vendored)._

### 6.1 — Eval Framework

- `@agntk/evals` package wrapping PromptFoo as evaluation engine
- `agntk eval` CLI command — run assertion-based tests against agent configs
- Assertion library: exact match, contains, LLM-graded, regex, JSON schema, custom
- Model comparison: benchmark which provider/model performs best for a given agent task
- Regression detection: CI-friendly exit codes for prompt quality regressions

### 6.2 — Red-Team Suite

- `agntk redteam` CLI command — runs PromptFoo's red-team plugins against a named agent
- Tests agent's system prompt + tools + skills against: prompt injection, data exfiltration, PII leakage, jailbreaks, encoding attacks
- Validates agntk's guardrails pipeline with offensive testing (complements the defensive runtime filtering)

### 6.3 — CI Integration

- Use PromptFoo in agntk's own CI to regression-test system prompt changes and tool descriptions
- Provider adapter: agntk agents testable as PromptFoo providers via `@ai-sdk/openai-compatible` layer

### Implementation Notes

- PromptFoo is pre-1.0 (~v0.121) and large (~7,700 commits) — wrap behind agntk's own API surface
- Expose a stable `@agntk/evals` interface so the underlying engine can be swapped if needed

---

## Phase 7: Agent Templates + Skills Enhancement

**Goal**: Structured agent definitions, starter templates, and richer skills system.

_Draws from [Agency Agents](https://github.com/msitarzewski/agency-agents) persona format and [Impeccable](https://github.com/pbakaus/impeccable) skill bundling patterns._

### 7.1 — Structured Identity Schema

- Extend `identity.md` with optional structured sections: role, expertise areas, constraints, success metrics, deliverables
- Keep structured fields optional — freeform still works
- Validate structure and estimate token cost during `agntk` startup (lint on load)

### 7.2 — Starter Agent Templates

- Ship 5-10 curated templates: Code Reviewer, Security Auditor, DevOps SRE, Test Engineer, API Designer
- `agntk create --template <name>` CLI command for scaffolding named agents
- Templates include: identity, default skills, recommended tool set

### 7.3 — Skills System Enhancement

- **Anti-patterns section** in `SKILL.md` schema — structured "what NOT to do" guidance injected into system prompt
- **Skill-defined commands** — skills register custom slash commands that trigger specific prompt templates (e.g., security skill exposes `/scan`, `/audit`, `/harden`)

---

## Implementation Order

```
Phase 1 (Security) ──── no dependencies, ship FIRST
    │
Phase 2 (Persistence + Scheduling) ──── depends on Phase 1 approval gate
    │
Phase 3 (Research) ──┐── reuses existing spawn-agent + best-of-n
    │                 │
Phase 5 (Memory) ─────┘── independent, can parallelize with Phase 3
    │
Phase 4 (Orchestration) ──── builds on Phases 2-3
    │
Phase 6 (Eval + Red-Team) ──── independent, can start after Phase 1
    │
Phase 7 (Templates + Skills) ──── independent, can start anytime
```
