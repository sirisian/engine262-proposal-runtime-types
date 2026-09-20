import { CanonicalizeType } from './intern.mts';
import { displayType } from './records.mts';
import type { TypeRecord } from './records.mts';

interface ArgumentNode {
  readonly next: Map<string, ArgumentNode>;
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
    // Keyed by the canonical form's TEXT, not by the record itself.
    //
    // `CanonicalizeType` builds a fresh record on every call - its literal arm
    // returns `{ Kind: 'literal', Value, Base }` newly each time - so it is a
    // normal form and not an interned one. A `Map` keyed by the record compares
    // by identity, so every lookup missed by construction: the write stored one
    // key and the very next read with the same binding did not find it.
    //
    // #sec-generic-where says a specialization's clauses are "evaluated when it
    // is created ... and NEVER PER CALL", and this memo is what enforces that,
    // so a memo that cannot hit means both runtime sites re-evaluate on every
    // call - `f.<4>(x)` evaluating a `where probe(N)` twice, and three calls six
    // times.
    const key = displayType(CanonicalizeType(bound));
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
