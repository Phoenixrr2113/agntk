import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
  }),
}));

import { createBackgroundTool, clearBackgroundSessions } from '../tools/shell/background';

const callCtx = {
  toolCallId: 'test',
  messages: [],
};

afterEach(() => {
  clearBackgroundSessions();
});

describe('background tool', () => {
  describe('start', () => {
    it('should start a background process', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse(
        (await bg.execute!({ operation: 'start', command: 'echo "hello"' }, callCtx)) as string,
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^bg-/);
      expect(result.status).toBe('running');
    });

    it('should require command for start', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse((await bg.execute!({ operation: 'start' }, callCtx)) as string);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should block dangerous commands', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse(
        (await bg.execute!({ operation: 'start', command: 'rm -rf /' }, callCtx)) as string,
      );

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('list', () => {
    it('should list empty sessions', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse((await bg.execute!({ operation: 'list' }, callCtx)) as string);

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.sessions).toEqual([]);
    });

    it('should list started sessions', async () => {
      const bg = createBackgroundTool();
      await bg.execute!({ operation: 'start', command: 'sleep 1' }, callCtx);
      await bg.execute!({ operation: 'start', command: 'sleep 2' }, callCtx);

      const result = JSON.parse((await bg.execute!({ operation: 'list' }, callCtx)) as string);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });
  });

  describe('status', () => {
    it('should require sessionId', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse((await bg.execute!({ operation: 'status' }, callCtx)) as string);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should return not found for unknown session', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse(
        (await bg.execute!({ operation: 'status', sessionId: 'bg-unknown' }, callCtx)) as string,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should show status of a started session', async () => {
      const bg = createBackgroundTool();
      const startResult = JSON.parse(
        (await bg.execute!({ operation: 'start', command: 'sleep 10' }, callCtx)) as string,
      );

      const result = JSON.parse(
        (await bg.execute!(
          { operation: 'status', sessionId: startResult.sessionId },
          callCtx,
        )) as string,
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('running');
      expect(result.runningFor).toBeDefined();
    });
  });

  describe('output', () => {
    it('should return output from a process', async () => {
      const bg = createBackgroundTool();
      const startResult = JSON.parse(
        (await bg.execute!(
          { operation: 'start', command: 'echo "test output"' },
          callCtx,
        )) as string,
      );

      await new Promise((r) => setTimeout(r, 500));

      const result = JSON.parse(
        (await bg.execute!(
          { operation: 'output', sessionId: startResult.sessionId },
          callCtx,
        )) as string,
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('test output');
    });
  });

  describe('stop', () => {
    it('should stop a running process', async () => {
      const bg = createBackgroundTool();
      const startResult = JSON.parse(
        (await bg.execute!({ operation: 'start', command: 'sleep 60' }, callCtx)) as string,
      );

      const result = JSON.parse(
        (await bg.execute!(
          { operation: 'stop', sessionId: startResult.sessionId },
          callCtx,
        )) as string,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('terminated');
    });

    it('should handle stopping already completed process', async () => {
      const bg = createBackgroundTool();
      const startResult = JSON.parse(
        (await bg.execute!({ operation: 'start', command: 'echo done' }, callCtx)) as string,
      );

      await new Promise((r) => setTimeout(r, 500));

      const result = JSON.parse(
        (await bg.execute!(
          { operation: 'stop', sessionId: startResult.sessionId },
          callCtx,
        )) as string,
      );

      expect(result.success).toBe(true);

      expect(result.message).toBeDefined();
    });
  });

  describe('unknown operation', () => {
    it('should return error for unknown operation', async () => {
      const bg = createBackgroundTool();
      const result = JSON.parse(
        (await bg.execute!({ operation: 'invalid' as 'list' }, callCtx)) as string,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });
});
