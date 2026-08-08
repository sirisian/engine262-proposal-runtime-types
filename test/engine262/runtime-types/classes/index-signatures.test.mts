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

test('qualified type names resolve enum members to literal types', () => {
  // An enum member used as a type is the literal type of that member's value.
  expect(evaluated(`enum Color { Red, Green, Blue }
    type R = Color.Red;
    (0 is R) && !(1 is R) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated('enum E { A = "x", B = "y" } type TA = E.A; ("x" is TA) && !("y" is TA) ? "ok" : "no";')).toBe('ok');
  // As an annotation.
  expect(evaluated('enum E { A = 5 } let x: E.A = 5; x == 5 ? "ok" : "no";')).toBe('ok');
  expectThrown('enum E { A = 5 } let x: E.A = 6;');
});

test('a nonexistent qualified member is not a type', () => {
  expect(evaluated('enum E { A } type T = E.A; (0 is T) ? "ok" : "no";')).toBe('ok');
  // Accessing through a non-object base throws.
  expectThrown('let x = 5; let y: x.foo = 1;');
});
