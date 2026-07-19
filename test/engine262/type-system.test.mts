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

test('type aliases bind interned Type Objects', () => {
  expect(evaluated('type A = uint8; type B = uint8; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = uint8; type B = A; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = uint8; type B = uint16; A === B ? "same" : "different";')).toBe('different');
});

test('shorthands intern to their expansions', () => {
  expect(evaluated('type A = int8; type B = int.<8>; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = boolean1; type B = uint.<1>; A === B ? "same" : "different";')).toBe('same');
});

test('canonicalization: flattening, deduplication, ordering, never', () => {
  expect(evaluated('type U1 = uint8 | string | uint8; type U2 = string | uint8; U1 === U2 ? "same" : "different";')).toBe('same');
  expect(evaluated('type U1 = (uint8 | string) | uint16; type U2 = uint16 | (string | uint8); U1 === U2 ? "same" : "different";')).toBe('same');
  expect(evaluated('type S = uint8 | uint8; type A = uint8; S === A ? "same" : "different";')).toBe('same');
  expect(evaluated('type N = never; type M = uint8 & never; N === M ? "same" : "different";')).toBe('same');
});

test('instanceof is IsOfType membership', () => {
  // #sec-value-types: numeric value types have their own values; a plain
  // Number is no longer a member, and membership follows the constructed
  // value's own type.
  expect(evaluated(`type T = uint8;
    ((5 := T) instanceof T) && !(5 instanceof T) && !("x" instanceof T) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated('((7 := uint8) instanceof uint16) ? "no" : "ok";')).toBe('ok');
  expect(evaluated('type S = string; ("hi" instanceof S) && !(5 instanceof S) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type L = "on"; ("on" instanceof L) && !("off" instanceof L) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type U = uint8 | string; ((7 := uint8) instanceof U) && ("s" instanceof U) && !(true instanceof U) ? "ok" : "no";')).toBe('ok');
});

test('array and tuple membership', () => {
  expect(evaluated('type A = [].<number>; ([1, 2] instanceof A) && !([1, "x"] instanceof A) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type B = [].<uint8>; ([(1 := uint8), (2 := uint8)] instanceof B) && !([1, 2] instanceof B) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type F = [2].<number>; ([1, 2] instanceof F) && !([1] instanceof F) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type P = [number, string]; ([1, "a"] instanceof P) && !(["a", 1] instanceof P) ? "ok" : "no";')).toBe('ok');
});

test('unresolvable and unsupported types throw', () => {
  expectThrown('type X = notDefined;');
  expectThrown('type O = 3i;'); // imaginary literal types remain unsupported
});

test('object types are structural', () => {
  expect(evaluated(`type P = { x: number, y?: string };
    ({ x: 1 } is P) && ({ x: 1, y: "s" } is P) && !({ y: "s" } is P) && !({ x: "s" } is P) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated('type P = { x: number }; function f() { return { x: "s" }; } try { let p: P = f(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('type A = { x: number }; type B = { x: number }; A === B ? "same" : "different";')).toBe('same');
});

test('function types and callability', () => {
  expect(evaluated('type F = (a: number) => string; ((x) => x) is F ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type F = (a: number) => string; (5 is F) ? "no" : "ok";')).toBe('ok');
});

test('computed array extents evaluate', () => {
  expect(evaluated('const n = 1 + 1; type F = [n].<number>; ([1, 2] instanceof F) && !([1] instanceof F) ? "ok" : "no";')).toBe('ok');
});

test('computed types call their builder', () => {
  expect(evaluated('function pick() { return uint8; } type C = pick(); C === uint8 ? "same" : "different";')).toBe('same');
  expect(evaluated('function bad() { return 5; } try { type C = bad(); "no"; } catch (e) { "caught"; }')).toBe('caught');
});
