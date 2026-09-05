import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * The compatibility bound, asserted as behaviour.
 *
 * `sec-overloading-of-the-standard-library` states the rule and names the
 * casualties it exists to prevent: "a function with no numeric parameter has
 * nothing to select on, and giving its result a value type would change what
 * every existing call returns. `'A'.charCodeAt(0) === 65` is *true* today, and a
 * `uint16` result would make it *false*, since the values of distinct value
 * types are distinct. The same reasoning covers `indexOf` and `lastIndexOf`,
 * whose `=== -1` is the universal idiom, the Date getters, and the byte
 * lengths."
 *
 * test262 covers these for an engine with no proposal at all. What it cannot
 * cover is the thing this proposal has to be clear about: that the OLD and the
 * NEW behaviour co-exist, in one program, with neither displacing the other.
 * These are that.
 *
 * The list is the clause's own, not one invented here, which is what makes it
 * the right list.
 */

test('the idioms the compatibility bound names still hold', () => {
  expect(evaluated("String('A'.charCodeAt(0) === 65);")).toBe('true');
  expect(evaluated('String([1, 2].indexOf(9) === -1);')).toBe('true');
  expect(evaluated("String('ab'.lastIndexOf('z') === -1);")).toBe('true');
  expect(evaluated('const d = new Date(0); String(d.getFullYear() === 1970);')).toBe('true');
  expect(evaluated('String(new ArrayBuffer(8).byteLength === 8);')).toBe('true');
  expect(evaluated('String([1, 2, 3].length === 3);')).toBe('true');
});

test('old and new co-exist in ONE program', () => {
  // The property that matters and that test262 cannot state: a program using the
  // proposal's types still sees the language's own behaviour everywhere it did.
  expect(evaluated("const n: uint8 = 1; String('A'.charCodeAt(0) === 65) + String(n === (1 := uint8));")).toBe('truetrue');
  expect(evaluated('const a: [].<uint8> = [1, 2]; String([9].indexOf(1) === -1);')).toBe('true');
  // An UNTYPED array reports a Number length; a TYPED one reports the index
  // type. Both in one program, neither displacing the other.
  expect(evaluated('const u = [1, 2]; String(typeof u.length === "number");')).toBe('true');
  expect(evaluated('const a: [].<uint8> = [1, 2]; String(Reflect.typeOf(a.length) === (type uint64));')).toBe('true');
});

test('a fixed-result static does not change what a call RETURNS', () => {
  // These carry Static Types. The clause's warning is that a VALUE type
  // would change the answer - a `uint16` from `charCodeAt` breaking `=== 65` -
  // so none of them was given one: `boolean`, `string`, `symbol` and `number`
  // are what these already answer.
  expect(evaluated('String(Array.isArray([1]) === true);')).toBe('true');
  expect(evaluated('String(Object.is(1, 1) === true);')).toBe('true');
  expect(evaluated("String(String.fromCharCode(65) === 'A');")).toBe('true');
  expect(evaluated('String(Symbol.for("x") === Symbol.for("x"));')).toBe('true');
  expect(evaluated('String(typeof Date.now() === "number");')).toBe('true');
  // And an untyped program still passes them anything.
  expect(evaluated('String(Array.isArray("no")) + String(Number.isInteger("no"));')).toBe('falsefalse');
});

test('a fixed-result static does not refuse an EXISTING SPELLING', () => {
  // The assertions above cannot fail for a static-typing mistake: a Static Type
  // is a claim about a value, and it cannot change what a call returns at run
  // time. Verified by injecting the fault - giving `Date.now` a `uint64` result
  // left every run-time assertion above passing.
  //
  // What a wrong fixed type DOES break is a program that already type-checked.
  // These are that guard, one per entry: the type each function has always
  // effectively answered, written as an annotation a program may have written.
  expect(ok('let n: number = Date.now();')).toBe(true);
  expect(ok('let n: boolean = Array.isArray([1]);')).toBe(true);
  expect(ok('let n: boolean = Object.is(1, 1);')).toBe(true);
  expect(ok('let n: string = String.fromCharCode(65);')).toBe(true);
  expect(ok('let n: string = String.fromCodePoint(65);')).toBe(true);
  expect(ok('let n: symbol = Symbol.for("x");')).toBe(true);
  expect(ok('let n: string = Symbol.keyFor(Symbol.for("x"));')).toBe(true);
  expect(ok('let n: boolean = ArrayBuffer.isView(new Uint8Array(1));')).toBe(true);
  // The overloaded predicates are NOT given a fixed result, so their literal
  // answers survive - `table-numeric-library-signatures` says `Number.isNaN`
  // over an integer family is *false*.
  expect(ok('const x: uint8 = 1; let n: false = Number.isNaN(x);')).toBe(true);
  expect(ok('const x: uint8 = 1; let n: true = Number.isInteger(x);')).toBe(true);
});

test('a value type is NOT given to a function that has nothing to select on', () => {
  // The clause: "Where a typed result is wanted from such a function, the
  // program writes a conversion." So the value-type annotation is refused and
  // the Number one is not - which is the shape of every row in the bound.
  expect(ok("let n: number = 'A'.charCodeAt(0);")).toBe(true);
  expect(ok('let n: number = [1].indexOf(1);')).toBe(true);
  expect(ok('let n: number = new Date(0).getFullYear();')).toBe(true);
  // The conversion a program writes when it wants one.
  expect(evaluated("const c: uint16 = ('A'.charCodeAt(0) := uint16); String(c === (65 := uint16));")).toBe('true');
});

test('an untyped program is untouched end to end', () => {
  // Participation: a source text using none of these types pays nothing and
  // behaves exactly as it does today.
  expect(evaluated('let a = 1; a = "s"; a = {}; String(typeof a);')).toBe('object');
  expect(evaluated('const m = new Map(); m.set(1, "a"); m.set("1", "b"); String(m.size);')).toBe('2');
  expect(evaluated('const s = new Set(); s.add(1); s.add("1"); String(s.size);')).toBe('2');
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => n); String(g.size) + String(typeof g.size);')).toBe('2number');
  expect(evaluated('function f(x) { return x + 1; } String(f(1)) + f("a");')).toBe('2a1');
});

test('an untyped array reads its length and indexOf as Number, as the run time does', () => {
  // The index type belongs to an array THAT HAS AN ELEMENT TYPE, which is the
  // clause's own scope and what the run time does: a declared `[].<uint8>` reads
  // its `length` as a `uint64`, and a bare literal reads it as a Number, because
  // the literal carries no [[TypedElement]]. The checker inferred `[].<number>`
  // for `[1]` and could not tell it from a declared one, so these were refused.
  expect(ok('let n: number = [1].length;')).toBe(true);
  expect(ok('let n: number = ([1]).length;')).toBe(true);
  expect(ok('let n: number = [].length;')).toBe(true);
  // `indexOf` and `lastIndexOf` return Number on EVERY array, typed or not. The
  // clause names them: their `=== -1` is the universal idiom, and a `uint64` is
  // not a type `-1` can inhabit. The run time already returned a plain Number;
  // the checker claimed otherwise.
  expect(ok('let n: number = [1].indexOf(1);')).toBe(true);
  expect(ok('let n: number = [1].lastIndexOf(1);')).toBe(true);
  expect(ok('const a: [].<uint8> = [1]; let n: number = a.indexOf(1);')).toBe(true);
  expect(ok('const a: [].<uint8> = [1]; let n: uint64 = a.indexOf(1);')).toBe(false);
  // A DECLARED array's length is the index type, unchanged.
  expect(ok('const a: [].<uint8> = [1]; let n: uint64 = a.length;')).toBe(true);
  expect(ok('const a: [].<uint8> = [1]; let n: number = a.length;')).toBe(false);
  expect(ok('const a: [].<any> = [1]; let n: uint64 = a.length;')).toBe(true);
});
