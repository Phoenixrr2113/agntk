<!--
 @fileoverview Technical plan for fixing sub-agent spawning, plan tool delegation constraints,
 and workspace path resolution issues in the SDK.
-->

# Plan: Fix Sub-Agent Spawning, Plan Delegation, and Workspace Issues

## Root Cause Analysis

### Issue 1: Sub-agents can spawn more sub-agents

**File:** `packages/sdk/src/agent.ts:39`
`DEFAULT_MAX_SPAWN_DEPTH = 2` means depth-1 sub-agents pass the `< 2` check on line 162 and get `spawn_agent` in their toolset. The user expects only the parent to spawn.

**Fix:** Change `DEFAULT_MAX_SPAWN_DEPTH` from `2` to `1`.

---

### Issue 2: Plan tool forces delegation on 5+ step plans, even in sub-agents

**File:** `packages/sdk/src/tools/plan/tools.ts:192-201`
When a sub-agent creates a 5+ step plan and tries `decide("proceed")`, the plan tool returns an error forcing delegation. But delegation = `spawn_agent`, which creates unwanted nesting (and is now blocked by Fix 1). Sub-agents get stuck.

**File:** `packages/sdk/src/agent.ts:133`
`createToolPreset('full', ...)` is called for ALL agents with no `planConfig` override — sub-agents get `disableDelegation: false` by default.

**Fix:** When `isSubAgent` is true, pass `planConfig: { disableDelegation: true }` to `createToolPreset` so sub-agents can proceed on plans of any size.

---

### Issue 3: Sub-agent workspace path is always `undefined`

**File:** `packages/sdk/src/agent.ts:167`
`workspacePath: undefined` is hardcoded in the `createSpawnAgentTool` options. This flows to `spawn-agent/index.ts:160`:

```ts
const agentWorkspacePath = workspacePath ? `${workspacePath}/${agentId}` : agentId;
```

Result: workspace becomes a bare `agentId` string (e.g., `"add-fileoverview-headers-Osb3"`) — a relative path that resolves to nothing. The parent can't find it, the sub-agent can't write to it.

**Fix:** Pass the resolved `agentStatePath` (or a sub-directory of it) as `workspacePath` when creating the spawn tool. This gives sub-agents a real directory under `.agntk/agents/<parent>/`.

---

### Issue 4: Empty summaries returned to parent

**File:** `packages/sdk/src/tools/spawn-agent/index.ts:387-403`
`extractSummary` returns `fullOutput` as-is when ≤500 chars. If the sub-agent produces zero text output (only tool calls, no final text), `fullOutput` is empty string → summary is `""`.

**Fix:** Detect empty output and return a descriptive fallback like `"Sub-agent completed but produced no text output. Check workspace for results."`. Also log a warning.

---

## Changes

### File 1: `packages/sdk/src/agent.ts`

1. **Line 39:** Change `DEFAULT_MAX_SPAWN_DEPTH` from `2` to `1`

2. **Line 133-136:** Pass `planConfig` based on `isSubAgent`:

   ```ts
   const planConfig = isSubAgent ? { disableDelegation: true } : undefined;
   let tools: ToolSet = createToolPreset('full', {
     workspaceRoot,
     fileOptions: { allowedPaths: [agentStatePath] },
     planConfig,
   }) as ToolSet;
   ```

3. **Line 167:** Replace `workspacePath: undefined` with actual workspace path:
   ```ts
   workspacePath: join(agentStatePath, 'workspace'),
   ```

### File 2: `packages/sdk/src/tools/spawn-agent/index.ts`

4. **Lines 387-403:** Handle empty output in `extractSummary`:
   ```ts
   async function extractSummary(fullOutput: string, originalTask: string): Promise<string> {
     if (!fullOutput.trim()) {
       log.warn('Sub-agent produced no text output', { task: originalTask.slice(0, 80) });
       return 'Sub-agent completed but produced no text output. Check workspace for results.';
     }
     // ... rest unchanged
   }
   ```

## Verification

- Unit tests for spawn-agent depth blocking
- Unit tests for plan tool with `disableDelegation: true`
- Integration: run `npx agntk` with a multi-file task and verify:
  - No sub-sub-agents spawned
  - Sub-agents can proceed on 5+ step plans
  - Workspace paths resolve to real directories
  - Non-empty summaries returned
