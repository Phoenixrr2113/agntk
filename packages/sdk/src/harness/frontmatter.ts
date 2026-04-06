import type { HarnessFrontmatter, ParsedHarnessDocument } from './types';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
const L0_REGEX = /<!--\s*L0:\s*(.*?)\s*-->/;
const L1_REGEX = /<!--\s*L1:\s*([\s\S]*?)\s*-->/;

export function parseRawFrontmatter(content: string): Record<string, string> {
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return {};

  const fields: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const kvMatch = line.match(/^\s*([a-zA-Z_-]+)\s*:\s*(.+?)\s*$/);
    if (kvMatch) {
      fields[kvMatch[1].toLowerCase()] = kvMatch[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return fields;
}

function parseYamlList(value: string): string[] {
  const bracketMatch = value.match(/^\[(.+)\]$/);
  const inner = bracketMatch ? bracketMatch[1] : value;
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatterFields(yaml: string): Partial<HarnessFrontmatter> {
  const result: Partial<HarnessFrontmatter> = {};

  for (const line of yaml.split('\n')) {
    const kvMatch = line.match(/^\s*([a-zA-Z_-]+)\s*:\s*(.+?)\s*$/);
    if (!kvMatch) continue;

    const [, rawKey, value] = kvMatch;
    const cleanValue = value.replace(/^['"]|['"]$/g, '');
    const key = rawKey.toLowerCase();

    switch (key) {
      case 'id':
        result.id = cleanValue;
        break;
      case 'tags':
        result.tags = parseYamlList(cleanValue);
        break;
      case 'created':
        result.created = cleanValue;
        break;
      case 'updated':
        result.updated = cleanValue;
        break;
      case 'author':
        result.author = cleanValue;
        break;
      case 'status':
        if (['active', 'draft', 'archived'].includes(cleanValue)) {
          result.status = cleanValue as HarnessFrontmatter['status'];
        }
        break;
      case 'source':
        result.source = cleanValue;
        break;
      case 'related':
        result.related = parseYamlList(cleanValue);
        break;
    }
  }

  return result;
}

function extractL0(content: string): string {
  const match = content.match(L0_REGEX);
  return match ? match[1].trim() : '';
}

function extractL1(content: string): string {
  const match = content.match(L1_REGEX);
  return match ? match[1].trim() : '';
}

function stripLevelComments(content: string): string {
  return content.replace(/<!--\s*L[012]:\s*[\s\S]*?-->/g, '').trim();
}

export function parseFrontmatter(content: string): ParsedHarnessDocument {
  const fmMatch = content.match(FRONTMATTER_REGEX);

  if (!fmMatch) {
    const l0 = extractL0(content);
    const l1 = extractL1(content);
    return {
      frontmatter: {},
      l0,
      l1,
      body: stripLevelComments(content),
    };
  }

  const [, yaml, rawBody] = fmMatch;
  const frontmatter = parseFrontmatterFields(yaml);
  const l0 = extractL0(rawBody);
  const l1 = extractL1(rawBody);
  const body = stripLevelComments(rawBody);

  return { frontmatter, l0, l1, body };
}
