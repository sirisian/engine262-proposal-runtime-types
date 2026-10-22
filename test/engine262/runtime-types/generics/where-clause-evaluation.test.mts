import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-generic-where. "A specialization's `where` clauses are evaluated
 * WHEN IT IS CREATED, as the last step of BindTypeArguments, and NEVER PER
 * CALL."
 *
 * The memo in `generic-where.mts` is what enforces that, and it could never
 * hit. It keyed its Map on the record `CanonicalizeType` returns, and that
 * function builds a FRESH object every call - its literal arm returns
 * `{ Kind: 'literal', Value, Base }` newly each time - so it is a normal form
 * and not an interned one. A Map keyed by the record compares by identity, so
 * the write stored one key and the very next read with the same binding did not
 * find it.
 *
 * With the memo dead, both runtime sites re-evaluated on every call: the
 * specialization check in CallExpression and `VerifyContracts`, which runs per
 * function body. `f.<4>(x)` evaluated a `where probe(N)` twice and three calls
 * six times.
 *
 * Interned Type Objects provide stable keys while preserving SameValue
 * distinctions that diagnostic text cannot express (such as signed zero).
 */

const P = 'function probe(x) { return true; } ';

// Observe execution from the host: ambient counters are not evaluable inputs
// to a specialization predicate, even when the counter is used only by a test.
function probeCalls(source: string): number {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let calls = 0;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type !== 'ReturnStatement') return;
    for (let owner = node.parent; owner; owner = owner.parent) {
      if (owner.type !== 'FunctionDeclaration') continue;
      if (owner.BindingIdentifier?.name === 'probe') calls++;
      break;
    }
  };
  try {
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`${P}${F}${source}`));
    expect(result.Type).toBe('normal');
    return calls;
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
}
const F = 'function f<N: uint32>(a: uint32): uint32 where probe(N) { return a; } ';

test('a clause is evaluated once for a specialization, however often it is called', () => {
  expect(probeCalls('let g = f.<4>;')).toBe(1);
  expect(probeCalls('f.<4>((1 := uint32));')).toBe(1);
  expect(probeCalls('f.<4>((1 := uint32)); f.<4>((2 := uint32)); f.<4>((3 := uint32));')).toBe(1);
});

test('a different specialization is a different evaluation', () => {
  // The memo is keyed on the bound arguments, so `f.<5>` is not `f.<4>`.
  expect(probeCalls('f.<4>((1 := uint32)); f.<5>((1 := uint32));')).toBe(2);
});

test('a CONTRACT still runs at every evaluation, which is a different rule', () => {
  // #sec-checked-contracts: "at every concrete evaluation of the builder ...
  // each clause is evaluated with `return` bound to it". A clause whose subject
  // is the return value is not a specialization's clause and is not memoized.
  expect(evaluated('let n = 0; function seen(r) { n++; return true; } '
    + 'function g(a: uint32): uint32 where seen(return) { return a; } '
    + 'g((1 := uint32)); g((2 := uint32)); String(n);')).toBe('2');
});

test('what the clauses admit and refuse is unchanged', () => {
  const G = 'function f<N: uint32>(a: uint32): uint32 where N > 2 { return a; } ';
  expect(evaluated(`${G}String(f.<4>((7 := uint32)));`)).toBe('7');
  expectStaticTypeError(`${G}f.<1>((1 := uint32));`);
  // A later specialization is judged on its own arguments, not on a memo hit
  // from an earlier one.
  expectStaticTypeError(`${G}f.<4>((1 := uint32)); f.<1>((1 := uint32));`);
});
