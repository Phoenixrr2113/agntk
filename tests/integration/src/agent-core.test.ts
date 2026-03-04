import { describe, it, expect } from 'vitest';
import { createAgent } from '@agntk/core';
import { createMockModel, createMockStreamModel } from './setup';

describe('Agent Core', () => {
  describe('createAgent + stream', () => {
    it('should create an agent and stream a text response', async () => {
      const agent = createAgent({
        name: 'core-test-agent',
        model: createMockModel('Hello from the agent!'),
        instructions: 'You are a helpful assistant.',
        maxSteps: 1,
      });

      const result = await agent.stream({ prompt: 'Say hello' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(text).toBe('Hello from the agent!');
    });

    it('should include instructions in system prompt', () => {
      const instructions = 'You are a pirate assistant. Always say arrr.';
      const agent = createAgent({
        name: 'pirate-agent',
        model: createMockModel('Arrr, hello matey!'),
        instructions,
        maxSteps: 1,
      });

      expect(agent.getSystemPrompt()).toContain(instructions);
    });

    it('should have unique names', () => {
      const agent1 = createAgent({
        name: 'agent-alpha',
        model: createMockModel('a'),
      });
      const agent2 = createAgent({
        name: 'agent-beta',
        model: createMockModel('b'),
      });

      expect(agent1.name).toBe('agent-alpha');
      expect(agent2.name).toBe('agent-beta');
      expect(agent1.name).not.toBe(agent2.name);
    });
  });

  describe('streaming interface', () => {
    it('should return a stream result from the agent', async () => {
      const agent = createAgent({
        name: 'stream-test-agent',
        model: createMockStreamModel('Hello world from streaming'),
        instructions: 'You are a helpful assistant.',
        maxSteps: 1,
      });

      expect(typeof agent.stream).toBe('function');
      const result = await agent.stream({ prompt: 'Say hello' });
      expect(result).toBeDefined();
      expect(result.fullStream).toBeDefined();
      expect(result.text).toBeDefined();
    });
  });
});
