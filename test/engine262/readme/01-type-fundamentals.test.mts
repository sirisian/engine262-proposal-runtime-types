import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectError, expectErrorFlagOff } from './harness.mts';

/**
 * README feature coverage — the type-system fundamentals.
 * Sections: Types Proposed, Variable Declaration With Type, typeof, instanceof,
 * Union and Nullable Types, Intersection types, Type Aliases and Recursion,
 * Literal Types, any Type.
 */

// ── Types Proposed ────────────────────────────────────────────────────────────
// The proposal adds number/boolean/string/object/symbol/bigint, the sized
// integer families int.<N>/uint.<N> with their shorthands, the floats, and the
// SIMD vector shorthands built on vector.<T, N>. Each name must resolve to an
// interned type in type position.
test('Types Proposed: the primitive and numeric type names resolve', () => {
  for (const name of ['number', 'boolean', 'string', 'object', 'symbol', 'bigint', 'any', 'never']) {
    expect(ok(`type T = ${name}; typeof T;`), name).toBe(true);
  }
  for (const name of ['int8', 'int16', 'int32', 'int64', 'int128', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'float16', 'float32', 'float64']) {
    expect(ok(`type T = ${name}; typeof T;`), name).toBe(true);
  }
});

test('Types Proposed: int/uint shorthands intern to their int.<N> expansions', () => {
  expect(bool('type A = int8; type B = int.<8>; String(A === B);')).toBe(true);
  expect(bool('type A = int32; type B = int.<32>; String(A === B);')).toBe(true);
  expect(bool('type A = uint8; type B = uint.<8>; String(A === B);')).toBe(true);
  expect(bool('type A = uint128; type B = uint.<128>; String(A === B);')).toBe(true);
  // boolean1 is uint.<1>
  expect(bool('type A = boolean1; type B = uint.<1>; String(A === B);')).toBe(true);
  // distinct widths are distinct types
  expect(bool('type A = uint8; type B = uint16; String(A === B);')).toBe(false);
});

test('Types Proposed: arbitrary-width int.<N> is accepted across the range', () => {
  // N runs 1..2^16; check a spread including non-shorthand widths
  for (const n of [1, 3, 7, 24, 40, 96, 256, 1000]) {
    expect(ok(`type T = uint.<${n}>; typeof T;`), `uint.<${n}>`).toBe(true);
  }
});

// ── Variable Declaration With Type ────────────────────────────────────────────
// `var`/`let`/`const` all accept `: Type`. A typed declaration without an
// initializer takes the type's default (0, '', false, ...), not undefined.
test('Variable Declaration: var/let/const accept annotations', () => {
  expect(evaluated('let a: uint32 = 5; a;')).toBe('5');
  expect(evaluated('const c: string = "hi"; c;')).toBe('hi');
  expect(ok('var v: boolean = true; v;')).toBe(true);
});

test('Variable Declaration: typed let without initializer takes the default; const stays required', () => {
  // A typed `let` with no initializer takes the type's default (DefaultValueOf):
  // numeric 0, '' for string, false for boolean, null for a nullable union.
  expect(evaluated('let d: uint32; d + 1;')).toBe('1'); // default 0
  expect(evaluated('let s: string; s + "x";')).toBe('x'); // default ''
  expect(evaluated('let b: boolean; String(b);')).toBe('false'); // default false
  expect(evaluated('let n: bigint; String(n === 0n);')).toBe('true'); // default 0n
  expect(evaluated('let x: uint8 | null; String(x === null);')).toBe('true'); // nullable -> null
  // Per the normative spec, a `const` without an initializer remains a Syntax
  // Error whether or not it is typed (the README prose is superseded here).
  expectError('const d: uint32; d;');
  // A type with no meaningful zero (symbol) has no default; a let of it without
  // an initializer stays undefined rather than inventing a value.
  expect(evaluated('let sy: symbol; String(sy === undefined);')).toBe('true');
});

// ── typeof Operator ───────────────────────────────────────────────────────────
// typeof is essentially unchanged: numeric types report "number"; a function
// reports "function"; an array reports "object".
test('typeof: numeric types report "number", functions "function", arrays "object"', () => {
  expect(evaluated('let a: uint8 = 0; typeof a;')).toBe('number');
  expect(evaluated('let b: float64 = 1; typeof b;')).toBe('number');
  expect(evaluated('let d: (uint8) => uint8 = x => x; typeof d;')).toBe('function');
  expect(evaluated('let c: [].<uint8> = []; typeof c;')).toBe('object');
});

// ── instanceof Operator ───────────────────────────────────────────────────────
// Type objects implement Symbol.hasInstance; instanceof is a subtype test
// against the value's runtime type. A fixed-length array is an instance of the
// variable-length array of the same element; a distinct width is not a member.
test('instanceof: membership by runtime type; width distinctions hold', () => {
  expect(evaluated('let a: uint8 = 0; String(a instanceof uint8);')).toBe('true');
  expect(evaluated('let a: uint8 = 0; String(a instanceof uint16);')).toBe('false');
});

test('instanceof: a typed function is an instance of its signature type and Function', () => {
  expect(evaluated('type F = (uint8) => uint8; const f = (x: uint8): uint8 => x; String(f instanceof F);')).toBe('true');
  expect(evaluated('const f = (x: uint8): uint8 => x; String(f instanceof Function);')).toBe('true');
});

// ── Union and Nullable Types ──────────────────────────────────────────────────
// All types except any are non-nullable; a union admits its arms. A non-nullable
// value type is not a supertype of null (a type-level fact), and a null
// initializer converts at the `:=` boundary.
test('Union/Nullable: a nullable union admits null; null is not assignable to a non-nullable type', () => {
  expect(evaluated('let a: uint8 | null = null; String(a === null);')).toBe('true');
  expect(ok('let a: uint8 | string = "a"; a;')).toBe(true);
  // null is not assignable to a non-nullable numeric type, but is to the nullable
  // union. (Operands are aliased: an inline `type null` in a call argument
  // alongside a union does not parse in expression position.)
  expect(bool('type NullT = null; String(Reflect.isAssignable(NullT, uint8));')).toBe(false);
  expect(bool('type NullT = null; type NU = uint8 | null; String(Reflect.isAssignable(NullT, NU));')).toBe(true);
});

test('Union: canonicalization flattens, deduplicates, and orders arms', () => {
  expect(bool('type U1 = uint8 | string | uint8; type U2 = string | uint8; String(U1 === U2);')).toBe(true);
  expect(bool('type U1 = (uint8 | string) | uint16; type U2 = uint16 | (string | uint8); String(U1 === U2);')).toBe(true);
});

// ── Intersection types ────────────────────────────────────────────────────────
// An intersection is a subtype of each of its members; a merged object type is
// assignable to the intersection; and `& never` collapses to never.
test('Intersection: subtype of each member; merged object assignable to it; & never collapses', () => {
  expect(bool('type T = { a: uint8 } & { b: string }; type M = { a: uint8 }; String(Reflect.isAssignable(T, M));')).toBe(true);
  expect(bool('type T = { a: uint8 } & { b: string }; type E = { a: uint8, b: string }; String(Reflect.isAssignable(E, T));')).toBe(true);
  expect(bool('type N = never; type M = uint8 & never; String(N === M);')).toBe(true);
});

// ── Type Aliases and Recursion ────────────────────────────────────────────────
test('Type Aliases: alias resolves to the same interned type', () => {
  expect(bool('type A = uint8; type B = A; String(A === B);')).toBe(true);
  expect(bool('type A = uint8; type B = uint8; String(A === B);')).toBe(true);
});

// ── Literal Types ─────────────────────────────────────────────────────────────
// A literal type has one value and is a subtype of its base. Same literal interns
// to one type; the `type` operator produces the literal type of a value.
test('Literal Types: a literal type is singular and interns by value', () => {
  expect(bool("type A = 'hello'; type B = 'hello'; String(A === B);")).toBe(true);
  expect(bool("type A = 'hello'; type B = 'world'; String(A === B);")).toBe(false);
  expect(bool('type A = 42; type B = 42; String(A === B);')).toBe(true);
  // the `type` operator on a value yields that value's literal type
  expect(bool("type H = 'hello'; String(type 'hello' === H);")).toBe(true);
  // a literal is a subtype of its base (assignable to it)
  expect(bool("String(Reflect.isAssignable(type 'hello', string));")).toBe(true);
});

// ── any Type ──────────────────────────────────────────────────────────────────
// any is the one nullable type and the top of assignability: everything is
// assignable to any.
test('any Type: everything is assignable to any', () => {
  expect(bool('String(Reflect.isAssignable(uint32, any));')).toBe(true);
  expect(bool('String(Reflect.isAssignable(string, any));')).toBe(true);
  expect(bool('type T = { a: uint8 }; String(Reflect.isAssignable(T, any));')).toBe(true);
});

// ── Backwards compatibility: the whole syntax is gated ────────────────────────
test('feature off: typed declarations stay a syntax error', () => {
  expectErrorFlagOff('let a: uint32 = 5; a;');
  expectErrorFlagOff('type A = uint8; A;');
});
