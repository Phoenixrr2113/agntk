import { describe, it, expect } from 'vitest';
import { createAgent } from '@agntk/core';
import { createMockModel } from './setup';

describe('E2E: Agent Lifecycle', () => {
  describe('agent creation and streaming', () => {
    it('should create agent with name and stream a response', async () => {
      const agent = createAgent({
        name: 'lifecycle-agent',
        model: createMockModel('The user profile shows name: John, role: admin.'),
        instructions: 'You help with data lookups.',
        maxSteps: 3,
      });

      expect(agent.name).toBe('lifecycle-agent');

      const result = await agent.stream({ prompt: 'Get user profile' });
      expect(result.text).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(typeof text).toBe('string');
    });
  });

  describe('agent with custom instructions', () => {
    it('should include instructions in system prompt', () => {
      const agent = createAgent({
        name: 'ts-expert',
        model: createMockModel('TypeScript expert here.'),
        instructions: 'You are a specialized TypeScript expert.',
      });

      expect(agent.getSystemPrompt()).toContain('You are a specialized TypeScript expert.');
    });

    it('should include agent name in system prompt', () => {
      const agent = createAgent({
        name: 'code-reviewer',
        model: createMockModel('Review output'),
        instructions: 'You review code for best practices.',
      });

      expect(agent.getSystemPrompt()).toContain('code-reviewer');
    });
  });
});
