import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-iteration-types with #sec-type-errors. A value of a primitive
 * type is not iterable, `string` excepted - it iterates its characters. The run
 * time refused the rest with "1 (typed) is not iterable", and the operand's
 * type is written at its declaration, so the judgment is determinable.
 *
 * Deliberately narrow, for the reason callability is: an ~object~ or a
 * ~nominal~ may carry `Symbol.iterator`, and the structures here do not record
 * it, so "no iterator in the structure" would refuse a type that has one. Every
 * case is in a function that is never called.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a value of a primitive type is not iterable', () => {
  expectThrown(dead('let n: uint8 = uint8(1); for (const x of n) { }'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; for (const x of b) { }'), 'is not iterable');
  // Spreading one is the same rule at another syntax.
  expectThrown(dead('let n: uint8 = uint8(1); let a = [...n];'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; let a = [...b];'), 'is not iterable');
});

test('a string iterates its characters', () => {
  expect(ok(dead('let s: string = "x"; for (const x of s) { }'))).toBe(true);
  expect(ok(dead('let s: string = "x"; let a = [...s];'))).toBe(true);
});

test('what the rule does not reach', () => {
  // The iterables the library and the language supply.
  expect(ok(dead('let a: [].<uint8> = []; for (const x of a) { }'))).toBe(true);
  expect(ok(dead('let t: [uint8, string] = [uint8(1), "s"]; for (const x of t) { }'))).toBe(true);
  expect(ok(dead('let m: Map.<string, uint8> = new Map(); for (const x of m) { }'))).toBe(true);
  expect(ok(dead('let s: Set.<uint8> = new Set(); for (const x of s) { }'))).toBe(true);
  expect(ok(dead('function* g() { yield uint8(1); } for (const x of g()) { }'))).toBe(true);
  expect(ok(dead('for (const x of 0..<3) { }'))).toBe(true);

  // A user type declaring the method, which is why an object or nominal
  // receiver is not judged.
  expect(ok(dead('class C { [Symbol.iterator]() { return [1][Symbol.iterator](); } }'
    + ' let c: C = new C(); for (const x of c) { }'))).toBe(true);

  // The two escapes that must stay open.
  expect(ok(dead('let a: any = [1]; for (const x of a) { }'))).toBe(true);
  expect(ok(dead('let u = [1]; for (const x of u) { }'))).toBe(true);
  expect(ok(dead('function f() { for (const x of arguments) { } }'))).toBe(true);

  // OBJECT spread and destructuring are not iteration and are untouched.
  expect(ok(dead('let o: { a: uint8 } = { a: uint8(1) }; let p = { ...o };'))).toBe(true);
  expect(ok(dead('let o: { a: uint8 } = { a: uint8(1) }; let { a } = o;'))).toBe(true);
});

test('an ARRAY PATTERN iterates its initializer', () => {
  // The same judgment at a third syntax: a pattern fills its elements by
  // iterating, so a value that cannot be iterated cannot fill one.
  expectThrown(dead('let n: uint8 = uint8(1); let [x] = n;'), 'is not iterable');
  expectThrown(dead('let b: boolean = true; let [x] = b;'), 'is not iterable');
  expectThrown(dead('let n: uint8 = uint8(1); const [x, y] = n;'), 'is not iterable');

  // An ARRAY, a string and an array literal all iterate.
  expect(ok(dead('let a: [].<uint8> = []; let [x] = a;'))).toBe(true);
  expect(ok(dead('let s: string = "x"; let [x] = s;'))).toBe(true);
  expect(ok(dead('let [x] = [1, 2];'))).toBe(true);
  // An OBJECT pattern reads properties rather than iterating.
  expect(ok(dead('let o: { x: uint8 } = { x: uint8(1) }; let { x } = o;'))).toBe(true);
  // A destructured PARAMETER is bound by the call, not by an initializer here.
  expect(ok(dead('function f([x]: [].<uint8>) { }'))).toBe(true);
});
