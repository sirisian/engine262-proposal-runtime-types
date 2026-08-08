import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-object-types-semantics (Object Types) - index signatures.
 *
 * An index signature types the members a declaration does not name, so a read
 * through a computed key has a static type and a write through one is checked.
 */

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

test('index signatures constrain arbitrary keys', () => {
  expect(evaluated(`type Dict = { [k: string]: number };
    ({ a: 1, b: 2 } is Dict) && ({} is Dict) && !({ a: "s" } is Dict) ? "ok" : "no";`)).toBe('ok');
  // A named property coexists with an index signature.
  expect(evaluated(`type WithName = { name: string, [k: string]: number };
    ({ name: "n", x: 1 } is WithName) && !({ name: "n", x: "s" } is WithName) ? "ok" : "no";`)).toBe('ok');
});

test('index signatures are enforced at boundaries', () => {
  expectThrown('type Dict = { [k: string]: number }; let d: Dict = { a: "not a number" };');
  expect(evaluated('type Dict = { [k: string]: number }; let d: Dict = { a: 1, b: 2 }; "ok";')).toBe('ok');
});

test('index signatures participate in identity', () => {
  expect(evaluated('type A = { [k: string]: number }; type B = { [k: string]: number }; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = { [k: string]: number }; type B = { [k: string]: string }; A !== B ? "ok" : "no";')).toBe('ok');
});

test('a qualified type name resolves an enum member to that ENUMERATOR', () => {
  // `Color.Red` in type position denotes the enumerator, not the whole enum and
  // not the literal type of its value. That is what makes a discriminated union
  // carry a guarantee: `{ kind: Shape.Circle }` is satisfied by the enumerator
  // and not by any value that happens to share its number.
  expect(evaluated(`enum Color { Red, Green, Blue }
    type R = Color.Red;
    (Color.Red is R) && !(Color.Green is R) && !(R === Color) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated('enum E: string { A = "x", B = "y" } type TA = E.A; (E.A is TA) && !(E.B is TA) ? "ok" : "no";')).toBe('ok');
  // A bare value of the underlying type is not of it either, for the reason a
  // bare value is not of the enum.
  expect(evaluated('enum Color { Red, Green } type R = Color.Red; !(0 is R) ? "ok" : "no";')).toBe('ok');
  // As an annotation.
  expect(evaluated('enum E { A = 5 } let x: E.A = E.A; x == 5 ? "ok" : "no";')).toBe('ok');
  expectThrown('enum E { A = 5 } let x: E.A = 6;');
});

test('a qualified member resolves through its base, and a non-object base does not', () => {
  expect(evaluated('enum E { A } type T = E.A; (E.A is T) ? "ok" : "no";')).toBe('ok');
  // Accessing through a non-object base throws.
  expectThrown('let x = 5; let y: x.foo = 1;');
});
