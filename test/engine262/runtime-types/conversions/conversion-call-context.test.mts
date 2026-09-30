import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A conversion call - one whose callee names a TYPE - and what the checker knows about it (#sec-conversions).
 * It has a static result type, its own target, so `const c: string = uint32(1)` is refused before the source
 * runs; and a bad conversion source is a static error where the argument's type is known, so `uint32("s")` is
 * refused even in a dead branch.
 *
 * Return-type overloading is where a conversion call does not help: `uint32(f())` for a return-type-overloaded
 * `f` remains ambiguous, since the argument of a conversion call gets no contextual type. And converting the
 * result first does not resolve an overloaded callee: `h(uint32(f()))`, for `h` overloaded on `uint8` and
 * `string`, is refused, because a boundary checks a typed value rather than converting it, so a `uint32`
 * reaches neither parameter.
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
  expect(evaluated('type A<T: type> = T; String(Number(A.<uint32>(1)));')).toBe('1');
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
  // The checker knows what `uint32(1)` is - its target type - so a wrong program such as
  // `const c: string = uint32(1)` is refused.
  expectThrown('const c: string = uint32(1);', 'not assignable');
  expectThrown('if (false) { const c: string = uint32(1); }', 'not assignable');
  expect(evaluated('const c: uint32 = uint32(1); String(Number(c));')).toBe('1');
});

test('a conversion call answers its target type everywhere, and a boundary checks rather than converts', () => {
  // A conversion call answers its TARGET type everywhere, and a boundary checks a typed value rather than
  // converting it (runtime type checks, amended step 3). #sec-conversions keys the numeric conversions on
  // FAMILIES - "a numeric target has a conversion available only when the value is itself numeric" - but the
  // position does not win where a typed value would convert: a `uint32` reaches neither a `uint8` parameter nor,
  // through `any`, one.
  const F = 'function f(): uint32 { return 10; } function f(): string { return "10"; } ';
  // The overloaded callee and the `any` route: both are refused.
  expectThrown(`${F} function h(a: uint8) { return 1; } function h(a: string) { return 2; }`
    + ' String(h(uint32(f())));', 'not assignable');
  expectThrown('function h(a: uint8) { return 1; } const v: any = uint32(1); String(h(v));', 'is not assignable to');
});

test('a bad conversion source is a STATIC error', () => {
  // #sec-conversions: "the numeric conversions are keyed on NUMERIC families, so a numeric target has a
  // conversion available only when the value is itself numeric." So `uint32("s")` is a static error, not only a
  // runtime TypeError: it is refused even in a dead branch.
  expectThrown('if (false) { uint32("s"); }', 'not a conversion source');
  expectThrown('uint32("s");', 'not a conversion source');
});

test('...reported only where the argument type is KNOWN', () => {
  // Argument types are frequently null in this pass, and refusing an unknown
  // type would reject programs the runtime accepts. A numeric source and a
  // string TARGET are both untouched.
  expect(evaluated('String(Number(uint32(1)));')).toBe('1');
  expect(evaluated('let n = 1; String(Number(uint32(n)));')).toBe('1');
  expect(evaluated('String(string(1));')).toBe('1');
});
