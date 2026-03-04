import { describe, it, expect, vi } from 'vitest';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(() => vi.fn()),
      trace: vi.fn(),
    })),
  }),
}));

import { contentFilter, topicFilter, lengthLimit, custom } from '../guardrails/built-ins';
import {
  runGuardrails,
  handleGuardrailResults,
  buildRetryFeedback,
  wrapWithGuardrails,
} from '../guardrails/runner';
import { GuardrailBlockedError } from '../guardrails/types';
import type { Guardrail, GuardrailResult } from '../guardrails/types';

describe('contentFilter', () => {
  it('should pass clean text', () => {
    const guard = contentFilter();
    const result = guard.check('Hello, this is a normal message.');
    expect(result.passed).toBe(true);
  });

  it('should detect SSN', () => {
    const guard = contentFilter();
    const result = guard.check('My SSN is 123-45-6789');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('SSN');
  });

  it('should detect credit card numbers', () => {
    const guard = contentFilter();
    const result = guard.check('Card: 4111-1111-1111-1111');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('credit card');
  });

  it('should detect email addresses', () => {
    const guard = contentFilter();
    const result = guard.check('Contact me at user@example.com');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('email');
  });

  it('should detect phone numbers', () => {
    const guard = contentFilter();
    const result = guard.check('Call me at (555) 123-4567');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('phone');
  });

  it('should redact PII and provide filtered version', () => {
    const guard = contentFilter({ redact: true });
    const result = guard.check('My SSN is 123-45-6789 and email is test@example.com');
    expect(result.passed).toBe(false);
    expect(result.filtered).toContain('[SSN REDACTED]');
    expect(result.filtered).toContain('[EMAIL REDACTED]');
    expect(result.filtered).not.toContain('123-45-6789');
    expect(result.filtered).not.toContain('test@example.com');
  });

  it('should not provide filtered version when redact is false', () => {
    const guard = contentFilter({ redact: false });
    const result = guard.check('My SSN is 123-45-6789');
    expect(result.passed).toBe(false);
    expect(result.filtered).toBeUndefined();
  });

  it('should support custom patterns', () => {
    const guard = contentFilter({
      patterns: [
        { name: 'API key', pattern: /\bsk-[a-zA-Z0-9]{32,}\b/g, replacement: '[API_KEY REDACTED]' },
      ],
    });
    const result = guard.check('My key is sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('API key');
  });
});

describe('topicFilter', () => {
  it('should pass allowed content', () => {
    const guard = topicFilter(['violence', 'drugs']);
    const result = guard.check('Let me help you with your code review.');
    expect(result.passed).toBe(true);
  });

  it('should block forbidden topics', () => {
    const guard = topicFilter(['violence', 'drugs']);
    const result = guard.check('Tell me about drugs and their effects.');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('drugs');
  });

  it('should support regex patterns', () => {
    const guard = topicFilter([/\bhack(ing)?\b/i]);
    const result = guard.check('How to do hacking?');
    expect(result.passed).toBe(false);
  });

  it('should be case insensitive for string topics', () => {
    const guard = topicFilter(['Violence']);
    const result = guard.check('This contains violence.');
    expect(result.passed).toBe(false);
  });
});

describe('lengthLimit', () => {
  it('should pass text within char limit', () => {
    const guard = lengthLimit({ maxChars: 100 });
    const result = guard.check('Short text');
    expect(result.passed).toBe(true);
  });

  it('should block text exceeding char limit', () => {
    const guard = lengthLimit({ maxChars: 10 });
    const result = guard.check('This is a longer text');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('10 characters');
  });

  it('should provide truncated filtered version for char limit', () => {
    const guard = lengthLimit({ maxChars: 5 });
    const result = guard.check('Hello World');
    expect(result.passed).toBe(false);
    expect(result.filtered).toBe('Hello');
  });

  it('should pass text within word limit', () => {
    const guard = lengthLimit({ maxWords: 10 });
    const result = guard.check('one two three');
    expect(result.passed).toBe(true);
  });

  it('should block text exceeding word limit', () => {
    const guard = lengthLimit({ maxWords: 2 });
    const result = guard.check('one two three four');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('2 words');
  });
});

describe('custom guardrail', () => {
  it('should work with boolean return', () => {
    const guard = custom('no-profanity', (text) => !text.includes('bad'));
    expect(guard.check('good text').passed).toBe(true);
    expect(guard.check('bad text').passed).toBe(false);
  });

  it('should work with object return', () => {
    const guard = custom('json-check', (text) => {
      try {
        JSON.parse(text);
        return { passed: true };
      } catch {
        return { passed: false, message: 'Not valid JSON' };
      }
    });
    expect(guard.check('{"key":"value"}').passed).toBe(true);
    expect(guard.check('not json').passed).toBe(false);
  });
});

describe('runGuardrails', () => {
  it('should run guardrails sequentially', async () => {
    const order: string[] = [];

    const guard1: Guardrail = {
      name: 'g1',
      check: async (_text) => {
        order.push('g1-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('g1-end');
        return { passed: true, name: 'g1' };
      },
    };

    const guard2: Guardrail = {
      name: 'g2',
      check: async (_text) => {
        order.push('g2-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('g2-end');
        return { passed: true, name: 'g2' };
      },
    };

    const { results } = await runGuardrails([guard1, guard2], 'test', { phase: 'input' });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);

    expect(order[0]).toBe('g1-start');
    expect(order[1]).toBe('g1-end');
    expect(order[2]).toBe('g2-start');
    expect(order[3]).toBe('g2-end');
  });

  it('should chain filters sequentially so each operates on the previous output', async () => {
    const piiFilter: Guardrail = {
      name: 'pii-filter',
      check: async (text) => ({
        passed: false,
        name: 'pii-filter',
        message: 'PII detected',
        filtered: text.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN REDACTED]'),
      }),
    };

    const lengthFilter: Guardrail = {
      name: 'length-filter',
      check: async (text) => ({
        passed: false,
        name: 'length-filter',
        message: 'too long',
        filtered: text.slice(0, 50),
      }),
    };

    const { results, filteredText } = await runGuardrails(
      [piiFilter, lengthFilter],
      'My SSN is 123-45-6789 and this is a long sentence that should be truncated',
      { phase: 'output' },
    );

    expect(results).toHaveLength(2);

    expect(filteredText).not.toContain('123-45-6789');
    expect(filteredText).toContain('[SSN REDACTED]');
    expect(filteredText.length).toBeLessThanOrEqual(50);
  });

  it('should handle guardrail errors gracefully', async () => {
    const guard: Guardrail = {
      name: 'broken',
      check: () => {
        throw new Error('boom');
      },
    };

    const { results } = await runGuardrails([guard], 'test', { phase: 'input' });

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('boom');
  });

  it('should return empty results for no guardrails', async () => {
    const { results, filteredText } = await runGuardrails([], 'test', { phase: 'input' });
    expect(results).toEqual([]);
    expect(filteredText).toBe('test');
  });
});

describe('handleGuardrailResults', () => {
  it('should return blocked: false when all pass', () => {
    const results: GuardrailResult[] = [
      { passed: true, name: 'g1' },
      { passed: true, name: 'g2' },
    ];
    const outcome = handleGuardrailResults(results, 'text', 'text', 'output', 'throw');
    expect(outcome.blocked).toBe(false);
  });

  it('should throw on block with onBlock=throw', () => {
    const results: GuardrailResult[] = [{ passed: false, name: 'g1', message: 'blocked' }];
    expect(() => handleGuardrailResults(results, 'text', 'text', 'output', 'throw')).toThrow(
      GuardrailBlockedError,
    );
  });

  it('should return filtered text with onBlock=filter', () => {
    const results: GuardrailResult[] = [
      { passed: false, name: 'g1', message: 'blocked', filtered: 'clean text' },
    ];
    const outcome = handleGuardrailResults(results, 'dirty text', 'clean text', 'output', 'filter');
    expect(outcome.blocked).toBe(true);
    expect(outcome.text).toBe('clean text');
  });

  it('should signal retry with onBlock=retry', () => {
    const results: GuardrailResult[] = [{ passed: false, name: 'g1', message: 'blocked' }];
    const outcome = handleGuardrailResults(results, 'text', 'text', 'output', 'retry');
    expect(outcome.blocked).toBe(true);
    expect(outcome.text).toBe('text');
  });
});

describe('GuardrailBlockedError', () => {
  it('should have correct properties', () => {
    const results: GuardrailResult[] = [
      { passed: false, name: 'contentFilter', message: 'PII detected: SSN' },
      { passed: true, name: 'lengthLimit' },
    ];
    const error = new GuardrailBlockedError('output', results);
    expect(error.phase).toBe('output');
    expect(error.guardrailName).toBe('contentFilter');
    expect(error.results).toBe(results);
    expect(error.message).toContain('contentFilter');
    expect(error.message).toContain('PII detected');
  });
});

describe('buildRetryFeedback', () => {
  it('should build feedback from failed results', () => {
    const results: GuardrailResult[] = [
      { passed: false, name: 'contentFilter', message: 'PII detected: SSN' },
      { passed: true, name: 'lengthLimit' },
    ];
    const feedback = buildRetryFeedback(results);
    expect(feedback).toContain('GUARDRAIL FEEDBACK');
    expect(feedback).toContain('contentFilter');
    expect(feedback).toContain('PII detected');
    expect(feedback).not.toContain('lengthLimit');
  });
});

describe('wrapWithGuardrails', () => {
  it('should pass through when no guardrails block', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'Hello world' });
    const wrapped = wrapWithGuardrails(generate, {
      output: [lengthLimit({ maxChars: 1000 })],
      onBlock: 'throw',
    });

    const result = await wrapped({ prompt: 'Say hello' });
    expect(result.text).toBe('Hello world');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('should run input guardrails before agent', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'ok' });
    const wrapped = wrapWithGuardrails(generate, {
      input: [topicFilter(['forbidden'])],
      onBlock: 'throw',
    });

    await expect(wrapped({ prompt: 'Tell me about forbidden things' })).rejects.toThrow(
      GuardrailBlockedError,
    );

    expect(generate).not.toHaveBeenCalled();
  });

  it('should run output guardrails after agent', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'SSN: 123-45-6789' });
    const wrapped = wrapWithGuardrails(generate, {
      output: [contentFilter()],
      onBlock: 'throw',
    });

    await expect(wrapped({ prompt: 'Give me info' })).rejects.toThrow(GuardrailBlockedError);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('should retry with feedback when onBlock=retry', async () => {
    let callCount = 0;
    const generate = vi.fn().mockImplementation(async ({ prompt: _prompt }: { prompt: string }) => {
      callCount++;
      if (callCount === 1) {
        return { text: 'SSN: 123-45-6789' };
      }

      return { text: 'Here is the information you requested.' };
    });

    const wrapped = wrapWithGuardrails(generate, {
      output: [contentFilter()],
      onBlock: 'retry',
      maxRetries: 2,
    });

    const result = await wrapped({ prompt: 'Give me info' });

    expect(result.text).toBe('Here is the information you requested.');
    expect(generate).toHaveBeenCalledTimes(2);

    const secondCallPrompt = generate.mock.calls[1][0].prompt;
    expect(secondCallPrompt).toContain('GUARDRAIL FEEDBACK');
  });

  it('should throw after max retries exhausted', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'SSN: 123-45-6789' });
    const wrapped = wrapWithGuardrails(generate, {
      output: [contentFilter()],
      onBlock: 'retry',
      maxRetries: 1,
    });

    await expect(wrapped({ prompt: 'Give me info' })).rejects.toThrow(GuardrailBlockedError);

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('should filter output when onBlock=filter', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'SSN: 123-45-6789 is private' });
    const wrapped = wrapWithGuardrails(generate, {
      output: [contentFilter({ redact: true })],
      onBlock: 'filter',
    });

    const result = await wrapped({ prompt: 'Give me info' });
    expect(result.text).toContain('[SSN REDACTED]');
    expect(result.text).not.toContain('123-45-6789');
  });

  it('should run input and output guardrails together', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'Clean response' });
    const inputGuard: Guardrail = {
      name: 'input-check',
      check: () => ({ passed: true, name: 'input-check' }),
    };
    const outputGuard: Guardrail = {
      name: 'output-check',
      check: () => ({ passed: true, name: 'output-check' }),
    };

    const wrapped = wrapWithGuardrails(generate, {
      input: [inputGuard],
      output: [outputGuard],
      onBlock: 'throw',
    });

    const result = await wrapped({ prompt: 'test' });
    expect(result.text).toBe('Clean response');
  });

  it('should run input guardrails sequentially for correct filter chaining', async () => {
    const order: string[] = [];

    const guard1: Guardrail = {
      name: 'input-1',
      check: async () => {
        order.push('input-1-start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('input-1-end');
        return { passed: true, name: 'input-1' };
      },
    };

    const guard2: Guardrail = {
      name: 'input-2',
      check: async () => {
        order.push('input-2-start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('input-2-end');
        return { passed: true, name: 'input-2' };
      },
    };

    const generate = vi.fn().mockResolvedValue({ text: 'ok' });
    const wrapped = wrapWithGuardrails(generate, {
      input: [guard1, guard2],
      onBlock: 'throw',
    });

    await wrapped({ prompt: 'test' });

    expect(order).toEqual(['input-1-start', 'input-1-end', 'input-2-start', 'input-2-end']);
  });
});
