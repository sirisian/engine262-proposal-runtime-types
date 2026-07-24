import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// Phase 3 (STATIC-CHECKER-PLAN.md): contextual types and overload resolution
// at a call, over the numeric library's listing. The checker resolves per
// #sec-overload-resolution — a typed argument names the only viable family,
// the contextual type of #sec-contextual-types filters by return, a literal
// argument takes the chosen parameter's type — and a resolution from context
// alone is recorded for EvaluateCall to honour, so the runtime executes the
// resolved row. Static diagnostics are proven static by placing the call in a
// function that is never invoked: a rejection then can only be the checker's.

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('R8: a contextual integer type resolves the call at that family', () => {
  // The integer root row: `Math.sqrt` of a uint8 is the integer square root.
  // Without the contextual resolution this is float64's 3.1622..., which the
  // uint8 binding boundary refuses; with it, the call itself computes 3.
  expect(evaluated('const a: uint8 = Math.sqrt(10); String(a === (3 := uint8));')).toBe('true');
  // The identity row, same shape: floor of an integer is itself.
  expect(evaluated('const a: uint8 = Math.floor(7); String(a === (7 := uint8));')).toBe('true');
});

test('R8: the checked integer row raises where the float path would wrap at the boundary', () => {
  // `Math.pow` resolved at uint8 declares a uint8 return, and 2**10 is not
  // representable there: the checked row raises. The conversion, by contrast,
  // wraps: uint16's 1024 converted to uint8 is 0. Both observable, and now
  // both right for the right reason.
  expectThrown('const a: uint8 = Math.pow(2, 10); "unreachable";');
  expect(evaluated('String(((1024 := uint16) := uint8) === (0 := uint8));')).toBe('true');
});

test('an out-of-range literal at a contextual call is rejected before anything runs', () => {
  // 300 cannot take uint8, the chosen parameter type, so the literal itself is
  // the diagnostic — in a never-called function, so the rejection is static.
  expectThrown('function neverCalled() { const a: uint8 = Math.pow(2, 300); } "unreachable";');
});

test('a mixed-type call is a static diagnostic at the call', () => {
  // "Every signature takes its numeric parameters at one type." Two typed
  // arguments of different families are viable at no signature, and the
  // checker says so without running anything.
  expectThrown('function neverCalled() { Math.min((1 := uint8), (2 := float32)); } "unreachable";');
});

test('a typed argument with no row at its family is a static diagnostic', () => {
  // The transcendentals have no integer row: an integer-typed argument fails
  // resolution rather than promoting silently.
  expectThrown('function neverCalled() { Math.tan((1 := uint8)); } "unreachable";');
});

test('a contextual type no signature returns is a static diagnostic', () => {
  // `Math.exp` has a float row and no integer row, so nothing returns uint8.
  expectThrown('function neverCalled() { const a: uint8 = Math.exp(1); } "unreachable";');
  // A typed argument beside a conflicting context: the uint8 row returns
  // uint8, which is not float32, and no other signature takes a uint8.
  expectThrown('function neverCalled(u: uint8): float32 { return Math.sqrt(u); } "unreachable";');
});

test('the return annotation and an assignment target are contextual positions', () => {
  // #table-contextual-types: the operand of `return` takes the annotated
  // return type, and the right operand of an assignment takes the target's.
  expect(evaluated('function f(): uint8 { return Math.sqrt(9); } String(f() === (3 := uint8));')).toBe('true');
  expect(evaluated('let a: uint8 = 0; a = Math.sqrt(16); String(a === (4 := uint8));')).toBe('true');
});

test('the Number signature stays the silent default', () => {
  // No typed argument and no numeric context: the untyped world, unchanged.
  expect(evaluated('String(Math.pow(2, 10));')).toBe('1024');
  expect(evaluated('let n = Math.sqrt(10); String(n > 3.16 && n < 3.17);')).toBe('true');
  // A `number` annotation is that same world by name.
  expect(evaluated('let n: number = Math.pow(2, 10); String(n);')).toBe('1024');
});

test('cast placement: converting the result and converting the operand differ', () => {
  // The numeric library plan's distinction, stated over the integer and float
  // rows: converting the RESULT keeps the integer row's exact square root,
  // converting the OPERAND selects the float row's approximation. The plan's
  // own literals use 10n, and that exact pair could not be asserted before F38: no
  // conversion admits a bigint source to a float target yet
  // (`float64(3n)` and `(3n := float64)` both refuse), which is
  // conversion-table work adjacent to F14, not this phase's; F37 pins it.
  expect(evaluated('String((Math.sqrt((10 := uint8)) := float64));')).toBe('3');
  expect(evaluated('String(Math.sqrt((10 := float64)));')).toBe('3.1622776601683795');
  // The plan's own literals, over the bigint row: assertable since the
  // bigint-to-float conversion source landed (F38; F37 had pinned it).
  expect(evaluated('String(float64(Math.sqrt(10n)));')).toBe('3');
  expect(evaluated('String(Math.sqrt(float64(10n)));')).toBe('3.1622776601683795');
});
