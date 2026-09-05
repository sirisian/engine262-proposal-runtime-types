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

// ---------------------------------------------------------------------------
// WIDE INTEGER TYPES ARE COMPARED EXACTLY.
//
// `uint64`, `int64`, `uint128` and `int128` carry their payload as a BigInt, so
// a value past 2^53 is held exactly - `String()` showed it and `===` compared it.
// But `==`, `!=` and every relational read the operand through `numberValue()`,
// on a recorded assumption that "a typed number always carries a Number
// payload, wide integer types included", which had stopped being true. So
// `uint64(2^53) == uint64(2^53 + 1)` was *true* and `<` between them *false*,
// while `===` between the same two values was correctly *false* and `+` was
// exact. Unary `-` read the payload the same way, so `-(-b)` came back one short.
//
// The expected values below are computed with BigInt arithmetic rather than
// written by hand, so the test cannot agree with the engine by sharing its
// mistake.
// ---------------------------------------------------------------------------

const WIDE: [string, bigint, bigint, number, boolean][] = [
  // name, min, max, bits, signed
  ['uint64', 0n, 2n ** 64n - 1n, 64, false],
  ['int64', -(2n ** 63n), 2n ** 63n - 1n, 64, true],
  ['uint128', 0n, 2n ** 128n - 1n, 128, false],
  ['int128', -(2n ** 127n), 2n ** 127n - 1n, 128, true],
];
const A = 2n ** 53n;
const B = A + 1n;

for (const [ty, min, max, bits, signed] of WIDE) {
  const M = 2n ** BigInt(bits);
  const wrap = (v: bigint) => (signed ? ((((v + M / 2n) % M) + M) % M) - M / 2n : ((v % M) + M) % M);
  const p = (v: bigint) => `${ty}.parse("${v}")`;

  test(`${ty}: equality and relationals are exact past 2^53`, () => {
    const pre = `let a = ${p(A)}; let b = ${p(B)};`;
    // The report: `a == a + 1` and `a == b` were true.
    expect(evaluated(`${pre} String(a == b);`)).toBe(String(A === B));
    expect(evaluated(`${pre} String(a != b);`)).toBe(String(A !== B));
    expect(evaluated(`${pre} String(a == a + 1);`)).toBe('false');
    // All four relationals, both orders - a first pass caught only two because
    // the other two happened to agree with the collapsed value.
    expect(evaluated(`${pre} String(a < b);`)).toBe(String(A < B));
    expect(evaluated(`${pre} String(a <= b);`)).toBe(String(A <= B));
    expect(evaluated(`${pre} String(a > b);`)).toBe(String(A > B));
    expect(evaluated(`${pre} String(a >= b);`)).toBe(String(A >= B));
    expect(evaluated(`${pre} String(b > a);`)).toBe(String(B > A));
    expect(evaluated(`${pre} String(b <= a);`)).toBe(String(B <= A));
    // What was already right stays right.
    expect(evaluated(`${pre} String(a === b);`)).toBe('false');
    expect(evaluated(`${pre} String(b - a);`)).toBe(String(B - A));
    expect(evaluated(`${pre} String(new Set([a]).has(b));`)).toBe('false');
  });

  test(`${ty}: equality is exact at the type's edges`, () => {
    expect(evaluated(`let a = ${p(max)}; let b = ${p(max - 1n)}; String(a == b);`)).toBe('false');
    expect(evaluated(`let a = ${p(max)}; let b = ${p(max - 1n)}; String(b < a);`)).toBe('true');
    expect(evaluated(`let a = ${p(min)}; let b = ${p(max)}; String(a < b);`)).toBe('true');
    expect(evaluated(`let a = ${p(max)}; String(a >= a && a <= a && a == a);`)).toBe('true');
  });

  test(`${ty}: unary minus and bitwise NOT read the exact payload`, () => {
    // The modular rule for an unsigned type is unchanged; it is now applied to
    // the value the type actually holds.
    expect(evaluated(`let a = ${p(B)}; String(-(-a) === a);`)).toBe('true');
    expect(evaluated(`let a = ${p(1n)}; String(-a);`)).toBe(String(wrap(-1n)));
    expect(evaluated(`let a = ${p(B)}; String(~a);`)).toBe(String(wrap(~B)));
  });

  test(`${ty}: == against a plain Number or BigInt is mathematical and exact`, () => {
    // `==` crosses numeric types by mathematical value (the clause on the
    // equality operators); the value 2^53 + 1 equals the BigInt and not the
    // Number 2^53, which is the nearest double.
    expect(evaluated(`let a = ${p(B)}; String(a == ${B}n);`)).toBe('true');
    expect(evaluated(`let a = ${p(B)}; String(a != ${B + 1n}n);`)).toBe('true');
    expect(evaluated(`let a = ${p(B)}; String(a == ${A});`)).toBe('false');
    expect(evaluated(`let a = ${p(B)}; String(a == NaN);`)).toBe('false');
    // A relational against a LITERAL adapts the literal to the type, and is
    // then exact.
    expect(evaluated(`let a = ${p(B)}; String(a > ${A});`)).toBe('true');
    expect(evaluated(`let a = ${p(B)}; String(a < ${B + 1n});`)).toBe('true');
  });
}

test('a relational between two different numeric types is a type error, as the clause says', () => {
  // "It is a type error if the Static Types of the operands of an arithmetic,
  // bitwise, shift, or relational operator are numeric types that are not the
  // same type." Equality is the deliberate exception; ordering is not.
  expect(run('let a = uint64.parse("5"); let b = uint128.parse("6"); a < b;')).toMatchObject({ Type: 'throw' });
  expect(run('let a = int64.parse("-1"); let b = uint64.parse("0"); a < b;')).toMatchObject({ Type: 'throw' });
  expect(run('let a = uint64.parse("5"); a < 6n;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('let a = uint64.parse("5"); let b = uint128.parse("5"); String(a == b);')).toBe('true');
});
