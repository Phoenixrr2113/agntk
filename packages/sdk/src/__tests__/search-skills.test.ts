import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { createSearchSkillsTool, clearSkillsCache, getSkillsCache } from '../tools/search-skills';

const callCtx = {
  toolCallId: 'test',
  messages: [],
};

function createSkillDir(baseDir: string, name: string, frontmatter: string, body = ''): string {
  const skillDir = path.join(baseDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\n${frontmatter}\n---\n${body}`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  return skillDir;
}

let tmpDir: string;

beforeEach(() => {
  clearSkillsCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-skills-test-'));
});

afterEach(() => {
  clearSkillsCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createSearchSkillsTool', () => {
  it('should create a tool with search_skills key', () => {
    const tools = createSearchSkillsTool();
    expect(tools).toHaveProperty('search_skills');
    expect(tools.search_skills).toBeDefined();
  });

  it('should have an execute function', () => {
    const tools = createSearchSkillsTool();
    expect(tools.search_skills.execute).toBeDefined();
  });
});

describe('search_skills execute', () => {
  it('should return empty results when no skills directory exists', async () => {
    const tools = createSearchSkillsTool({
      directories: [path.join(tmpDir, 'nonexistent')],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'test', limit: undefined }, callCtx)) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.message).toContain('No skills found');
  });

  it('should find skills by keyword match', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'deploy-docker',
      [
        'name: deploy-docker',
        'description: Deploy applications using Docker containers',
        'tags: [docker, deploy, containers]',
        'when_to_use: When you need to containerize and deploy an application',
      ].join('\n'),
    );

    createSkillDir(
      skillsDir,
      'code-review',
      [
        'name: code-review',
        'description: Review code for quality and best practices',
        'tags: [review, quality, lint]',
        'when_to_use: When reviewing pull requests or code changes',
      ].join('\n'),
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'docker deploy', limit: undefined },
        callCtx,
      )) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.results[0].name).toBe('deploy-docker');
  });

  it('should return results with correct shape (name, description, tags, whenToUse)', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'test-skill',
      [
        'name: test-skill',
        'description: A test skill for verification',
        'tags: [testing, verify]',
        'when_to_use: When testing things',
        'model: fast',
      ].join('\n'),
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'test', limit: undefined }, callCtx)) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const skill = result.results[0];
    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('A test skill for verification');
    expect(skill.tags).toEqual(['testing', 'verify']);
    expect(skill.whenToUse).toBe('When testing things');
    expect(skill.model).toBe('fast');
    expect(typeof skill.score).toBe('number');
  });

  it('should rank results by relevance', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'docker-compose',
      [
        'name: docker-compose',
        'description: Manage multi-container Docker applications',
        'tags: [docker, compose, containers]',
        'when_to_use: When managing docker compose stacks',
      ].join('\n'),
    );

    createSkillDir(
      skillsDir,
      'git-ops',
      [
        'name: git-ops',
        'description: Git operations and workflows',
        'tags: [git, version-control]',
        'when_to_use: When managing git repositories',
      ].join('\n'),
    );

    createSkillDir(
      skillsDir,
      'docker-build',
      [
        'name: docker-build',
        'description: Build Docker images',
        'tags: [docker, build, images]',
        'when_to_use: When building docker images',
      ].join('\n'),
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'docker', limit: undefined },
        callCtx,
      )) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const names = result.results.map((r: { name: string }) => r.name);
    expect(names).toContain('docker-compose');
    expect(names).toContain('docker-build');
    expect(names).not.toContain('git-ops');
  });

  it('should respect limit parameter', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    for (let i = 0; i < 5; i++) {
      createSkillDir(
        skillsDir,
        `test-skill-${i}`,
        [
          `name: test-skill-${i}`,
          `description: Test skill number ${i} for testing`,
          'tags: [test]',
        ].join('\n'),
      );
    }

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'test', limit: 2 }, callCtx)) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.totalSkills).toBe(5);
  });

  it('should use default maxResults from config', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    for (let i = 0; i < 5; i++) {
      createSkillDir(
        skillsDir,
        `skill-${i}`,
        [`name: skill-${i}`, `description: Skill number ${i} for testing`, 'tags: [test]'].join(
          '\n',
        ),
      );
    }

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
      maxResults: 3,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'test', limit: undefined }, callCtx)) as string,
    );

    expect(result.count).toBe(3);
  });

  it('should return totalSkills count', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(skillsDir, 'skill-a', 'name: skill-a\ndescription: Alpha skill\ntags: [alpha]');
    createSkillDir(skillsDir, 'skill-b', 'name: skill-b\ndescription: Beta skill\ntags: [beta]');

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'alpha', limit: undefined }, callCtx)) as string,
    );

    expect(result.totalSkills).toBe(2);
    expect(result.count).toBe(1);
  });
});

describe('skills cache', () => {
  it('should cache skills across calls', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'cached-skill',
      'name: cached-skill\ndescription: A cached skill\ntags: [cache]',
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    await tools.search_skills.execute!({ query: 'cache', limit: undefined }, callCtx);
    expect(getSkillsCache()).not.toBeNull();

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: 'cache', limit: undefined }, callCtx)) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });

  it('should invalidate cache when file changes', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const skillDir = createSkillDir(
      skillsDir,
      'mutable-skill',
      'name: mutable-skill\ndescription: Original description\ntags: [original]',
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result1 = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'original', limit: undefined },
        callCtx,
      )) as string,
    );
    expect(result1.count).toBe(1);

    await new Promise((r) => setTimeout(r, 50));
    const newContent =
      '---\nname: mutable-skill\ndescription: Updated description\ntags: [updated]\n---\n';
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), newContent);

    const now = new Date();
    fs.utimesSync(path.join(skillDir, 'SKILL.md'), now, now);

    const result2 = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'updated', limit: undefined },
        callCtx,
      )) as string,
    );
    expect(result2.count).toBe(1);
    expect(result2.results[0].name).toBe('mutable-skill');
  });

  it('should invalidate cache when file is deleted', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'ephemeral-skill',
      'name: ephemeral-skill\ndescription: Will be deleted\ntags: [ephemeral]',
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result1 = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'ephemeral', limit: undefined },
        callCtx,
      )) as string,
    );
    expect(result1.count).toBe(1);

    fs.rmSync(path.join(skillsDir, 'ephemeral-skill'), { recursive: true });

    const result2 = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'ephemeral', limit: undefined },
        callCtx,
      )) as string,
    );
    expect(result2.count).toBe(0);
  });

  it('should clear cache with clearSkillsCache()', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'test-clear',
      'name: test-clear\ndescription: Test clear\ntags: [clear]',
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    tools.search_skills.execute!({ query: 'clear', limit: undefined }, callCtx);
    expect(getSkillsCache()).not.toBeNull();

    clearSkillsCache();
    expect(getSkillsCache()).toBeNull();
  });
});

describe('error handling', () => {
  it('should handle empty query gracefully', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(skillsDir, 'any-skill', 'name: any-skill\ndescription: Any skill\ntags: [any]');

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!({ query: '', limit: undefined }, callCtx)) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
  });

  it('should handle query with no matches', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    createSkillDir(
      skillsDir,
      'alpha-skill',
      'name: alpha-skill\ndescription: Alpha skill\ntags: [alpha]',
    );

    const tools = createSearchSkillsTool({
      directories: [skillsDir],
      basePath: tmpDir,
    });

    const result = JSON.parse(
      (await tools.search_skills.execute!(
        { query: 'zzz-nonexistent-keyword', limit: undefined },
        callCtx,
      )) as string,
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.totalSkills).toBe(1);
  });
});
