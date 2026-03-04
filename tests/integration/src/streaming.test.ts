import { describe, it, expect } from 'vitest';
import { createAgent } from '@agntk/core';
import { createMockStreamModel } from './setup';

describe('Streaming', () => {
  describe('agent.stream()', () => {
    it('should return a stream result object', async () => {
      const agent = createAgent({
        name: 'stream-result-test',
        model: createMockStreamModel('Hello world from streaming agent'),
        instructions: 'You are a helpful assistant.',
        maxSteps: 1,
      });

      const result = await agent.stream({ prompt: 'Say hello' });
      expect(result).toBeDefined();
      expect(result.fullStream).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.usage).toBeDefined();
    });

    it('should exist as a callable function on the agent', () => {
      const agent = createAgent({
        name: 'stream-fn-test',
        model: createMockStreamModel('Streaming test'),
        maxSteps: 1,
      });

      expect(typeof agent.stream).toBe('function');
    });

    it('should resolve text from the stream', async () => {
      const agent = createAgent({
        name: 'stream-text-test',
        model: createMockStreamModel('Hello world'),
        maxSteps: 1,
      });

      const result = await agent.stream({ prompt: 'Say hello' });
      const text = await result.text;
      expect(text).toBe('Hello world');
    });
  });
});
