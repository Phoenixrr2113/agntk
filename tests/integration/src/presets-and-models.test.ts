import { describe, it, expect } from 'vitest';
import { createAgent } from '@agntk/core';
import { createMockModel } from './setup';

describe('Models & Agent Config', () => {
  describe('createAgent with different configs', () => {
    it('should create agent with name only', () => {
      const agent = createAgent({
        name: 'minimal-agent',
        model: createMockModel('Hello'),
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('minimal-agent');
    });

    it('should create agent with instructions', () => {
      const agent = createAgent({
        name: 'coder-agent',
        model: createMockModel('Code output'),
        instructions: 'You are an expert coder.',
      });

      expect(agent.name).toBe('coder-agent');
      expect(agent.getSystemPrompt()).toContain('expert coder');
    });

    it('should create agent with custom maxSteps', () => {
      const agent = createAgent({
        name: 'custom-steps-agent',
        model: createMockModel('Output'),
        maxSteps: 50,
      });

      expect(agent).toBeDefined();
    });
  });
});
