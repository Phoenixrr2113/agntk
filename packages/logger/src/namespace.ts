import type { DebugConfig } from './types';

export function parseDebugEnv(debug: string | undefined): {
  enabled: string[];
  excluded: string[];
} {
  if (!debug) {
    return { enabled: [], excluded: [] };
  }

  const enabled: string[] = [];
  const excluded: string[] = [];

  const patterns = debug.split(/[\s,]+/).filter(Boolean);

  for (const pattern of patterns) {
    if (pattern.startsWith('-')) {
      excluded.push(pattern.slice(1));
    } else {
      enabled.push(pattern);
    }
  }

  return { enabled, excluded };
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesPattern(namespace: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => patternToRegex(pattern).test(namespace));
}

export function isNamespaceEnabled(
  namespace: string,
  config: Pick<DebugConfig, 'enabledPatterns' | 'excludedPatterns'>,
): boolean {
  if (config.enabledPatterns.length === 0) return false;
  if (matchesPattern(namespace, config.excludedPatterns)) return false;
  return matchesPattern(namespace, config.enabledPatterns);
}

export function childNamespace(parent: string, child: string): string {
  return `${parent}:${child}`;
}
