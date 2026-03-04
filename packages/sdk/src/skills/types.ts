export interface SkillMeta {
  name: string;

  description: string;

  path: string;

  directory: string;

  tags?: string[];

  whenToUse?: string;

  model?: 'fast' | 'standard' | 'reasoning' | 'powerful';

  maxSteps?: number;

  requires?: SkillRequirements;

  license?: string;

  compatibility?: string;

  metadata?: Record<string, string>;

  allowedTools?: string[];

  toolsDeny?: string[];

  extra?: Record<string, unknown>;
}

export interface SkillRequirements {
  binaries?: string[];

  env?: string[];
}

export interface SkillContent extends SkillMeta {
  content: string;
}

export interface SkillsConfig {
  directories?: string[];

  autoDiscover?: boolean;

  include?: string[];
}
