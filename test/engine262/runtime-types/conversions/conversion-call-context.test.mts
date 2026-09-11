import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A conversion call - one whose callee names a TYPE - and what the checker knows
 * about it.
 *
 * Today: nothing. `uint32("s")` in a dead branch raises no static error, and
 * `const c: string = uint32(1)` is accepted, so neither the argument nor the
 * result is checked. Everything about `uint32(x)` is decided at run time.
 *
 * Two consequences, one in each direction:
 *
 *   uint32(f())                 // ambiguous - the argument gets no contextual type
 *   const c: string = uint32(1) // accepted  - the call has no static result type
 *
 * and `README.md:2088` documents `h(uint32(f()))` as the REMEDY for return-type
 * ambiguity, which does not work.
 *
 * The tests below are the regression guard, written before the feature: they pin
 * what a conversion call does today and must keep doing.
 */

test('a conversion call resolves its callee by ORDINARY SCOPE', () => {
  // The guard that matters most. A local binding shadowing a type name is an
  // ordinary call, and recognition must not reach past scope resolution to treat
  // it as a conversion.
  expect(evaluated('{ let uint32 = (x) => 99; String(uint32(1)); }')).toBe('99');
});

test('the shapes a conversion call already has', () => {
  expect(evaluated('String(Number(uint32(1)));')).toBe('1');
  expect(evaluated('String(Number(uint32(uint8(1))));')).toBe('1');
  expect(evaluated('String(Reflect.typeOf(uint32(1)));')).toBe('uint.<32>');
  expect(evaluated('let n = 0.1; String(Number(uint32(n)));')).toBe('0');
});

test('a callee may be an alias, an applied primitive, or a generic application', () => {
  // All three are conversion callees, so recognising only a bare primitive name
  // would miss them.
  expect(evaluated('type U = uint32; String(Number(U(1)));')).toBe('1');
  expect(evaluated('String(rational.<64>(1));')).toBe('1');
  expect(evaluated('type A<T> = T; String(Number(A.<uint32>(1)));')).toBe('1');
});

test('a CLASS callee is not a conversion', () => {
  // Already a different error, which is what keeps conversions and constructions
  // distinct without a new rule.
  expectThrown('class C { constructor(a: uint32) {} } C(1);', 'cannot be invoked without');
});

test('the runtime still rejects a bad conversion source', () => {
  // This must keep failing when the CHECKER learns to reject it too - the static
  // error is additional, not a replacement.
  expectThrown('uint32("s");', 'not a conversion source');
});

test('a conversion call answers its target type', () => {
  // Without this the checker did not know what `uint32(1)` IS, so a wrong program
  // passed: `const c: string = uint32(1)` was accepted. That is the mirror of the
  // ambiguity above - a right program refused - and both came from the checker
  // not modelling the construct.
  expectThrown('const c: string = uint32(1);', 'not assignable');
  expectThrown('if (false) { const c: string = uint32(1); }', 'not assignable');
  expect(evaluated('const c: uint32 = uint32(1); String(Number(c));')).toBe('1');
});

test('...but the POSITION wins where it converts', () => {
  // `#sec-conversions` keys the numeric conversions on FAMILIES - "a numeric
  // target has a conversion available only when the value is itself numeric" -
  // so a `uint32` in a `uint8` position converts, though `IsAssignable` is false
  // for it and the runtime converts there too.
  //
  // Answering the target type UNCONDITIONALLY refused this, which is the remedy
  // `README.md:2088` documents. The test is here because four attempts at this
  // step passed the two rows above and failed this one.
  const F = 'function f(): uint32 { return 10; } function f(): string { return "10"; } ';
  expect(evaluated(`${F} function h(a: uint8) { return 1; } function h(a: string) { return 2; }`
    + ' String(h(uint32(f())));')).toBe('1');
  expect(evaluated('function h(a: uint8) { return 1; } const v = uint32(1); String(h(v));')).toBe('1');
});
