import type { Guardrail } from './types';

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN REDACTED]' },
  {
    name: 'credit card',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CC REDACTED]',
  },
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL REDACTED]',
  },
  {
    name: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE REDACTED]',
  },
];

export function contentFilter(
  options: {
    redact?: boolean;
    patterns?: Array<{ name: string; pattern: RegExp; replacement: string }>;
  } = {},
): Guardrail {
  const { redact = true, patterns: extra = [] } = options;
  const allPatterns = [...PII_PATTERNS, ...extra];

  return {
    name: 'contentFilter',
    check: (text) => {
      const found: string[] = [];
      let filtered = text;

      for (const { name, pattern, replacement } of allPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          found.push(name);
          if (redact) {
            pattern.lastIndex = 0;
            filtered = filtered.replace(pattern, replacement);
          }
        }
      }

      if (found.length === 0) {
        return { passed: true, name: 'contentFilter' };
      }

      return {
        passed: false,
        name: 'contentFilter',
        message: `PII detected: ${found.join(', ')}`,
        ...(redact ? { filtered } : {}),
      };
    },
  };
}

export function topicFilter(blockedTopics: Array<string | RegExp>): Guardrail {
  const matchers = blockedTopics.map((topic) =>
    typeof topic === 'string' ? new RegExp(`\\b${escapeRegex(topic)}\\b`, 'i') : topic,
  );

  return {
    name: 'topicFilter',
    check: (text) => {
      const textLower = text.toLowerCase();
      const matched: string[] = [];

      for (let i = 0; i < matchers.length; i++) {
        matchers[i].lastIndex = 0;
        if (
          matchers[i].test(text) ||
          (typeof blockedTopics[i] === 'string' &&
            textLower.includes((blockedTopics[i] as string).toLowerCase()))
        ) {
          matched.push(
            typeof blockedTopics[i] === 'string'
              ? (blockedTopics[i] as string)
              : String(blockedTopics[i]),
          );
        }
      }

      if (matched.length === 0) {
        return { passed: true, name: 'topicFilter' };
      }

      return {
        passed: false,
        name: 'topicFilter',
        message: `Blocked topics detected: ${matched.join(', ')}`,
      };
    },
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function lengthLimit(options: { maxChars?: number; maxWords?: number }): Guardrail {
  const { maxChars, maxWords } = options;

  return {
    name: 'lengthLimit',
    check: (text) => {
      if (maxChars !== undefined && text.length > maxChars) {
        return {
          passed: false,
          name: 'lengthLimit',
          message: `Content exceeds ${maxChars} characters (got ${text.length})`,
          filtered: text.slice(0, maxChars),
        };
      }

      if (maxWords !== undefined) {
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        if (wordCount > maxWords) {
          return {
            passed: false,
            name: 'lengthLimit',
            message: `Content exceeds ${maxWords} words (got ${wordCount})`,
          };
        }
      }

      return { passed: true, name: 'lengthLimit' };
    },
  };
}

export function custom(
  name: string,
  checkFn: (text: string) => boolean | { passed: boolean; message?: string; filtered?: string },
): Guardrail {
  return {
    name,
    check: (text) => {
      const result = checkFn(text);
      if (typeof result === 'boolean') {
        return {
          passed: result,
          name,
          message: result ? undefined : `Custom guardrail '${name}' blocked`,
        };
      }
      return { name, ...result };
    },
  };
}
