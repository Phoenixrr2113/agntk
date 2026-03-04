import { DEFAULT_MAX_HISTORY, DEFAULT_MAX_BRANCH_SIZE } from './constants';
import type { ThoughtData, ReasoningResult, DeepReasoningConfig } from './types';

export class DeepReasoningEngine {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private maxHistorySize: number;
  private maxBranchSize: number;

  constructor(options: { maxHistorySize?: number; maxBranchSize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? DEFAULT_MAX_HISTORY;
    this.maxBranchSize = options.maxBranchSize ?? DEFAULT_MAX_BRANCH_SIZE;
  }

  processThought(input: ThoughtData): ReasoningResult {
    if (input.thoughtNumber > input.totalThoughts) {
      input.totalThoughts = input.thoughtNumber;
    }

    this.thoughtHistory.push(input);

    if (this.thoughtHistory.length > this.maxHistorySize) {
      this.thoughtHistory.shift();
    }

    if (input.branchFromThought && input.branchId) {
      if (!this.branches[input.branchId]) {
        this.branches[input.branchId] = [];
      }

      const branch = this.branches[input.branchId];
      if (branch) {
        branch.push(input);
        if (branch.length > this.maxBranchSize) {
          branch.shift();
        }
      }
    }

    return {
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
      branches: Object.keys(this.branches),
      thoughtHistoryLength: this.thoughtHistory.length,
    };
  }

  getHistory(): ThoughtData[] {
    return [...this.thoughtHistory];
  }

  getBranches(): Record<string, ThoughtData[]> {
    return { ...this.branches };
  }

  reset(): void {
    this.thoughtHistory = [];
    this.branches = {};
  }
}

let isEnabled = false;
let globalEngine: DeepReasoningEngine | null = null;

export function configureDeepReasoning(config: DeepReasoningConfig): void {
  isEnabled = config.enabled;

  if (config.enabled) {
    globalEngine = new DeepReasoningEngine({
      maxHistorySize: config.maxHistorySize,
      maxBranchSize: config.maxBranchSize,
    });
  } else {
    globalEngine = null;
  }
}

export function isDeepReasoningEnabled(): boolean {
  return isEnabled;
}

export function getDeepReasoningEngine(): DeepReasoningEngine {
  if (!globalEngine) {
    globalEngine = new DeepReasoningEngine();
  }
  return globalEngine;
}

export function resetDeepReasoningEngine(): void {
  globalEngine?.reset();
}
