import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, createNoopLogger } from '../logger';
import { configure, resetConfig, addTransport, enable } from '../config';
import type { LogEntry, LogTransport } from '../types';

describe('createLogger', () => {
  beforeEach(() => {
    resetConfig();
    enable('*');
  });

  afterEach(() => {
    resetConfig();
  });

  it('should create a logger with the given namespace', () => {
    const log = createLogger('@agntk/test');
    expect(log.namespace).toBe('@agntk/test');
  });

  it('should have all log level methods', () => {
    const log = createLogger('@agntk/test');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.trace).toBe('function');
  });

  it('should return true for isEnabled when namespace is enabled', () => {
    enable('@agntk/*');
    const log = createLogger('@agntk/test');
    expect(log.isEnabled()).toBe(true);
  });

  it('should write to transports when logging', () => {
    const entries: LogEntry[] = [];
    const mockTransport: LogTransport = {
      name: 'mock',
      write: (entry) => entries.push(entry),
    };

    addTransport(mockTransport);
    const log = createLogger('@agntk/test');
    log.info('Test message', { key: 'value' });

    expect(entries).toHaveLength(1);
    expect(entries[0].namespace).toBe('@agntk/test');
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('Test message');
    expect(entries[0].data).toEqual({ key: 'value' });
  });

  it('should include timestamp and id in log entries', () => {
    const entries: LogEntry[] = [];
    const mockTransport: LogTransport = {
      name: 'mock',
      write: (entry) => entries.push(entry),
    };

    addTransport(mockTransport);
    const log = createLogger('@agntk/test');
    log.info('Test');

    expect(entries[0].id).toBeDefined();
    expect(entries[0].timestamp).toBeDefined();
    expect(new Date(entries[0].timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  describe('log levels', () => {
    it('should log at error level', () => {
      const entries: LogEntry[] = [];
      addTransport({ name: 'mock', write: (e) => entries.push(e) });

      const log = createLogger('@agntk/test');
      log.error('Error message');

      expect(entries[0].level).toBe('error');
    });

    it('should log at warn level', () => {
      const entries: LogEntry[] = [];
      addTransport({ name: 'mock', write: (e) => entries.push(e) });

      const log = createLogger('@agntk/test');
      log.warn('Warn message');

      expect(entries[0].level).toBe('warn');
    });

    it('should respect configured log level', () => {
      const entries: LogEntry[] = [];
      addTransport({ name: 'mock', write: (e) => entries.push(e) });
      configure({ level: 'warn' });

      const log = createLogger('@agntk/test');
      log.info('Info message');
      log.warn('Warn message');

      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('warn');
    });
  });

  describe('child logger', () => {
    it('should create a child logger with inherited context', () => {
      const entries: LogEntry[] = [];
      addTransport({ name: 'mock', write: (e) => entries.push(e) });

      const log = createLogger('@agntk/test');
      const child = log.child({ requestId: 'req-123' });

      child.info('Child message', { extra: 'data' });

      expect(entries[0].data).toEqual({
        requestId: 'req-123',
        extra: 'data',
      });
    });

    it('should maintain parent namespace', () => {
      const log = createLogger('@agntk/test');
      const child = log.child({ runId: 'run-1' });

      expect(child.namespace).toBe('@agntk/test');
    });
  });

  describe('time', () => {
    it('should log with durationMs', async () => {
      const entries: LogEntry[] = [];
      addTransport({ name: 'mock', write: (e) => entries.push(e) });

      const log = createLogger('@agntk/test');
      const done = log.time('operation');

      await new Promise((r) => setTimeout(r, 10));
      done();

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('operation');
      expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('transport error handling', () => {
    it('should not throw if transport fails', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      addTransport({
        name: 'failing',
        write: () => {
          throw new Error('Transport error');
        },
      });

      const log = createLogger('@agntk/test');

      expect(() => log.info('Test')).not.toThrow();
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });
});

describe('createNoopLogger', () => {
  it('should create a logger with no-op methods', () => {
    const log = createNoopLogger('@agntk/noop');

    expect(log.namespace).toBe('@agntk/noop');
    expect(log.isEnabled()).toBe(false);

    log.error('error');
    log.warn('warn');
    log.info('info');
    log.debug('debug');
    log.trace('trace');

    const done = log.time('timer');
    done();
  });

  it('should return noop logger from child', () => {
    const log = createNoopLogger('@agntk/noop');
    const child = log.child({ key: 'value' });

    expect(child.isEnabled()).toBe(false);
  });
});
