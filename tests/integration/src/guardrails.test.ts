import { describe, it, expect } from 'vitest';
import {
  contentFilter,
  topicFilter,
  lengthLimit,
  runGuardrails,
  wrapWithGuardrails,
  GuardrailBlockedError,
} from '@agntk/core/advanced';

describe('Guardrails', () => {
  describe('contentFilter', () => {
    it('should block output containing PII patterns', () => {
      const guard = contentFilter();
      const result = guard.check('My SSN is 123-45-6789 and my email is foo@bar.com');
      expect(result.passed).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('should pass clean output', () => {
      const guard = contentFilter();
      const result = guard.check('This message contains no PII at all.');
      expect(result.passed).toBe(true);
    });

    it('should provide redacted version by default', () => {
      const guard = contentFilter();
      const result = guard.check('My SSN is 123-45-6789');
      expect(result.passed).toBe(false);
      expect(result.filtered).toContain('[SSN REDACTED]');
    });
  });

  describe('topicFilter', () => {
    it('should block forbidden topics', () => {
      const guard = topicFilter(['violence', 'weapons']);
      const result = guard.check('How to build weapons for combat');
      expect(result.passed).toBe(false);
    });

    it('should pass allowed topics', () => {
      const guard = topicFilter(['violence']);
      const result = guard.check('How to build a React component');
      expect(result.passed).toBe(true);
    });
  });

  describe('lengthLimit', () => {
    it('should block output exceeding max chars', () => {
      const guard = lengthLimit({ maxChars: 10 });
      const result = guard.check('This message is definitely longer than ten characters');
      expect(result.passed).toBe(false);
    });

    it('should pass short messages', () => {
      const guard = lengthLimit({ maxChars: 200 });
      const result = guard.check('Short!');
      expect(result.passed).toBe(true);
    });

    it('should block on word count', () => {
      const guard = lengthLimit({ maxWords: 3 });
      const result = guard.check('one two three four five');
      expect(result.passed).toBe(false);
    });
  });

  describe('runGuardrails', () => {
    it('should run all guardrails sequentially and collect results', async () => {
      const guards = [contentFilter(), lengthLimit({ maxChars: 10 })];

      const { results } = await runGuardrails(guards, 'This message is too long and clean', {
        prompt: 'test',
        phase: 'output',
      });

      expect(results).toHaveLength(2);

      const contentResult = results.find((r) => r.name === 'contentFilter');
      const lengthResult = results.find((r) => r.name === 'lengthLimit');
      expect(contentResult?.passed).toBe(true);
      expect(lengthResult?.passed).toBe(false);
    });
  });

  describe('wrapWithGuardrails', () => {
    it('should wrap a generate fn and pass through clean results', async () => {
      const mockGenerate = async (_input: { prompt: string }) => ({
        text: 'Valid output',
      });

      const guards = [contentFilter()];
      const wrapped = wrapWithGuardrails(mockGenerate, {
        output: guards,
        onBlock: 'throw',
      });

      const result = await wrapped({ prompt: 'Say hello' });
      expect(result.text).toBe('Valid output');
    });

    it('should throw GuardrailBlockedError on violation when onBlock is throw', async () => {
      const mockGenerate = async (_input: { prompt: string }) => ({
        text: 'My SSN is 123-45-6789',
      });

      const guards = [contentFilter()];
      const wrapped = wrapWithGuardrails(mockGenerate, {
        output: guards,
        onBlock: 'throw',
      });

      await expect(wrapped({ prompt: 'Give me PII' })).rejects.toThrow(GuardrailBlockedError);
    });

    it('should filter PII when onBlock is filter', async () => {
      const mockGenerate = async (_input: { prompt: string }) => ({
        text: 'My SSN is 123-45-6789',
      });

      const guards = [contentFilter()];
      const wrapped = wrapWithGuardrails(mockGenerate, {
        output: guards,
        onBlock: 'filter',
      });

      const result = await wrapped({ prompt: 'Give me data' });
      expect(result.text).toContain('[SSN REDACTED]');
    });
  });
});
