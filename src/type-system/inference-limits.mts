import type { ParseNode } from '../parser/ParseNode.mts';
import type { Known } from './records.mts';

/** Host resource limits; reaching one is not a proof of non-convergence. */
export interface InferenceLimits {
  evaluations?: number;
  results?: number;
  depth?: number;
}

export class InferenceResources {
  readonly limits: Required<InferenceLimits>;
  exhausted?: { kind: keyof InferenceLimits, declaration: ParseNode };
  private evaluations = 0;
  private depth = 0;
  private results = new Map<ParseNode, Known[]>();

  constructor(limits: InferenceLimits = {}) {
    this.limits = { evaluations: limits.evaluations ?? 10000, results: limits.results ?? 64, depth: limits.depth ?? 64 };
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('return inference limits must be non-negative safe integers');
      }
    }
  }

  enter(declaration: ParseNode): boolean {
    if (this.exhausted) return false;
    if (this.evaluations === this.limits.evaluations) {
      this.exhausted = { kind: 'evaluations', declaration };
    } else if (this.depth === this.limits.depth) {
      this.exhausted = { kind: 'depth', declaration };
    } else {
      this.evaluations += 1;
      this.depth += 1;
      return true;
    }
    return false;
  }

  leave(): void {
    this.depth -= 1;
  }

  result(declaration: ParseNode, answer: Known, same: (left: Known, right: Known) => boolean): void {
    if (this.exhausted) return;
    const previous = this.results.get(declaration) ?? [];
    if (previous.some((value) => same(value, answer))) return;
    if (previous.length === this.limits.results) this.exhausted = { kind: 'results', declaration };
    else {
      previous.push(answer);
      this.results.set(declaration, previous);
    }
  }
}
