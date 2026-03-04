import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tool } from 'ai';
import { createAgent } from '@agntk/core';
import { createMockModel, createMockToolModel } from './setup';

describe('Tool Execution', () => {
  describe('single tool call', () => {
    it('should execute a custom tool and return the final response', async () => {
      const model = createMockToolModel(
        [{ id: 'call-1', name: 'get_weather', args: { city: 'London' } }],
        'The weather in London is sunny and 22°C.',
      );

      const weatherTool = tool({
        description: 'Get the current weather for a city',
        parameters: z.object({ city: z.string() }),
        execute: async ({ city }) => ({ city, temperature: 22, condition: 'sunny' }),
      });

      const agent = createAgent({
        name: 'tool-weather-test',
        model,
        tools: { get_weather: weatherTool },
        maxSteps: 3,
      });

      const result = await agent.stream({ prompt: 'What is the weather in London?' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;

      expect(text).toBe('The weather in London is sunny and 22°C.');
    });

    it('should track tool call results in steps', async () => {
      const model = createMockToolModel(
        [{ id: 'call-1', name: 'calculator', args: { a: 5, b: 3 } }],
        'The result is 8.',
      );

      const calcTool = tool({
        description: 'Add two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ sum: a + b }),
      });

      const agent = createAgent({
        name: 'tool-calc-test',
        model,
        tools: { calculator: calcTool },
        maxSteps: 3,
      });

      const result = await agent.stream({ prompt: 'Add 5 and 3' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;

      expect(text).toBe('The result is 8.');
    });
  });

  describe('tool error handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      const model = createMockToolModel(
        [{ id: 'call-1', name: 'failing_tool', args: {} }],
        'The tool encountered an error, but I can still respond.',
      );

      const failingTool = tool({
        description: 'A tool that always fails',
        parameters: z.object({}),
        execute: async () => {
          throw new Error('Tool execution failed');
        },
      });

      const agent = createAgent({
        name: 'tool-error-test',
        model,
        tools: { failing_tool: failingTool },
        maxSteps: 3,
      });

      const result = await agent.stream({ prompt: 'Use the failing tool' });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(text).toBeDefined();
    });
  });

  describe('tool with complex schemas', () => {
    it('should handle tools with nested object schemas', async () => {
      const model = createMockToolModel(
        [{ id: 'call-1', name: 'create_user', args: { name: 'John', age: 30 } }],
        'User John created successfully.',
      );

      const createUserTool = tool({
        description: 'Create a user',
        parameters: z.object({
          name: z.string(),
          age: z.number(),
        }),
        execute: async ({ name, age }) => ({ id: 'user-1', name, age, created: true }),
      });

      const agent = createAgent({
        name: 'tool-schema-test',
        model,
        tools: { create_user: createUserTool },
        maxSteps: 3,
      });

      const result = await agent.stream({ prompt: 'Create user John, age 30' });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(text).toContain('John');
    });
  });

  describe('no tool calls', () => {
    it('should handle model that responds without tool calls', async () => {
      const model = createMockModel('Direct response without any tools.');

      const someTool = tool({
        description: 'A tool that exists but is not called',
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => ({ output: input }),
      });

      const agent = createAgent({
        name: 'tool-noop-test',
        model,
        tools: { some_tool: someTool },
        maxSteps: 3,
      });

      const result = await agent.stream({ prompt: 'Just respond without tools' });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of result.fullStream) {
        void 0;
      }
      const text = await result.text;
      expect(text).toBe('Direct response without any tools.');
    });
  });
});
