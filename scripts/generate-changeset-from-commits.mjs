#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const helpFlag = args.includes('--help') || args.includes('-h');

if (helpFlag) {
  console.log(`
Usage: node generate-changeset-from-commits.mjs [options]

Options:
  --base <branch>    Base branch to compare against (default: origin/main)
  --head <branch>    Head branch to compare (default: HEAD)
  --help             Show this help message

This script generates changeset files from conventional commits in a PR.
It detects affected packages and creates appropriate changeset entries.
  `);
  process.exit(0);
}

// Parse arguments
let baseBranch = 'origin/main';
let headBranch = 'HEAD';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    baseBranch = args[i + 1];
    i++;
  } else if (args[i] === '--head' && args[i + 1]) {
    headBranch = args[i + 1];
    i++;
  }
}

// Package mapping
const packageMap = {
  'packages/sdk/': '@agntk/core',
  'packages/cli/': '@agntk/cli',
  'packages/agntk/': 'agntk',
  'packages/sdk-server/': '@agntk/server',
  'packages/sdk-client/': '@agntk/client',
  'packages/logger/': '@agntk/logger',
  'packages/search/': '@agntk/search',
  'packages/config-typescript/': '@agntk/config-typescript',
  'packages/config-eslint/': '@agntk/config-eslint',
};

// Get list of commits between base and head
let commits = [];
try {
  const commitLog = execSync(
    `git log ${baseBranch}..${headBranch} --format=%H%n%s%n%b%n---END---`,
    { encoding: 'utf-8' },
  );

  const commitBlocks = commitLog.split('---END---').filter(Boolean);
  commits = commitBlocks.map((block) => {
    const lines = block.trim().split('\n');
    return {
      hash: lines[0],
      subject: lines[1] || '',
      body: lines.slice(2).join('\n'),
    };
  });
} catch (error) {
  console.error('Error getting commits:', error.message);
  process.exit(1);
}

if (commits.length === 0) {
  console.log('No commits found between branches');
  process.exit(0);
}

// Parse conventional commits and determine bump type
function parseBumpType(subject, body) {
  // Check for breaking change
  if (subject.includes('!:') || body.includes('BREAKING CHANGE')) {
    return 'major';
  }

  const prefix = subject.split(':')[0].toLowerCase();

  if (prefix === 'feat') {
    return 'minor';
  } else if (['fix', 'perf', 'refactor'].includes(prefix)) {
    return 'patch';
  } else if (['chore', 'docs', 'ci', 'test', 'style'].includes(prefix)) {
    return 'skip';
  }

  return 'skip';
}

// Get changed files for a commit
function getChangedFiles(hash) {
  try {
    const files = execSync(`git show --name-only --format= ${hash}`, {
      encoding: 'utf-8',
    });
    return files.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Detect affected packages from changed files
function detectAffectedPackages(files) {
  const packages = new Set();

  for (const file of files) {
    for (const [path, pkgName] of Object.entries(packageMap)) {
      if (file.startsWith(path)) {
        packages.add(pkgName);
        break;
      }
    }
  }

  return Array.from(packages);
}

// Group commits by bump type and affected packages
const changesByType = {
  major: new Map(),
  minor: new Map(),
  patch: new Map(),
};

for (const commit of commits) {
  const bumpType = parseBumpType(commit.subject, commit.body);

  if (bumpType === 'skip') {
    continue;
  }

  const files = getChangedFiles(commit.hash);
  const packages = detectAffectedPackages(files);

  for (const pkg of packages) {
    const key = `${pkg}:${bumpType}`;
    if (!changesByType[bumpType].has(key)) {
      changesByType[bumpType].set(key, []);
    }
    changesByType[bumpType].get(key).push(commit.subject);
  }
}

// Generate changeset file if there are changes
const allChanges = [
  ...changesByType.major.entries(),
  ...changesByType.minor.entries(),
  ...changesByType.patch.entries(),
];

if (allChanges.length === 0) {
  console.log('No conventional commits found that require a changeset');
  process.exit(0);
}

// Create changeset file
const timestamp = Date.now();
const slug = `auto-changeset-${timestamp}`;
const changesetPath = join('.changeset', `${slug}.md`);

// Build frontmatter
const frontmatter = {};
for (const [key, commits] of allChanges) {
  const [pkg, bumpType] = key.split(':');
  if (!frontmatter[pkg]) {
    frontmatter[pkg] = bumpType;
  }
}

// Build content
let content = '---\n';
for (const [pkg, bumpType] of Object.entries(frontmatter)) {
  content += `"${pkg}": ${bumpType}\n`;
}
content += '---\n\n';

// Add summary of changes
content += 'Auto-generated changeset from conventional commits:\n\n';
for (const [key, commitList] of allChanges) {
  const [pkg, bumpType] = key.split(':');
  content += `- **${pkg}** (${bumpType}): ${commitList.join(', ')}\n`;
}

// Write changeset file
try {
  writeFileSync(changesetPath, content, 'utf-8');
  console.log(`Generated changeset: ${changesetPath}`);
} catch (error) {
  console.error('Error writing changeset file:', error.message);
  process.exit(1);
}
