import { describe, it, expect, vi } from 'vitest';
import type { Tool, ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(() => vi.fn()),
      trace: vi.fn(),
    })),
  }),
}));

import {
  isDangerousTool,
  DANGEROUS_TOOLS,
  wrapToolWithApproval,
  applyApproval,
  resolveApprovalConfig,
  type ApprovalConfig,
} from '../tools/approval';

function createMockTool(name = 'test'): Tool {
  return tool({
    description: `Mock ${name} tool`,
    parameters: z.object({ input: z.string().optional() }),
    execute: async ({ input }) => `Executed ${name}: ${input ?? 'none'}`,
  });
}

describe('isDangerousTool', () => {
  it('should identify default dangerous tools', () => {
    expect(isDangerousTool('shell')).toBe(true);
    expect(isDangerousTool('browser')).toBe(true);
    expect(isDangerousTool('file_write')).toBe(true);
    expect(isDangerousTool('file_edit')).toBe(true);
    expect(isDangerousTool('file_create')).toBe(true);
  });

  it('should not flag safe tools', () => {
    expect(isDangerousTool('glob')).toBe(false);
    expect(isDangerousTool('grep')).toBe(false);
    expect(isDangerousTool('file_read')).toBe(false);
    expect(isDangerousTool('plan')).toBe(false);
  });

  it('should use custom list when provided', () => {
    expect(isDangerousTool('custom_tool', ['custom_tool'])).toBe(true);
    expect(isDangerousTool('shell', ['custom_tool'])).toBe(false);
  });
});

describe('DANGEROUS_TOOLS', () => {
  it('should contain expected tools', () => {
    expect(DANGEROUS_TOOLS.has('shell')).toBe(true);
    expect(DANGEROUS_TOOLS.has('browser')).toBe(true);
    expect(DANGEROUS_TOOLS.has('file_write')).toBe(true);
    expect(DANGEROUS_TOOLS.has('file_edit')).toBe(true);
    expect(DANGEROUS_TOOLS.has('file_create')).toBe(true);
  });

  it('should have exactly 5 default dangerous tools', () => {
    expect(DANGEROUS_TOOLS.size).toBe(5);
  });
});

describe('wrapToolWithApproval', () => {
  it('should add needsApproval: true without handler', () => {
    const mockTool = createMockTool('shell');
    const wrapped = wrapToolWithApproval('shell', mockTool, { enabled: true });
    expect((wrapped as Record<string, unknown>).needsApproval).toBe(true);
  });

  it('should preserve tool execute function', async () => {
    const mockTool = createMockTool('shell');
    const wrapped = wrapToolWithApproval('shell', mockTool, { enabled: true });

    expect(wrapped.execute).toBeDefined();
  });

  it('should use custom handler when provided', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const mockTool = createMockTool('shell');
    const wrapped = wrapToolWithApproval('shell', mockTool, {
      enabled: true,
      handler,
    });

    const needsApproval = (wrapped as Record<string, unknown>).needsApproval;
    expect(typeof needsApproval).toBe('function');

    const result = await (needsApproval as (input: unknown) => Promise<boolean>)({
      cmd: 'rm -rf /',
    });
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'shell',
        input: { cmd: 'rm -rf /' },
      }),
    );
  });

  it('should deny on timeout when timeoutAction is deny', async () => {
    const handler = vi.fn().mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const mockTool = createMockTool('shell');
    const wrapped = wrapToolWithApproval('shell', mockTool, {
      enabled: true,
      handler,
      timeout: 50,
      timeoutAction: 'deny',
    });

    const needsApproval = (wrapped as Record<string, unknown>).needsApproval as (
      input: unknown,
    ) => Promise<boolean>;
    const result = await needsApproval({ cmd: 'test' });
    expect(result).toBe(false);
  });

  it('should approve on timeout when timeoutAction is approve', async () => {
    const handler = vi.fn().mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const mockTool = createMockTool('shell');
    const wrapped = wrapToolWithApproval('shell', mockTool, {
      enabled: true,
      handler,
      timeout: 50,
      timeoutAction: 'approve',
    });

    const needsApproval = (wrapped as Record<string, unknown>).needsApproval as (
      input: unknown,
    ) => Promise<boolean>;
    const result = await needsApproval({ cmd: 'test' });
    expect(result).toBe(true);
  });
});

describe('applyApproval', () => {
  it('should not modify tools when disabled', () => {
    const tools: ToolSet = {
      shell: createMockTool('shell'),
      glob: createMockTool('glob'),
    };

    const result = applyApproval(tools, { enabled: false });
    expect((result.shell as Record<string, unknown>).needsApproval).toBeUndefined();
  });

  it('should flag dangerous tools when enabled', () => {
    const tools: ToolSet = {
      shell: createMockTool('shell'),
      glob: createMockTool('glob'),
      file_write: createMockTool('file_write'),
    };

    const result = applyApproval(tools, { enabled: true });
    expect((result.shell as Record<string, unknown>).needsApproval).toBe(true);
    expect((result.file_write as Record<string, unknown>).needsApproval).toBe(true);
    expect((result.glob as Record<string, unknown>).needsApproval).toBeUndefined();
  });

  it('should only flag custom tool list when provided', () => {
    const tools: ToolSet = {
      shell: createMockTool('shell'),
      glob: createMockTool('glob'),
      custom: createMockTool('custom'),
    };

    const result = applyApproval(tools, { enabled: true, tools: ['custom'] });
    expect((result.custom as Record<string, unknown>).needsApproval).toBe(true);
    expect((result.shell as Record<string, unknown>).needsApproval).toBeUndefined();
  });

  it('should preserve all tools in output', () => {
    const tools: ToolSet = {
      shell: createMockTool('shell'),
      glob: createMockTool('glob'),
      plan: createMockTool('plan'),
    };

    const result = applyApproval(tools, { enabled: true });
    expect(Object.keys(result)).toHaveLength(3);
    expect(result.shell).toBeDefined();
    expect(result.glob).toBeDefined();
    expect(result.plan).toBeDefined();
  });
});

describe('resolveApprovalConfig', () => {
  it('should return undefined for falsy input', () => {
    expect(resolveApprovalConfig(undefined)).toBeUndefined();
    expect(resolveApprovalConfig(false)).toBeUndefined();
  });

  it('should create default config from true', () => {
    const config = resolveApprovalConfig(true);
    expect(config).toEqual({ enabled: true });
  });

  it('should pass through full config', () => {
    const input: ApprovalConfig = {
      enabled: true,
      tools: ['shell'],
      timeout: 5000,
    };
    expect(resolveApprovalConfig(input)).toBe(input);
  });
});

describe('agent approval integration', () => {
  it('should accept approval: true in createAgent', async () => {
    const { createAgent } = await import('../agent');
    const agent = createAgent({ name: 'approval-test', approval: true });
    expect(agent).toBeDefined();
  });

  it('should accept approval config object', async () => {
    const { createAgent } = await import('../agent');
    const agent = createAgent({
      name: 'approval-config-test',
      approval: { enabled: true, tools: ['shell'], timeout: 5000 },
    });
    expect(agent).toBeDefined();
  });

  it('should accept approval: false without error', async () => {
    const { createAgent } = await import('../agent');
    const agent = createAgent({ name: 'approval-false-test', approval: false });
    expect(agent).toBeDefined();
  });
});
