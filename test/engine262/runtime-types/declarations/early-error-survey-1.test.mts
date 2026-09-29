import { test, expect } from 'vitest';
import {
  evaluated, expectEarlyError, expectStaticTypeError, expectThrownKind, ok,
} from '../harness.mts';

/**
 * Early errors the specification states: each test pins one "it is a type error if" or
 * "is a Syntax Error" sentence of spec.emu that the checker raises before the source
 * runs, grouped by the clause that states it.
 */

// ---- #sec-integer-operations: a zero divisor in either spelling ----

test('a zero divisor written as a call-form conversion is refused', () => {
  // "It is a type error if the divisor of `/` or `%` is a literal zero, or an
  // explicit conversion of one to an integer type"; #sec-explicit-conversion:
  // `uint8(v)` and `v := uint8` "are the same operation".
  expectStaticTypeError('let a: uint8 = 4; let b = a / uint8(0);');
  expectStaticTypeError('let a: int32 = 4; let b = a % int32(0);');
  expectStaticTypeError('let a: uint8 = 4; a /= uint8(0);');
  expectStaticTypeError('let a: uint8 = 4; let b = a / (0 := uint8);');
  expect(evaluated('let a: uint8 = 4; String(a / uint8(2));')).toBe('2');
  // A divisor read from a binding is a run-time question, as before.
  expectThrownKind('let a: uint8 = 4; let z: uint8 = 0; a / z;', 'RangeError');
});

test('a zero divisor named by a constant of the operand type is refused', () => {
  // The divisor and shift rules read one constant: a literal, a `const` chain, an explicit
  // conversion of either, or a `const` of an integer value type.
  expectStaticTypeError('let a: uint8 = 4; const Z: uint8 = 0; let b = a / Z;');
  expectStaticTypeError('let a: uint8 = 4; const Z = 0; let b = a % Z;');
  expect(evaluated('let a: uint8 = 4; const D: uint8 = 2; String(a / D);')).toBe('2');
});

test('a shift distance follows the divisor rule through conversions and typed constants', () => {
  expectStaticTypeError('let a: uint8 = 4; let b = a << uint8(8);');
  expectStaticTypeError('let a: uint8 = 4; let b = a << (8 := uint8);');
  expectStaticTypeError('let a: uint8 = 4; let b = a >> (-1 := int8);');
  expectStaticTypeError('let a: uint8 = 4; const K: uint8 = 8; let b = a << K;');
  expect(evaluated('let a: uint8 = 4; const K: uint8 = 2; String(a << K);')).toBe('16');
  // A conversion is folded THROUGH its wrap: `uint8(256)` is the distance 0
  // the run time shifts by, and `(-1 := uint8)` is 255.
  expect(evaluated('let a: uint8 = 4; String(a << uint8(256));')).toBe('4');
  expectStaticTypeError('let a: uint8 = 4; let b = a << (-1 := uint8);');
});

// ---- #sec-match-exhaustiveness: the catch-all half -----------------------------

test('a match over a subject with no atoms needs a catch-all', () => {
  // "A `match` is exhaustive when it has a catch-all clause, or when the atoms
  // of its subject's Static Type are not ~none~ and every atom is covered by
  // some clause. It is a type error for a `match` not to be exhaustive."
  expectStaticTypeError('let x: uint8 = 2; let r = match (x) { when 1: 0; };');
  expectStaticTypeError('let s: string = "b"; let r = match (s) { when "a": 0; };');
  expectStaticTypeError('let t: type = uint8; let r = match (t) { when ${uint8}: 0; };');
  // An unsealed class is an open set: a subclass arm leaves the base's other
  // values uncovered, while a type pattern naming the class itself narrows
  // the subject to nothing and so covers it.
  expectStaticTypeError('class P { x: uint8 = 1; } class Q extends P {} let p: P = new P(); let r = match (p) { when Q: 0; };');
  expect(ok('class P { x: uint8 = 1; } let p: P = new P(); let r = match (p) { when P: 0; };')).toBe(true);
  // A guarded binding is refutable, so it is not a catch-all; an annotated
  // binding at the subject's own type covers it by narrowing.
  expectStaticTypeError('let x: uint8 = 2; let r = match (x) { when let v if (v > 1): v; };');
  expect(ok('let x: uint8 = 2; let r = match (x) { when let v: uint8: v; };')).toBe(true);
});

test('coverage established by narrowing satisfies the rule too', () => {
  // A literal subject a literal pattern names, and a subject the unguarded
  // patterns leave nothing of, hold no value without a clause; the spec's
  // sentence names atoms only, and this is its companion reading.
  expect(evaluated('String(match (1) { when 1: 5; });')).toBe('5');
  expect(evaluated('String(match (1 + 1) { when 2: 5; });')).toBe('5');
  expect(evaluated('String(match ("a") { when "a": 1; });')).toBe('1');
  expect(evaluated('let x: 1 = 1; String(match (x) { when 1: 0; });')).toBe('0');
  expectStaticTypeError('let r = match (5) { when 1: 1; };');
  expectStaticTypeError('let r = match (99) { when 1: "a"; when 2: "b"; };');
});

test('each catch-all form the clause names satisfies the rule', () => {
  expect(evaluated('let x: uint8 = 2; String(match (x) { when 1: 0; default: 9; });')).toBe('9');
  expect(evaluated('let x: uint8 = 2; String(match (x) { when 1: 0; when _: 9; });')).toBe('9');
  expect(evaluated('let x: uint8 = 2; String(match (x) { when 1: 0; when let v: v; });')).toBe('2');
  expect(evaluated('let x: uint8 = 2; String(match (x) { when let v: any: v; });')).toBe('2');
  expect(evaluated('let x: uint8 = 2; String(match (x) { when 1 or _: 9; });')).toBe('9');
  expect(evaluated('let x: uint8 = 2; String(match (x) { when let a and let b: a; });')).toBe('2');
});

test('the catch-all rule leaves untyped subjects, `match all`, and atom-bearing subjects alone', () => {
  // An ~any~ subject keeps the run time's TypeError as its backstop, as the clause's note
  // says for "an untyped subject".
  expect(evaluated('let x = 5; String(match (x) { when 5: 0; });')).toBe('0');
  expectThrownKind('let x = 6; match (x) { when 5: 0; };', 'TypeError');
  expect(ok('let x: uint8 = 2; let r = match all (x) { when 1: 0; };')).toBe(true);
  expect(evaluated('let x: boolean = true; String(match (x) { when true: 0; when false: 1; });')).toBe('0');
  expect(evaluated('let x: uint8 | string = 1; String(match (x) { when uint8: 0; when string: 1; });')).toBe('0');
  expect(ok('function f<T: type>(v: T): uint8 { return match (v) { when let n: uint8: n; default: 0; }; }')).toBe(true);
});

// ---- #sec-function-types: the parenthesized-type cover ------------------------

test('the parenthesized-type cover refuses an initializer and admits a reference type', () => {
  // "it is a type error if the cover does not match that refinement": a
  // FunctionTypeParameter's Initializer is not part of a Type.
  expectEarlyError('let x: (uint8 = 1);', 'SyntaxError');
  expectEarlyError('let x: (a: uint8 = 1);', 'SyntaxError');
  expect(ok('type F = (uint8 = 1) => void;')).toBe(true);
  expect(evaluated('let x: (uint8) = 1; String(x);')).toBe('1');
  // `ref` PrimaryType is a ReferenceType, itself a PrimaryType, so `(ref uint8)` is a
  // well-formed `( Type )` that the cover admits.
  expect(ok('type R = (ref uint8);')).toBe(true);
  expect(evaluated('let r: (ref uint8) | null = null; String(r);')).toBe('null');
  expect(ok('type F = ((ref uint8)) => void;')).toBe(true);
});

// ---- #sec-user-defined-conversions: ambiguity at the use site --------------------

test('two applicable conversions of one form with no more specific one are refused', () => {
  // "It is a type error if two conversions of the same form apply and neither is more
  // specific." The direct `new T(c)` reports this through ResolveOverload, and the
  // implicit boundary reports it too.
  const shapes = 'interface I1 { a: uint8 } interface I2 { b: uint8 } class C implements I1, I2 { a: uint8 = 1; b: uint8 = 2; } ';
  const operators = 'class T { operator T(v: I1) { return new T(); } operator T(v: I2) { return new T(); } } ';
  const constructors = 'class T { constructor(v: I1) {} constructor(v: I2) {} } ';
  expectStaticTypeError(`${shapes}${operators}let c: C = new C(); let t: T = c;`);
  expectStaticTypeError(`${shapes}${constructors}let c: C = new C(); let t: T = c;`);
  expectStaticTypeError(`${shapes}${operators}function f(t: T): void {} let c: C = new C(); f(c);`);
  expectStaticTypeError(`${shapes}${operators}function g(c: C): T { return c; }`);
});

test('a more specific conversion, or one of each form, resolves', () => {
  expect(ok('class A { x: uint8 = 1; } class B extends A {} class T { operator T(v: A) { return new T(); } operator T(v: B) { return new T(); } } let b: B = new B(); let t: T = b;')).toBe(true);
  // Statically one of two operators applies; which one the run time selects is a separate
  // matter (it currently picks by declaration order), so only the judgment is asserted.
  expect(ok('class A { x: uint8 = 1; } class T { operator T(v: A) { return new T(); } operator T(v: string) { return new T(); } } function g(a: A): T { return a; }')).toBe(true);
  // "When both a converting constructor and a declared conversion could apply
  // to the same pair, the constructor is preferred": two forms, no ambiguity.
  expect(ok('class S { x: uint8 = 1; } class T { constructor(v?: S) {} operator T(v: S) { return new T(); } } let s: S = new S(); let t: T = s;')).toBe(true);
});

// ---- #sec-proved-library-operations: the intrinsic-origin effect screen's reach ----

test('the seed judgment survives ordinary typed code around the construction', () => {
  // Ordinary typed code around the construction - `+`, `.length`, `++`, a call of a known
  // function - does not stand an intrinsic-origin proof down (#sec-proved-library-operations).
  expectStaticTypeError('let q: uint8 = 1; let w = q + q; const s = new Set.<uint8>(["a"]);');
  expectStaticTypeError('let xs: [].<uint8> = []; let n = xs.length; let e = xs[0]; const s = new Set.<uint8>(["a"]);');
  expectStaticTypeError('let q: uint8 = 1; String(q); const s = new Set.<uint8>(["a"]);');
  expectStaticTypeError('let s: string = "x"; let n = s.length; let t = "a" + s; const x = new Set.<uint8>([300]);');
  expectStaticTypeError('let q: uint8 = 1; for (let i: uint8 = 0; i < q; i++) { q += 1; } const x = new Set.<uint8>([300]);');
  expectStaticTypeError('const m = new Map.<string, uint8>([["a", "b"]]); let q: uint8 = 1; q++;');
  expectStaticTypeError('let p = new Promise.<uint8>((resolve) => resolve("a")); let q: uint8 = 1; let w = q * 2;');
});

test('an effect that cannot run before the construction does not count', () => {
  // A function declared but never named on the prefix, and a call after the
  // construction, cannot replace the intrinsic before it runs.
  expectStaticTypeError('function later() { let o = {}; let w = o + 1; } const s = new Set.<uint8>(["a"]);');
  expectStaticTypeError('const s = new Set.<uint8>(["a"]); let t = [1, 2].map((x) => x);');
  expectStaticTypeError('function g() { Set.prototype.add = function () {}; } const s = new Set.<uint8>(["a"]); g();');
});

test('an effect that can run before the construction still stands the proof down', () => {
  // The proof stays sound: user code reachable before the site, directly or
  // through another local function, and an operation over an operand of
  // unknown type, each retain the run-time check.
  // The replaced adder stores nothing, so the construction that would have
  // been refused early runs and holds an empty set: no Early Error, no throw.
  expect(evaluated('function g() { Set.prototype.add = function () {}; } g(); const s = new Set.<uint8>(["a"]); String(s.size);')).toBe('0');
  expect(evaluated('function g() { Set.prototype.add = function () {}; } function h() { g(); } h(); const s = new Set.<uint8>(["a"]); String(s.size);')).toBe('0');
  expectThrownKind('let o = {}; let w = o + 1; const s = new Set.<uint8>(["a"]);', 'TypeError');
  expect(evaluated('let o = { valueOf() { Set.prototype.add = function () {}; return 1; } }; let w = o + 1; const s = new Set.<uint8>(["a"]); String(s.size);')).toBe('0');
});
