import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex, rebuildAllIndexes } from '../harness/index-builder';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-builder-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('buildIndex', () => {
  it('generates a markdown table from directory contents', async () => {
    writeFile(
      'rules/safety.md',
      `---
id: safety-001
tags: [safety, core]
status: active
updated: 2025-06-01
---
<!-- L0: Filesystem safety rule -->
Body.`,
    );

    writeFile(
      'rules/comms.md',
      `---
id: comms-001
tags: [communication]
status: draft
updated: 2025-05-15
---
<!-- L0: Communication guidelines -->
Body.`,
    );

    const result = await buildIndex(path.join(tmpDir, 'rules'));

    expect(result).toContain('# Index');
    expect(result).toContain('2 file(s)');
    expect(result).toContain('safety-001');
    expect(result).toContain('comms-001');
    expect(result).toContain('Filesystem safety rule');
    expect(result).toContain('| File | ID | Tags |');
  });

  it('returns empty string for nonexistent directory', async () => {
    const result = await buildIndex(path.join(tmpDir, 'nonexistent'));
    expect(result).toBe('');
  });

  it('excludes _index.md from the listing', async () => {
    writeFile('rules/_index.md', 'Old index content');
    writeFile(
      'rules/rule1.md',
      `---
id: rule-1
status: active
---
<!-- L0: A rule -->
Body.`,
    );

    const result = await buildIndex(path.join(tmpDir, 'rules'));
    expect(result).toContain('1 file(s)');
    expect(result).not.toContain('_index.md');
  });

  it('sorts by updated date descending', async () => {
    writeFile(
      'rules/older.md',
      `---
id: older
updated: 2025-01-01
---
<!-- L0: Older -->
Body.`,
    );

    writeFile(
      'rules/newer.md',
      `---
id: newer
updated: 2025-06-01
---
<!-- L0: Newer -->
Body.`,
    );

    const result = await buildIndex(path.join(tmpDir, 'rules'));
    const newerIndex = result.indexOf('newer');
    const olderIndex = result.indexOf('older');
    expect(newerIndex).toBeLessThan(olderIndex);
  });
});

describe('rebuildAllIndexes', () => {
  it('creates _index.md in each harness subdirectory', async () => {
    writeFile(
      'rules/r1.md',
      `---
id: r1
status: active
---
<!-- L0: Rule one -->
Body.`,
    );

    writeFile(
      'instincts/i1.md',
      `---
id: i1
status: active
---
<!-- L0: Instinct one -->
Body.`,
    );

    await rebuildAllIndexes(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, 'rules', '_index.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'instincts', '_index.md'))).toBe(true);
  });
});
