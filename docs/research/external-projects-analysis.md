# External Projects Analysis

Research date: 2026-03-12

Evaluation of 6 open-source projects for potential synergies with agntk — a zero-config, portable AI agent framework (TypeScript, AI SDK, monorepo, 647 tests passing, v1.2.2).

---

## Executive Summary

| Project | Relevance | Priority | Action |
|---------|-----------|----------|--------|
| **PromptFoo** | HIGH | P0 | Integrate as eval/red-team layer |
| **OpenViking** | HIGH | P0 | Study tiered context + memory architecture |
| **Agency Agents** | MEDIUM | P1 | Adopt persona format for skills system |
| **Impeccable** | MEDIUM | P1 | Adopt skill bundling pattern |
| **NanoChat** | LOW | P3 | Educational reference only |
| **Heretic** | NONE | -- | No actionable benefit |

---

## 1. PromptFoo

**Repository:** https://github.com/promptfoo/promptfoo
**Stars:** ~13,700 | **License:** MIT | **Stack:** TypeScript, Node 20+, Vitest

### What It Is

An open-source CLI and library for evaluating, testing, and red-teaming LLM applications. Developer-first, privacy-focused ("prompts never leave your machine"), designed for CI/CD integration.

### Key Capabilities

- **Evaluation engine**: Side-by-side model comparison, configurable assertions, templated prompts (Nunjucks), response caching
- **Red-teaming**: 31 attack strategies, 65 vulnerability plugins (prompt injection, data exfiltration, PII detection, BOLA/BFLA, encoding attacks, multi-turn escalation, hallucination/bias/toxicity detection)
- **50+ LLM providers**: OpenAI, Anthropic, Google, Azure, Bedrock, Ollama, OpenRouter, etc.
- **Web UI**: React-based visual results dashboard
- **Extensibility**: Custom providers (TS, Python, Ruby, Go, Docker), custom assertions, custom red-team plugins, MCP support

### Relevance to agntk: HIGH

agntk currently has:
- A guardrails pipeline (content filtering, prompt injection defense, URL validation)
- An evals sub-import (`@agntk/core/evals`) with `listWiseJudge`
- Phase 3 roadmap for deep research with self-critique
- Phase 1 security hardening in progress

**What PromptFoo adds that agntk lacks:**

1. **Systematic eval framework** — agntk's `listWiseJudge` is a single best-of-N evaluator. PromptFoo provides a complete assertion system with dozens of built-in matchers, regression detection, and CI/CD integration. This would give agntk users a way to validate agent behavior before deployment.

2. **Red-team testing at scale** — agntk's guardrails are defensive (runtime filtering). PromptFoo's red-teaming is offensive (proactive vulnerability discovery). The 65 vulnerability plugins could test agntk agents against prompt injection, data leakage, jailbreaks, and domain-specific safety failures that the guardrails might miss.

3. **Model comparison infrastructure** — agntk supports multiple providers (OpenRouter, OpenAI, Cerebras, Ollama) but has no built-in way to benchmark which provider/model performs best for a given agent task. PromptFoo's evaluation engine solves this directly.

4. **Regression testing for prompts** — As agntk's system prompts, tool descriptions, and skills evolve, there's no automated way to detect quality regressions. PromptFoo's assertion-based testing closes this gap.

### Recommended Actions

- **Integration path**: Create an `@agntk/evals` package or extend the existing evals sub-import to wrap PromptFoo as the evaluation backend. Expose `agntk eval` CLI command.
- **Red-team integration**: Add a `agntk redteam` command that runs PromptFoo's red-team suite against a named agent's configuration (system prompt + tools + skills).
- **CI pipeline**: Use PromptFoo in agntk's own CI to regression-test system prompt changes and tool descriptions.
- **Shared providers**: PromptFoo's provider abstraction aligns with agntk's `@ai-sdk/openai-compatible` layer — a thin adapter could let agntk agents be tested as PromptFoo providers.

### Risks

- PromptFoo is a large dependency (~7,700 commits). Consider wrapping rather than importing directly.
- PromptFoo is still pre-1.0 (v0.121.2) — API surface may shift.

---

## 2. OpenViking

**Repository:** https://github.com/volcengine/OpenViking
**Stars:** ~7,000 | **License:** Apache 2.0 | **Stack:** Python (primary), Rust (CLI), Go (filesystem), C++

### What It Is

A context database purpose-built for AI agents from ByteDance/Volcengine. Organizes all agent context (memory, resources, skills) through a virtual file system paradigm (`viking://` URIs) instead of flat vector stores.

### Key Capabilities

- **Virtual filesystem (AGFS)**: Hierarchical context organization navigable by agents, replacing unstructured vector stores
- **Tiered context loading (L0/L1/L2)**: Abstracts → overviews → full detail on demand, dramatically reducing token consumption
- **Directory recursive retrieval**: Intent analysis locks onto a high-scoring directory, then refines with semantic search within it
- **Observable retrieval**: Every retrieval preserves its trajectory through the filesystem for debugging
- **Automatic session memory**: Extracts user preferences and agent experience from conversations for self-improvement
- **Copy-on-write updates**: Incremental resource updates with data integrity
- **MCP integration**: Model Context Protocol support

### Relevance to agntk: HIGH

agntk currently has:
- `MarkdownMemoryStore` — flat markdown files for memory, decisions, preferences
- Phase 5 roadmap: context window tracking, memory TTL/pruning, semantic memory search, cross-agent memory
- Simple keyword-based memory search (Phase 5 plans embedding-based via Vectra)

**What OpenViking's architecture teaches agntk:**

1. **Tiered context loading** — agntk currently loads entire memory files into the system prompt. OpenViking's L0/L1/L2 pattern (abstract → overview → full detail) directly addresses Phase 5.1's context window tracking goal. agntk could implement a similar hierarchy: L0 = memory section headers, L1 = summaries per section, L2 = full entries.

2. **Filesystem-as-context paradigm** — agntk already uses a filesystem structure for agent state (`~/.agntk/agents/{name}/memory/`, `workspace/`, `archive/`). OpenViking's `viking://` URI scheme validates this direction and suggests making the filesystem structure more intentional and navigable by the agent itself.

3. **Directory-recursive retrieval** — For Phase 5.3 (semantic memory search), OpenViking's approach of first narrowing to a relevant directory via intent analysis, then doing semantic search within it, is more efficient than searching all memories flat. This maps well to agntk's existing directory structure (memory.md, decisions.md, preferences.md).

4. **Observable retrieval chains** — agntk has Langfuse + OpenTelemetry observability for the agent loop, but no visibility into memory retrieval. Adding retrieval trajectory tracking would improve debuggability.

5. **Session-based memory evolution** — OpenViking's automatic extraction of preferences and experience from conversations aligns with agntk's existing memory pipeline but adds the compression/evolution aspect that agntk currently lacks.

### Recommended Actions

- **Study, don't integrate directly** — OpenViking is Python/Rust/Go; direct integration isn't practical. Instead, port the architectural patterns.
- **Implement tiered context loading** in `MarkdownMemoryStore` — add L0 (section headers only), L1 (first line of each entry), L2 (full content) loading modes.
- **Add retrieval observability** — extend the existing observability integration to trace memory reads with path + reason.
- **Adopt copy-on-write for memory updates** — write to `.tmp`, rename for atomicity (Phase 2.1 already plans this for sessions; extend to memory).
- **Consider a `context://` URI scheme** — let agents reference context hierarchically rather than by raw file paths.

### Risks

- OpenViking is backed by ByteDance resources — feature velocity may exceed what a smaller project can absorb.
- The Go filesystem component is complex. Port patterns, not code.

---

## 3. Agency Agents

**Repository:** https://github.com/msitarzewski/agency-agents
**Stars:** ~34,700 | **License:** MIT | **Stack:** Markdown, Shell scripts

### What It Is

A collection of 142 specialized AI agent persona definitions organized across 12 professional divisions. Each agent is a structured Markdown file defining expertise, communication style, deliverables, success metrics, and workflows. Not a runtime — purely prompt-engineering assets.

### Key Capabilities

- **142 personas** across 12 divisions (engineering, design, marketing, sales, testing, product, etc.)
- **Multi-tool distribution**: Converts one Markdown definition to work across 9 AI tools (Claude Code, Cursor, Aider, Windsurf, Gemini CLI, etc.)
- **Standardized schema**: core identity, responsibilities, critical requirements, deliverables, success metrics, workflow examples
- **Shell-based pipeline**: `install.sh` (interactive), `convert.sh` (format transformation), `lint-agents.sh` (validation)

### Relevance to agntk: MEDIUM

agntk currently has:
- A skills system that auto-discovers `SKILL.md` files in project directories
- Named agents with identity files (human-editable `identity.md`)
- System prompt injection for skills
- Content sanitization for prompt injection defense

**What Agency Agents offers agntk:**

1. **Structured persona format** — agntk's `identity.md` is freeform. Agency Agents demonstrates that a structured schema (responsibilities, success metrics, deliverables, workflow examples) produces more consistent behavior. agntk could adopt a similar structured format for its identity files.

2. **Division-based agent templates** — agntk could ship a library of pre-built agent templates (DevOps SRE, Security Auditor, Code Reviewer, etc.) following Agency Agents' schema. Users run `agntk create --template security-auditor` and get a production-ready named agent.

3. **Multi-tool format conversion** — The conversion pipeline concept (one source → multiple output formats) could be applied to agntk's skills system. A skill defined in agntk's format could be exported for use in other tools.

4. **Quality validation** — The `lint-agents.sh` pattern could inspire validation for agntk identity/skill files — ensuring required fields are present, prompts don't exceed token budgets, etc.

### Recommended Actions

- **Define a structured agent template schema** — extend `identity.md` to include optional structured sections: role, expertise areas, constraints, success metrics.
- **Ship 5-10 starter templates** — curate from Agency Agents' 142 definitions, adapting to agntk's format. Focus on developer-relevant divisions: engineering, testing, security, devops.
- **Add `agntk create --template <name>`** CLI command for scaffolding named agents from templates.
- **Add identity/skill linting** — validate structure and estimate token cost during `agntk` startup.

### Risks

- The 34,700 stars are for the content library, not runtime quality — the personas need testing with agntk's specific system prompt and tool set.
- Overly rigid schemas can reduce agent flexibility. Keep structured fields optional.

---

## 4. Impeccable

**Repository:** https://github.com/pbakaus/impeccable
**Stars:** ~5,500 | **License:** Apache 2.0 | **Stack:** JavaScript, HTML, CSS, Bun

### What It Is

A design language system for AI coding assistants. Provides structured design knowledge (typography, color, layout, motion, interaction, responsive design, UX writing), steering commands, and anti-pattern guidance that improve LLM UI output quality.

### Key Capabilities

- **7 reference guides**: typography, color/contrast (OKLCH, WCAG), spatial design, motion, interaction, responsive, UX writing
- **17 steering commands**: `/audit`, `/critique`, `/normalize`, `/polish`, `/animate`, `/colorize`, etc.
- **Anti-patterns catalog**: explicitly guides LLMs away from common UI mistakes
- **8 tool distributions**: Cursor, Claude Code, OpenCode, Pi, Gemini CLI, Codex CLI, VS Code Copilot, Kiro
- **Build pipeline**: Modular source skills → provider-specific bundles

### Relevance to agntk: MEDIUM

agntk currently has:
- Skills system with `SKILL.md` auto-discovery
- Content sanitization for skill injection
- No built-in domain-specific knowledge packages

**What Impeccable's architecture teaches agntk:**

1. **Skill bundling pipeline** — Impeccable's build system (source modules → provider-specific bundles) is a mature pattern for distributing domain knowledge across AI tools. agntk's skills system could adopt a similar pipeline: author skills as modular source files, build into optimized bundles per context window budget.

2. **Domain-specific knowledge packages** — Impeccable proves that injecting structured domain expertise (design principles, anti-patterns) into LLM context significantly improves output quality. agntk could support similar knowledge packages for other domains: security best practices, database optimization, API design, etc.

3. **Steering commands pattern** — Impeccable's `/audit`, `/critique`, `/polish` commands are a UX pattern agntk could adopt. Named agents could expose domain-specific commands that trigger structured workflows (e.g., a security agent exposing `/scan`, `/audit`, `/harden`).

4. **Anti-pattern injection** — Explicitly telling agents what NOT to do (via anti-patterns guides) is an underused prompting technique. agntk could include anti-pattern sections in skill definitions.

### Recommended Actions

- **Add `antiPatterns` section to SKILL.md schema** — structured guidance on what to avoid, injected into system prompt.
- **Support skill-defined commands** — let skills register custom slash commands (similar to Impeccable's steering commands) that trigger specific prompt templates.
- **Consider a skill marketplace/registry** — if agntk supports modular skill packages, a registry would let the community share domain knowledge packages.

### Risks

- Adding design-specific skills is niche — focus on the architectural patterns, not the specific design content.
- Skill token budgets need management. Impeccable's 7 reference guides could consume significant context window.

---

## 5. NanoChat

**Repository:** https://github.com/karpathy/nanochat
**Stars:** ~47,200 | **License:** MIT | **Stack:** Python, PyTorch

### What It Is

A minimal framework for training complete LLMs (tokenization through chat UI) on a single GPU node. Demonstrates GPT-2-level training in ~1.8 hours on 8xH100s for ~$48-$100. Successor to Karpathy's nanoGPT.

### Key Capabilities

- End-to-end pipeline: tokenization, pretraining, SFT, RLHF, evaluation, inference, chat UI
- Single `--depth` parameter auto-configures all hyperparameters
- Multi-hardware support (H100, A100, V100, CPU, Apple Silicon)
- Time-to-GPT-2 leaderboard for optimization benchmarking
- Standard benchmarks: MMLU, GSM8K, HumanEval, ARC

### Relevance to agntk: LOW

agntk consumes LLMs via API providers — it does not train models. NanoChat's value is in model training, which is outside agntk's scope entirely.

**Limited applicability:**
- The evaluation benchmarks (MMLU, GSM8K, etc.) could theoretically inform how agntk evaluates model performance, but PromptFoo already solves this better for the API-consumption use case.
- The single-dial configuration philosophy (`--depth` controls everything) aligns with agntk's zero-config philosophy, but this is conceptual inspiration rather than actionable integration.

### Recommended Actions

- **None** — Bookmark as educational reference for understanding LLM training internals. No integration path.

---

## 6. Heretic

**Repository:** https://github.com/hereticjsorg/heretic
**Stars:** 17 | **License:** MIT | **Stack:** JavaScript, Marko, Fastify, MongoDB

### What It Is

A full-stack Node.js web framework combining SSR with SPA behavior. Uses Marko templating, Fastify, MongoDB, and bundles auth, i18n, form/table builders, and image processing.

### Key Capabilities

- Hybrid SSR/SPA rendering via Marko
- Built-in auth (OAuth2, JWT, 2FA)
- Internationalization, form/table builders
- Image processing (Sharp), PDF generation (Puppeteer)
- CLI lifecycle tools

### Relevance to agntk: NONE

- Different domain entirely (web application framework vs AI agent SDK)
- Different tech stack (Marko, Fastify, MongoDB vs TypeScript, AI SDK, Hono)
- No AI/agent capabilities
- Minimal community adoption (17 stars, single contributor, last commit October 2025)
- agntk already uses Hono for its server package — no need for another web framework

### Recommended Actions

- **None** — No overlap or benefit.

---

## Cross-Cutting Themes

### 1. Evaluation and Testing (PromptFoo)
agntk's roadmap has no dedicated evaluation phase. PromptFoo fills this gap completely — systematic prompt testing, model comparison, regression detection, and red-teaming. This is the highest-impact integration.

### 2. Context and Memory Architecture (OpenViking)
agntk's Phase 5 (Smart Context + Memory) plans address the same problems OpenViking solves. Studying OpenViking's tiered loading and directory-recursive retrieval before implementing Phase 5 would avoid reinventing patterns that are already proven.

### 3. Structured Agent Definitions (Agency Agents + Impeccable)
Both projects demonstrate that structured, schema-driven skill/persona definitions produce better AI outputs than freeform text. agntk's identity and skills systems would benefit from adopting structured schemas with required fields, anti-patterns, and steering commands.

### 4. Multi-Tool Distribution (Agency Agents + Impeccable)
Both projects solve the "one source, many tools" problem with build pipelines. If agntk's skills are designed to be portable, a similar pipeline could expand agntk's ecosystem reach.

---

## Recommended Implementation Sequence

```
1. PromptFoo integration (P0)
   └─ Eval CLI command + red-team suite
   └─ CI integration for agntk's own prompts

2. OpenViking patterns (P0)
   └─ Tiered context loading in MarkdownMemoryStore
   └─ Retrieval observability
   └─ Inform Phase 5 architecture decisions

3. Agent templates + structured schemas (P1)
   └─ Structured identity.md schema
   └─ 5-10 starter templates (from Agency Agents)
   └─ Skill-defined commands (from Impeccable)
   └─ Anti-patterns support in skills
```
