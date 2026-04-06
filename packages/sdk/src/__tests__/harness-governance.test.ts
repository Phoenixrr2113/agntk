import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGovernanceLoader } from '../harness/governance';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gov-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('GovernanceLoader', () => {
  describe('loadCore', () => {
    it('parses core.md with identity sections', async () => {
      writeFile(
        'core.md',
        `---
id: core
author: human
status: active
---
## Purpose
Help users accomplish tasks safely and effectively.

## Creator
AgntK Team

## Values
- Transparency
- Safety first
- User empowerment

## Ethics
- Never deceive the user
- Respect data privacy

## Identity
I am a governance-aware AI assistant.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const core = await loader.loadCore();

      expect(core).not.toBeNull();
      expect(core!.purpose).toBe('Help users accomplish tasks safely and effectively.');
      expect(core!.creator).toBe('AgntK Team');
      expect(core!.values).toEqual(['Transparency', 'Safety first', 'User empowerment']);
      expect(core!.ethics).toEqual(['Never deceive the user', 'Respect data privacy']);
      expect(core!.identity).toBe('I am a governance-aware AI assistant.');
    });

    it('returns null when core.md does not exist', async () => {
      const loader = createGovernanceLoader(tmpDir);
      const core = await loader.loadCore();
      expect(core).toBeNull();
    });
  });

  describe('loadRules', () => {
    it('loads rules from rules/ directory', async () => {
      writeFile(
        'rules/safety.md',
        `---
id: safety-001
tags: [safety, filesystem]
author: human
status: active
---
<!-- L0: Filesystem safety rule -->
<!-- L1: Prevents modification of system-critical paths -->
Do not modify files in /etc, /System, or /usr.`,
      );

      writeFile(
        'rules/comms.md',
        `---
id: comms-001
tags: [communication]
author: human
status: active
---
<!-- L0: Communication rule -->
<!-- L1: Always be transparent about capabilities -->
Never claim to have capabilities you do not possess.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const rules = await loader.loadRules();

      expect(rules).toHaveLength(2);
      const ids = rules.map((r) => r.frontmatter.id).sort();
      expect(ids).toEqual(['comms-001', 'safety-001']);

      const safety = rules.find((r) => r.frontmatter.id === 'safety-001')!;
      expect(safety.l0).toBe('Filesystem safety rule');
      expect(safety.l1).toBe('Prevents modification of system-critical paths');
    });

    it('skips archived rules', async () => {
      writeFile(
        'rules/active.md',
        `---
id: active-rule
status: active
author: human
---
Active rule body.`,
      );

      writeFile(
        'rules/old.md',
        `---
id: old-rule
status: archived
author: human
---
Archived rule body.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const rules = await loader.loadRules();

      expect(rules).toHaveLength(1);
      expect(rules[0].frontmatter.id).toBe('active-rule');
    });

    it('returns empty array when rules/ does not exist', async () => {
      const loader = createGovernanceLoader(tmpDir);
      const rules = await loader.loadRules();
      expect(rules).toEqual([]);
    });
  });

  describe('loadInstincts', () => {
    it('loads instincts with provenance from source field', async () => {
      writeFile(
        'instincts/retry-pattern.md',
        `---
id: instinct-001
tags: [error-handling]
author: agent
status: active
source: session-2025-01-15
---
<!-- L0: Retry with backoff -->
<!-- L1: When API calls fail, retry up to 3 times with exponential backoff -->
Implement exponential backoff for transient failures.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const instincts = await loader.loadInstincts();

      expect(instincts).toHaveLength(1);
      expect(instincts[0].frontmatter.id).toBe('instinct-001');
      expect(instincts[0].provenance).toBe('session-2025-01-15');
      expect(instincts[0].l0).toBe('Retry with backoff');
    });

    it('defaults provenance to unknown when source not set', async () => {
      writeFile(
        'instincts/simple.md',
        `---
id: instinct-002
author: agent
status: active
---
<!-- L0: Simple instinct -->
Body.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const instincts = await loader.loadInstincts();

      expect(instincts[0].provenance).toBe('unknown');
    });

    it('skips _index.md files', async () => {
      writeFile(
        'instincts/_index.md',
        `# Index
This should be skipped.`,
      );

      writeFile(
        'instincts/real.md',
        `---
id: real-instinct
author: agent
status: active
---
<!-- L0: Real instinct -->
Body.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const instincts = await loader.loadInstincts();

      expect(instincts).toHaveLength(1);
      expect(instincts[0].frontmatter.id).toBe('real-instinct');
    });
  });

  describe('buildGovernancePrompt', () => {
    it('builds combined prompt with all three tiers', async () => {
      writeFile(
        'core.md',
        `## Purpose
Assist users.

## Creator
Test

## Identity
Test agent.`,
      );

      writeFile(
        'rules/r1.md',
        `---
id: rule-1
author: human
status: active
---
<!-- L1: Be safe -->
Safety rule.`,
      );

      writeFile(
        'instincts/i1.md',
        `---
id: instinct-1
author: agent
status: active
---
<!-- L0: Learn from errors -->
Error learning instinct.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const prompt = await loader.buildGovernancePrompt();

      expect(prompt).toContain('<governance>');
      expect(prompt).toContain('</governance>');
      expect(prompt).toContain('<governance-core>');
      expect(prompt).toContain('Assist users.');
      expect(prompt).toContain('<governance-rules>');
      expect(prompt).toContain('Be safe');
      expect(prompt).toContain('<governance-instincts>');
      expect(prompt).toContain('Learn from errors');
    });

    it('returns empty string when no governance files exist', async () => {
      const loader = createGovernanceLoader(tmpDir);
      const prompt = await loader.buildGovernancePrompt();
      expect(prompt).toBe('');
    });

    it('includes only the tiers that have content', async () => {
      writeFile(
        'rules/r1.md',
        `---
id: only-rule
author: human
status: active
---
<!-- L1: Only rules exist -->
Just a rule.`,
      );

      const loader = createGovernanceLoader(tmpDir);
      const prompt = await loader.buildGovernancePrompt();

      expect(prompt).toContain('<governance-rules>');
      expect(prompt).not.toContain('<governance-core>');
      expect(prompt).not.toContain('<governance-instincts>');
    });
  });
});
