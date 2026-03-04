export interface GuardrailResult {
  passed: boolean;

  name: string;

  message?: string;

  filtered?: string;
}

export interface Guardrail {
  name: string;

  check: (text: string, context?: GuardrailContext) => GuardrailResult | Promise<GuardrailResult>;
}

export interface GuardrailContext {
  prompt?: string;

  phase: 'input' | 'output';
}

export type OnBlockAction = 'throw' | 'retry' | 'filter';

export interface GuardrailsConfig {
  input?: Guardrail[];

  output?: Guardrail[];

  onBlock?: OnBlockAction;

  maxRetries?: number;
}

export class GuardrailBlockedError extends Error {
  public readonly guardrailName: string;
  public readonly phase: 'input' | 'output';
  public readonly results: GuardrailResult[];

  constructor(phase: 'input' | 'output', results: GuardrailResult[]) {
    const failed = results.filter((r) => !r.passed);
    const names = failed.map((r) => r.name).join(', ');
    const messages = failed
      .map((r) => r.message)
      .filter(Boolean)
      .join('; ');
    super(`Guardrail blocked (${phase}): [${names}] ${messages}`);
    this.name = 'GuardrailBlockedError';
    this.guardrailName = names;
    this.phase = phase;
    this.results = results;
  }
}
