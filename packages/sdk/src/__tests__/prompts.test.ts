import { describe, it, expect } from 'vitest';
import {
  buildSystemContext,
  formatSystemContextBlock,
  buildDynamicSystemPrompt,
  type SystemContext,
} from '../prompts/context';

describe('buildSystemContext', () => {
  it('should return context with required fields', async () => {
    const context = await buildSystemContext();

    expect(context).toHaveProperty('currentTime');
    expect(context).toHaveProperty('currentDate');
    expect(context).toHaveProperty('timezone');
    expect(context).toHaveProperty('platform');
    expect(context).toHaveProperty('hostname');
    expect(context).toHaveProperty('username');
  });

  it('should include workspace root when provided', async () => {
    const context = await buildSystemContext({ workspaceRoot: '/test/workspace' });
    expect(context.workspaceRoot).toBe('/test/workspace');
  });

  it('should format current time correctly', async () => {
    const context = await buildSystemContext();

    expect(context.currentTime).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  });

  it('should format current date correctly', async () => {
    const context = await buildSystemContext();

    expect(context.currentDate).toMatch(/\w+,\s+\w+\s+\d+,\s+\d{4}/);
  });
});

describe('formatSystemContextBlock', () => {
  it('should format context as markdown', () => {
    const context: SystemContext = {
      currentTime: '10:30 AM',
      currentDate: 'Tuesday, January 14, 2026',
      timezone: 'America/New_York',
      platform: 'darwin',
      hostname: 'test-machine',
      username: 'testuser',
      locale: 'en-US',
    };

    const block = formatSystemContextBlock(context);

    expect(block).toContain('# Current Environment');
    expect(block).toContain('**Date**: Tuesday, January 14, 2026');
    expect(block).toContain('**Time**: 10:30 AM');
    expect(block).toContain('**Platform**: darwin');
    expect(block).toContain('**User**: testuser');
  });

  it('should include workspace when provided', () => {
    const context: SystemContext = {
      currentTime: '10:30 AM',
      currentDate: 'Tuesday, January 14, 2026',
      timezone: 'America/New_York',
      platform: 'darwin',
      hostname: 'test-machine',
      username: 'testuser',
      locale: 'en-US',
      workspaceRoot: '/my/project',
    };

    const block = formatSystemContextBlock(context);
    expect(block).toContain('**Workspace**: /my/project');
  });

  it('should include workspace map when provided', () => {
    const context: SystemContext = {
      currentTime: '10:30 AM',
      currentDate: 'Tuesday, January 14, 2026',
      timezone: 'America/New_York',
      platform: 'darwin',
      hostname: 'test-machine',
      username: 'testuser',
      locale: 'en-US',
      workspaceRoot: '/my/project',
      workspaceMap: 'src/: index.ts, utils\npackage.json',
    };

    const block = formatSystemContextBlock(context);
    expect(block).toContain('## Workspace Structure');
    expect(block).toContain('src/: index.ts, utils');
  });
});

describe('buildDynamicSystemPrompt', () => {
  it('should combine base prompt with context', async () => {
    const basePrompt = 'You are a helpful assistant.';
    const dynamicPrompt = await buildDynamicSystemPrompt(basePrompt);

    expect(dynamicPrompt).toContain(basePrompt);
    expect(dynamicPrompt).toContain('# Current Environment');
  });

  it('should include workspace info when provided', async () => {
    const basePrompt = 'Base prompt.';
    const dynamicPrompt = await buildDynamicSystemPrompt(basePrompt, {
      workspaceRoot: '/test/workspace',
    });

    expect(dynamicPrompt).toContain('/test/workspace');
  });
});

describe('buildSystemContext with user preferences', () => {
  it('should accept userPreferences option', async () => {
    const context = await buildSystemContext({
      userPreferences: {
        name: 'John',
        communicationStyle: 'concise',
      },
    });

    expect(context).toHaveProperty('currentTime');
    expect(context.userPreferences?.name).toBe('John');
    expect(context.userPreferences?.communicationStyle).toBe('concise');
  });

  it('should work without userPreferences', async () => {
    const context = await buildSystemContext({});
    expect(context).toHaveProperty('currentTime');
    expect(context.userPreferences).toBeUndefined();
  });
});

describe('formatSystemContextBlock with user preferences', () => {
  it('should include user preferences in formatted output', () => {
    const context: SystemContext = {
      currentTime: '10:30 AM',
      currentDate: 'Tuesday, January 14, 2026',
      timezone: 'America/New_York',
      platform: 'darwin',
      hostname: 'test-machine',
      username: 'testuser',
      locale: 'en-US',
      userPreferences: {
        name: 'Test User',
        language: 'English',
        communicationStyle: 'concise',
        codeStyle: {
          indentation: 'spaces',
          indentSize: 2,
        },
      },
    };

    const block = formatSystemContextBlock(context);

    expect(block).toContain('## User Preferences');
    expect(block).toContain('**Name**: Test User');
    expect(block).toContain('**Preferred Language**: English');
    expect(block).toContain('**Communication Style**: concise');
    expect(block).toContain('Indentation: spaces');
    expect(block).toContain('Indent Size: 2');
  });
});
