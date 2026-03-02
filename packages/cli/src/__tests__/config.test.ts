import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Mock node:fs to control file existence and content
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
  };
});

describe('loadDotenvFallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('loads API key from ~/.agntk/.env when not in env', async () => {
    delete process.env['OPENROUTER_API_KEY'];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('OPENROUTER_API_KEY=sk-or-from-file\n');

    const { loadDotenvFallback: freshLoad } = await import('../config');
    freshLoad();

    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-from-file');
  });

  it('does not override existing env vars', async () => {
    process.env['OPENROUTER_API_KEY'] = 'sk-or-from-export';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('OPENROUTER_API_KEY=sk-or-from-file\n');

    const { loadDotenvFallback: freshLoad } = await import('../config');
    freshLoad();

    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-from-export');
  });

  it('skips comments and blank lines', async () => {
    delete process.env['OPENROUTER_API_KEY'];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('# Comment line\n\nOPENROUTER_API_KEY=sk-or-parsed\n');

    const { loadDotenvFallback: freshLoad } = await import('../config');
    freshLoad();

    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-parsed');
  });
});
