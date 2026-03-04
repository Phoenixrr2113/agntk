import { describe, it, expect } from 'vitest';
import { createPlanTool, createDeepReasoningTool } from '@agntk/core/tools';

function parse(result: string | Record<string, unknown>) {
  if (typeof result === 'string') return JSON.parse(result) as Record<string, unknown>;
  return result;
}

describe('plan tool', () => {
  it('creates a plan with steps', async () => {
    const plan = createPlanTool({});
    const result = parse(
      await plan.execute!(
        {
          action: 'create',
          title: 'Test Plan',
          steps: ['Step one', 'Step two', 'Step three'],
        },
        {} as never,
      ),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('Test Plan');
  });

  it('views current plan', async () => {
    const plan = createPlanTool({});
    await plan.execute!(
      { action: 'create', title: 'View Test', steps: ['Alpha', 'Beta'] },
      {} as never,
    );
    const result = parse(await plan.execute!({ action: 'view' }, {} as never));
    expect(result.success).toBe(true);
    const planData = result.plan as Record<string, unknown>;
    expect(planData.title).toBe('View Test');
  });

  it('updates step status', async () => {
    const plan = createPlanTool({});
    await plan.execute!(
      { action: 'create', title: 'Update Test', steps: ['Do thing'] },
      {} as never,
    );
    const result = parse(
      await plan.execute!(
        { action: 'update_status', stepName: 'Do thing', status: 'completed' },
        {} as never,
      ),
    );
    expect(result.success).toBe(true);
  });
});

describe('deep reasoning tool', () => {
  it('accepts a single thought', async () => {
    const reasoning = createDeepReasoningTool();
    const result = parse(
      await reasoning.execute!(
        {
          thought: 'The problem requires analyzing the input constraints.',
          nextThoughtNeeded: false,
          thoughtNumber: 1,
          totalThoughts: 1,
        },
        {} as never,
      ),
    );
    expect(result.thoughtNumber).toBe(1);
    expect(result.nextThoughtNeeded).toBe(false);
  });

  it('supports multi-step reasoning chain', async () => {
    const reasoning = createDeepReasoningTool();
    const step1 = parse(
      await reasoning.execute!(
        {
          thought: 'First, identify the key variables.',
          nextThoughtNeeded: true,
          thoughtNumber: 1,
          totalThoughts: 3,
        },
        {} as never,
      ),
    );
    expect(step1.nextThoughtNeeded).toBe(true);

    const step2 = parse(
      await reasoning.execute!(
        {
          thought: 'Next, analyze their relationships.',
          nextThoughtNeeded: true,
          thoughtNumber: 2,
          totalThoughts: 3,
        },
        {} as never,
      ),
    );
    expect(step2.thoughtNumber).toBe(2);

    const step3 = parse(
      await reasoning.execute!(
        {
          thought: 'Finally, the answer is 42.',
          nextThoughtNeeded: false,
          thoughtNumber: 3,
          totalThoughts: 3,
        },
        {} as never,
      ),
    );
    expect(step3.nextThoughtNeeded).toBe(false);
    expect(step3.thoughtHistoryLength).toBeGreaterThanOrEqual(3);
  });

  it('supports branching', async () => {
    const reasoning = createDeepReasoningTool();
    const result = parse(
      await reasoning.execute!(
        {
          thought: 'Exploring alternative approach.',
          nextThoughtNeeded: true,
          thoughtNumber: 1,
          totalThoughts: 2,
          branchId: 'alt-approach',
          branchFromThought: 0,
        },
        {} as never,
      ),
    );
    expect(result.branches).toBeDefined();
  });
});
