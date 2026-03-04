import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('@agntk/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(() => vi.fn()),
  }),
}));

import { createProgressTools, type ProgressData } from '../tools/progress';

let tmpDir: string;

const callCtx = {
  toolCallId: 'test',
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeProgress(data: ProgressData): void {
  fs.writeFileSync(path.join(tmpDir, 'progress.json'), JSON.stringify(data, null, 2));
}

function readProgress(): ProgressData {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8'));
}

describe('progress_read', () => {
  it('should return empty data when no progress.json exists', async () => {
    const tools = createProgressTools(tmpDir);
    const result = JSON.parse((await tools.progress_read.execute({}, callCtx)) as string);

    expect(result.success).toBe(true);
    expect(result.summary.totalFeatures).toBe(0);
    expect(result.data.features).toEqual([]);
    expect(result.data.sessions).toEqual([]);
  });

  it('should read existing progress.json', async () => {
    writeProgress({
      version: 1,
      features: [
        {
          id: 'auth',
          name: 'Authentication',
          status: 'completed',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        { id: 'api', name: 'API Layer', status: 'in_progress', updatedAt: '2025-01-02T00:00:00Z' },
        { id: 'ui', name: 'UI Design', status: 'pending', updatedAt: '2025-01-03T00:00:00Z' },
      ],
      sessions: [
        { sessionId: 'session-1', startedAt: '2025-01-01T00:00:00Z', actions: ['Started auth'] },
      ],
    });

    const tools = createProgressTools(tmpDir);
    const result = JSON.parse((await tools.progress_read.execute({}, callCtx)) as string);

    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      totalFeatures: 3,
      pending: 1,
      inProgress: 1,
      completed: 1,
      blocked: 0,
      totalSessions: 1,
    });
    expect(result.data.features).toHaveLength(3);
  });

  it('should handle malformed progress.json gracefully', async () => {
    fs.writeFileSync(path.join(tmpDir, 'progress.json'), 'not-json');

    const tools = createProgressTools(tmpDir);
    const result = JSON.parse((await tools.progress_read.execute({}, callCtx)) as string);

    expect(result.success).toBe(true);
    expect(result.data.features).toEqual([]);
  });
});

describe('progress_update (features)', () => {
  it('should add a new feature', async () => {
    const tools = createProgressTools(tmpDir);
    const result = JSON.parse(
      (await tools.progress_update.execute(
        { featureId: 'auth', featureName: 'Authentication', featureStatus: 'pending' },
        callCtx,
      )) as string,
    );

    expect(result.success).toBe(true);
    const data = readProgress();
    expect(data.features).toHaveLength(1);
    expect(data.features[0].id).toBe('auth');
    expect(data.features[0].name).toBe('Authentication');
    expect(data.features[0].status).toBe('pending');
  });

  it('should update an existing feature', async () => {
    writeProgress({
      version: 1,
      features: [
        {
          id: 'auth',
          name: 'Authentication',
          status: 'pending',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ],
      sessions: [],
    });

    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      { featureId: 'auth', featureStatus: 'completed', featureNotes: 'Done!' },
      callCtx,
    );

    const data = readProgress();
    expect(data.features[0].status).toBe('completed');
    expect(data.features[0].notes).toBe('Done!');

    expect(data.features[0].updatedAt).not.toBe('2025-01-01T00:00:00Z');
  });

  it('should preserve other features when updating one', async () => {
    writeProgress({
      version: 1,
      features: [
        { id: 'auth', name: 'Auth', status: 'completed', updatedAt: '2025-01-01T00:00:00Z' },
        { id: 'api', name: 'API', status: 'pending', updatedAt: '2025-01-01T00:00:00Z' },
      ],
      sessions: [],
    });

    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      { featureId: 'api', featureStatus: 'in_progress' },
      callCtx,
    );

    const data = readProgress();
    expect(data.features).toHaveLength(2);
    expect(data.features[0].id).toBe('auth');
    expect(data.features[0].status).toBe('completed');
    expect(data.features[1].id).toBe('api');
    expect(data.features[1].status).toBe('in_progress');
  });
});

describe('progress_update (session log)', () => {
  it('should create a new session and log an action', async () => {
    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      { sessionId: 'session-1', action: 'Started working on auth module' },
      callCtx,
    );

    const data = readProgress();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].sessionId).toBe('session-1');
    expect(data.sessions[0].actions).toHaveLength(1);
    expect(data.sessions[0].actions[0]).toContain('Started working on auth module');
  });

  it('should append to existing session', async () => {
    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute({ sessionId: 'session-1', action: 'Action 1' }, callCtx);
    await tools.progress_update.execute({ sessionId: 'session-1', action: 'Action 2' }, callCtx);

    const data = readProgress();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].actions).toHaveLength(2);
  });

  it('should preserve previous sessions (append-only)', async () => {
    writeProgress({
      version: 1,
      features: [],
      sessions: [
        { sessionId: 'old-session', startedAt: '2025-01-01T00:00:00Z', actions: ['Old action'] },
      ],
    });

    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      { sessionId: 'new-session', action: 'New action' },
      callCtx,
    );

    const data = readProgress();
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions[0].sessionId).toBe('old-session');
    expect(data.sessions[0].actions).toEqual(['Old action']);
    expect(data.sessions[1].sessionId).toBe('new-session');
  });

  it('should handle combined feature update + session log', async () => {
    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      {
        featureId: 'auth',
        featureName: 'Authentication',
        featureStatus: 'completed',
        sessionId: 'session-1',
        action: 'Completed authentication feature',
      },
      callCtx,
    );

    const data = readProgress();
    expect(data.features).toHaveLength(1);
    expect(data.features[0].status).toBe('completed');
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].actions[0]).toContain('Completed authentication feature');
  });
});

describe('progress.json format', () => {
  it('should write pretty-printed JSON with trailing newline', async () => {
    const tools = createProgressTools(tmpDir);
    await tools.progress_update.execute(
      { featureId: 'test', featureName: 'Test', featureStatus: 'pending' },
      callCtx,
    );

    const raw = fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8');

    expect(raw).toContain('  ');

    expect(raw.endsWith('\n')).toBe(true);

    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
