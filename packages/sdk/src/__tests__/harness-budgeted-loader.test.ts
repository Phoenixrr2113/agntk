import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MarkdownMemoryStore } from '../memory/store';
import { loadMemoryContextWithBudget } from '../memory/loader';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budgeted-loader-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function createStore(): MarkdownMemoryStore {
  return new MarkdownMemoryStore({
    projectDir: tmpDir,
    globalDir: path.join(tmpDir, 'global'),
    workspaceRoot: tmpDir,
  });
}

describe('loadMemoryContextWithBudget', () => {
  it('returns empty string when no memory content exists', async () => {
    const store = createStore();
    await store.ensureDirectories();

    const result = await loadMemoryContextWithBudget(store);
    expect(result).toBe('');
  });

  it('loads identity and context as always-on sections', async () => {
    writeFile('global/identity.md', 'I am a test agent.');
    writeFile(path.join(tmpDir, 'context.md'), 'Last session: tested the loader.');

    const store = new MarkdownMemoryStore({
      projectDir: tmpDir,
      globalDir: path.join(tmpDir, 'global'),
      workspaceRoot: tmpDir,
    });

    const result = await loadMemoryContextWithBudget(store);
    expect(result).toContain('Identity');
    expect(result).toContain('I am a test agent.');
  });

  it('prioritizes files matching taskHint by tag relevance', async () => {
    const store = createStore();
    await store.ensureDirectories();

    writeFile(
      'memory/api-design.md',
      `---
id: api-design
tags: [api, rest, architecture]
---
<!-- L0: API design patterns -->
<!-- L1: REST API patterns and best practices for our service -->
Full API design notes here.`,
    );

    writeFile(
      'memory/testing.md',
      `---
id: testing
tags: [testing, jest, vitest]
---
<!-- L0: Testing strategies -->
<!-- L1: Unit and integration testing patterns -->
Full testing notes.`,
    );

    const result = await loadMemoryContextWithBudget(store, {
      taskHint: 'api rest endpoint',
      tokenBudget: 500,
    });

    expect(result).toContain('REST API patterns');
  });

  it('loads L1 summaries for high-relevance files within budget', async () => {
    const store = createStore();
    await store.ensureDirectories();

    writeFile(
      'memory/relevant.md',
      `---
id: relevant
tags: [security]
---
<!-- L0: Security notes -->
<!-- L1: Important security patterns for our application -->
Full security content.`,
    );

    const result = await loadMemoryContextWithBudget(store, {
      taskHint: 'security',
      tokenBudget: 2000,
    });

    expect(result).toContain('Important security patterns');
  });

  it('falls back to L0 listing when budget is exhausted', async () => {
    const store = createStore();
    await store.ensureDirectories();

    for (let i = 0; i < 10; i++) {
      writeFile(
        `memory/file-${i}.md`,
        `---
id: file-${i}
tags: [topic-${i}]
---
<!-- L0: Summary for file ${i} -->
<!-- L1: ${'x'.repeat(500)} -->
${'Full content '.repeat(100)}`,
      );
    }

    const result = await loadMemoryContextWithBudget(store, {
      tokenBudget: 200,
    });

    expect(result).toContain('Available Memory Files');
  });

  it('always loads files in alwaysLoadFull list', async () => {
    const store = createStore();
    await store.ensureDirectories();

    writeFile('memory/critical.md', 'This file must always be loaded in full.');
    writeFile('memory/optional.md', 'This file can be summarized.');

    const result = await loadMemoryContextWithBudget(store, {
      tokenBudget: 100,
      alwaysLoadFull: ['critical.md'],
    });

    expect(result).toContain('This file must always be loaded in full.');
  });
});
