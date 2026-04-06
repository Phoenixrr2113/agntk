import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createLogger } from '@agntk/logger';
import { parseFrontmatter } from './frontmatter';

const log = createLogger('@agntk/core:harness-evaluator');

export type CapabilityType = 'rule' | 'instinct' | 'skill' | 'workflow' | 'unknown';

export type EvalStepStatus = 'pass' | 'fail' | 'warn';

export interface EvalStep {
  name: string;
  status: EvalStepStatus;
  message: string;
}

export interface EvalReport {
  path: string;
  detectedType: CapabilityType;
  steps: EvalStep[];
  passed: boolean;
  suggestions: string[];
}

function detectType(content: string, frontmatter: Record<string, unknown>): CapabilityType {
  if (frontmatter['schedule']) return 'workflow';
  if (frontmatter['provenance'] || frontmatter['source']) return 'instinct';

  const bodyLower = content.toLowerCase();
  if (bodyLower.includes('instinct') && frontmatter['author'] === 'agent') return 'instinct';
  if (frontmatter['requires-binaries'] || frontmatter['requires-env']) return 'skill';

  const tags = (frontmatter['tags'] as string[] | undefined) ?? [];
  if (tags.some((t) => typeof t === 'string' && t.toLowerCase().includes('rule'))) return 'rule';
  if (tags.some((t) => typeof t === 'string' && t.toLowerCase().includes('skill'))) return 'skill';

  if (frontmatter['id']) return 'rule';

  return 'unknown';
}

function validateFormat(content: string): EvalStep {
  const hasFrontmatter = /^---\s*\n[\s\S]*?\n---/.test(content);
  if (!hasFrontmatter) {
    return {
      name: 'format-validation',
      status: 'fail',
      message: 'Missing YAML frontmatter block (---)',
    };
  }
  return { name: 'format-validation', status: 'pass', message: 'Valid frontmatter format' };
}

function validateRequiredFields(
  frontmatter: Record<string, unknown>,
  detectedType: CapabilityType,
): EvalStep {
  const missing: string[] = [];

  if (!frontmatter['id']) missing.push('id');
  if (!frontmatter['status']) missing.push('status');

  if (detectedType === 'instinct' && !frontmatter['source']) {
    missing.push('source (provenance)');
  }

  if (missing.length > 0) {
    return {
      name: 'required-fields',
      status: 'warn',
      message: `Missing recommended fields: ${missing.join(', ')}`,
    };
  }

  return { name: 'required-fields', status: 'pass', message: 'All required fields present' };
}

function validateLevels(l0: string, l1: string): EvalStep {
  if (!l0 && !l1) {
    return {
      name: 'level-comments',
      status: 'warn',
      message: 'Missing L0/L1 comments — add <!-- L0: summary --> for discoverability',
    };
  }

  if (l0 && l0.length > 100) {
    return {
      name: 'level-comments',
      status: 'warn',
      message: `L0 too long (${l0.length} chars) — keep under 100 chars for index readability`,
    };
  }

  return { name: 'level-comments', status: 'pass', message: 'L0/L1 comments present' };
}

function validateBody(body: string): EvalStep {
  if (!body.trim()) {
    return { name: 'body-content', status: 'fail', message: 'Empty body — file has no content' };
  }

  if (body.length < 20) {
    return {
      name: 'body-content',
      status: 'warn',
      message: 'Body is very short — consider adding more detail',
    };
  }

  return { name: 'body-content', status: 'pass', message: 'Body content present' };
}

function generateSuggestions(steps: EvalStep[], detectedType: CapabilityType): string[] {
  const suggestions: string[] = [];

  for (const step of steps) {
    if (step.status === 'fail' || step.status === 'warn') {
      suggestions.push(`[${step.name}] ${step.message}`);
    }
  }

  if (detectedType === 'unknown') {
    suggestions.push(
      'Could not determine capability type — add tags: [rule], [instinct], [skill], or [workflow]',
    );
  }

  return suggestions;
}

export async function evaluateCapability(filePath: string): Promise<EvalReport> {
  if (!existsSync(filePath)) {
    return {
      path: filePath,
      detectedType: 'unknown',
      steps: [{ name: 'file-exists', status: 'fail', message: 'File not found' }],
      passed: false,
      suggestions: ['Verify the file path exists'],
    };
  }

  const content = await readFile(filePath, 'utf-8');
  const parsed = parseFrontmatter(content);
  const raw: Record<string, unknown> = { ...parsed.frontmatter };

  const rawFmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (rawFmMatch) {
    for (const line of rawFmMatch[1].split('\n')) {
      const kvMatch = line.match(/^\s*([a-zA-Z_-]+)\s*:\s*(.+?)\s*$/);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        if (!(key in raw)) {
          raw[key] = kvMatch[2].replace(/^['"]|['"]$/g, '');
        }
      }
    }
  }

  const detectedType = detectType(content, raw);
  const steps: EvalStep[] = [];

  steps.push(validateFormat(content));
  steps.push(validateRequiredFields(raw, detectedType));
  steps.push(validateLevels(parsed.l0, parsed.l1));
  steps.push(validateBody(parsed.body));

  const passed = steps.every((s) => s.status !== 'fail');
  const suggestions = generateSuggestions(steps, detectedType);

  log.debug('Capability evaluated', {
    path: filePath,
    detectedType,
    passed,
    stepResults: steps.map((s) => `${s.name}:${s.status}`),
  });

  return { path: filePath, detectedType, steps, passed, suggestions };
}
