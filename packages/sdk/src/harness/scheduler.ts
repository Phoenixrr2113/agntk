import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@agntk/logger';
import { parseFrontmatter, parseRawFrontmatter } from './frontmatter';

const log = createLogger('@agntk/core:harness-scheduler');

export interface ScheduledWorkflow {
  id: string;
  path: string;
  schedule: string;
  body: string;
  tags: string[];
}

export interface SchedulerConfig {
  harnessRoot: string;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  onFire: (workflow: ScheduledWorkflow) => void | Promise<void>;
}

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = trimmed.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= min && num <= max) {
      values.add(num);
    }
  }

  return values;
}

export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

export function matchesCron(cron: CronFields, date: Date): boolean {
  return (
    cron.minutes.has(date.getMinutes()) &&
    cron.hours.has(date.getHours()) &&
    cron.daysOfMonth.has(date.getDate()) &&
    cron.months.has(date.getMonth() + 1) &&
    cron.daysOfWeek.has(date.getDay())
  );
}

const WORKFLOWS_DIR = 'workflows';

async function discoverScheduledWorkflows(harnessRoot: string): Promise<ScheduledWorkflow[]> {
  const workflowsDir = join(harnessRoot, WORKFLOWS_DIR);
  if (!existsSync(workflowsDir)) return [];

  const workflows: ScheduledWorkflow[] = [];

  try {
    const entries = await readdir(workflowsDir);
    const mdFiles = entries.filter((e) => e.endsWith('.md') && !e.startsWith('_'));

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(workflowsDir, file), 'utf-8');
        const raw = parseRawFrontmatter(content);
        const parsed = parseFrontmatter(content);

        const schedule = raw['schedule'];
        if (!schedule) continue;

        workflows.push({
          id: raw['id'] ?? file.replace(/\.md$/, ''),
          path: join(workflowsDir, file),
          schedule,
          body: parsed.body,
          tags: parsed.frontmatter.tags ?? [],
        });
      } catch (err) {
        log.warn('Failed to parse workflow', {
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    log.warn('Failed to read workflows directory', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return workflows;
}

export interface Scheduler {
  start(): Promise<void>;
  stop(): void;
  getWorkflows(): ScheduledWorkflow[];
}

export function createScheduler(config: SchedulerConfig): Scheduler {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let workflows: ScheduledWorkflow[] = [];
  const parsedCrons = new Map<string, CronFields>();

  function isQuietHours(date: Date): boolean {
    if (config.quietHoursStart === undefined || config.quietHoursEnd === undefined) return false;
    const hour = date.getHours();

    if (config.quietHoursStart <= config.quietHoursEnd) {
      return hour >= config.quietHoursStart && hour < config.quietHoursEnd;
    }
    return hour >= config.quietHoursStart || hour < config.quietHoursEnd;
  }

  async function tick(): Promise<void> {
    const now = new Date();

    if (isQuietHours(now)) {
      log.debug('Quiet hours active, skipping tick');
      return;
    }

    for (const workflow of workflows) {
      const cron = parsedCrons.get(workflow.id);
      if (!cron) continue;

      if (matchesCron(cron, now)) {
        try {
          log.info('Firing workflow', { id: workflow.id, schedule: workflow.schedule });
          await config.onFire(workflow);
        } catch (err) {
          log.warn('Workflow execution failed', {
            id: workflow.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    async start(): Promise<void> {
      workflows = await discoverScheduledWorkflows(config.harnessRoot);

      for (const wf of workflows) {
        const cron = parseCron(wf.schedule);
        if (cron) {
          parsedCrons.set(wf.id, cron);
        } else {
          log.warn('Invalid cron expression', { id: wf.id, schedule: wf.schedule });
        }
      }

      log.info('Scheduler started', { workflowCount: workflows.length });

      intervalId = setInterval(() => {
        tick().catch((err) => {
          log.warn('Scheduler tick failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, 60_000);
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        log.info('Scheduler stopped');
      }
    },

    getWorkflows(): ScheduledWorkflow[] {
      return [...workflows];
    },
  };
}
