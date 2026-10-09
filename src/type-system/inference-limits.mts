import type { ParseNode } from '../parser/ParseNode.mts';
import type { Known } from './records.mts';

/** Host resource limits; reaching one is not a proof of non-convergence. */
export interface InferenceLimits {
  evaluations?: number;
  results?: number;
  depth?: number;
}

export type InferenceComponent = 'return' | 'yield' | 'resolve' | 'generator-return';

/** Historical answers own their compiler records, but never clone identities. */
function snapshotAnswer(answer: Known): Known {
  const seen = new Map<object, unknown>();
  const pending: (() => void)[] = [];
  const identities = new Set(['Declaration', 'DeclarationIdentity', 'Operator', 'DefaultEnvironment']);
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const proto = Object.getPrototypeOf(value);
    if (typeof (value as { type?: unknown }).type === 'string'
      || !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set)
        && proto !== Object.prototype && proto !== null) return value;
    if (value instanceof Map) {
      const result = new Map();
      seen.set(value, result);
      pending.push(() => {
        for (const [key, item] of value) result.set(key, copy(item));
      });
      return result;
    }
    if (value instanceof Set) return new Set(value);
    const result: Record<PropertyKey, unknown> = Array.isArray(value) ? [] as unknown as Record<PropertyKey, unknown> : Object.create(proto);
    seen.set(value, result);
    pending.push(() => {
      for (const key of Reflect.ownKeys(value)) {
        const item = (value as Record<PropertyKey, unknown>)[key];
        result[key] = typeof key === 'string' && identities.has(key) ? item : copy(item);
      }
    });
    return result;
  };
  const result = copy(answer);
  for (let i = 0; i < pending.length; i += 1) pending[i]();
  return result as Known;
}

export class InferenceResources {
  readonly limits: Required<InferenceLimits>;
  exhausted?: { kind: keyof InferenceLimits, declaration: ParseNode };
  private evaluations = 0;
  private depth = 0;
  private results = new Map<ParseNode, { component: InferenceComponent, answer: Known }[]>();

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

  result(declaration: ParseNode, component: InferenceComponent, answer: Known, same: (left: Known, right: Known) => boolean): void {
    if (this.exhausted) return;
    const previous = this.results.get(declaration) ?? [];
    if (previous.some((value) => value.component === component && same(value.answer, answer))) return;
    if (previous.length === this.limits.results) this.exhausted = { kind: 'results', declaration };
    else {
      previous.push({ component, answer: snapshotAnswer(answer) });
      this.results.set(declaration, previous);
    }
  }
}
