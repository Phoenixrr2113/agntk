import { describe, it, expect } from 'vitest';
import { formatPretty, formatJSON, formatSSE } from '../formatter';
import type { LogEntry } from '../types';

const createEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'test-id-123',
  timestamp: '2026-01-15T12:00:00.000Z',
  namespace: '@agntk/test',
  level: 'info',
  message: 'Test message',
  ...overrides,
});

describe('formatPretty', () => {
  it('should format a basic log entry without colors', () => {
    const entry = createEntry();
    const result = formatPretty(entry, false);

    expect(result).toContain('INF');
    expect(result).toContain('[@agntk/test]');
    expect(result).toContain('Test message');
  });

  it('should format with level labels', () => {
    expect(formatPretty(createEntry({ level: 'error' }), false)).toContain('ERR');
    expect(formatPretty(createEntry({ level: 'warn' }), false)).toContain('WRN');
    expect(formatPretty(createEntry({ level: 'info' }), false)).toContain('INF');
    expect(formatPretty(createEntry({ level: 'debug' }), false)).toContain('DBG');
    expect(formatPretty(createEntry({ level: 'trace' }), false)).toContain('TRC');
  });

  it('should include duration when present', () => {
    const entry = createEntry({ durationMs: 123 });
    const result = formatPretty(entry, false);

    expect(result).toContain('+123ms');
  });

  it('should format data as key=value pairs', () => {
    const entry = createEntry({ data: { userId: 'user-1', count: 42 } });
    const result = formatPretty(entry, false);

    expect(result).toContain('userId="user-1"');
    expect(result).toContain('count=42');
  });

  it('should handle null/undefined values in data', () => {
    const entry = createEntry({ data: { nullable: null } });
    const result = formatPretty(entry, false);

    expect(result).toContain('nullable=null');
  });

  it('should truncate long object values', () => {
    const longObject = { nested: { deep: 'a'.repeat(100) } };
    const entry = createEntry({ data: { obj: longObject } });
    const result = formatPretty(entry, false);

    expect(result).toContain('...');
  });

  it('should include ANSI colors when enabled', () => {
    const entry = createEntry();
    const result = formatPretty(entry, true);

    expect(result).toContain('\x1b[');
  });
});

describe('formatJSON', () => {
  it('should return valid JSON string', () => {
    const entry = createEntry();
    const result = formatJSON(entry);

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should include all entry fields', () => {
    const entry = createEntry({ data: { key: 'value' }, durationMs: 50 });
    const result = formatJSON(entry);
    const parsed = JSON.parse(result);

    expect(parsed.id).toBe('test-id-123');
    expect(parsed.timestamp).toBe('2026-01-15T12:00:00.000Z');
    expect(parsed.namespace).toBe('@agntk/test');
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Test message');
    expect(parsed.data).toEqual({ key: 'value' });
    expect(parsed.durationMs).toBe(50);
  });
});

describe('formatSSE', () => {
  it('should format as SSE event', () => {
    const entry = createEntry();
    const result = formatSSE(entry);

    expect(result).toContain('event: log\n');
    expect(result).toContain('data: ');
    expect(result).toContain('id: test-id-123\n');
    expect(result.slice(-2)).toBe('\n\n');
  });

  it('should have JSON data payload', () => {
    const entry = createEntry();
    const result = formatSSE(entry);

    const dataLine = result.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();

    const json = dataLine!.replace('data: ', '');
    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json);
    expect(parsed.namespace).toBe('@agntk/test');
  });
});
