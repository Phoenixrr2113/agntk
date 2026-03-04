import { describe, it, expect } from 'vitest';
import {
  contentFilter,
  topicFilter,
  lengthLimit,
  custom,
  runGuardrails,
  handleGuardrailResults,
  GuardrailBlockedError,
} from '@agntk/core/advanced';

describe('contentFilter', () => {
  it('redacts SSN patterns', () => {
    const guard = contentFilter();
    const result = guard.check('My SSN is 123-45-6789', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('SSN');
    expect(result.filtered).toContain('[SSN REDACTED]');
    expect(result.filtered).not.toContain('123-45-6789');
  });

  it('passes clean text unchanged', () => {
    const guard = contentFilter();
    const result = guard.check('Hello, this is a normal message.', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(true);
  });

  it('redacts credit card and email', () => {
    const guard = contentFilter();
    const result = guard.check('Card: 4111-1111-1111-1111, email: test@example.com', {
      prompt: '',
      phase: 'output',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('credit card');
    expect(result.message).toContain('email');
    expect(result.filtered).toContain('[CC REDACTED]');
    expect(result.filtered).toContain('[EMAIL REDACTED]');
  });

  it('redacts phone numbers', () => {
    const guard = contentFilter();
    const result = guard.check('Call me at 555-123-4567', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
    expect(result.filtered).toContain('[PHONE REDACTED]');
  });

  it('supports custom patterns', () => {
    const guard = contentFilter({
      patterns: [{ name: 'custom-id', pattern: /ID-\d{6}/g, replacement: '[ID REDACTED]' }],
    });
    const result = guard.check('Your ID-123456 is confirmed.', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
    expect(result.filtered).toContain('[ID REDACTED]');
  });
});

describe('topicFilter', () => {
  it('blocks text containing blocked topic', () => {
    const guard = topicFilter(['explosives', 'weapons']);
    const result = guard.check('Here is how to make explosives at home.', {
      prompt: '',
      phase: 'output',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('explosives');
  });

  it('passes text without blocked topics', () => {
    const guard = topicFilter(['explosives']);
    const result = guard.check('Here is a recipe for chocolate cake.', {
      prompt: '',
      phase: 'output',
    });
    expect(result.passed).toBe(true);
  });

  it('supports regex patterns', () => {
    const guard = topicFilter([/hack(ing|er|s)/i]);
    const result = guard.check('Advanced hacking techniques', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
  });
});

describe('lengthLimit', () => {
  it('passes text within char limit', () => {
    const guard = lengthLimit({ maxChars: 100 });
    const result = guard.check('Short text.', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(true);
  });

  it('blocks and truncates text exceeding char limit', () => {
    const guard = lengthLimit({ maxChars: 10 });
    const result = guard.check('This is a long piece of text that exceeds the limit.', {
      prompt: '',
      phase: 'output',
    });
    expect(result.passed).toBe(false);
    expect(result.filtered?.length).toBeLessThanOrEqual(10);
  });

  it('blocks text exceeding word limit', () => {
    const guard = lengthLimit({ maxWords: 3 });
    const result = guard.check('one two three four five', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('words');
  });
});

describe('custom guardrail', () => {
  it('blocks with boolean return', () => {
    const guard = custom('no-profanity', (text) => !text.includes('badword'));
    const result = guard.check('This has a badword in it.', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
  });

  it('passes with boolean return', () => {
    const guard = custom('no-profanity', (text) => !text.includes('badword'));
    const result = guard.check('This is clean.', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(true);
  });

  it('supports detailed return', () => {
    const guard = custom('json-only', (text) => {
      try {
        JSON.parse(text);
        return { passed: true };
      } catch {
        return { passed: false, message: 'Response must be valid JSON', filtered: '{}' };
      }
    });
    const result = guard.check('not json', { prompt: '', phase: 'output' });
    expect(result.passed).toBe(false);
    expect(result.filtered).toBe('{}');
  });
});

describe('runGuardrails', () => {
  it('chains multiple guardrails', async () => {
    const guards = [contentFilter(), lengthLimit({ maxChars: 200 })];
    const { results, filteredText } = await runGuardrails(
      guards,
      'My SSN is 123-45-6789. ' + 'x'.repeat(300),
      { prompt: '', phase: 'output' },
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].name).toBe('contentFilter');

    expect(results[1].passed).toBe(false);
    expect(results[1].name).toBe('lengthLimit');

    expect(filteredText).not.toContain('123-45-6789');
    expect(filteredText.length).toBeLessThanOrEqual(200);
  });

  it('returns all passed when text is clean and short', async () => {
    const guards = [contentFilter(), lengthLimit({ maxChars: 1000 })];
    const { results } = await runGuardrails(guards, 'Clean text.', { prompt: '', phase: 'output' });
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('handles guardrail that throws', async () => {
    const throwingGuard = {
      name: 'crasher',
      check: () => {
        throw new Error('Guardrail crash');
      },
    };
    const { results } = await runGuardrails([throwingGuard], 'any text', {
      prompt: '',
      phase: 'output',
    });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Guardrail error');
  });
});

describe('handleGuardrailResults', () => {
  it('returns blocked=false when all passed', () => {
    const results = [{ passed: true, name: 'test' }];
    const check = handleGuardrailResults(results, 'text', 'text', 'output', 'filter');
    expect(check.blocked).toBe(false);
    expect(check.text).toBe('text');
  });

  it('returns filtered text in filter mode', () => {
    const results = [{ passed: false, name: 'test', filtered: 'filtered-text' }];
    const check = handleGuardrailResults(results, 'original', 'filtered-text', 'output', 'filter');
    expect(check.blocked).toBe(true);
    expect(check.text).toBe('filtered-text');
  });

  it('throws in throw mode', () => {
    const results = [{ passed: false, name: 'test' }];
    expect(() => {
      handleGuardrailResults(results, 'text', 'text', 'output', 'throw');
    }).toThrow(GuardrailBlockedError);
  });
});
