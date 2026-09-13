import { CanonicalizeType } from './intern.mts';
import type { TypeRecord } from './records.mts';

interface ArgumentNode {
  readonly next: Map<TypeRecord, ArgumentNode>;
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
    const key = CanonicalizeType(bound);
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
  entry(clause, bindings, true)!.verified = true;
}
