export type {
  HarnessFrontmatter,
  CoreIdentity,
  Rule,
  Instinct,
  ParsedHarnessDocument,
  HarnessConfig,
} from './types';

export { parseFrontmatter } from './frontmatter';

export type { GovernanceLoader } from './governance';
export { createGovernanceLoader } from './governance';

export type { AgentEvent, AgentEventType, AgentEventOutcome, EventLogger } from './events';
export { createEventLogger } from './events';

export type { InstinctWriterConfig } from './instinct-writer';
export { createInstinctTool } from './instinct-writer';

export type { JournalEntry, InstinctCandidate, KnowledgeUpdate, SynthesizeJournalOptions } from './journal';
export { synthesizeJournal } from './journal';

export { buildIndex, rebuildAllIndexes } from './index-builder';
