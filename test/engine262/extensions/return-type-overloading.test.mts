import { test, expect } from 'vitest';
import { ok, evaluated } from '../readme/harness.mts';

/**
 * PLAN-return-type-overloading.md phase 1: the filter.
 *
 * #sec-overloading-on-return-type: "a signature is identified by its return
 * type as well as its parameter types. The return type does not participate in
 * ranking; it participates in filtering" - and where a call has no contextual
 * type and more than one signature remains viable, the call is ambiguous.
 *
 * The signature record carries its return type now, and the resolver filters
 * the TIED candidates by it when given a contextual type.
 *
 * PHASE 2 FOUND THE AMBIGUITY IS THE CHECKER'S, NOT THE RUNTIME'S. The error
 * comes from check.mts, statically, before any call runs - so the runtime
 * contextual-type stack that phase 2 built reaches a resolution that never
 * happens for this program. Two things came of looking:
 *
 *   - The checker DROPPED the return type when building its candidates. Its
 *     signatures carry a `Return` and the mapping did not copy it, so the
 *     resolver could not have filtered whatever it was given. Fixed.
 *   - The resolution runs inside the checker's tree WALK, which visits a call
 *     without knowing the type its position requires. Supplying a contextual
 *     type means threading a target through the walk, which is a larger change
 *     than passing an argument and is what phase 2 actually needs.
 *
 * So the runtime half is built and unreachable for this case, and the checker
 * half is one field further along and blocked on the walk. The assertions below
 * are unchanged and still flip when that lands.
 */

test('overloading on parameters resolves', () => {
  // The part that already worked, asserted here because the filter must not
  // disturb it: this is decided by RANKING and never reaches the tie-break.
  const P = 'function f(a: uint8) { return 1; } function f(a: string) { return 2; } ';
  expect(evaluated(`${P}String(f("x"));`)).toBe('2');
  expect(evaluated(`${P}String(f(1));`)).toBe('1');
});

test('two signatures differing only in return are declared', () => {
  // They parse and both are registered - the design writes two full bodies
  // rather than TypeScript-style declarations, which is what an earlier
  // measurement of this feature got wrong.
  expect(ok('function f(): uint32 { return 10; } function f(): string { return "10"; }')).toBe(true);
});

test('a call with no contextual type is ambiguous', () => {
  // The clause's own example, and the half that is already correct.
  const P = 'function f(): uint32 { return 10; } function f(): string { return "10"; } ';
  expect(ok(`${P}f();`)).toBe(false);
});

test('a call in a binding position is still ambiguous (phase 2 flips this)', () => {
  // The clause requires `const a: string = f()` to select the second signature.
  // The filter is implemented and receives no contextual type, because the
  // dispatch calls resolveOverload with two arguments. Asserted as it behaves
  // with the divergence named, so phase 2 has a failing expectation to flip
  // rather than a comment to find.
  const P = 'function f(): uint32 { return 10; } function f(): string { return "10"; } ';
  expect(ok(`${P}const a: string = f();`)).toBe(false);
  expect(ok(`${P}const b: uint32 = f();`)).toBe(false);
});

test('an untyped catch-all still ranks last', () => {
  // #sec-overload-resolution's own example. The filter runs only on a tie, so
  // a catch-all beaten on rank never reaches it.
  const P = 'function f() { return 0; } function f(a: uint8) { return 1; } ';
  expect(evaluated(`${P}String(f(1));`)).toBe('1');
  expect(evaluated(`${P}String(f(1, 2));`)).toBe('0');
});
