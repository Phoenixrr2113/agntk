import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCommand,
  isBrowserCliAvailable,
  resetCliAvailability,
  createBrowserTool,
} from '../tools/browser';
import {
  browserInputSchema,
  BROWSER_ACTIONS,
  BROWSER_TOOL_DESCRIPTION,
} from '../tools/browser/types';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

function mockExecFile(stdout: string, stderr = '', exitCode = 0) {
  const mock = execFile as unknown as ReturnType<typeof vi.fn>;
  mock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...args: unknown[]) => unknown) => {
      if (typeof _opts === 'function') {
        const callback = _opts;
        if (exitCode !== 0) {
          const err = Object.assign(new Error(stderr), { stdout, stderr, code: exitCode });
          callback(err, stdout, stderr);
        } else {
          callback(null, { stdout, stderr });
        }
      } else if (typeof cb === 'function') {
        if (exitCode !== 0) {
          const err = Object.assign(new Error(stderr), { stdout, stderr, code: exitCode });
          cb(err, stdout, stderr);
        } else {
          cb(null, { stdout, stderr });
        }
      }
      return {} as any;
    },
  );
}

describe('buildCommand', () => {
  it('builds open command', () => {
    const args = buildCommand({ action: 'open', url: 'https://example.com' });
    expect(args).toEqual(['open', 'https://example.com']);
  });

  it('builds snapshot command', () => {
    const args = buildCommand({ action: 'snapshot' });
    expect(args).toEqual(['snapshot']);
  });

  it('builds snapshot with interactive flag', () => {
    const args = buildCommand({ action: 'snapshot', interactive: true });
    expect(args).toEqual(['snapshot', '-i']);
  });

  it('builds click command', () => {
    const args = buildCommand({ action: 'click', selector: '@e1' });
    expect(args).toEqual(['click', '@e1']);
  });

  it('builds fill command', () => {
    const args = buildCommand({ action: 'fill', selector: '@e3', text: 'hello@test.com' });
    expect(args).toEqual(['fill', '@e3', 'hello@test.com']);
  });

  it('builds type command', () => {
    const args = buildCommand({ action: 'type', selector: '#input', text: 'hello' });
    expect(args).toEqual(['type', '#input', 'hello']);
  });

  it('builds select command', () => {
    const args = buildCommand({ action: 'select', selector: '#dropdown', value: 'option1' });
    expect(args).toEqual(['select', '#dropdown', 'option1']);
  });

  it('builds press command', () => {
    const args = buildCommand({ action: 'press', key: 'Enter' });
    expect(args).toEqual(['press', 'Enter']);
  });

  it('builds hover command', () => {
    const args = buildCommand({ action: 'hover', selector: '@e5' });
    expect(args).toEqual(['hover', '@e5']);
  });

  it('builds scroll command', () => {
    const args = buildCommand({ action: 'scroll', direction: 'down' });
    expect(args).toEqual(['scroll', 'down']);
  });

  it('builds scroll command with pixels', () => {
    const args = buildCommand({ action: 'scroll', direction: 'up', pixels: 500 });
    expect(args).toEqual(['scroll', 'up', '500']);
  });

  it('builds screenshot command with auto path', () => {
    const args = buildCommand({ action: 'screenshot' });
    expect(args[0]).toBe('screenshot');
    expect(args[1]).toMatch(/browser-screenshot-\d+\.png$/);
  });

  it('builds screenshot with custom path and fullPage', () => {
    const args = buildCommand({ action: 'screenshot', path: '/tmp/shot.png', fullPage: true });
    expect(args).toEqual(['screenshot', '/tmp/shot.png', '--full']);
  });

  it('builds getText command', () => {
    const args = buildCommand({ action: 'getText', selector: '@e2' });
    expect(args).toEqual(['get', 'text', '@e2']);
  });

  it('builds getUrl command', () => {
    const args = buildCommand({ action: 'getUrl' });
    expect(args).toEqual(['get', 'url']);
  });

  it('builds getTitle command', () => {
    const args = buildCommand({ action: 'getTitle' });
    expect(args).toEqual(['get', 'title']);
  });

  it('builds wait for selector', () => {
    const args = buildCommand({ action: 'wait', selector: '#loaded' });
    expect(args).toEqual(['wait', '#loaded']);
  });

  it('builds wait for ms', () => {
    const args = buildCommand({ action: 'wait', ms: 2000 });
    expect(args).toEqual(['wait', '2000']);
  });

  it('builds wait for text', () => {
    const args = buildCommand({ action: 'wait', text: 'Welcome' });
    expect(args).toEqual(['wait', '--text', 'Welcome']);
  });

  it('builds wait for URL pattern', () => {
    const args = buildCommand({ action: 'wait', url: '**/dashboard' });
    expect(args).toEqual(['wait', '--url', '**/dashboard']);
  });

  it('builds wait for load state', () => {
    const args = buildCommand({ action: 'wait', load: 'networkidle' });
    expect(args).toEqual(['wait', '--load', 'networkidle']);
  });

  it('builds wait with default (no params)', () => {
    const args = buildCommand({ action: 'wait' });
    expect(args).toEqual(['wait', '1000']);
  });

  it('builds eval command', () => {
    const args = buildCommand({ action: 'eval', js: 'document.title' });
    expect(args).toEqual(['eval', 'document.title']);
  });

  it('builds check command', () => {
    const args = buildCommand({ action: 'check', selector: '@e7' });
    expect(args).toEqual(['check', '@e7']);
  });

  it('builds uncheck command', () => {
    const args = buildCommand({ action: 'uncheck', selector: '@e8' });
    expect(args).toEqual(['uncheck', '@e8']);
  });

  it('builds dblclick command', () => {
    const args = buildCommand({ action: 'dblclick', selector: '@e4' });
    expect(args).toEqual(['dblclick', '@e4']);
  });

  it('builds close command', () => {
    const args = buildCommand({ action: 'close' });
    expect(args).toEqual(['close']);
  });

  it('includes session flag from config', () => {
    const args = buildCommand({ action: 'open', url: 'https://x.com' }, { session: 'my-session' });
    expect(args).toContain('--session');
    expect(args).toContain('my-session');
  });

  it('includes CDP URL flag from config', () => {
    const args = buildCommand(
      { action: 'open', url: 'https://x.com' },
      { cdpUrl: 'ws://localhost:9222' },
    );
    expect(args).toContain('--cdp');
    expect(args).toContain('ws://localhost:9222');
  });

  it('includes no-headless flag from config', () => {
    const args = buildCommand({ action: 'open', url: 'https://x.com' }, { headless: false });
    expect(args).toContain('--no-headless');
  });
});

describe('browserInputSchema', () => {
  it('validates open action', () => {
    const result = browserInputSchema.safeParse({ action: 'open', url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('validates click action', () => {
    const result = browserInputSchema.safeParse({ action: 'click', selector: '@e1' });
    expect(result.success).toBe(true);
  });

  it('validates fill action', () => {
    const result = browserInputSchema.safeParse({ action: 'fill', selector: '@e2', text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = browserInputSchema.safeParse({ action: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects open without url', () => {
    const result = browserInputSchema.safeParse({ action: 'open' });
    expect(result.success).toBe(false);
  });

  it('rejects click without selector', () => {
    const result = browserInputSchema.safeParse({ action: 'click' });
    expect(result.success).toBe(false);
  });

  it('validates snapshot with optional interactive', () => {
    const result = browserInputSchema.safeParse({ action: 'snapshot', interactive: true });
    expect(result.success).toBe(true);
  });

  it('validates close (no additional params)', () => {
    const result = browserInputSchema.safeParse({ action: 'close' });
    expect(result.success).toBe(true);
  });

  it('validates wait with text', () => {
    const result = browserInputSchema.safeParse({ action: 'wait', text: 'Welcome' });
    expect(result.success).toBe(true);
  });

  it('validates scroll with direction', () => {
    const result = browserInputSchema.safeParse({ action: 'scroll', direction: 'down' });
    expect(result.success).toBe(true);
  });

  it('rejects scroll with invalid direction', () => {
    const result = browserInputSchema.safeParse({ action: 'scroll', direction: 'diagonal' });
    expect(result.success).toBe(false);
  });
});

describe('isBrowserCliAvailable', () => {
  beforeEach(() => {
    resetCliAvailability();
    (execFile as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCliAvailability();
  });

  it('returns true when CLI is found', async () => {
    mockExecFile('/usr/local/bin/agent-browser');
    const available = await isBrowserCliAvailable();
    expect(available).toBe(true);
  });

  it('returns false when CLI is not found', async () => {
    const mock = execFile as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: (...args: unknown[]) => unknown) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(new Error('not found'));
        return {} as any;
      },
    );

    const available = await isBrowserCliAvailable();
    expect(available).toBe(false);
  });

  it('caches availability result', async () => {
    mockExecFile('/usr/local/bin/agent-browser');
    await isBrowserCliAvailable();
    await isBrowserCliAvailable();

    const mock = execFile as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('browser tool exports', () => {
  it('exports BROWSER_ACTIONS array', () => {
    expect(BROWSER_ACTIONS).toContain('open');
    expect(BROWSER_ACTIONS).toContain('click');
    expect(BROWSER_ACTIONS).toContain('fill');
    expect(BROWSER_ACTIONS).toContain('snapshot');
    expect(BROWSER_ACTIONS).toContain('close');
    expect(BROWSER_ACTIONS.length).toBeGreaterThanOrEqual(15);
  });

  it('exports BROWSER_TOOL_DESCRIPTION', () => {
    expect(BROWSER_TOOL_DESCRIPTION).toContain('agent-browser');
    expect(BROWSER_TOOL_DESCRIPTION).toContain('open');
    expect(BROWSER_TOOL_DESCRIPTION).toContain('snapshot');
    expect(BROWSER_TOOL_DESCRIPTION).toContain('click');
  });
});

describe('createBrowserTool', () => {
  beforeEach(() => {
    resetCliAvailability();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCliAvailability();
  });

  it('creates a tool with description', () => {
    const tool = createBrowserTool();
    expect(tool.description).toBe(BROWSER_TOOL_DESCRIPTION);
  });

  it('returns error when CLI is not available', async () => {
    const mock = execFile as unknown as ReturnType<typeof vi.fn>;
    mock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb?: (...args: unknown[]) => unknown) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        if (callback) callback(new Error('not found'));
        return {} as any;
      },
    );

    const tool = createBrowserTool();
    const result = await tool.execute!({ action: 'open', url: 'https://example.com' }, {} as any);
    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('agent-browser CLI not found');
  });

  it('accepts custom config', () => {
    const tool = createBrowserTool({
      timeout: 60000,
      session: 'test',
      headless: false,
    });
    expect(tool.description).toBe(BROWSER_TOOL_DESCRIPTION);
  });
});

describe('browser tool in presets', () => {
  it('is listed in full preset tools', async () => {
    const { toolPresets } = await import('../presets/tools');
    expect(toolPresets.full.tools).toContain('browser');
  });

  it('is NOT in standard preset', async () => {
    const { toolPresets } = await import('../presets/tools');
    expect(toolPresets.standard.tools).not.toContain('browser');
  });

  it('is NOT in minimal preset', async () => {
    const { toolPresets } = await import('../presets/tools');
    expect(toolPresets.minimal.tools).not.toContain('browser');
  });
});
