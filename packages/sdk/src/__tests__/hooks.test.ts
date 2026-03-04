import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defineHook,
  createWebhook,
  sleep,
  getHookRegistry,
  _resetHookRegistry,
  _resetHookCounter,
  _resetWdkCache,
  HookRegistry,
  HookNotFoundError,
  HookNotPendingError,
  HookRejectedError,
} from '../workflow/hooks';

const tick = () => Promise.resolve();

beforeEach(() => {
  _resetHookRegistry();
  _resetHookCounter();

  _resetWdkCache(true);
});

afterEach(() => {
  _resetHookRegistry();
  _resetHookCounter();
  _resetWdkCache();
});

describe('defineHook', () => {
  it('creates a typed hook factory with name and description', () => {
    const hook = defineHook({
      name: 'approval',
      description: 'Approve dangerous actions',
    });

    expect(hook.name).toBe('approval');
    expect(hook.description).toBe('Approve dangerous actions');
    expect(typeof hook.wait).toBe('function');
    expect(typeof hook.waitWithId).toBe('function');
  });

  it('creates a hook with timeout and defaultValue', () => {
    const hook = defineHook<{ action: string }, { approved: boolean }>({
      name: 'approval',
      timeout: '30m',
      defaultValue: { approved: false },
    });

    expect(hook.name).toBe('approval');
  });

  it('hook.wait() registers a pending hook in the registry', async () => {
    const hook = defineHook<{ action: string }, { approved: boolean }>({
      name: 'approval',
    });

    const registry = getHookRegistry();

    const promise = hook.wait({ action: 'delete files' });
    await tick();

    const pending = registry.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].name).toBe('approval');
    expect(pending[0].status).toBe('pending');
    expect(pending[0].payload).toEqual({ action: 'delete files' });

    await registry.resume(pending[0].id, { approved: true });
    const result = await promise;
    expect(result).toEqual({ approved: true });
  });

  it('hook.waitWithId() uses the provided ID', async () => {
    const hook = defineHook<{ action: string }, boolean>({
      name: 'confirm',
    });

    const registry = getHookRegistry();
    const promise = hook.waitWithId('my-custom-id', { action: 'test' });
    await tick();

    expect(registry.has('my-custom-id')).toBe(true);

    const instance = registry.get('my-custom-id');
    expect(instance?.id).toBe('my-custom-id');
    expect(instance?.name).toBe('confirm');

    await registry.resume('my-custom-id', true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('hook.wait() generates unique IDs', async () => {
    const hook = defineHook({ name: 'test' });

    const registry = getHookRegistry();
    const p1 = hook.wait({ a: 1 });
    const p2 = hook.wait({ a: 2 });
    await tick();

    const pending = registry.listPending();
    expect(pending.length).toBe(2);
    expect(pending[0].id).not.toBe(pending[1].id);

    await registry.resume(pending[0].id, 'r1');
    await registry.resume(pending[1].id, 'r2');
    await p1;
    await p2;
  });

  it('hook with timeout resolves with defaultValue', async () => {
    vi.useFakeTimers();

    const hook = defineHook<{ msg: string }, { approved: boolean; reason?: string }>({
      name: 'timed-approval',
      timeout: '5s',
      defaultValue: { approved: false, reason: 'Timed out' },
    });

    const promise = hook.wait({ msg: 'Approve this?' });
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(6000);

    const result = await promise;
    expect(result).toEqual({ approved: false, reason: 'Timed out' });

    const registry = getHookRegistry();
    const hooks = registry.list('timed_out');
    expect(hooks.length).toBe(1);

    vi.useRealTimers();
  });

  it('hook resolved before timeout does not trigger default', async () => {
    vi.useFakeTimers();

    const hook = defineHook<unknown, string>({
      name: 'fast',
      timeout: '10s',
      defaultValue: 'timed-out',
    });

    const registry = getHookRegistry();
    const promise = hook.wait({});
    await vi.advanceTimersByTimeAsync(0);

    const pending = registry.listPending();
    await registry.resume(pending[0].id, 'resolved!');

    const result = await promise;
    expect(result).toBe('resolved!');

    vi.advanceTimersByTime(15000);

    const hook0 = registry.get(pending[0].id);
    expect(hook0?.status).toBe('resolved');

    vi.useRealTimers();
  });

  it('validates resume payload when validator provided', async () => {
    const hook = defineHook<{ msg: string }, { count: number }>({
      name: 'validated',
      validate: (payload) => {
        if (payload.count < 0) {
          throw new Error('Count must be non-negative');
        }
      },
    });

    const registry = getHookRegistry();
    const promise = hook.wait({ msg: 'Enter count' });
    await tick();

    const pending = registry.listPending();

    await expect(registry.resume(pending[0].id, { count: -1 })).rejects.toThrow(
      'Count must be non-negative',
    );

    expect(registry.get(pending[0].id)?.status).toBe('pending');

    await registry.resume(pending[0].id, { count: 5 });
    const result = await promise;
    expect(result).toEqual({ count: 5 });
  });
});

describe('HookRegistry', () => {
  it('starts empty', () => {
    const registry = new HookRegistry();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it('register creates a pending hook', async () => {
    const registry = new HookRegistry();

    const promise = registry.register('hook-1', 'test', { data: 123 });

    expect(registry.has('hook-1')).toBe(true);
    expect(registry.get('hook-1')?.status).toBe('pending');
    expect(registry.get('hook-1')?.name).toBe('test');
    expect(registry.size).toBe(1);

    await registry.resume('hook-1', 'ok');
    await promise;
  });

  it('register throws on duplicate ID', async () => {
    const registry = new HookRegistry();

    registry.register('dup-1', 'test', {});

    expect(() => registry.register('dup-1', 'test', {})).toThrow(
      'Hook with ID "dup-1" already exists',
    );

    await registry.resume('dup-1', 'ok');
  });

  it('resume resolves the hook', async () => {
    const registry = new HookRegistry();

    const promise = registry.register<unknown, string>('r-1', 'test', {});

    const instance = await registry.resume('r-1', 'result-value');

    expect(instance.status).toBe('resolved');
    expect(instance.resolvedAt).toBeInstanceOf(Date);
    expect(instance.result).toBe('result-value');

    const result = await promise;
    expect(result).toBe('result-value');
  });

  it('resume throws HookNotFoundError for unknown ID', async () => {
    const registry = new HookRegistry();

    await expect(registry.resume('nonexistent', {})).rejects.toThrow(HookNotFoundError);
  });

  it('resume throws HookNotPendingError for already resolved hook', async () => {
    const registry = new HookRegistry();

    registry.register('rr-1', 'test', {});
    await registry.resume('rr-1', 'first');

    await expect(registry.resume('rr-1', 'second')).rejects.toThrow(HookNotPendingError);
  });

  it('reject transitions hook to rejected status', async () => {
    const registry = new HookRegistry();

    const promise = registry.register('rej-1', 'test', {});

    const instance = registry.reject('rej-1', 'Not approved');

    expect(instance.status).toBe('rejected');
    expect(instance.resolvedAt).toBeInstanceOf(Date);

    await expect(promise).rejects.toThrow(HookRejectedError);
    await expect(promise).rejects.toThrow('Not approved');
  });

  it('reject throws HookNotFoundError for unknown ID', () => {
    const registry = new HookRegistry();

    expect(() => registry.reject('nonexistent', 'reason')).toThrow(HookNotFoundError);
  });

  it('listPending returns only pending hooks', async () => {
    const registry = new HookRegistry();

    registry.register('p-1', 'test', {});
    registry.register('p-2', 'test', {});
    registry.register('p-3', 'test', {});

    await registry.resume('p-2', 'done');

    const pending = registry.listPending();
    expect(pending.length).toBe(2);
    expect(pending.map((h) => h.id).sort()).toEqual(['p-1', 'p-3']);

    await registry.resume('p-1', 'ok');
    await registry.resume('p-3', 'ok');
  });

  it('list with status filter works', async () => {
    const registry = new HookRegistry();

    registry.register('f-1', 'test', {});
    registry.register('f-2', 'test', {});

    await registry.resume('f-1', 'done');

    expect(registry.list('resolved').length).toBe(1);
    expect(registry.list('pending').length).toBe(1);

    await registry.resume('f-2', 'ok');
  });

  it('clear removes all hooks', async () => {
    const registry = new HookRegistry();

    registry.register('c-1', 'test', {});
    registry.register('c-2', 'test', {});

    expect(registry.size).toBe(2);

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.has('c-1')).toBe(false);
  });
});

describe('HookNotFoundError', () => {
  it('has correct properties', () => {
    const error = new HookNotFoundError('hook-123');

    expect(error.message).toBe('Hook "hook-123" not found');
    expect(error.name).toBe('HookNotFoundError');
    expect(error.hookId).toBe('hook-123');
    expect(error instanceof Error).toBe(true);
  });
});

describe('HookNotPendingError', () => {
  it('has correct properties', () => {
    const error = new HookNotPendingError('hook-456', 'resolved');

    expect(error.message).toBe('Hook "hook-456" is not pending (status: resolved)');
    expect(error.name).toBe('HookNotPendingError');
    expect(error.hookId).toBe('hook-456');
    expect(error.currentStatus).toBe('resolved');
    expect(error instanceof Error).toBe(true);
  });
});

describe('HookRejectedError', () => {
  it('has correct properties', () => {
    const error = new HookRejectedError('hook-789', 'User said no');

    expect(error.message).toBe('Hook "hook-789" was rejected: User said no');
    expect(error.name).toBe('HookRejectedError');
    expect(error.hookId).toBe('hook-789');
    expect(error.reason).toBe('User said no');
    expect(error instanceof Error).toBe(true);
  });
});

describe('createWebhook', () => {
  it('creates a webhook with auto-generated ID', async () => {
    const { id, promise } = createWebhook<{ approved: boolean }>({
      callbackPath: '/api/approve',
    });

    expect(id).toMatch(/^hook-webhook-/);

    const registry = getHookRegistry();
    expect(registry.has(id)).toBe(true);

    await registry.resume(id, { approved: true });

    const result = await promise;
    expect(result.data).toEqual({ approved: true });
    expect(result.timedOut).toBe(false);
  });

  it('creates a webhook with custom ID', async () => {
    const { id, promise } = createWebhook({
      id: 'wh-custom-123',
    });

    expect(id).toBe('wh-custom-123');

    const registry = getHookRegistry();
    await registry.resume(id, 'payload');

    const result = await promise;
    expect(result.data).toBe('payload');
  });

  it('webhook times out with default value', async () => {
    vi.useFakeTimers();

    const { promise } = createWebhook<boolean>({
      timeout: '3s',
      defaultValue: false,
    });

    vi.advanceTimersByTime(4000);

    const result = await promise;
    expect(result.data).toBe(false);
    expect(result.timedOut).toBe(true);

    vi.useRealTimers();
  });
});

describe('sleep', () => {
  it('sleeps for the specified duration using setTimeout fallback', async () => {
    const start = Date.now();
    await sleep('1s', { reason: 'testing' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(3000);
  }, 10000);

  it('throws on invalid duration format', async () => {
    await expect(sleep('invalid')).rejects.toThrow('Invalid duration format');
  });
});

describe('getHookRegistry singleton', () => {
  it('returns the same registry on repeated calls', () => {
    const r1 = getHookRegistry();
    const r2 = getHookRegistry();
    expect(r1).toBe(r2);
  });

  it('_resetHookRegistry creates a fresh registry', () => {
    const r1 = getHookRegistry();
    r1.register('test-1', 'test', {});
    expect(r1.size).toBe(1);

    _resetHookRegistry();

    const r2 = getHookRegistry();
    expect(r2).not.toBe(r1);
    expect(r2.size).toBe(0);
  });
});

describe('Integration: full hook lifecycle', () => {
  it('defineHook → wait → resume → result', async () => {
    const approvalHook = defineHook<
      { action: string; files: string[] },
      { approved: boolean; reason?: string }
    >({
      name: 'file-deletion-approval',
      description: 'Approve file deletions',
    });

    const registry = getHookRegistry();

    const resultPromise = approvalHook.wait({
      action: 'delete',
      files: ['a.txt', 'b.txt'],
    });
    await tick();

    const pending = registry.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].payload).toEqual({
      action: 'delete',
      files: ['a.txt', 'b.txt'],
    });

    await registry.resume(pending[0].id, {
      approved: true,
      reason: 'Looks safe',
    });

    const result = await resultPromise;
    expect(result.approved).toBe(true);
    expect(result.reason).toBe('Looks safe');
  });

  it('defineHook → wait → reject → error', async () => {
    const hook = defineHook<{ msg: string }, string>({
      name: 'confirm',
    });

    const registry = getHookRegistry();
    const resultPromise = hook.wait({ msg: 'Confirm?' });
    await tick();

    const pending = registry.listPending();
    registry.reject(pending[0].id, 'User cancelled');

    await expect(resultPromise).rejects.toThrow('User cancelled');
    await expect(resultPromise).rejects.toThrow(HookRejectedError);
  });

  it('multiple hooks can be pending simultaneously', async () => {
    const hook = defineHook<{ step: number }, boolean>({
      name: 'multi-step',
    });

    const registry = getHookRegistry();

    const p1 = hook.waitWithId('step-1', { step: 1 });
    const p2 = hook.waitWithId('step-2', { step: 2 });
    const p3 = hook.waitWithId('step-3', { step: 3 });
    await tick();

    expect(registry.listPending().length).toBe(3);

    await registry.resume('step-2', true);
    await registry.resume('step-1', false);
    await registry.resume('step-3', true);

    expect(await p1).toBe(false);
    expect(await p2).toBe(true);
    expect(await p3).toBe(true);

    expect(registry.listPending().length).toBe(0);
    expect(registry.list('resolved').length).toBe(3);
  });
});
