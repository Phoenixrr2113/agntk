/**
 * @file Tests for update checker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('node:https', () => ({
  get: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));

vi.mock('../version', () => ({
  getVersion: vi.fn(() => '1.2.8'),
}));

import { checkForUpdate } from '../update-check';
import { existsSync, readFileSync } from 'node:fs';

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
  });

  it('returns null when no cache exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(checkForUpdate()).toBeNull();
  });

  it('returns null when cached version matches current', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ latestVersion: '1.2.8', checkedAt: Date.now() }),
    );
    expect(checkForUpdate()).toBeNull();
  });

  it('returns null when cached version is older than current', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ latestVersion: '1.2.7', checkedAt: Date.now() }),
    );
    expect(checkForUpdate()).toBeNull();
  });

  it('returns update message when newer version is available', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ latestVersion: '1.3.0', checkedAt: Date.now() }),
    );
    const msg = checkForUpdate();
    expect(msg).toContain('1.3.0');
    expect(msg).toContain('npm i -g agntk');
  });

  it('returns update message for major version bump', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ latestVersion: '2.0.0', checkedAt: Date.now() }),
    );
    const msg = checkForUpdate();
    expect(msg).toContain('2.0.0');
  });

  it('returns update message for patch version bump', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ latestVersion: '1.2.9', checkedAt: Date.now() }),
    );
    const msg = checkForUpdate();
    expect(msg).toContain('1.2.9');
  });

  it('returns null when cache is corrupted', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(checkForUpdate()).toBeNull();
  });
});
