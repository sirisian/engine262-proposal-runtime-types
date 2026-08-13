import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// Spec: #sec-equality-and-comparison (Equality and Comparison).
//
// Value-type identity: the values of distinct value types are distinct, so a
// typed number is never strictly equal to a plain Number nor to a value of
// another numeric type. Inheriting Number's equality would make all three
// compare equal, which is the floor this file holds.

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

test('a typed number is never strictly equal to a plain Number', () => {
  // A LITERAL takes the typed operand's type, so this is "eq". The identity
  // rule is asserted with a VARIABLE, which adopts nothing: that is
  // the comparison that asks whether a typed value and a Number are the same
  // value, and the answer is still no.
  expect(evaluated('(5 := uint8) === 5 ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('let n = 5; (5 := uint8) === n ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('5 === (5 := uint8) ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('let m = 5; m === (5 := uint8) ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('(0 := int8) === 0 ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('let z = 0; (0 := int8) === z ? "eq" : "neq";')).toBe('neq');
});

test('typed numbers of different types are not strictly equal', () => {
  expect(evaluated('(5 := uint8) === (5 := uint16) ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('(5 := uint8) === (5 := int8) ? "eq" : "neq";')).toBe('neq');
});

test('typed numbers of the same type and payload are strictly equal', () => {
  expect(evaluated('(5 := uint8) === (5 := uint8) ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('(255 := uint8) === (255 := uint8) ? "eq" : "neq";')).toBe('eq');
});

test('plain Number equality is unchanged', () => {
  expect(evaluated('5 === 5 ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('5 === 6 ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('NaN === NaN ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('0 === -0 ? "eq" : "neq";')).toBe('eq');
});

test('SameValue (Object.is) distinguishes typed numbers', () => {
  expect(evaluated('Object.is((5 := uint8), 5) ? "same" : "diff";')).toBe('diff');
  expect(evaluated('Object.is((5 := uint8), (5 := uint16)) ? "same" : "diff";')).toBe('diff');
  expect(evaluated('Object.is((5 := uint8), (5 := uint8)) ? "same" : "diff";')).toBe('same');
});

test('SameValueZero (Map/Set keying) distinguishes typed numbers', () => {
  // A typed key does not collide with a plain-Number key.
  expect(evaluated('const m = new Map(); m.set((5 := uint8), "typed"); m.set(5, "plain"); m.size === 2 ? "ok" : "no";')).toBe('ok');
  // Same-type typed keys coincide.
  expect(evaluated('const m = new Map(); m.set((5 := uint8), "a"); m.set((5 := uint8), "b"); m.size === 1 && m.get((5 := uint8)) === "b" ? "ok" : "no";')).toBe('ok');
  // Different-width typed keys are distinct.
  expect(evaluated('const s = new Set(); s.add((5 := uint8)); s.add((5 := uint16)); s.size === 2 ? "ok" : "no";')).toBe('ok');
});

test('an enumerator type admits the enumerator and nothing that merely equals it', () => {
  // `E.A` denotes the enumerator. A typed 1 is not it, and neither is a plain 1
  // - membership is the one-way rule, and `E(1)` is the way across.
  expect(evaluated('enum E { A = 1 } type T = E.A; (1 := uint8) is T ? "member" : "not";')).toBe('not');
  expect(evaluated('enum E { A = 1 } type T = E.A; 1 is T ? "member" : "not";')).toBe('not');
  expect(evaluated('enum E { A = 1 } type T = E.A; E.A is T ? "member" : "not";')).toBe('member');
  expect(evaluated('enum E { A = 1 } type T = E.A; E(1) is T ? "member" : "not";')).toBe('member');
});

test('an enum operand is read at its underlying type in a comparison', () => {
  // #sec-enums: an enum value is "usable wherever the underlying type is
  // required", and a comparison against a non-enum operand is such a position -
  // which is what makes a value read from outside the program comparable
  // against an enumerator at all.
  expect(evaluated('enum C { Zero, One } C.One === 1 ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('enum C { Zero, One } 1 === C.One ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('enum C { Zero, One } let n: int32 = 1; C.One === n ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('enum C { Zero, One } C.One === 3 ? "eq" : "neq";')).toBe('neq');
  // A `case` label is an equality position, so a switch over a value from
  // outside selects.
  expect(evaluated('enum C { Zero, One } let n: int32 = 1; let r = "no"; switch (n) { case C.One: r = "hit"; break; } r;')).toBe('hit');
  // Two DISTINCT enums establish nothing about each other's position, so they
  // stay distinct types and compare unequal even where their values agree.
  expect(evaluated('enum Color { Red } enum Size { Small } Color.Red === Size.Small ? "eq" : "neq";')).toBe('neq');
  // And a binding of the `number` type still adopts nothing, as it does for
  // every other typed value.
  expect(evaluated('enum C { Zero, One } let n = 1; C.One === n ? "eq" : "neq";')).toBe('neq');
});

// A relational operator a class does not declare is DERIVED from the one it
// does: `a > b` is `b < a`, `a <= b` is `!(b < a)`, `a >= b` is `!(a < b)`.
//
// Falling through to the abstract comparison gave WRONG answers, not missing
// ones - two objects coerce to "[object Object]", and comparing that string
// with itself makes `>` always false and `<=` and `>=` always true. Half of
// those are right by coincidence, so every case below is asserted in BOTH
// operand orders; a one-directional test passes against the bug.

test('an undeclared relational operator derives from the declared one', () => {
  const M = 'class M { constructor(v) { this.v = v; } operator <(o: M) { return this.v < o.v; } } ';
  // The declared operator, unchanged.
  expect(evaluated(`${M}String(new M(1) < new M(2));`)).toBe('true');
  expect(evaluated(`${M}String(new M(2) < new M(1));`)).toBe('false');
  // `>` was always false; the reversed order is what exposes it.
  expect(evaluated(`${M}String(new M(2) > new M(1));`)).toBe('true');
  expect(evaluated(`${M}String(new M(1) > new M(2));`)).toBe('false');
  // `<=` and `>=` were always true.
  expect(evaluated(`${M}String(new M(1) <= new M(2));`)).toBe('true');
  expect(evaluated(`${M}String(new M(2) <= new M(1));`)).toBe('false');
  expect(evaluated(`${M}String(new M(1) <= new M(1));`)).toBe('true');
  expect(evaluated(`${M}String(new M(2) >= new M(1));`)).toBe('true');
  expect(evaluated(`${M}String(new M(1) >= new M(2));`)).toBe('false');
  expect(evaluated(`${M}String(new M(1) >= new M(1));`)).toBe('true');
});

test('a declared operator takes precedence over the derivation', () => {
  // Its `>` deliberately DISAGREES with its `<`: derivation would answer true,
  // so a passing assertion proves the declaration won rather than coincided.
  const D = 'class D { constructor(v) { this.v = v; } operator <(o: D) { return this.v < o.v; } operator >(o: D) { return false; } } ';
  expect(evaluated(`${D}String(new D(2) > new D(1));`)).toBe('false');
  expect(evaluated(`${D}String(new D(1) < new D(2));`)).toBe('true');
  // A class declaring only `<=` keeps using it.
  expect(evaluated('class M { constructor(v) { this.v = v; } operator <=(o: M) { return this.v <= o.v; } } String(new M(2) <= new M(1));')).toBe('false');
});

test('the derivation reaches only classes that declare a comparison', () => {
  // A class declaring nothing keeps the abstract comparison.
  expect(evaluated('class N { constructor(v) { this.v = v; } } String(new N(1) < new N(2));')).toBe('false');
  expect(evaluated('const a = {}, b = {}; String(a > b);')).toBe('false');
  // Numbers and strings are untouched.
  expect(evaluated('String(2 > 1);')).toBe('true');
  expect(evaluated('String("b" > "a");')).toBe('true');
});

test('the declared operator is a user function', () => {
  // It may return a non-boolean, so the result is coerced before negating
  // rather than assumed.
  const B = 'class B { constructor(v) { this.v = v; } operator <(o: B) { return this.v < o.v ? 1 : 0; } } ';
  expect(evaluated(`${B}String(new B(2) >= new B(1));`)).toBe('true');
  expect(evaluated(`${B}String(new B(1) >= new B(2));`)).toBe('false');
});
