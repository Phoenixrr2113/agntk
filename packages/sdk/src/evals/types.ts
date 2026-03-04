import type { StepResult, ToolSet } from 'ai';
import type { Agent } from '../types/agent';

export interface EvalCaseResult {
  name: string;
  passed: boolean;
  duration: number;
  assertions: AssertionResult[];
  error?: string;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface EvalCase {
  name: string;
  prompt: string;
  assertions: Assertion[];

  timeout?: number;
}

export interface Assertion {
  name: string;
  check: (result: EvalAgentResult) => AssertionResult | Promise<AssertionResult>;
}

export interface EvalAgentResult {
  text: string;
  steps: StepResult<ToolSet>[];
  totalUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface EvalSuiteConfig {
  name: string;
  agent: Agent;
  cases: EvalCase[];

  maxConcurrency?: number;

  reporter?: 'console' | 'json' | EvalReporter;
}

export interface EvalSuiteResult {
  name: string;
  totalCases: number;
  passed: number;
  failed: number;
  duration: number;
  cases: EvalCaseResult[];
}

export interface EvalReporter {
  onCaseStart?: (caseName: string) => void;
  onCaseEnd?: (result: EvalCaseResult) => void;
  onSuiteEnd?: (result: EvalSuiteResult) => void;
}
