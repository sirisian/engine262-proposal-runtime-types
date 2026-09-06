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

// ---------------------------------------------------------------------------
// A LITERAL IN ARITHMETIC IS READ BEFORE ROUNDING.
//
// README, "Four things remain implicit": a literal takes the type of its
// context; a `const` of a numeric constant "behaves as if inlined" and "the
// initializer may compute"; and "one that doesn't fit is a compile-time
// TypeError rather than a silent truncation". Two paths lost the literal's
// digits: a literal OPERAND beside a typed value took the type but was read as
// the double the lexer produced, and a constant EXPRESSION at a typed position
// was computed in Number before the type was consulted.
//
// The checker had no arm for any arithmetic expression, which is why neither
// path could be right: nothing typed the operator, so nothing could hand a
// literal its type or fold a constant. Expected values are BigInt arithmetic.
// ---------------------------------------------------------------------------

const P53 = 2n ** 53n;
const Q53 = P53 + 1n;

test('a constant arithmetic expression takes the contextual type and is exact - the report', () => {
  const want = String(P53 + Q53);
  expect(evaluated(`let b: uint64 = ${P53} + ${Q53}; String(b);`)).toBe(want);
  expect(evaluated(`function f(a: uint64) { return a; } String(f(${P53} + ${Q53}));`)).toBe(want);
  expect(evaluated(`function g(): uint64 { return ${P53} + ${Q53}; } String(g());`)).toBe(want);
  expect(evaluated(`type O = { v: uint64 }; let o: O = { v: ${P53} + ${Q53} }; String(o.v);`)).toBe(want);
  expect(evaluated(`const m = new Map.<string, uint64>(); m.set("k", ${P53} + ${Q53}); String(m.get("k"));`)).toBe(want);
});

test('the constant is folded FIRST and checked against the type - no silent wrap', () => {
  // `uint8(200) + uint8(100)` wraps to 44 at run time. Had the type been
  // propagated to each literal and the sum computed in the type, this would be
  // a silent 44; folded first it is the compile-time error the README promises.
  expect(run('let x: uint8 = 200 + 100;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('try { eval("let x: uint8 = 200 + 100;"); "ok"; } catch (e) { e.constructor.name; }')).toBe('StaticTypeError');
  expect(evaluated('let x: uint8 = 1 + 2; String(x);')).toBe('3');
  // The EXPRESSION's value is what takes the type; a subexpression that would
  // not fit on its own is not a value of anything.
  expect(evaluated('let x: uint8 = 300 - 100; String(x);')).toBe('200');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 300 - 299); String(m.get("a"));')).toBe('1');
  expect(evaluated('let x: int8 = -128; String(x);')).toBe('-128');
  expect(evaluated('let x: int8 = -(100 + 28); String(x);')).toBe('-128');
  expect(evaluated('let x: uint8 = 2 ** 8 - 1; String(x);')).toBe('255');
  expect(run('let x: uint8 = 2 ** 8;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('let x: uint64 = 10 ** 19; String(x);')).toBe(String(10n ** 19n));
  expect(run('let x: uint64 = 2 ** 64;')).toMatchObject({ Type: 'throw' });
  // An inexact quotient is not an integer and is not folded.
  expect(evaluated('let x: uint8 = 8 / 2; String(x);')).toBe('4');
});

for (const ty of ['uint64', 'int64', 'uint128', 'int128']) {
  test(`${ty}: a literal operand takes the other operand's type EXACTLY, every operator`, () => {
    // "An operand of a binary operator whose other operand has a known value
    // type -> the type of the other operand", read "before any rounding".
    const A = 2n ** 54n + 1n;
    const L = Q53;
    const pre = `let a: ${ty} = ${A};`;
    expect(evaluated(`${pre} String(a + ${L});`)).toBe(String(A + L));
    expect(evaluated(`${pre} String(${L} + a);`)).toBe(String(L + A));
    expect(evaluated(`${pre} String(a - ${L});`)).toBe(String(A - L));
    expect(evaluated(`${pre} String(a % ${L});`)).toBe(String(A % L));
    expect(evaluated(`${pre} String(a & ${L});`)).toBe(String(A & L));
    expect(evaluated(`${pre} String(a | ${L});`)).toBe(String(A | L));
    expect(evaluated(`${pre} String(a ^ ${L});`)).toBe(String(A ^ L));
    expect(evaluated(`${pre} String(a >> 1);`)).toBe(String(A >> 1n));
    // Through parentheses, and as a bare statement or an untyped call's
    // argument - a literal's type does not depend on where its expression stands.
    expect(evaluated(`${pre} String(a + (${L}));`)).toBe(String(A + L));
    expect(evaluated(`${pre} let r; r = a + ${L}; String(r);`)).toBe(String(A + L));
  });
}

test('a literal that cannot take the other operand\'s type is a compile-time error', () => {
  // The README's own example: `a + 300` at a `uint8`.
  expect(evaluated('try { eval("let a: uint8 = 200; a + 300;"); "ok"; } catch (e) { e.constructor.name; }')).toBe('StaticTypeError');
  expect(evaluated('let a: uint8 = 200; String(a + 1);')).toBe('201');
});

test('typed arithmetic has a Static Type, so its result is checked where it goes', () => {
  // With no arm for arithmetic every `a + b` was ~any~, and `let s: string =
  // a + 1` was accepted - `s` became the STRING "2".
  expect(run('let a: uint8 = 1; let s: string = a + 1;')).toMatchObject({ Type: 'throw' });
  expect(run('let a: uint8 = 1; let b: uint16 = 2; let c = a + b;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('let a: uint8 = 1; let b: uint8 = 2; let c: uint8 = a + b; String(c);')).toBe('3');
  // Untyped arithmetic is untouched.
  expect(evaluated('let x = 1 + 2; String(x);')).toBe('3');
  expect(evaluated('let s = "a" + 1; String(s);')).toBe('a1');
});

test('a const of a numeric constant behaves as if inlined - exactly, at any width', () => {
  // README: "A const of a numeric constant behaves as if inlined ... The
  // initializer may compute ... and so does a chain of such constants." The
  // binding itself holds a Number - `typeof K` is 'number', `K` alone prints
  // the rounded value - so a USE of it at a wide type has to fold to the exact
  // value of the initializer rather than read the binding. It read the binding.
  const K = Q53;
  expect(evaluated(`const K = ${K}; let b: uint64 = K; String(b);`)).toBe(String(K));
  expect(evaluated(`const K = ${P53} + ${Q53}; let b: uint64 = K; String(b);`)).toBe(String(P53 + Q53));
  expect(evaluated(`const A = ${P53}; const B = ${Q53}; let b: uint64 = A + B; String(b);`)).toBe(String(P53 + Q53));
  expect(evaluated(`const A = ${P53}; const B = A + 1; const C = A + B; let b: uint64 = C; String(b);`)).toBe(String(P53 + Q53));
  // As the literal operand beside a typed value.
  expect(evaluated(`const K = ${K}; let a: uint64 = 1; String(a + K);`)).toBe(String(1n + K));
  // The README's own refusal, now the compile-time error it describes.
  expect(evaluated('try { eval("const K = 300; let x: uint8 = K;"); "ok"; } catch (e) { e.constructor.name; }')).toBe('StaticTypeError');
  // Nothing about the binding changes: untyped use is a Number.
  expect(evaluated(`const K = ${K}; String(typeof K);`)).toBe('number');
  // A narrow constant and a float constant are as they were.
  expect(evaluated('const K = 3; let x: uint8 = K; String(x);')).toBe('3');
  expect(evaluated('const K = 3.14; let f: float64 = K; String(f);')).toBe('3.14');
  // A shadowing `let` is not constant.
  expect(evaluated('const K = 5; { let K = 7; let x: uint8 = K; String(x); }')).toBe('7');
});

// ---------------------------------------------------------------------------
// A LITERAL BESIDE A DECIMAL TAKES THE DECIMAL TYPE, ON ITS SOURCE DIGITS.
//
// decimal.md: "a decimal literal is read from its source digits directly, not
// routed through a binary float64", "in a decimal context the literal 0.1 is
// the decimal one tenth", and "the literal 3 takes the decimal type". Two things
// stood in the way. The decimal type records carry the width IN the name -
// `decimal64`, where the integer records are `uint` AT 64 - so the value-type
// predicate never matched them and `a + 0.2` beside a decimal was refused with
// "a decimal operand requires a decimal on both sides". And there was no decimal
// constant fold, so `0.1 + 0.2` at a decimal type was computed in Number and
// `0.30000000000000004` was refused at the boundary.
// ---------------------------------------------------------------------------

for (const ty of ['decimal64', 'decimal128']) {
  test(`${ty}: a literal operand takes the decimal type and is exact`, () => {
    expect(evaluated(`let a: ${ty} = 0.1; String(a + 0.2);`)).toBe('0.3');
    expect(evaluated(`let a: ${ty} = 0.1; String(0.2 + a);`)).toBe('0.3');
    expect(evaluated(`let a: ${ty} = 1.1; String(a * 3);`)).toBe('3.3');
    expect(evaluated(`let a: ${ty} = 1.0; String(a - 0.9);`)).toBe('0.1');
    expect(evaluated(`let a: ${ty} = 0.1; String((a + 0.2) is ${ty});`)).toBe('true');
    // A value of another type still does not convert on its own (decimal.md).
    expect(run(`let a: ${ty} = 0.1; let n: uint8 = 2; a + n;`)).toMatchObject({ Type: 'throw' });
  });

  test(`${ty}: a constant expression at the type is folded on its digits`, () => {
    expect(evaluated(`let b: ${ty} = 0.1 + 0.2; String(b);`)).toBe('0.3');
    expect(evaluated(`let b: ${ty} = 1.1 * 3; String(b);`)).toBe('3.3');
    expect(evaluated(`let b: ${ty} = -(0.1 + 0.2); String(b);`)).toBe('-0.3');
    expect(evaluated(`function f(v: ${ty}) { return v; } String(f(0.1 + 0.2));`)).toBe('0.3');
    expect(evaluated(`function g(): ${ty} { return 0.1 + 0.2; } String(g());`)).toBe('0.3');
    // A `const` of a decimal constant behaves as if inlined, and a chain does.
    expect(evaluated(`const K = 0.1; let b: ${ty} = K; String(b);`)).toBe('0.1');
    expect(evaluated(`const K = 0.2; let a: ${ty} = 0.1; String(a + K);`)).toBe('0.3');
    expect(evaluated(`const A = 0.1; const B = A + 0.2; let b: ${ty} = B; String(b);`)).toBe('0.3');
    // An integer constant serves as a decimal too.
    expect(evaluated(`const K = 3; let a: ${ty} = 1.1; String(a * K);`)).toBe('3.3');
  });
}

test('decimal128 keeps 34 digits through a literal and a fold', () => {
  expect(evaluated('let a: decimal128 = 1.234567890123456789012345678901234; String(a);')).toBe('1.234567890123456789012345678901234');
  expect(evaluated('let a: decimal128 = 1.234567890123456789012345678901234 + 0; String(a);')).toBe('1.234567890123456789012345678901234');
});
