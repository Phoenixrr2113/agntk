import { describe, it, expect } from 'vitest';
import {
  defineHook,
  resumeHook,
  getHookRegistry,
  HookNotFoundError,
  HookNotPendingError,
  HookRejectedError,
  FatalError,
  RetryableError,
} from '@agntk/core/advanced';

describe('Hooks & Human-in-the-Loop', () => {
  describe('defineHook', () => {
    it('should create a hook object with wait method', () => {
      const hook = defineHook({
        name: 'approval',
        description: 'Requires human approval to proceed',
      });

      expect(hook).toBeDefined();
      expect(hook.name).toBe('approval');
      expect(typeof hook.wait).toBe('function');
    });

    it('should create a hook with timeout and default value', () => {
      const hook = defineHook({
        name: 'review',
        timeout: '30m',
        defaultValue: { approved: false },
      });

      expect(hook).toBeDefined();
      expect(hook.name).toBe('review');
    });

    it('should expose description on the hook', () => {
      const hook = defineHook({
        name: 'described-hook',
        description: 'This hook does something special',
      });

      expect(hook.description).toBe('This hook does something special');
    });

    it('should expose waitWithId method', () => {
      const hook = defineHook({
        name: 'id-hook',
        description: 'Hook with custom ID support',
      });

      expect(typeof hook.waitWithId).toBe('function');
    });
  });

  describe('HookRegistry', () => {
    it('should return a singleton registry', () => {
      const registry1 = getHookRegistry();
      const registry2 = getHookRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should have listPending method', () => {
      const registry = getHookRegistry();
      expect(typeof registry.listPending).toBe('function');
      const pending = registry.listPending();
      expect(Array.isArray(pending)).toBe(true);
    });
  });

  describe('resumeHook', () => {
    it('should throw HookNotFoundError for unknown hook ID', async () => {
      await expect(resumeHook('nonexistent-hook-id', {})).rejects.toThrow(HookNotFoundError);
    });
  });

  describe('Error classes', () => {
    it('HookNotFoundError should be an Error', () => {
      const err = new HookNotFoundError('test-id');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('test-id');
    });

    it('HookNotPendingError should be an Error', () => {
      const err = new HookNotPendingError('test-id', 'resolved');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('test-id');
    });

    it('HookRejectedError should be an Error', () => {
      const err = new HookRejectedError('test-id', 'Rejected by user');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('Rejected');
    });

    it('FatalError should be an Error', () => {
      const err = new FatalError('Something unrecoverable');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('unrecoverable');
    });

    it('RetryableError should be an Error', () => {
      const err = new RetryableError('Try again');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('Try again');
    });
  });
});
