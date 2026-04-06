import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: vi.fn((spec: Record<string, unknown>) => spec),
  ToolLoopAgent: class {},
  stepCountIs: () => () => false,
}));

import { generateText } from 'ai';
import { synthesizeJournal } from '../harness/journal';
import { createEventLogger } from '../harness/events';
import type { LanguageModel } from 'ai';

const mockGenerateText = vi.mocked(generateText);

let tmpDir: string;
let eventsDir: string;
let journalDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-journal-test-'));
  eventsDir = path.join(tmpDir, 'events');
  journalDir = path.join(tmpDir, 'journal');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const mockModel = {} as LanguageModel;

describe('synthesizeJournal', () => {
  it('returns null when no events exist for the date', async () => {
    const logger = createEventLogger(eventsDir);

    const result = await synthesizeJournal('2025-01-15', {
      eventLogger: logger,
      model: mockModel,
      journalDir,
    });

    expect(result).toBeNull();
  });

  it('synthesizes events into a journal entry', async () => {
    const logger = createEventLogger(eventsDir);

    logger.log({
      source: 'test-agent',
      type: 'interaction',
      summary: 'User asked about API design',
      details: { prompt: 'How should I design this API?' },
    });

    logger.log({
      source: 'test-agent',
      type: 'decision',
      summary: 'Recommended REST over GraphQL',
      details: { reasoning: 'Simpler for CRUD operations' },
      outcome: { action: 'respond', llmInvoked: true, tokensUsed: 500 },
    });

    await logger.flush();

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        reflection: 'Today I helped with API design decisions. The user preferred simpler approaches.',
        instinctCandidates: [
          {
            text: 'For simple CRUD APIs, default to REST unless GraphQL is explicitly needed.',
            tags: ['api-design', 'architecture'],
            reasoning: 'User confirmed REST was the right choice for their use case.',
          },
        ],
        knowledgeUpdates: [
          {
            entity: 'User API preferences',
            fact: 'Prefers REST for CRUD operations',
          },
        ],
      }),
    } as Awaited<ReturnType<typeof generateText>>);

    const today = new Date().toISOString().split('T')[0];
    const result = await synthesizeJournal(today, {
      eventLogger: logger,
      model: mockModel,
      journalDir,
    });

    expect(result).not.toBeNull();
    expect(result!.date).toBe(today);
    expect(result!.reflection).toContain('API design');
    expect(result!.instinctCandidates).toHaveLength(1);
    expect(result!.instinctCandidates[0].tags).toContain('api-design');
    expect(result!.knowledgeUpdates).toHaveLength(1);

    const journalPath = path.join(journalDir, `${today}.md`);
    expect(fs.existsSync(journalPath)).toBe(true);

    const content = fs.readFileSync(journalPath, 'utf-8');
    expect(content).toContain(`# Journal — ${today}`);
    expect(content).toContain('Instinct Candidates');
    expect(content).toContain('Knowledge Updates');
  });

  it('handles malformed LLM response gracefully', async () => {
    const logger = createEventLogger(eventsDir);

    logger.log({
      source: 'test',
      type: 'system',
      summary: 'Test event',
      details: null,
    });

    await logger.flush();

    mockGenerateText.mockResolvedValueOnce({
      text: 'This is not valid JSON but a reasonable reflection.',
    } as Awaited<ReturnType<typeof generateText>>);

    const today = new Date().toISOString().split('T')[0];
    const result = await synthesizeJournal(today, {
      eventLogger: logger,
      model: mockModel,
      journalDir,
    });

    expect(result).not.toBeNull();
    expect(result!.reflection).toContain('reasonable reflection');
    expect(result!.instinctCandidates).toEqual([]);
    expect(result!.knowledgeUpdates).toEqual([]);
  });
});
