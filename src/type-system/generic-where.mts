import { GetTypeObject } from './intern.mts';
import type { TypeRecord } from './records.mts';
import { RequiredModuleInputFailure } from './required-module-inputs.mts';

interface ArgumentNode {
  readonly next: Map<object, ArgumentNode>;
  verified: boolean;
}

// #sec-generic-where: a closed predicate depends only on the specialization's
// bound arguments. The checking pass and runtime boundaries share its result.
const verifiedClauses = new WeakMap<object, { names: readonly string[], root: ArgumentNode }>();

function entry(clause: object, bindings: ReadonlyMap<string, TypeRecord>, create: boolean): ArgumentNode | undefined {
  let cache = verifiedClauses.get(clause);
  if (!cache) {
    if (!create) return undefined;
    cache = { names: [...bindings.keys()], root: { next: new Map(), verified: false } };
    verifiedClauses.set(clause, cache);
  }
  let node = cache.root;
  for (const name of cache.names) {
    const bound = bindings.get(name);
    if (!bound) return undefined;
    // Canonical Type Object identity preserves SameType/SameValue, including
    // signed zero and nominal declarations with the same diagnostic name.
    const key = GetTypeObject(bound);
    let next = node.next.get(key);
    if (!next) {
      if (!create) return undefined;
      next = { next: new Map(), verified: false };
      node.next.set(key, next);
    }
    node = next;
  }
  return node;
}

export function GenericWhereVerified(clause: object, bindings: ReadonlyMap<string, TypeRecord>): boolean {
  return entry(clause, bindings, false)?.verified === true;
}

export function MarkGenericWhereVerified(clause: object, bindings: ReadonlyMap<string, TypeRecord>): void {
  if (RequiredModuleInputFailure()) return;
  // A clause verified at pre-evaluation over a method's own parameters and
  // its class's (round 5, Q7) is keyed by both; a run-time frame holding only
  // the method's own finds no entry, and the verification is simply not
  // reused there, rather than crashing the host.
  const verified = entry(clause, bindings, true);
  if (verified) verified.verified = true;
}
