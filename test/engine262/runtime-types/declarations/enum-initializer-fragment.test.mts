import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-enums with #annex-evaluable-fragment.
 *
 * "Every initializer is evaluated in the compile-time evaluable fragment, since
 * an enumerator is a constant of the program."
 *
 * It was evaluated outside one, and the checking pass was hiding it. That pass
 * evaluates a CLOSED initializer under the fragment, so `enum E { A =
 * Math.random() }` was refused there and never reached the declaration. An
 * initializer the pass could not resolve - one naming a binding it cannot read -
 * was skipped there and then evaluated at the declaration with no fragment in
 * force, so `const r = Math.random; enum E { A = r() }` produced a real random
 * number and failed the range check against it. The diagnostic named a different
 * value on every run, and the rule that should have refused it never ran.
 *
 * The fragment is enforced on the FUNCTION at the call rather than on the call
 * syntax - `fragment-library.mts` states the reason, that "a name in the source
 * is not the built-in it reaches" - so the fix is only that the call now happens
 * inside a fragment evaluation. That design is what makes the aliased spelling
 * reachable at all.
 */

test('an excluded built-in reached through a binding is refused', () => {
  // The case that escaped: the pass cannot read `r`, so it skipped the
  // initializer and the declaration evaluated it unguarded.
  expectThrownKind('const r = Math.random; enum E { A = r() }', 'TypeError');
  expectThrownKind('const d = Date.now; enum E { A = d() }', 'TypeError');
  // Not a range accident: a float64 enum has room for the value and is still
  // refused, because the rule is about the FUNCTION and not about the result.
  expectThrownKind('const r = Math.random; enum E: float64 { A = r() }', 'TypeError');
});

test('the refusal names the built-in, not the value it produced', () => {
  // What made the old behaviour untenable: `RangeError: 0.458... is not in the
  // range of "int.<32>"` named a number that differed on every run and pointed
  // at the range rather than at the call.
  expect(evaluated('try { eval("const r = Math.random; enum E { A = r() }"); "no error"; } '
    + 'catch (e) { e.message; }')).toContain('outside the compile-time-evaluable fragment');
});

test('the directly-spelled form keeps its earlier refusal', () => {
  // Closed, so the checking pass evaluates it and refuses before the source
  // runs. Pinned so the two spellings cannot drift apart again.
  expectStaticTypeError('enum E { A = Math.random() }');
  expectStaticTypeError('enum E { A = Date.now() }');
  expectStaticTypeError('enum E: float64 { A = (i, n) => Math.random() }');
});

test('initializers within the fragment still work, aliased or not', () => {
  expect(evaluated('enum E { A = 1, B = 2 } String(E.B);')).toBe('2');
  expect(evaluated('const K = 3; enum E { A = K } String(E.A);')).toBe('3');
  expect(evaluated('enum E { A = 1 + 2 * 3 } String(E.A);')).toBe('7');
  // A library-floor call, and the same call reached through a binding: both are
  // in the fragment, so both stand.
  expect(evaluated('enum E { A = Math.max(1, 2) } String(E.A);')).toBe('2');
  expect(evaluated('const m = Math.max; enum E { A = m(1, 2) } String(E.A);')).toBe('2');
});

test('the other enumerator forms are unaffected', () => {
  // "An enumerator initialized with a function of two parameters is given the
  // result of calling that function" - that call is inside the fragment too,
  // since the function produces the enumerator's value.
  expect(evaluated('enum Count: float32 { Zero = (index, name) => index * 100, One, Two } String(Count.Two);')).toBe('200');
  expect(evaluated('enum E { A, B, C } String(E.C);')).toBe('2');
  expect(evaluated("enum E: string { A = 'x', B = 'y' } E.B;")).toBe('y');
  expect(evaluated("const s = Symbol('s'); enum E: symbol { A = s } String(E.A === s);")).toBe('true');
});
