import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'node:fs';
import { createLogger } from '@agntk/logger';
import { discoverSkills, searchSkills } from '../skills/loader';
import type { SkillMeta } from '../skills/types';

const log = createLogger('@agntk/core:search-skills');

interface SkillCache {
  skills: SkillMeta[];

  mtimes: Map<string, number>;
  loadedAt: number;
}

let cache: SkillCache | null = null;

const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

function isCacheStale(c: SkillCache): boolean {
  if (Date.now() - c.loadedAt > MAX_CACHE_AGE_MS) return true;

  for (const [filePath, cachedMtime] of c.mtimes) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs !== cachedMtime) return true;
    } catch {
      return true;
    }
  }

  return false;
}

function getCachedSkills(directories?: string[], basePath?: string): SkillMeta[] {
  if (cache && !isCacheStale(cache)) {
    return cache.skills;
  }

  log.debug('Refreshing skills cache');
  const skills = discoverSkills(directories, basePath);

  const mtimes = new Map<string, number>();
  for (const skill of skills) {
    try {
      const stat = fs.statSync(skill.path);
      mtimes.set(skill.path, stat.mtimeMs);
    } catch {
      void 0;
    }
  }

  cache = { skills, mtimes, loadedAt: Date.now() };
  return skills;
}

export function clearSkillsCache(): void {
  cache = null;
}

export function getSkillsCache(): SkillCache | null {
  return cache;
}

export interface SearchSkillsToolConfig {
  directories?: string[];

  basePath?: string;

  maxResults?: number;
}

export function createSearchSkillsTool(config: SearchSkillsToolConfig = {}) {
  const { directories, basePath, maxResults = 5 } = config;

  return {
    search_skills: tool({
      description:
        'Search for available skills by keyword. Returns ranked matches ' +
        'with name, description, tags, and when_to_use guidance. ' +
        'Use this to find the right skill for a subtask.',
      inputSchema: z.object({
        query: z.string().describe('Search keywords (e.g. "deploy docker", "code review")'),
        limit: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .describe('Maximum results to return. Default: 5'),
      }),
      execute: async ({ query, limit }) => {
        const effectiveLimit = limit ?? maxResults;

        try {
          const skills = getCachedSkills(directories, basePath);

          if (skills.length === 0) {
            return JSON.stringify({
              success: true,
              count: 0,
              results: [],
              message: 'No skills found. Add SKILL.md files to your skills directory.',
            });
          }

          const matches = searchSkills(skills, query, effectiveLimit);

          const results = matches.map((m) => ({
            name: m.skill.name,
            description: m.skill.description,
            tags: m.skill.tags ?? [],
            whenToUse: m.skill.whenToUse ?? '',
            model: m.skill.model,
            score: Math.round(m.score * 100) / 100,
          }));

          log.debug('Skills search', { query, found: results.length, total: skills.length });

          return JSON.stringify({
            success: true,
            count: results.length,
            totalSkills: skills.length,
            results,
          });
        } catch (error) {
          log.error('Skills search failed', { query, error: String(error) });
          return JSON.stringify({
            success: false,
            error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
    }),
  };
}
