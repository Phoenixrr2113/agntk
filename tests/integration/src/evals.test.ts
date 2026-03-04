import { describe, it, expect } from 'vitest';
import { createAgent } from '@agntk/core';
import {
  createEvalSuite,
  outputContains,
  outputMatches,
  stepCount,
  tokenUsage,
} from '@agntk/core/evals';
import { createMockModel, createMockMultiModel } from './setup';

describe('Evaluation Framework', () => {
  describe('assertions', () => {
    it('outputContains should check for substring', () => {
      const assertion = outputContains('hello');
      expect(assertion).toBeDefined();
      expect(assertion.name).toContain('outputContains');
    });

    it('outputMatches should check regex', () => {
      const assertion = outputMatches(/\d+/);
      expect(assertion).toBeDefined();
      expect(assertion.name).toContain('outputMatches');
    });

    it('stepCount should check number of steps', () => {
      const assertion = stepCount(1, 5);
      expect(assertion).toBeDefined();
      expect(assertion.name).toContain('stepCount');
    });

    it('tokenUsage should check token limits', () => {
      const assertion = tokenUsage(1000);
      expect(assertion).toBeDefined();
      expect(assertion.name).toContain('tokenUsage');
    });
  });

  describe('createEvalSuite', () => {
    it('should create an eval suite configuration', () => {
      const agent = createAgent({
        name: 'eval-suite-test',
        model: createMockModel('test'),
        maxSteps: 1,
      });

      const suite = createEvalSuite({
        name: 'test-eval-suite',
        agent,
        cases: [
          {
            name: 'basic greeting',
            prompt: 'Say hello',
            assertions: [outputContains('hello')],
          },
        ],
        reporter: 'json',
      });

      expect(suite).toBeDefined();
      expect(suite.name).toBe('test-eval-suite');
    });

    it('should run eval cases against the configured agent', async () => {
      const agent = createAgent({
        name: 'eval-run-test',
        model: createMockModel('Hello, world! The answer is 42.'),
        maxSteps: 1,
      });

      const suite = createEvalSuite({
        name: 'greeting-eval',
        agent,
        reporter: 'json',
        cases: [
          {
            name: 'should greet',
            prompt: 'Say hello',
            assertions: [outputContains('Hello')],
          },
          {
            name: 'should contain number',
            prompt: 'What is the answer?',
            assertions: [outputMatches(/\d+/)],
          },
        ],
      });

      const results = await suite.run();

      expect(results).toBeDefined();
      expect(results.totalCases).toBe(2);
      expect(results.passed).toBe(2);
      expect(results.failed).toBe(0);
      expect(results.cases).toHaveLength(2);
      expect(results.cases[0].passed).toBe(true);
      expect(results.cases[1].passed).toBe(true);
    });

    it('should report failures when assertions do not match', async () => {
      const agent = createAgent({
        name: 'eval-fail-test',
        model: createMockModel('No greeting here'),
        maxSteps: 1,
      });

      const suite = createEvalSuite({
        name: 'failing-eval',
        agent,
        reporter: 'json',
        cases: [
          {
            name: 'should contain specific text',
            prompt: 'Say hello',
            assertions: [outputContains('NONEXISTENT_STRING')],
          },
        ],
      });

      const results = await suite.run();

      expect(results.failed).toBe(1);
      expect(results.cases[0].passed).toBe(false);
      expect(results.cases[0].assertions[0].passed).toBe(false);
    });
  });

  describe('eval suite metrics', () => {
    it('should track pass/fail counts', async () => {
      const agent = createAgent({
        name: 'eval-metrics-test',
        model: createMockMultiModel(['Hello world', 'The answer is 42', 'Goodbye universe']),
        maxSteps: 1,
      });

      const suite = createEvalSuite({
        name: 'mixed-eval',
        agent,
        reporter: 'json',
        cases: [
          {
            name: 'check hello',
            prompt: 'Greet',
            assertions: [outputContains('Hello')],
          },
          {
            name: 'check number',
            prompt: 'Math',
            assertions: [outputMatches(/\d+/)],
          },
          {
            name: 'check missing word',
            prompt: 'Farewell',
            assertions: [outputContains('MISSING')],
          },
        ],
      });

      const results = await suite.run();

      expect(results.passed).toBe(2);
      expect(results.failed).toBe(1);
      expect(results.totalCases).toBe(3);
      expect(typeof results.duration).toBe('number');
    });
  });
});
