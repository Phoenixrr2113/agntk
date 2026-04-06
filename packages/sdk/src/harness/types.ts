export interface HarnessFrontmatter {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  author: string;
  status: 'active' | 'draft' | 'archived';
  source?: string;
  related?: string[];
}

export interface CoreIdentity {
  purpose: string;
  creator: string;
  values: string[];
  ethics: string[];
  identity: string;
}

export interface Rule {
  frontmatter: HarnessFrontmatter;
  l0: string;
  l1: string;
  body: string;
}

export interface Instinct {
  frontmatter: HarnessFrontmatter;
  l0: string;
  l1: string;
  body: string;
  provenance: string;
}

export interface ParsedHarnessDocument {
  frontmatter: Partial<HarnessFrontmatter>;
  l0: string;
  l1: string;
  body: string;
}

export interface HarnessConfig {
  root?: string;
  core?: boolean;
  rules?: boolean;
  instincts?: boolean;
}
