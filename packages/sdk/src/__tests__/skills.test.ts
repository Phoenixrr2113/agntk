import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseSkillFrontmatter,
  discoverSkills,
  loadSkillContent,
  loadSkills,
  loadSkillsFromPaths,
  buildSkillsSystemPrompt,
  searchSkills,
  filterEligibleSkills,
  isSkillEligible,
} from '../skills/loader';
import type { SkillContent, SkillMeta } from '../skills/types';

let tmpDir: string;

function createSkillFile(
  dirName: string,
  frontmatter: Record<string, string>,
  body: string,
): string {
  const skillDir = path.join(tmpDir, dirName);
  fs.mkdirSync(skillDir, { recursive: true });
  const lines = [`---`];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push(`---`, body);
  const skillFile = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillFile, lines.join('\n'));
  return skillDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseSkillFrontmatter', () => {
  it('parses name and description from frontmatter', () => {
    const content = `---
name: my-skill
description: Does cool things
---
Some instructions here.`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('Does cool things');
    expect(result.body).toBe('Some instructions here.');
  });

  it('handles quoted values', () => {
    const content = `---
name: "quoted-skill"
description: 'single quoted'
---
Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('quoted-skill');
    expect(result.description).toBe('single quoted');
  });

  it('returns full content as body when no frontmatter', () => {
    const content = 'No frontmatter here.';
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.body).toBe('No frontmatter here.');
  });

  it('handles empty body after frontmatter', () => {
    const content = `---
name: empty-body
description: No body
---
`;

    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('empty-body');
    expect(result.body).toBe('');
  });

  it('preserves multiline body content', () => {
    const content = `---
name: multiline
description: Has multiple lines
---
Line 1

Line 3
  Indented line`;

    const result = parseSkillFrontmatter(content);
    expect(result.body).toContain('Line 1');
    expect(result.body).toContain('Line 3');
    expect(result.body).toContain('  Indented line');
  });
});

describe('discoverSkills', () => {
  it('discovers skills in directories', () => {
    createSkillFile('skill-a', { name: 'alpha', description: 'First skill' }, 'Alpha instructions');
    createSkillFile('skill-b', { name: 'beta', description: 'Second skill' }, 'Beta instructions');

    const skills = discoverSkills([tmpDir]);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('skips directories without SKILL.md', () => {
    createSkillFile('has-skill', { name: 'present', description: 'Here' }, 'Content');

    fs.mkdirSync(path.join(tmpDir, 'no-skill'), { recursive: true });

    const skills = discoverSkills([tmpDir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('present');
  });

  it('uses directory name when no name in frontmatter', () => {
    const skillDir = path.join(tmpDir, 'my-tool');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'No frontmatter skill.');

    const skills = discoverSkills([tmpDir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-tool');
  });

  it('returns empty array for non-existent directory', () => {
    const skills = discoverSkills(['/nonexistent/path']);
    expect(skills).toEqual([]);
  });

  it('resolves relative paths against basePath', () => {
    const skillsBase = path.join(tmpDir, '.agents', 'skills');
    fs.mkdirSync(path.join(skillsBase, 'my-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsBase, 'my-skill', 'SKILL.md'),
      `---\nname: relative-skill\ndescription: Relative\n---\nContent`,
    );

    const skills = discoverSkills(['.agents/skills'], tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('relative-skill');
  });
});

describe('loadSkillContent', () => {
  it('loads full content for a discovered skill', () => {
    createSkillFile(
      'test-skill',
      { name: 'test', description: 'Test skill' },
      'Detailed instructions here.',
    );

    const discovered = discoverSkills([tmpDir]);
    expect(discovered).toHaveLength(1);

    const loaded = loadSkillContent(discovered[0]);
    expect(loaded.name).toBe('test');
    expect(loaded.content).toBe('Detailed instructions here.');
  });
});

describe('loadSkills', () => {
  it('loads all skills with auto-discover', () => {
    createSkillFile('s1', { name: 'one', description: 'First' }, 'Body 1');
    createSkillFile('s2', { name: 'two', description: 'Second' }, 'Body 2');

    const skills = loadSkills({ directories: [tmpDir] });
    expect(skills).toHaveLength(2);
    expect(skills.every((s) => s.content.length > 0)).toBe(true);
  });

  it('filters by include list', () => {
    createSkillFile('s1', { name: 'wanted', description: 'Keep' }, 'Body 1');
    createSkillFile('s2', { name: 'unwanted', description: 'Skip' }, 'Body 2');

    const skills = loadSkills({ directories: [tmpDir], include: ['wanted'] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('wanted');
  });

  it('returns empty when include matches nothing', () => {
    createSkillFile('s1', { name: 'existing', description: 'Here' }, 'Body');

    const skills = loadSkills({ directories: [tmpDir], include: ['nonexistent'] });
    expect(skills).toEqual([]);
  });
});

describe('loadSkillsFromPaths', () => {
  it('loads skills from explicit paths', () => {
    const dir = createSkillFile(
      'explicit',
      { name: 'direct', description: 'Directly loaded' },
      'Direct content',
    );

    const skills = loadSkillsFromPaths([dir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('direct');
    expect(skills[0].content).toBe('Direct content');
  });

  it('skips paths without SKILL.md', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    const skills = loadSkillsFromPaths([emptyDir]);
    expect(skills).toEqual([]);
  });
});

describe('buildSkillsSystemPrompt', () => {
  it('builds prompt with skill sections', () => {
    const skills: SkillContent[] = [
      {
        name: 'code-review',
        description: 'Reviews code for quality',
        path: '/fake/path',
        directory: '/fake',
        content: 'When reviewing code, check for:\n1. Security\n2. Performance',
      },
    ];

    const prompt = buildSkillsSystemPrompt(skills);
    expect(prompt).toContain('<skills>');
    expect(prompt).toContain('</skills>');
    expect(prompt).toContain('### code-review');
    expect(prompt).toContain('Reviews code for quality');
    expect(prompt).toContain('When reviewing code');
    expect(prompt).toContain('1 skill(s) available');
  });

  it('returns empty string when no skills', () => {
    expect(buildSkillsSystemPrompt([])).toBe('');
  });

  it('includes multiple skills', () => {
    const skills: SkillContent[] = [
      { name: 'a', description: 'A', path: '', directory: '', content: 'Alpha' },
      { name: 'b', description: 'B', path: '', directory: '', content: 'Beta' },
    ];

    const prompt = buildSkillsSystemPrompt(skills);
    expect(prompt).toContain('### a');
    expect(prompt).toContain('### b');
    expect(prompt).toContain('2 skill(s) available');
  });
});

describe('expanded frontmatter fields', () => {
  it('should parse tags', () => {
    const content = `---
name: deploy
tags: [devops, ci, docker]
---
Deploy instructions.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.tags).toEqual(['devops', 'ci', 'docker']);
  });

  it('should parse when_to_use', () => {
    const content = `---
name: review
when_to_use: When the user asks for a code review or PR review
---
Review body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.whenToUse).toBe('When the user asks for a code review or PR review');
  });

  it('should parse when-to-use (kebab-case)', () => {
    const content = `---
name: review
when-to-use: When reviewing code
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.whenToUse).toBe('When reviewing code');
  });

  it('should parse model tier', () => {
    const content = `---
name: complex-reasoning
model: powerful
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.model).toBe('powerful');
  });

  it('should ignore invalid model tier', () => {
    const content = `---
name: test
model: mega-ultra
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.model).toBeUndefined();
  });

  it('should parse max_steps', () => {
    const content = `---
name: deep-research
max_steps: 50
---
Research body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.maxSteps).toBe(50);
  });

  it('should parse max-steps (kebab-case)', () => {
    const content = `---
name: test
max-steps: 25
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.maxSteps).toBe(25);
  });

  it('should ignore invalid max_steps', () => {
    const content = `---
name: test
max_steps: not-a-number
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.maxSteps).toBeUndefined();
  });

  it('should parse requires-binaries', () => {
    const content = `---
name: docker-deploy
requires-binaries: [docker, kubectl]
---
Deploy with Docker.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.requires?.binaries).toEqual(['docker', 'kubectl']);
  });

  it('should parse requires-env', () => {
    const content = `---
name: api-caller
requires-env: [OPENAI_API_KEY, DATABASE_URL]
---
Call APIs.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.requires?.env).toEqual(['OPENAI_API_KEY', 'DATABASE_URL']);
  });

  it('should parse both requires-binaries and requires-env', () => {
    const content = `---
name: full
requires-binaries: [git, node]
requires-env: [API_KEY]
---
Body.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.requires?.binaries).toEqual(['git', 'node']);
    expect(parsed.requires?.env).toEqual(['API_KEY']);
  });

  it('should parse all expanded fields together', () => {
    const content = `---
name: mega-skill
description: Does everything
tags: [multi, purpose]
when_to_use: Always
model: reasoning
max_steps: 30
requires-binaries: [node]
requires-env: [TOKEN]
license: MIT
---
Full skill content.`;
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.name).toBe('mega-skill');
    expect(parsed.description).toBe('Does everything');
    expect(parsed.tags).toEqual(['multi', 'purpose']);
    expect(parsed.whenToUse).toBe('Always');
    expect(parsed.model).toBe('reasoning');
    expect(parsed.maxSteps).toBe(30);
    expect(parsed.requires?.binaries).toEqual(['node']);
    expect(parsed.requires?.env).toEqual(['TOKEN']);
    expect(parsed.license).toBe('MIT');
  });
});

describe('searchSkills', () => {
  const skills: SkillMeta[] = [
    {
      name: 'code-review',
      description: 'Reviews code for quality and bugs',
      path: '',
      directory: '',
      tags: ['review', 'quality'],
      whenToUse: 'When asked to review a pull request',
    },
    {
      name: 'docker-deploy',
      description: 'Deploy with Docker containers',
      path: '',
      directory: '',
      tags: ['devops', 'docker', 'deploy'],
    },
    {
      name: 'api-testing',
      description: 'Test REST APIs',
      path: '',
      directory: '',
      tags: ['testing', 'api'],
    },
    {
      name: 'refactoring',
      description: 'Refactor code for readability',
      path: '',
      directory: '',
      tags: ['code', 'quality'],
    },
    {
      name: 'git-workflow',
      description: 'Git branching and merging',
      path: '',
      directory: '',
      tags: ['git', 'devops'],
    },
  ];

  it('should return empty for empty query', () => {
    expect(searchSkills(skills, '')).toEqual([]);
  });

  it('should match by name', () => {
    const results = searchSkills(skills, 'docker');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.name).toBe('docker-deploy');
  });

  it('should match by tag', () => {
    const results = searchSkills(skills, 'devops');
    expect(results.length).toBe(2);
    const names = results.map((r) => r.skill.name);
    expect(names).toContain('docker-deploy');
    expect(names).toContain('git-workflow');
  });

  it('should match by description', () => {
    const results = searchSkills(skills, 'REST');
    expect(results.length).toBe(1);
    expect(results[0].skill.name).toBe('api-testing');
  });

  it('should match by whenToUse', () => {
    const results = searchSkills(skills, 'pull request');
    expect(results.length).toBe(1);
    expect(results[0].skill.name).toBe('code-review');
  });

  it('should rank results by relevance', () => {
    const results = searchSkills(skills, 'quality');
    expect(results.length).toBe(2);

    const names = results.map((r) => r.skill.name);
    expect(names).toContain('code-review');
    expect(names).toContain('refactoring');
  });

  it('should respect limit', () => {
    const results = searchSkills(skills, 'code', 1);
    expect(results.length).toBe(1);
  });

  it('should return empty for no matches', () => {
    const results = searchSkills(skills, 'quantum-computing');
    expect(results).toEqual([]);
  });
});

describe('filterEligibleSkills', () => {
  it('should keep skills with no requirements', () => {
    const skills: SkillMeta[] = [
      { name: 'simple', description: 'No requirements', path: '', directory: '' },
    ];
    expect(filterEligibleSkills(skills)).toHaveLength(1);
  });

  it('should keep skills when binary exists on PATH', () => {
    const skills: SkillMeta[] = [
      {
        name: 'needs-node',
        description: 'Needs node',
        path: '',
        directory: '',
        requires: { binaries: ['node'] },
      },
    ];
    const eligible = filterEligibleSkills(skills);
    expect(eligible).toHaveLength(1);
  });

  it('should filter out skills with missing binary', () => {
    const skills: SkillMeta[] = [
      {
        name: 'needs-imaginary',
        description: 'Missing',
        path: '',
        directory: '',
        requires: { binaries: ['__nonexistent_binary_12345__'] },
      },
    ];
    const eligible = filterEligibleSkills(skills);
    expect(eligible).toHaveLength(0);
  });

  it('should keep skills when env var exists', () => {
    process.env.__SKILL_TEST_VAR__ = 'true';
    try {
      const skills: SkillMeta[] = [
        {
          name: 'needs-env',
          description: 'Needs env',
          path: '',
          directory: '',
          requires: { env: ['__SKILL_TEST_VAR__'] },
        },
      ];
      expect(filterEligibleSkills(skills)).toHaveLength(1);
    } finally {
      delete process.env.__SKILL_TEST_VAR__;
    }
  });

  it('should filter out skills with missing env var', () => {
    const skills: SkillMeta[] = [
      {
        name: 'needs-env',
        description: 'Missing',
        path: '',
        directory: '',
        requires: { env: ['__NONEXISTENT_ENV_VAR_12345__'] },
      },
    ];
    expect(filterEligibleSkills(skills)).toHaveLength(0);
  });

  it('should filter mixed requirements', () => {
    process.env.__SKILL_TEST_VAR2__ = 'yes';
    try {
      const skills: SkillMeta[] = [
        {
          name: 'all-good',
          description: 'Has everything',
          path: '',
          directory: '',
          requires: { binaries: ['node'], env: ['__SKILL_TEST_VAR2__'] },
        },
        {
          name: 'missing-binary',
          description: 'Missing binary',
          path: '',
          directory: '',
          requires: { binaries: ['__fake__'] },
        },
        { name: 'no-reqs', description: 'No requirements', path: '', directory: '' },
      ];
      const eligible = filterEligibleSkills(skills);
      expect(eligible).toHaveLength(2);
      expect(eligible.map((s) => s.name).sort()).toEqual(['all-good', 'no-reqs']);
    } finally {
      delete process.env.__SKILL_TEST_VAR2__;
    }
  });
});

describe('isSkillEligible', () => {
  it('should return true for skills with no requirements', () => {
    expect(isSkillEligible({ name: 'test', description: '', path: '', directory: '' })).toBe(true);
  });

  it('should return false for missing binary', () => {
    expect(
      isSkillEligible({
        name: 'test',
        description: '',
        path: '',
        directory: '',
        requires: { binaries: ['__definitely_not_installed__'] },
      }),
    ).toBe(false);
  });

  it('should return false for missing env var', () => {
    expect(
      isSkillEligible({
        name: 'test',
        description: '',
        path: '',
        directory: '',
        requires: { env: ['__NOT_SET_12345__'] },
      }),
    ).toBe(false);
  });
});
