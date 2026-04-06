import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseCron, matchesCron, createScheduler } from '../harness/scheduler';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('parseCron', () => {
  it('parses standard cron expression', () => {
    const cron = parseCron('0 9 * * 1-5');
    expect(cron).not.toBeNull();
    expect(cron!.minutes.has(0)).toBe(true);
    expect(cron!.hours.has(9)).toBe(true);
    expect(cron!.daysOfWeek.has(1)).toBe(true);
    expect(cron!.daysOfWeek.has(5)).toBe(true);
    expect(cron!.daysOfWeek.has(0)).toBe(false);
  });

  it('parses step expressions', () => {
    const cron = parseCron('*/15 * * * *');
    expect(cron).not.toBeNull();
    expect(cron!.minutes.has(0)).toBe(true);
    expect(cron!.minutes.has(15)).toBe(true);
    expect(cron!.minutes.has(30)).toBe(true);
    expect(cron!.minutes.has(45)).toBe(true);
    expect(cron!.minutes.has(10)).toBe(false);
  });

  it('returns null for invalid expression', () => {
    expect(parseCron('invalid')).toBeNull();
    expect(parseCron('1 2 3')).toBeNull();
  });
});

describe('matchesCron', () => {
  it('matches a specific date/time', () => {
    const cron = parseCron('30 14 * * *')!;
    const match = new Date(2025, 5, 15, 14, 30, 0);
    const noMatch = new Date(2025, 5, 15, 14, 31, 0);

    expect(matchesCron(cron, match)).toBe(true);
    expect(matchesCron(cron, noMatch)).toBe(false);
  });
});

describe('createScheduler', () => {
  it('discovers workflows from directory', async () => {
    writeFile(
      'workflows/daily-journal.md',
      `---
id: daily-journal
tags: [journal]
schedule: 0 22 * * *
---
Synthesize today's journal.`,
    );

    const onFire = vi.fn();
    const scheduler = createScheduler({
      harnessRoot: tmpDir,
      onFire,
    });

    await scheduler.start();
    const workflows = scheduler.getWorkflows();

    expect(workflows).toHaveLength(1);
    expect(workflows[0].id).toBe('daily-journal');
    expect(workflows[0].schedule).toBe('0 22 * * *');

    scheduler.stop();
  });

  it('ignores workflows without schedule field', async () => {
    writeFile(
      'workflows/no-schedule.md',
      `---
id: manual-only
tags: [manual]
---
This has no schedule.`,
    );

    const onFire = vi.fn();
    const scheduler = createScheduler({
      harnessRoot: tmpDir,
      onFire,
    });

    await scheduler.start();
    expect(scheduler.getWorkflows()).toHaveLength(0);
    scheduler.stop();
  });

  it('handles missing workflows directory', async () => {
    const onFire = vi.fn();
    const scheduler = createScheduler({
      harnessRoot: tmpDir,
      onFire,
    });

    await scheduler.start();
    expect(scheduler.getWorkflows()).toHaveLength(0);
    scheduler.stop();
  });
});
