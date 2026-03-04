import { createLogger } from '@agntk/logger';
import { parseDuration } from './utils';

const log = createLogger('@agntk/core:workflow:hooks');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wdk: any = null;
let _wdkChecked = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWdk(): Promise<any> {
  if (_wdkChecked) return _wdk;
  _wdkChecked = true;

  try {
    _wdk = await import('workflow');
    log.info('WDK runtime detected for hooks');
  } catch {
    _wdk = null;
    log.debug('WDK runtime not available — using in-memory hook registry');
  }
  return _wdk;
}

function isWdkAvailable(): boolean {
  return _wdk !== null;
}

export function _resetWdkCache(forceNoWdk = false): void {
  _wdk = null;
  _wdkChecked = forceNoWdk;
}

export type HookStatus = 'pending' | 'resolved' | 'rejected' | 'timed_out';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface HookDefinition<TPayload = unknown, TResult = unknown> {
  name: string;

  description?: string;

  timeout?: string;

  defaultValue?: TResult;

  validate?: (payload: TResult) => void | Promise<void>;
}

export interface HookInstance<TPayload = unknown, TResult = unknown> {
  id: string;

  name: string;

  description?: string;

  payload: TPayload;

  status: HookStatus;

  createdAt: Date;

  resolvedAt?: Date;

  timeoutMs?: number;

  result?: TResult;
}

export interface Hook<TPayload = unknown, TResult = unknown> {
  readonly name: string;

  readonly description?: string;

  wait: (payload: TPayload) => Promise<TResult>;

  waitWithId: (id: string, payload: TPayload) => Promise<TResult>;
}

export interface WebhookOptions {
  id?: string;

  callbackPath?: string;

  timeout?: string;

  defaultValue?: unknown;
}

export interface WebhookResult<T = unknown> {
  data: T;

  timedOut: boolean;

  url?: string;
}

export interface SleepOptions {
  reason?: string;
}

export class HookRegistry {
  private hooks = new Map<string, HookInstance>();
  private resolvers = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  >();
  private validators = new Map<string, (payload: unknown) => void | Promise<void>>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  get(id: string): HookInstance | undefined {
    return this.hooks.get(id);
  }

  has(id: string): boolean {
    return this.hooks.has(id);
  }

  list(status?: HookStatus): HookInstance[] {
    const all = Array.from(this.hooks.values());
    return status ? all.filter((h) => h.status === status) : all;
  }

  listPending(): HookInstance[] {
    return this.list('pending');
  }

  register<TPayload, TResult>(
    id: string,
    name: string,
    payload: TPayload,
    options: {
      description?: string;
      timeoutMs?: number;
      defaultValue?: TResult;
      validate?: (payload: TResult) => void | Promise<void>;
    } = {},
  ): Promise<TResult> {
    if (this.hooks.has(id)) {
      throw new Error(`Hook with ID "${id}" already exists`);
    }

    const instance: HookInstance<TPayload, TResult> = {
      id,
      name,
      description: options.description,
      payload,
      status: 'pending',
      createdAt: new Date(),
      timeoutMs: options.timeoutMs,
    };

    this.hooks.set(id, instance as HookInstance);

    if (options.validate) {
      this.validators.set(id, options.validate as (p: unknown) => void | Promise<void>);
    }

    log.info('Hook registered', {
      hookId: id,
      name,
      timeoutMs: options.timeoutMs,
    });

    return new Promise<TResult>((resolve, reject) => {
      this.resolvers.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      if (options.timeoutMs && options.timeoutMs > 0) {
        const timer = setTimeout(() => {
          if (this.hooks.get(id)?.status === 'pending') {
            log.info('Hook timed out, using default value', { hookId: id, name });

            const hook = this.hooks.get(id)!;
            hook.status = 'timed_out';
            hook.resolvedAt = new Date();
            hook.result = options.defaultValue;

            this.resolvers.get(id)?.resolve(options.defaultValue);
            this.cleanup(id);
          }
        }, options.timeoutMs);

        this.timeouts.set(id, timer);
      }
    });
  }

  async resume(id: string, result: unknown): Promise<HookInstance> {
    const hook = this.hooks.get(id);
    if (!hook) {
      throw new HookNotFoundError(id);
    }

    if (hook.status !== 'pending') {
      throw new HookNotPendingError(id, hook.status);
    }
    hook.status = 'resolved';

    const validator = this.validators.get(id);
    if (validator) {
      try {
        await validator(result);
      } catch (validationError) {
        hook.status = 'pending';
        throw validationError;
      }
    }

    hook.resolvedAt = new Date();
    hook.result = result;

    log.info('Hook resumed', { hookId: id, name: hook.name });

    this.resolvers.get(id)?.resolve(result);
    this.cleanup(id);

    return hook;
  }

  reject(id: string, reason: string): HookInstance {
    const hook = this.hooks.get(id);
    if (!hook) {
      throw new HookNotFoundError(id);
    }

    if (hook.status !== 'pending') {
      throw new HookNotPendingError(id, hook.status);
    }

    hook.status = 'rejected';
    hook.resolvedAt = new Date();

    log.info('Hook rejected', { hookId: id, name: hook.name, reason });

    this.resolvers.get(id)?.reject(new HookRejectedError(id, reason));
    this.cleanup(id);

    return hook;
  }

  private cleanup(id: string): void {
    this.resolvers.delete(id);
    this.validators.delete(id);
    const timer = this.timeouts.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timeouts.delete(id);
    }
  }

  clear(): void {
    for (const timer of this.timeouts.values()) {
      clearTimeout(timer);
    }
    this.hooks.clear();
    this.resolvers.clear();
    this.validators.clear();
    this.timeouts.clear();
  }

  get size(): number {
    return this.hooks.size;
  }
}

export class HookNotFoundError extends Error {
  readonly hookId: string;
  constructor(hookId: string) {
    super(`Hook "${hookId}" not found`);
    this.name = 'HookNotFoundError';
    this.hookId = hookId;
  }
}

export class HookNotPendingError extends Error {
  readonly hookId: string;
  readonly currentStatus: HookStatus;
  constructor(hookId: string, currentStatus: HookStatus) {
    super(`Hook "${hookId}" is not pending (status: ${currentStatus})`);
    this.name = 'HookNotPendingError';
    this.hookId = hookId;
    this.currentStatus = currentStatus;
  }
}

export class HookRejectedError extends Error {
  readonly hookId: string;
  readonly reason: string;
  constructor(hookId: string, reason: string) {
    super(`Hook "${hookId}" was rejected: ${reason}`);
    this.name = 'HookRejectedError';
    this.hookId = hookId;
    this.reason = reason;
  }
}

export class FatalError extends Error {
  readonly fatal = true;
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }

  static is(value: unknown): value is FatalError {
    return (
      value instanceof FatalError ||
      (value instanceof Error && 'fatal' in value && (value as { fatal: unknown }).fatal === true)
    );
  }
}

export class RetryableError extends Error {
  readonly retryAfter: Date;

  constructor(message: string, options?: { retryAfter?: number | string | Date }) {
    super(message);
    this.name = 'RetryableError';

    if (options?.retryAfter instanceof Date) {
      this.retryAfter = options.retryAfter;
    } else if (typeof options?.retryAfter === 'string') {
      this.retryAfter = new Date(Date.now() + parseDuration(options.retryAfter));
    } else if (typeof options?.retryAfter === 'number') {
      this.retryAfter = new Date(Date.now() + options.retryAfter);
    } else {
      this.retryAfter = new Date(Date.now() + 1000);
    }
  }

  static is(value: unknown): value is RetryableError {
    return value instanceof RetryableError;
  }
}

export function getWdkErrors(): {
  FatalError: typeof FatalError;
  RetryableError: typeof RetryableError;
} {
  if (isWdkAvailable() && _wdk) {
    return {
      FatalError: _wdk.FatalError ?? FatalError,
      RetryableError: _wdk.RetryableError ?? RetryableError,
    };
  }
  return { FatalError, RetryableError };
}

let _registry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
  if (!_registry) {
    _registry = new HookRegistry();
  }
  return _registry;
}

export function _resetHookRegistry(): void {
  _registry?.clear();
  _registry = null;
}

let _hookCounter = 0;

function generateHookId(name: string): string {
  _hookCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `hook-${name}-${ts}-${rand}-${_hookCounter}`;
}

export function _resetHookCounter(): void {
  _hookCounter = 0;
}

export function defineHook<TPayload = unknown, TResult = unknown>(
  definition: HookDefinition<TPayload, TResult>,
): Hook<TPayload, TResult> {
  const { name, description, timeout, defaultValue, validate } = definition;

  const timeoutMs = timeout ? parseDuration(timeout) : undefined;

  if (timeout && defaultValue === undefined) {
    log.warn('Hook has timeout but no defaultValue — will resolve with undefined on timeout', {
      name,
    });
  }

  log.debug('Hook defined', { name, description, timeoutMs });

  const wait = async (payload: TPayload): Promise<TResult> => {
    const id = generateHookId(name);
    return waitWithId(id, payload);
  };

  const waitWithId = async (id: string, payload: TPayload): Promise<TResult> => {
    log.info('Hook suspension created', { hookId: id, name, payload });

    const wdk = await getWdk();

    if (wdk?.createHook) {
      log.debug('Using WDK createHook', { hookId: id, name });

      const registry = getHookRegistry();
      const instance: HookInstance<TPayload, TResult> = {
        id,
        name,
        description,
        payload,
        status: 'pending',
        createdAt: new Date(),
        timeoutMs,
      };
      registry['hooks'].set(id, instance as HookInstance);

      try {
        const wdkHook = wdk.createHook({ token: id, metadata: { name, description, payload } });

        let result: TResult;
        if (timeoutMs && timeoutMs > 0) {
          const timeoutPromise = new Promise<TResult>((resolve) => {
            setTimeout(() => {
              instance.status = 'timed_out';
              instance.resolvedAt = new Date();
              instance.result = defaultValue;
              resolve(defaultValue as TResult);
            }, timeoutMs);
          });
          result = await Promise.race([wdkHook as Promise<TResult>, timeoutPromise]);
        } else {
          result = await (wdkHook as Promise<TResult>);
        }

        if (validate) {
          await validate(result);
        }

        instance.status = instance.status === 'timed_out' ? 'timed_out' : 'resolved';
        instance.resolvedAt = instance.resolvedAt ?? new Date();
        instance.result = result;

        return result;
      } catch (err) {
        instance.status = 'rejected';
        instance.resolvedAt = new Date();
        throw err;
      }
    }

    const registry = getHookRegistry();
    return registry.register<TPayload, TResult>(id, name, payload, {
      description,
      timeoutMs,
      defaultValue,
      validate,
    });
  };

  return {
    name,
    description,
    wait,
    waitWithId,
  };
}

export function createWebhook<T = unknown>(
  options: WebhookOptions = {},
): { id: string; promise: Promise<WebhookResult<T>>; url?: string } {
  const id = options.id ?? generateHookId('webhook');
  const timeoutMs = options.timeout ? parseDuration(options.timeout) : undefined;

  log.info('Webhook created', {
    webhookId: id,
    callbackPath: options.callbackPath,
    timeoutMs,
  });

  if (isWdkAvailable() && _wdk?.createWebhook) {
    log.debug('Using WDK createWebhook', { webhookId: id });

    const wdkWebhook = _wdk.createWebhook({ token: id });
    const url: string = wdkWebhook.url;

    const registry = getHookRegistry();
    const instance: HookInstance = {
      id,
      name: 'webhook',
      description: `Webhook callback: ${url}`,
      payload: { callbackPath: options.callbackPath, url },
      status: 'pending',
      createdAt: new Date(),
      timeoutMs,
    };
    registry['hooks'].set(id, instance);

    const promise: Promise<WebhookResult<T>> = (async () => {
      let data: T;
      let timedOut = false;

      if (timeoutMs && timeoutMs > 0) {
        const timeoutPromise = new Promise<T>((resolve) => {
          setTimeout(() => {
            instance.status = 'timed_out';
            instance.resolvedAt = new Date();
            timedOut = true;
            resolve(options.defaultValue as T);
          }, timeoutMs);
        });
        data = await Promise.race([wdkWebhook as Promise<T>, timeoutPromise]);
      } else {
        data = await (wdkWebhook as Promise<T>);
      }

      if (!timedOut) {
        instance.status = 'resolved';
        instance.resolvedAt = new Date();
      }
      instance.result = data;

      return { data, timedOut, url };
    })();

    return { id, promise, url };
  }

  const registry = getHookRegistry();

  const promise = registry
    .register<{ callbackPath?: string }, T>(
      id,
      'webhook',
      { callbackPath: options.callbackPath },
      {
        description: `Webhook callback: ${options.callbackPath ?? 'N/A'}`,
        timeoutMs,
        defaultValue: options.defaultValue as T,
      },
    )
    .then((data) => {
      const hook = registry.get(id);
      return {
        data,
        timedOut: hook?.status === 'timed_out',
      };
    });

  return { id, promise };
}

export async function resumeHook<T = unknown>(tokenOrId: string, payload: T): Promise<void> {
  const wdk = await getWdk();

  if (wdk?.resumeHook) {
    log.info('Resuming hook via WDK', { token: tokenOrId });
    await wdk.resumeHook(tokenOrId, payload);

    const registry = getHookRegistry();
    const instance = registry.get(tokenOrId);
    if (instance) {
      instance.status = 'resolved';
      instance.resolvedAt = new Date();
      instance.result = payload;
    }
    return;
  }

  const registry = getHookRegistry();
  await registry.resume(tokenOrId, payload);
}

export async function sleep(duration: string, options: SleepOptions = {}): Promise<void> {
  const ms = parseDuration(duration);

  log.info('Sleep started', {
    duration,
    ms,
    reason: options.reason,
  });

  try {
    const wdk = await getWdk();
    if (wdk?.sleep) {
      await wdk.sleep(ms);
      log.info('WDK sleep completed', { duration });
      return;
    }
  } catch {
    void 0;
  }

  log.debug('Using setTimeout fallback for sleep', { ms });
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  log.info('Sleep completed (setTimeout fallback)', { duration });
}
