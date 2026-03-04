import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tool } from 'ai';
import { createAgent } from '@agntk/core';
import {
  checkWorkflowAvailability,
  wrapToolAsDurableStep,
  wrapToolsAsDurable,
  wrapSelectedToolsAsDurable,
  parseDuration,
  formatDuration,
} from '@agntk/core/advanced';
import { createMockModel } from './setup';

describe('Durability', () => {
  describe('parseDuration', () => {
    it('should parse seconds', () => {
      expect(parseDuration('30s')).toBe(30_000);
    });

    it('should parse minutes', () => {
      expect(parseDuration('5m')).toBe(5 * 60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('should throw on invalid duration strings', () => {
      expect(() => parseDuration('invalid')).toThrow();
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds to readable string', () => {
      const formatted = formatDuration(60_000);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should format hours correctly', () => {
      const formatted = formatDuration(3600_000);
      expect(formatted).toContain('h');
    });
  });

  describe('checkWorkflowAvailability', () => {
    it('should return a boolean', async () => {
      const available = await checkWorkflowAvailability();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('wrapToolAsDurableStep', () => {
    it('should wrap a tool and preserve its interface', () => {
      const originalTool = tool({
        description: 'A test tool',
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => ({ output: input }),
      });

      const wrapped = wrapToolAsDurableStep(originalTool, {}, 'test-tool');

      expect(wrapped).toBeDefined();
      expect(wrapped.description).toBe('A test tool');
    });

    it('should accept durability config options', () => {
      const originalTool = tool({
        description: 'Configurable tool',
        parameters: z.object({ x: z.number() }),
        execute: async ({ x }) => ({ result: x * 2 }),
      });

      const wrapped = wrapToolAsDurableStep(originalTool, {
        retryCount: 5,
        timeout: '30s',
      });

      expect(wrapped).toBeDefined();
    });
  });

  describe('wrapToolsAsDurable', () => {
    it('should wrap all tools in a toolset', () => {
      const tools = {
        tool_a: tool({
          description: 'Tool A',
          parameters: z.object({ a: z.string() }),
          execute: async ({ a }) => ({ result: a }),
        }),
        tool_b: tool({
          description: 'Tool B',
          parameters: z.object({ b: z.number() }),
          execute: async ({ b }) => ({ result: b }),
        }),
      };

      const wrapped = wrapToolsAsDurable(tools);

      expect(Object.keys(wrapped)).toEqual(['tool_a', 'tool_b']);
      expect(wrapped.tool_a.description).toBe('Tool A');
      expect(wrapped.tool_b.description).toBe('Tool B');
    });
  });

  describe('wrapSelectedToolsAsDurable', () => {
    it('should only wrap specified tools', () => {
      const tools = {
        tool_a: tool({
          description: 'Tool A',
          parameters: z.object({ a: z.string() }),
          execute: async ({ a }) => ({ result: a }),
        }),
        tool_b: tool({
          description: 'Tool B',
          parameters: z.object({ b: z.number() }),
          execute: async ({ b }) => ({ result: b }),
        }),
      };

      const wrapped = wrapSelectedToolsAsDurable(tools, ['tool_a']);

      expect(Object.keys(wrapped)).toEqual(['tool_a', 'tool_b']);
    });
  });

  describe('createAgent (auto-detects durability)', () => {
    it('should create agent without error', () => {
      const agent = createAgent({
        name: 'durable-test-agent',
        model: createMockModel('Durable agent response'),
        maxSteps: 1,
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('durable-test-agent');
    });

    it('should stream responses', async () => {
      const agent = createAgent({
        name: 'durable-stream-agent',
        model: createMockModel('Durable response text'),
        maxSteps: 1,
      });

      const result = await agent.stream({ prompt: 'Test durability' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(text).toBe('Durable response text');
    });
  });
});
