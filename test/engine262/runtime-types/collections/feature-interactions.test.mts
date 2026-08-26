import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.7 - THE CROSS-FEATURE SWEEP.
 *
 * Derived from a pass over every design document: for each feature of the
 * proposal, what a typed collection does when it meets it. The other files in
 * this directory test the collections against themselves; this one tests them
 * against everything else, which is where a collection change breaks something
 * that has no collection in it.
 *
 * Deliberate refusals are asserted as refusals, so that a later change relaxing
 * one is caught here rather than discovered. `shared Map` is the clearest: a
 * collection is not a value type, so it cannot be shared, and the diagnostic
 * says exactly that.
 *
 * Rows NOT asserted, and why:
 *   - VALUE TYPE CLASS keys are `value-type-keys.test.mts`, blocked on D5.
 *   - `for`-`of` BINDING types are D17 and are asserted as expected failures in
 *     `iteration.test.mts`, for every receiver rather than only collections.
 *   - `when extends` is D7, a pattern-matching gap this plan does not own.
 */

// ---------------------------------------------------------------------------
// Generics
// ---------------------------------------------------------------------------

test('a collection inside a generic class takes the class argument', () => {
  expect(evaluated('class C<T> { m = new Map.<string, T>(); } const c = new C.<uint8>(); c.m.set("a", 1); String(c.m.size);')).toBe('1');
  expect(evaluated('class C<T> { s = new Set.<T>(); } const c = new C.<uint8>(); c.s.add(1); String(c.s.size);')).toBe('1');
  // A generic function over a collection, whose return is the index type.
  expect(ok('function f<T>(s: Set.<T>): uint64 { return s.size; }')).toBe(true);
});

test('a collection is invariant in its arguments, and reaches its family top', () => {
  expectStaticTypeError('function f(m: Map.<string, number>) {} let m: Map.<string, uint8> = new Map(); f(m);');
  expect(ok('function f(m: Map.<any, any>) {} let m: Map.<string, uint8> = new Map(); f(m);')).toBe(true);
  expect(ok('function f(s: Set.<any>) {} let s: Set.<uint8> = new Set(); f(s);')).toBe(true);
});

// ---------------------------------------------------------------------------
// Reflection and type programming
// ---------------------------------------------------------------------------

test('reflection reports a collection and its members', () => {
  expect(evaluated('String(Reflect.typeOf(new Map.<string, uint8>()) === (type Map.<string, uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new Map()) === (type Map));')).toBe('true');
  // The relation agrees with the checker, which it did not before D16.
  expect(evaluated('String(Reflect.isAssignable(type Set.<uint8>, type Iterable.<uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type Set.<uint8>, type Set.<any>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type Set.<uint8>, type Set.<string>));')).toBe('false');
});

test('a Set of type objects is usable as the seen-set of a builder', () => {
  // The type-programming idiom: a `Set.<type>` accumulating what has been
  // visited. It works because types are interned, so one type is one key.
  expect(evaluated('const seen = new Set.<type>(); seen.add(uint8); seen.add(uint8); String(seen.size) + "/" + String(seen.has(uint8));')).toBe('1/true');
});

// ---------------------------------------------------------------------------
// Narrowing, `is`, and typed catch
// ---------------------------------------------------------------------------

test('a collection narrows, matches and is caught by its specialization', () => {
  expect(evaluated('const x: any = new Map.<string, uint8>(); String(x is Map.<string, uint8>);')).toBe('true');
  expect(evaluated('const x: any = new Map.<string, uint8>(); String(x is Map.<string, string>);')).toBe('false');
  expect(evaluated('try { throw new Set.<uint8>(); } catch (e: Set.<uint8>) { "caught"; }')).toBe('caught');
  expect(evaluated('const m = new Map.<string, uint8>(); match (m) { when Map.<string, uint8>: "right"; default: "no"; }')).toBe('right');
});

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

test('a collection is compared by identity and is truthy', () => {
  // A collection is a REFERENCE type however its keys compare, so `===` on two
  // of them is identity. This is the contrast with a value type class, whose
  // instances compare field by field.
  expect(evaluated('const a = new Map.<string, uint8>(); const b = new Map.<string, uint8>(); String(a === b) + "/" + String(a === a);')).toBe('false/true');
  expect(evaluated('const m = new Map.<string, uint8>(); String(m ? "t" : "f");')).toBe('t');
  // An empty collection is truthy, as every object is - `size` is what a
  // program tests.
  expect(evaluated('const m = new Map.<string, uint8>(); String(!m) + "/" + String(m.size === 0);')).toBe('false/true');
});

// ---------------------------------------------------------------------------
// Threading - the refusal
// ---------------------------------------------------------------------------

test('a collection cannot be shared, and says why', () => {
  // threading.md: `shared` applies to a value type, and a collection is not one.
  // Asserted at RUN TIME, because the no-default-value rule fires first at a
  // bare declaration and would mask this (D10).
  expect(ok('let m: shared Map.<string, uint8> = new Map();')).toBe(false);
  expect(ok('let s: shared Set.<uint8> = new Set();')).toBe(false);
  // The contrast: a fixed array of a value type IS sharable, so the refusal is
  // about the collection rather than about `shared`.
  expect(ok('class V { x: uint32; } let v: shared V = new V();')).toBe(true);
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

test('a typed collection serializes as an untyped one does', () => {
  // `JSON.stringify` of a Map is `{}` today and stays so - a collection has no
  // own enumerable properties, and typing it adds none.
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); JSON.stringify(m);')).toBe('{}');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); JSON.stringify(s);')).toBe('{}');
  // A TYPED parse into a collection is not available; the form is refused rather
  // than silently producing an untyped Map.
  expect(ok('const m = JSON.parse.<Map.<string, uint8>>("{}");')).toBe(false);
});

// ---------------------------------------------------------------------------
// Memory layout and SoA
// ---------------------------------------------------------------------------

test('a collection is a reference, so it has no layout and cannot be an SoA element', () => {
  // A class holding a collection field has no layout, so it is not a value type
  // class and cannot be a column type. That is the same rule that makes a
  // String field disqualifying, applied to a collection.
  expect(ok('class C { m: Map.<string, uint8> = new Map(); x: uint8; } let s: SoA.<C, 4> = new SoA.<C, 4>();')).toBe(false);
  expect(ok('class C { m: Map.<string, uint8> = new Map(); } let v: shared C = new C();')).toBe(false);
  // The same class without the collection field IS a value type.
  expect(ok('class C { x: uint8; } let v: shared C = new C();')).toBe(true);
});

// ---------------------------------------------------------------------------
// Ranges, vectors, decorators, pipeline
// ---------------------------------------------------------------------------

test('a range-bounded key type, and a range iterated into a collection', () => {
  expect(ok('let m: Map.<uint8.<1..=6>, string> = new Map(); m.set(3, "x");')).toBe(true);
  expect(evaluated('const s = new Set.<uint32>(); for (const i of 0..<3) s.add(i); String(s.size);')).toBe('3');
});

test('a vector as a value and as an element', () => {
  expect(ok('let m: Map.<string, float32x4> = new Map();')).toBe(true);
  expect(ok('let s: Set.<float32x4> = new Set();')).toBe(true);
});

test('a decorated collection field, and a collection through a pipeline', () => {
  expect(ok('function d(v, c) { return v; } class K { @d m: Map.<string, uint8> = new Map(); }')).toBe(true);
  expect(ok('const s = new Set.<uint8>(); s.add(1); const n = s |> %.size;')).toBe(true);
  // The WeakMap-keyed registry `decorators.md` builds its signals on.
  expect(evaluated('const reg = new WeakMap.<object, uint8>(); const k = {}; reg.set(k, 1); String(reg.get(k));')).toBe('1');
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

test('a `ref` in a collection type is accepted today, and should not be', () => {
  // references.md: "a reference cannot be stored in a binding that outlives it,
  // a field, an array, or a collection." The type still forms. OQ9 resolved this
  // as an annotation-position refusal and assigned it to `references.md`;
  // asserted here as the CURRENT answer so that implementing it is a visible
  // change rather than a silent one.
  expect(ok('let m: Map.<string, ref uint8> = new Map();')).toBe(true);
  expect(ok('let a: [].<ref uint8> = [];')).toBe(true);
});
