import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../harness/frontmatter';

describe('parseFrontmatter', () => {
  it('parses full frontmatter with all fields', () => {
    const content = `---
id: rule-001
tags: [safety, core]
created: 2025-01-01
updated: 2025-06-15
author: human
status: active
source: session-abc
related: [rule-002, rule-003]
---
<!-- L0: Safety boundary rule -->
<!-- L1: Prevents the agent from modifying critical system files -->
Do not modify files in /etc or /System.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.id).toBe('rule-001');
    expect(result.frontmatter.tags).toEqual(['safety', 'core']);
    expect(result.frontmatter.created).toBe('2025-01-01');
    expect(result.frontmatter.updated).toBe('2025-06-15');
    expect(result.frontmatter.author).toBe('human');
    expect(result.frontmatter.status).toBe('active');
    expect(result.frontmatter.source).toBe('session-abc');
    expect(result.frontmatter.related).toEqual(['rule-002', 'rule-003']);
    expect(result.l0).toBe('Safety boundary rule');
    expect(result.l1).toBe('Prevents the agent from modifying critical system files');
    expect(result.body).toBe('Do not modify files in /etc or /System.');
  });

  it('handles content with no frontmatter', () => {
    const content = `<!-- L0: Quick summary -->
<!-- L1: Detailed description here -->
Body content goes here.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.l0).toBe('Quick summary');
    expect(result.l1).toBe('Detailed description here');
    expect(result.body).toBe('Body content goes here.');
  });

  it('handles content with no L0/L1 comments', () => {
    const content = `---
id: simple-rule
author: human
status: draft
---
Just a plain body with no level comments.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.id).toBe('simple-rule');
    expect(result.l0).toBe('');
    expect(result.l1).toBe('');
    expect(result.body).toBe('Just a plain body with no level comments.');
  });

  it('handles plain text with no frontmatter or comments', () => {
    const content = 'Simple plain text content.';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.l0).toBe('');
    expect(result.l1).toBe('');
    expect(result.body).toBe('Simple plain text content.');
  });

  it('handles quoted values in frontmatter', () => {
    const content = `---
id: "quoted-id"
author: 'single-quoted'
status: active
---
Body.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.id).toBe('quoted-id');
    expect(result.frontmatter.author).toBe('single-quoted');
  });

  it('ignores invalid status values', () => {
    const content = `---
id: test
status: invalid-status
---
Body.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.status).toBeUndefined();
  });

  it('strips L0 and L1 comments from body', () => {
    const content = `---
id: test
status: active
---
<!-- L0: Summary line -->
<!-- L1: A longer explanation that describes the purpose -->
The actual rule body content.

More content here.`;

    const result = parseFrontmatter(content);

    expect(result.body).not.toContain('L0:');
    expect(result.body).not.toContain('L1:');
    expect(result.body).toContain('The actual rule body content.');
    expect(result.body).toContain('More content here.');
  });

  it('handles multiline L1 comments', () => {
    const content = `---
id: test
status: active
---
<!-- L1: This is a longer description
that spans multiple lines
for detailed context -->
Body content.`;

    const result = parseFrontmatter(content);

    expect(result.l1).toBe(
      'This is a longer description\nthat spans multiple lines\nfor detailed context',
    );
  });

  it('parses tags as comma-separated list', () => {
    const content = `---
id: test
tags: safety, performance, memory
status: active
---
Body.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter.tags).toEqual(['safety', 'performance', 'memory']);
  });

  it('treats empty frontmatter block as no frontmatter', () => {
    const content = `---
---
Body content only.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.l0).toBe('');
    expect(result.l1).toBe('');
  });
});
