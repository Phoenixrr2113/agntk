import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { evaluateCapability } from '../harness/evaluator';
import { installCapability, uninstallCapability } from '../harness/installer';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluator-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('evaluateCapability', () => {
  it('passes a well-formed rule file', async () => {
    const filePath = writeFile(
      'rule.md',
      `---
id: test-rule
tags: [safety, rule]
status: active
author: human
---
<!-- L0: Safety boundary -->
<!-- L1: Prevents dangerous operations -->
Do not run rm -rf on system directories.`,
    );

    const report = await evaluateCapability(filePath);

    expect(report.passed).toBe(true);
    expect(report.detectedType).toBe('rule');
    expect(report.steps.every((s) => s.status !== 'fail')).toBe(true);
  });

  it('fails for file without frontmatter', async () => {
    const filePath = writeFile('bad.md', 'Just plain text with no frontmatter.');

    const report = await evaluateCapability(filePath);

    expect(report.passed).toBe(false);
    expect(report.steps.find((s) => s.name === 'format-validation')?.status).toBe('fail');
  });

  it('warns about missing L0/L1 comments', async () => {
    const filePath = writeFile(
      'no-levels.md',
      `---
id: test
status: active
---
Body without level comments.`,
    );

    const report = await evaluateCapability(filePath);

    expect(report.passed).toBe(true);
    const levelStep = report.steps.find((s) => s.name === 'level-comments');
    expect(levelStep?.status).toBe('warn');
  });

  it('detects instinct type from source field', async () => {
    const filePath = writeFile(
      'instinct.md',
      `---
id: learned-pattern
source: session-123
author: agent
status: active
---
<!-- L0: Error handling pattern -->
Always retry with backoff.`,
    );

    const report = await evaluateCapability(filePath);

    expect(report.detectedType).toBe('instinct');
  });

  it('handles nonexistent file', async () => {
    const report = await evaluateCapability(path.join(tmpDir, 'nonexistent.md'));

    expect(report.passed).toBe(false);
    expect(report.steps[0].name).toBe('file-exists');
  });
});

describe('installCapability', () => {
  it('installs a valid rule to the rules directory', async () => {
    const sourcePath = writeFile(
      'new-rule.md',
      `---
id: install-test
tags: [rule, test]
status: active
---
<!-- L0: Test rule -->
Test rule body.`,
    );

    const harnessRoot = path.join(tmpDir, 'harness');
    const result = await installCapability(sourcePath, harnessRoot);

    expect(result.success).toBe(true);
    expect(result.installedPath).toContain('rules');
    expect(fs.existsSync(result.installedPath!)).toBe(true);
  });

  it('rejects invalid files', async () => {
    const sourcePath = writeFile('invalid.md', 'No frontmatter');

    const harnessRoot = path.join(tmpDir, 'harness');
    const result = await installCapability(sourcePath, harnessRoot);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validation failed');
  });
});

describe('uninstallCapability', () => {
  it('removes an installed file', async () => {
    const filePath = writeFile('to-remove.md', 'content');

    const result = await uninstallCapability(filePath);

    expect(result.success).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('returns error for nonexistent file', async () => {
    const result = await uninstallCapability(path.join(tmpDir, 'nope.md'));
    expect(result.success).toBe(false);
  });
});
