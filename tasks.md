

---

## Phase 1: Harness Foundation (Types + Governance)

### HARNESS-TYPES-001
**Frontmatter parser and harness types**

```yaml
task_id: HARNESS-TYPES-001
name: Frontmatter parser and harness type definitions
status: draft
complexity: low

user_story: |
  As an SDK consumer, I want standardized types for harness primitives
  (CORE, rules, instincts, frontmatter), so I can build governance-aware agents.

ownership:
  modifies:
    - packages/sdk/src/harness/types.ts        # NEW
    - packages/sdk/src/harness/frontmatter.ts   # NEW
    - packages/sdk/src/index.ts                 # export new module
  reads:
    - packages/sdk/src/memory/types.ts
    - packages/sdk/src/skills/types.ts          # SkillMeta pattern to follow
  forbidden:
    - packages/sdk/src/agent.ts                 # not yet

interface_contracts:
  produces:
    - name: HarnessFrontmatter
      signature: "{ id, tags, created, updated, author, status, source?, related? }"
    - name: CoreIdentity
      signature: "{ purpose, creator, values, ethics, identity }"
    - name: Rule
      signature: "{ frontmatter, l0, l1, body }"
    - name: Instinct
      signature: "{ frontmatter, l0, l1, body, provenance }"
    - name: parseFrontmatter(content: string): { frontmatter, l0, l1, body }

dependencies:
  blocked_by: []
  blocks: [HARNESS-GOV-002, HARNESS-LOAD-004]

context_required:
  estimated_total_tokens: ~3000
```

**Key decisions:**
- Frontmatter uses `gray-matter` (already a pattern in skills/loader.ts)
- L0/L1 extracted from HTML comments via regex, not a new parser
- Types extend existing `SkillMeta` patterns for consistency

---

### HARNESS-GOV-002
**Governance loader — CORE → Rules → Instincts**

```yaml
task_id: HARNESS-GOV-002
name: Three-tier governance loader
status: draft
complexity: medium

user_story: |
  As an agent, I want a governance hierarchy (frozen CORE > human rules > 
  agent instincts) loaded into my context, so I have clear behavioral boundaries.

ownership:
  modifies:
    - packages/sdk/src/harness/governance.ts    # NEW
  reads:
    - packages/sdk/src/harness/types.ts         # from HARNESS-TYPES-001
    - packages/sdk/src/harness/frontmatter.ts   # from HARNESS-TYPES-001
    - packages/sdk/src/memory/store.ts          # directory patterns
    - packages/sdk/src/skills/loader.ts         # discovery pattern to follow

interface_contracts:
  consumes:
    - name: parseFrontmatter
      source: harness/frontmatter.ts
  produces:
    - name: GovernanceLoader
      signature: |
        {
          loadCore(): Promise<CoreIdentity | null>
          loadRules(): Promise<Rule[]>
          loadInstincts(): Promise<Instinct[]>
          buildGovernancePrompt(): Promise<string>
        }

dependencies:
  blocked_by: [HARNESS-TYPES-001]
  blocks: [HARNESS-WIRE-003]

approach:
  strategy: |
    Scan harness directories (core.md, rules/, instincts/), parse frontmatter,
    extract L0/L1, build prompt section. CORE is always loaded full. Rules load
    L1 by default, L2 on demand. Instincts load L0 only (filename + tags) with
    L1 for active-status instincts.
```

---

### HARNESS-WIRE-003
**Wire harness into createAgent()**

```yaml
task_id: HARNESS-WIRE-003
name: Integrate harness governance into agent creation
status: draft
complexity: medium

user_story: |
  As an SDK consumer, I want to enable harness governance on an agent with a
  single config option, so governance loads automatically at init.

ownership:
  modifies:
    - packages/sdk/src/types/agent.ts           # extend AgentOptions
    - packages/sdk/src/agent.ts                 # wire into ensureInit
  reads:
    - packages/sdk/src/harness/governance.ts    # from HARNESS-GOV-002
    - packages/sdk/src/memory/loader.ts         # existing memory loading pattern

interface_contracts:
  consumes:
    - name: GovernanceLoader
      source: harness/governance.ts
  produces:
    - name: AgentOptions.harness
      signature: |
        harness?: {
          root?: string
          core?: boolean
          rules?: boolean
          instincts?: boolean
        }

dependencies:
  blocked_by: [HARNESS-GOV-002]
  blocks: [HARNESS-INSTINCT-007]

approach:
  steps:
    1:
      action: Add optional `harness` field to AgentOptions
      output: Extended type
    2:
      action: In ensureInit(), if harness config present, create GovernanceLoader
      output: Governance prompt section
    3:
      action: Inject governance prompt between identity and workspace instructions
      output: Augmented system prompt with CORE > rules > instincts
```

---

## Phase 2: Enhanced Context Loading

### HARNESS-LOAD-004
**Token-budgeted context loader with L0/L1/L2**

```yaml
task_id: HARNESS-LOAD-004
name: Progressive context loading with token budget
status: draft
complexity: high

user_story: |
  As an agent with many memory/skill/rule files, I want context loaded
  progressively (filenames → summaries → full content) within a token budget,
  so I don't waste context on irrelevant files.

ownership:
  modifies:
    - packages/sdk/src/memory/loader.ts         # replace naive loading
    - packages/sdk/src/memory/types.ts          # add loadWithBudget to interface
  reads:
    - packages/sdk/src/harness/frontmatter.ts   # L0/L1 parsing
    - packages/sdk/src/harness/types.ts

interface_contracts:
  consumes:
    - name: parseFrontmatter
      source: harness/frontmatter.ts
  produces:
    - name: loadMemoryContext(store, options)
      signature: |
        options?: {
          tokenBudget?: number        // max tokens for memory section
          taskHint?: string           // current task for relevance matching
          alwaysLoadFull?: string[]   // file names to always load L2
        }

dependencies:
  blocked_by: [HARNESS-TYPES-001]
  blocks: []

approach:
  strategy: |
    1. Load always-on files full (identity, context, preferences) 
    2. List memory files → extract frontmatter tags + L0 from each
    3. If taskHint provided, score relevance by tag overlap
    4. Load L1 for top-scored files until 70% of budget spent
    5. Reserve 30% for agent to request L2 on-demand via file_read
    Token counting: chars / 4 (existing CHARS_PER_TOKEN constant)
```

---

### HARNESS-INDEX-005
**Auto-generated index manifests**

```yaml
task_id: HARNESS-INDEX-005
name: Directory index manifest builder
status: draft
complexity: low

user_story: |
  As an agent, I want auto-generated _index.md files summarizing each harness
  directory, so I can scan available resources without loading individual files.

ownership:
  modifies:
    - packages/sdk/src/harness/index-builder.ts  # NEW
  reads:
    - packages/sdk/src/harness/frontmatter.ts
    - packages/sdk/src/harness/types.ts

interface_contracts:
  produces:
    - name: buildIndex(dirPath: string): Promise<string>
      signature: "Generates markdown table from directory contents"
    - name: rebuildAllIndexes(harnessRoot: string): Promise<void>

dependencies:
  blocked_by: [HARNESS-TYPES-001]
  blocks: []

approach:
  strategy: |
    Scan directory for .md files, parse frontmatter + L0 from each,
    generate markdown table sorted by updated date. Write to _index.md.
    Can be called on-demand or by file watcher (Phase 4).
```

---

## Phase 3: Growth Loop

### HARNESS-EVENT-006
**Structured event logger**

```yaml
task_id: HARNESS-EVENT-006
name: Agent event logger for session tracking
status: draft
complexity: low

user_story: |
  As an agent runtime, I want to log structured events (interactions, tool calls,
  decisions) so they can be synthesized into journal entries and instincts.

ownership:
  modifies:
    - packages/sdk/src/harness/events.ts         # NEW
  reads:
    - packages/sdk/src/harness/types.ts
    - packages/sdk/src/types/streaming.ts        # StreamEventType patterns

interface_contracts:
  produces:
    - name: AgentEvent
      signature: |
        {
          id: string
          source: string
          type: 'interaction' | 'decision' | 'error' | 'scheduled' | 'system'
          timestamp: string
          threadId?: string
          summary: string
          details: unknown
          outcome?: { action: string, llmInvoked: boolean, tokensUsed: number }
        }
    - name: EventLogger
      signature: |
        {
          log(event: Omit<AgentEvent, 'id' | 'timestamp'>): void
          getEvents(date: string): AgentEvent[]
          getEventsByThread(threadId: string): AgentEvent[]
        }

dependencies:
  blocked_by: []
  blocks: [HARNESS-JOURNAL-008]

approach:
  strategy: |
    Append-only JSONL file per day in harness memory directory.
    Same pattern as Edith's events.jsonl but scoped per-agent.
    Storage: <agentStatePath>/events/YYYY-MM-DD.jsonl
```

---

### HARNESS-INSTINCT-007
**Instinct writer tool — agent creates learned behaviors**

```yaml
task_id: HARNESS-INSTINCT-007
name: Instinct creation tool for agent self-learning
status: draft
complexity: medium

user_story: |
  As an agent, I want to write instinct files when I learn something from
  experience, so future sessions benefit from my accumulated judgment.

ownership:
  modifies:
    - packages/sdk/src/harness/instinct-writer.ts   # NEW
    - packages/sdk/src/tools/index.ts               # register new tool
  reads:
    - packages/sdk/src/harness/types.ts
    - packages/sdk/src/harness/frontmatter.ts
    - packages/sdk/src/tools/file/tools.ts          # tool creation pattern

interface_contracts:
  produces:
    - name: create_instinct tool
      signature: |
        input: { text: string, tags: string[], source: string }
        output: { path: string, id: string }

dependencies:
  blocked_by: [HARNESS-WIRE-003]
  blocks: [HARNESS-JOURNAL-008]

approach:
  strategy: |
    New tool callable by the agent. Generates frontmatter, L0/L1 from text,
    writes to instincts/ directory. Provenance (source session) tracked in
    frontmatter. Agent system prompt includes instruction to create instincts
    when it encounters surprising failures or validated approaches.
```

---

### HARNESS-JOURNAL-008
**Journal synthesizer — daily reflection from events**

```yaml
task_id: HARNESS-JOURNAL-008
name: Journal synthesis pipeline
status: draft
complexity: high

user_story: |
  As an agent runtime, I want to synthesize daily events into a coherent
  journal entry that identifies instinct candidates, so the agent grows
  from accumulated experience.

ownership:
  modifies:
    - packages/sdk/src/harness/journal.ts       # NEW
  reads:
    - packages/sdk/src/harness/events.ts        # event log reader
    - packages/sdk/src/harness/types.ts
    - packages/sdk/src/harness/instinct-writer.ts
    - packages/sdk/src/models.ts                # resolveModel for LLM call

interface_contracts:
  consumes:
    - name: EventLogger.getEvents
      source: harness/events.ts
  produces:
    - name: synthesizeJournal(date: string): Promise<JournalEntry>
    - name: JournalEntry
      signature: |
        {
          date: string
          reflection: string
          instinctCandidates: { text: string, tags: string[], reasoning: string }[]
          knowledgeUpdates: { entity: string, fact: string }[]
        }

dependencies:
  blocked_by: [HARNESS-EVENT-006, HARNESS-INSTINCT-007]
  blocks: []

approach:
  strategy: |
    1. Read day's events from JSONL
    2. Group by thread
    3. LLM call: "Synthesize these events into a journal entry.
       Identify lessons that should become instincts.
       Identify facts that should be stored as knowledge."
    4. Write journal to memory/journal/YYYY-MM-DD.md
    5. Optionally auto-create instinct drafts (status: draft, needs review)
  
  decision_points:
    - condition: If >50 events in a day
      action: Chunk into groups of 20, synthesize per-chunk, then meta-synthesize
    - condition: If no events for a day
      action: Skip, no journal entry created
```

---

## Phase 4: Scheduler + Workflows

### HARNESS-SCHED-009
**Cron scheduler for workflow execution**

```yaml
task_id: HARNESS-SCHED-009
name: Cron-based workflow scheduler
status: draft
complexity: medium

ownership:
  modifies:
    - packages/sdk/src/harness/scheduler.ts     # NEW
  reads:
    - packages/sdk/src/harness/types.ts         # Workflow type with schedule field
    - packages/sdk/src/harness/frontmatter.ts

dependencies:
  blocked_by: [HARNESS-TYPES-001]
  blocks: [HARNESS-PIPE-011]

approach:
  strategy: |
    Uses `croner` for cron parsing. Reads workflows/ directory, extracts
    `schedule` from frontmatter. On fire: invokes callback with workflow
    context. Respects quiet hours from config. Lightweight — no LLM
    dependency in the scheduler itself.
```

---

### HARNESS-ADAPT-010
**Adapter interface for external system connectors**

```yaml
task_id: HARNESS-ADAPT-010
name: Adapter interface and base implementation
status: draft
complexity: medium

ownership:
  modifies:
    - packages/sdk/src/harness/adapter.ts       # NEW — interface + base class
  reads:
    - packages/sdk/src/harness/types.ts         # AgentEvent

dependencies:
  blocked_by: [HARNESS-EVENT-006]
  blocks: [HARNESS-PIPE-011]

interface_contracts:
  produces:
    - name: Adapter
      signature: |
        interface Adapter {
          name: string
          connect(): Promise<void>
          disconnect(): Promise<void>
          onEvent(handler: (event: AgentEvent) => void): void
        }
```

---

### HARNESS-PIPE-011
**Event pipeline — adapters → gateway → agent**

```yaml
task_id: HARNESS-PIPE-011
name: Two-tier event pipeline with gateway filtering
status: draft
complexity: high

ownership:
  modifies:
    - packages/sdk/src/harness/gateway.ts       # NEW — tier 1 rules engine
    - packages/sdk/src/harness/pipeline.ts      # NEW — orchestrates flow

dependencies:
  blocked_by: [HARNESS-SCHED-009, HARNESS-ADAPT-010]
  blocks: []

approach:
  strategy: |
    Tier 1 (Gateway): Deterministic rules compiled from harness rules/.
    Pattern match on event fields → drop | log | batch | forward.
    No LLM calls. Millisecond evaluation.
    
    Tier 2 (Agent): For forwarded events, check instincts and playbooks
    before invoking LLM. LLM is last resort.
    
    Pipeline: Adapter → Gateway → Priority Queue → Agent Handler
```

---

## Phase 5: Package Management

### HARNESS-EVAL-012
**Evaluator pipeline for capability validation**

```yaml
task_id: HARNESS-EVAL-012
name: Capability evaluation and installation pipeline
status: draft
complexity: high

ownership:
  modifies:
    - packages/sdk/src/harness/evaluator.ts     # NEW
    - packages/sdk/src/harness/installer.ts     # NEW

dependencies:
  blocked_by: [HARNESS-INDEX-005]
  blocks: [HARNESS-CLI-013]

approach:
  strategy: |
    6-step pipeline: format validation → type detection → compatibility
    check → dependency resolution → auto-fix → report.
    Stateless evaluator — reads harness, validates incoming file, reports.
    Can optionally use LLM for type detection and auto-fix steps.
```

---

### HARNESS-CLI-013
**CLI commands for capability management**

```yaml
task_id: HARNESS-CLI-013
name: CLI install/update/uninstall commands
status: draft
complexity: medium

ownership:
  modifies:
    - packages/cli/src/commands/install.ts      # NEW
    - packages/cli/src/commands/update.ts       # NEW
    - packages/cli/src/commands/uninstall.ts    # NEW
    - packages/cli/src/index.ts                 # register commands

dependencies:
  blocked_by: [HARNESS-EVAL-012]
  blocks: []
```

---

## Dependency Graph

```
HARNESS-TYPES-001 (foundation)
├── HARNESS-GOV-002 (governance loader)
│   └── HARNESS-WIRE-003 (wire into createAgent)
│       └── HARNESS-INSTINCT-007 (instinct writer tool)
│           └── HARNESS-JOURNAL-008 (journal synthesis) ←── HARNESS-EVENT-006
├── HARNESS-LOAD-004 (token-budgeted loader)
├── HARNESS-INDEX-005 (manifest builder)
│   └── HARNESS-EVAL-012 (evaluator)
│       └── HARNESS-CLI-013 (CLI commands)
├── HARNESS-EVENT-006 (event logger)
│   └── HARNESS-ADAPT-010 (adapter interface)
│       └── HARNESS-PIPE-011 (event pipeline) ←── HARNESS-SCHED-009
└── HARNESS-SCHED-009 (scheduler)
```

## Parallelization

```yaml
# Can run simultaneously (no shared files):
parallel_group_1: [HARNESS-TYPES-001]
parallel_group_2: [HARNESS-GOV-002, HARNESS-EVENT-006]  # after group 1
parallel_group_3: [HARNESS-WIRE-003, HARNESS-LOAD-004, HARNESS-INDEX-005, HARNESS-SCHED-009, HARNESS-ADAPT-010]
parallel_group_4: [HARNESS-INSTINCT-007, HARNESS-EVAL-012, HARNESS-PIPE-011]
parallel_group_5: [HARNESS-JOURNAL-008, HARNESS-CLI-013]
```

## Priority Order (if serializing)

| # | Task | Why First |
|---|---|---|
| 1 | HARNESS-TYPES-001 | Everything depends on it |
| 2 | HARNESS-GOV-002 | Core value prop — governance tiers |
| 3 | HARNESS-WIRE-003 | Makes governance usable in createAgent() |
| 4 | HARNESS-EVENT-006 | Foundation for growth loop |
| 5 | HARNESS-INSTINCT-007 | Agent can now learn |
| 6 | HARNESS-JOURNAL-008 | Closes the growth loop |
| 7 | HARNESS-LOAD-004 | Scaling — matters at 50+ files |
| 8 | HARNESS-INDEX-005 | Companion to loader |
| 9 | HARNESS-SCHED-009 | Enables autonomous operation |
| 10 | HARNESS-ADAPT-010 | External connectivity |
| 11 | HARNESS-PIPE-011 | Full event architecture |
| 12 | HARNESS-EVAL-012 | Package management |
| 13 | HARNESS-CLI-013 | User-facing install commands |

13 tasks total. Tasks 1-6 deliver the core differentiator (governance + growth loop). Tasks 7-8 handle scaling. Tasks 9-13 are runtime/ops.
