import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('annotated parameters convert at the call boundary', () => {
  // A string argument to a uint8 parameter has no conversion: TypeError.
  expectThrown('function f(a: uint8) { return a; } f("s");');
  // An in-range Number is converted to the numeric value type inside.
  // Asserted as a BOOLEAN rather than through a ternary: `a is uint8` where
  // `a` is declared `uint8` can never fail, so guarding a branch on it is the
  // dead code sec-narrowing forbids (F76). Reading the boolean guards nothing
  // and says exactly what this test means - the value arrived typed.
  expect(evaluated('function f(a: uint8) { return String(a is uint8); } f(5);')).toBe('true');
  // SUPERSEDED: a "convertible" string used to become the typed value, the
  // boundary reaching for ToNumber before checking anything. The Parsing clause
  // says a string is deliberately not a conversion source for a numeric type, so
  // even a well-formed one is refused and the parse is written.
  expectThrown('function f(a: uint8) { return a; } f("7");');
  expect(evaluated('function f(a: uint8) { return a === (7 := uint8) ? "ok" : "no"; } f(uint8.parse("7"));')).toBe('ok');
});

test('return annotations enforce on the way out', () => {
  expectThrown('function f(): uint8 { return "s"; } f();');
  expect(evaluated('function f(): uint8 { return 5; } String(f() is uint8);')).toBe('true');
  // Arrow concise bodies too.
  expect(evaluated('const f = (): uint8 => 9; String(f() is uint8);')).toBe('true');
  expectThrown('const f = (): uint8 => "s"; f();');
});

test('unannotated functions are untouched', () => {
  expect(evaluated('function f(a) { return a; } f("anything") === "anything" ? "ok" : "no";')).toBe('ok');
  expect(evaluated('const g = (a, b) => a + b; g(1, 2) === 3 ? "ok" : "no";')).toBe('ok');
});

test('tuple rest elements match', () => {
  expect(evaluated('type T = [uint8, ...string]; ([(1 := uint8), "a", "b"] instanceof T) && !([(1 := uint8), "a", 3] instanceof T) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = [uint8, ...string]; ([(1 := uint8)] instanceof T) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = [uint8, ...string]; !([] instanceof T) ? "ok" : "no";')).toBe('ok');
});

test('class nominal membership via the prototype chain', () => {
  expect(evaluated('class A {} class B extends A {} const T = type A; (new A() instanceof T) && (new B() instanceof T) && !({} instanceof T) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('class A {} class B extends A {} const U = type B; !(new A() instanceof U) && (new B() instanceof U) ? "ok" : "no";')).toBe('ok');
});
