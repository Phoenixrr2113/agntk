import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { createLogger } from '@agntk/logger';
import type { AgentEvent } from './events';
import type { EventLogger } from './events';

const log = createLogger('@agntk/core:harness-journal');

const MAX_EVENTS_PER_CHUNK = 20;

export interface InstinctCandidate {
  text: string;
  tags: string[];
  reasoning: string;
}

export interface KnowledgeUpdate {
  entity: string;
  fact: string;
}

export interface JournalEntry {
  date: string;
  reflection: string;
  instinctCandidates: InstinctCandidate[];
  knowledgeUpdates: KnowledgeUpdate[];
}

function groupEventsByThread(events: AgentEvent[]): Map<string, AgentEvent[]> {
  const grouped = new Map<string, AgentEvent[]>();
  for (const event of events) {
    const key = event.threadId ?? '__default__';
    const existing = grouped.get(key);
    if (existing) {
      existing.push(event);
    } else {
      grouped.set(key, [event]);
    }
  }
  return grouped;
}

function formatEventsForPrompt(events: AgentEvent[]): string {
  return events
    .map(
      (e) =>
        `[${e.timestamp}] (${e.type}) ${e.summary}` +
        (e.outcome ? ` → ${e.outcome.action} (tokens: ${e.outcome.tokensUsed})` : ''),
    )
    .join('\n');
}

const SYNTHESIS_PROMPT = `You are synthesizing a daily journal entry from agent activity events.

Analyze the events and produce a JSON response with this exact structure:
{
  "reflection": "A coherent 2-4 paragraph reflection on what happened today, patterns noticed, and what could improve.",
  "instinctCandidates": [
    {
      "text": "The learned behavior or pattern to remember",
      "tags": ["relevant", "tags"],
      "reasoning": "Why this should become an instinct"
    }
  ],
  "knowledgeUpdates": [
    {
      "entity": "The subject",
      "fact": "What was learned about it"
    }
  ]
}

Rules:
- Only suggest instinct candidates for genuinely surprising or non-obvious lessons
- Keep reflection focused on actionable insights, not narration
- Knowledge updates should be durable facts, not session-specific state
- Return valid JSON only, no markdown fences`;

async function synthesizeChunk(
  events: AgentEvent[],
  model: LanguageModel,
): Promise<JournalEntry> {
  const eventsText = formatEventsForPrompt(events);

  const { text } = await generateText({
    model,
    prompt: `${SYNTHESIS_PROMPT}\n\nEvents:\n${eventsText}`,
  });

  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '');
    const parsed = JSON.parse(cleaned) as {
      reflection: string;
      instinctCandidates?: InstinctCandidate[];
      knowledgeUpdates?: KnowledgeUpdate[];
    };

    return {
      date: '',
      reflection: parsed.reflection ?? '',
      instinctCandidates: parsed.instinctCandidates ?? [],
      knowledgeUpdates: parsed.knowledgeUpdates ?? [],
    };
  } catch (err) {
    log.warn('Failed to parse journal synthesis response', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      date: '',
      reflection: text,
      instinctCandidates: [],
      knowledgeUpdates: [],
    };
  }
}

export interface SynthesizeJournalOptions {
  eventLogger: EventLogger;
  model: LanguageModel;
  journalDir: string;
}

export async function synthesizeJournal(
  date: string,
  options: SynthesizeJournalOptions,
): Promise<JournalEntry | null> {
  const { eventLogger, model, journalDir } = options;

  const events = await eventLogger.getEvents(date);
  if (events.length === 0) {
    log.debug('No events for date, skipping journal', { date });
    return null;
  }

  log.info('Synthesizing journal', { date, eventCount: events.length });

  let entry: JournalEntry;

  if (events.length <= MAX_EVENTS_PER_CHUNK) {
    entry = await synthesizeChunk(events, model);
    entry.date = date;
  } else {
    const grouped = groupEventsByThread(events);
    const chunks: AgentEvent[][] = [];

    for (const [, threadEvents] of grouped) {
      if (threadEvents.length <= MAX_EVENTS_PER_CHUNK) {
        chunks.push(threadEvents);
      } else {
        for (let i = 0; i < threadEvents.length; i += MAX_EVENTS_PER_CHUNK) {
          chunks.push(threadEvents.slice(i, i + MAX_EVENTS_PER_CHUNK));
        }
      }
    }

    const chunkResults: JournalEntry[] = [];
    for (const chunk of chunks) {
      const result = await synthesizeChunk(chunk, model);
      chunkResults.push(result);
    }

    const metaEvents: AgentEvent[] = chunkResults.map((r, i) => ({
      id: `meta-${i}`,
      source: 'journal-synthesizer',
      type: 'system' as const,
      timestamp: new Date().toISOString(),
      summary: `Chunk ${i + 1} reflection: ${r.reflection.slice(0, 200)}`,
      details: {
        instinctCandidates: r.instinctCandidates,
        knowledgeUpdates: r.knowledgeUpdates,
      },
    }));

    entry = await synthesizeChunk(metaEvents, model);
    entry.date = date;

    for (const chunk of chunkResults) {
      entry.instinctCandidates.push(...chunk.instinctCandidates);
      entry.knowledgeUpdates.push(...chunk.knowledgeUpdates);
    }
  }

  if (!existsSync(journalDir)) {
    await mkdir(journalDir, { recursive: true });
  }

  const journalPath = join(journalDir, `${date}.md`);
  const content = formatJournalEntry(entry);
  await writeFile(journalPath, content, 'utf-8');

  log.info('Journal written', {
    date,
    path: journalPath,
    instincts: entry.instinctCandidates.length,
    knowledge: entry.knowledgeUpdates.length,
  });

  return entry;
}

function formatJournalEntry(entry: JournalEntry): string {
  const lines = [`# Journal — ${entry.date}`, '', entry.reflection];

  if (entry.instinctCandidates.length > 0) {
    lines.push('', '## Instinct Candidates');
    for (const ic of entry.instinctCandidates) {
      lines.push('', `### ${ic.tags.join(', ')}`, ic.text, `> ${ic.reasoning}`);
    }
  }

  if (entry.knowledgeUpdates.length > 0) {
    lines.push('', '## Knowledge Updates');
    for (const ku of entry.knowledgeUpdates) {
      lines.push(`- **${ku.entity}**: ${ku.fact}`);
    }
  }

  return lines.join('\n') + '\n';
}
