import { describe, it, expect } from 'vitest';
import { parseDebugEnv, matchesPattern, isNamespaceEnabled, childNamespace } from '../namespace';

describe('parseDebugEnv', () => {
  it('should return empty arrays for undefined', () => {
    const result = parseDebugEnv(undefined);
    expect(result).toEqual({ enabled: [], excluded: [] });
  });

  it('should return empty arrays for empty string', () => {
    const result = parseDebugEnv('');
    expect(result).toEqual({ enabled: [], excluded: [] });
  });

  it('should parse single pattern', () => {
    const result = parseDebugEnv('@agntk/*');
    expect(result).toEqual({ enabled: ['@agntk/*'], excluded: [] });
  });

  it('should parse multiple comma-separated patterns', () => {
    const result = parseDebugEnv('@agntk/core,@agntk/logger');
    expect(result).toEqual({
      enabled: ['@agntk/core', '@agntk/logger'],
      excluded: [],
    });
  });

  it('should parse multiple space-separated patterns', () => {
    const result = parseDebugEnv('@agntk/core @agntk/logger');
    expect(result).toEqual({
      enabled: ['@agntk/core', '@agntk/logger'],
      excluded: [],
    });
  });

  it('should identify excluded patterns with - prefix', () => {
    const result = parseDebugEnv('*,-@agntk/verbose');
    expect(result).toEqual({
      enabled: ['*'],
      excluded: ['@agntk/verbose'],
    });
  });

  it('should handle mixed enabled and excluded', () => {
    const result = parseDebugEnv('@agntk/*,-@agntk/core:trace,-@agntk/internal');
    expect(result).toEqual({
      enabled: ['@agntk/*'],
      excluded: ['@agntk/core:trace', '@agntk/internal'],
    });
  });
});

describe('matchesPattern', () => {
  it('should return false for empty patterns', () => {
    expect(matchesPattern('@agntk/core', [])).toBe(false);
  });

  it('should match exact namespace', () => {
    expect(matchesPattern('@agntk/core', ['@agntk/core'])).toBe(true);
    expect(matchesPattern('@agntk/core', ['@agntk/logger'])).toBe(false);
  });

  it('should match wildcard at end', () => {
    expect(matchesPattern('@agntk/core', ['@agntk/*'])).toBe(true);
    expect(matchesPattern('@agntk/logger', ['@agntk/*'])).toBe(true);
    expect(matchesPattern('other/module', ['@agntk/*'])).toBe(false);
  });

  it('should match nested namespaces with wildcard', () => {
    expect(matchesPattern('@agntk/core:agent', ['@agntk/core:*'])).toBe(true);
    expect(matchesPattern('@agntk/core:agent:tool', ['@agntk/core:*'])).toBe(true);
  });

  it('should match global wildcard', () => {
    expect(matchesPattern('@agntk/core', ['*'])).toBe(true);
    expect(matchesPattern('anything', ['*'])).toBe(true);
  });

  it('should match any of multiple patterns', () => {
    expect(matchesPattern('@agntk/core', ['@agntk/core', '@agntk/logger'])).toBe(true);
    expect(matchesPattern('@agntk/logger', ['@agntk/core', '@agntk/logger'])).toBe(true);
    expect(matchesPattern('@agntk/other', ['@agntk/core', '@agntk/logger'])).toBe(false);
  });
});

describe('isNamespaceEnabled', () => {
  it('should return false if no enabled patterns', () => {
    const result = isNamespaceEnabled('@agntk/core', {
      enabledPatterns: [],
      excludedPatterns: [],
    });
    expect(result).toBe(false);
  });

  it('should return true if matches enabled pattern', () => {
    const result = isNamespaceEnabled('@agntk/core', {
      enabledPatterns: ['@agntk/*'],
      excludedPatterns: [],
    });
    expect(result).toBe(true);
  });

  it('should return false if matches excluded pattern', () => {
    const result = isNamespaceEnabled('@agntk/verbose', {
      enabledPatterns: ['@agntk/*'],
      excludedPatterns: ['@agntk/verbose'],
    });
    expect(result).toBe(false);
  });

  it('should exclude before enable', () => {
    const result = isNamespaceEnabled('@agntk/core:trace', {
      enabledPatterns: ['*'],
      excludedPatterns: ['@agntk/core:trace'],
    });
    expect(result).toBe(false);
  });

  it('should enable if not in excluded', () => {
    const result = isNamespaceEnabled('@agntk/core:info', {
      enabledPatterns: ['*'],
      excludedPatterns: ['@agntk/core:trace'],
    });
    expect(result).toBe(true);
  });
});

describe('childNamespace', () => {
  it('should join parent and child with colon', () => {
    expect(childNamespace('@agntk/core', 'agent')).toBe('@agntk/core:agent');
  });

  it('should support multiple levels', () => {
    const level1 = childNamespace('@agntk/core', 'agent');
    const level2 = childNamespace(level1, 'tool');
    expect(level2).toBe('@agntk/core:agent:tool');
  });
});
