import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PLAN-typed-collections.md sec 6.4 - ITERATION AND THE REMAINING MEMBERS
 * (Phase 2, OQ3 and OQ4).
 *
 * What Phase 2 adds: `clear`, `keys`, `values`, `entries` and `forEach` acquire
 * signatures on a typed `Map` or `Set`; a weak collection refuses all of them by
 * name; and `Reflect.typeOf` reports a collection's specialization (D6).
 *
 * OQ3, AND A CORRECTION TO ITS RECOMMENDATION. The question was what
 * `keys`/`values`/`entries` return. `sec-iteration-types` rules out
 * per-collection iterator types by name - there is no `MapIterator` to return -
 * so the specification says `Iterator.<T>`, and it should. But the CHECKER
 * cannot return that record: in this engine `Iterator.<T>` is a structural
 * OBJECT record carrying members, with no [[Arguments]] to read, so a chain
 * starting from one loses its element type at the first step and
 * `m.values().map(f)` would be untyped. OQ3's recommendation - "return
 * `Iterator.<K>`, and add `Iterator` to the helper-dispatch receiver list" - was
 * not implementable as written, because there is no `Iterator` LibraryName to
 * dispatch on.
 *
 * The resolution keeps both halves. The checker returns `IteratorHelper.<T>`,
 * the carrier, which is a nominal that holds its element type AND is declared to
 * implement `Iterator.<T>`, `IterableIterator.<T>` and `Iterable.<T>` through
 * `BUILTIN_IMPLEMENTS`. So a caller gets a value satisfying the interface the
 * specification names, and a chain gets a receiver that carries what the next
 * step needs. The two statements agree rather than compete, and it is the same
 * choice `iteratorMethodSignature` already made for the helpers themselves.
 *
 * OQ4 TURNED OUT TO BE DONE. `Map` and `Set` were already in
 * `BUILTIN_IMPLEMENTS` - `Set.<T>` implements `Iterable.<T>` and `Map.<K, V>`
 * implements `Iterable.<[K, V]>` - and the checker honours it. Asserted below so
 * it stays true, since the table's own comment calls each entry "a claim kept
 * true by hand, which is why every one has a test".
 *
 * NOT IN PHASE 2, AND NOT A COLLECTIONS DEFECT: a `for`-`of` binding has no
 * type. See the D17 tests at the foot of this file.
 */

const M = 'let m: Map.<string, uint8> = new Map(); ';
const S = 'let s: Set.<uint8> = new Set(); ';

// ---------------------------------------------------------------------------
// The members Phase 2 types
// ---------------------------------------------------------------------------

test('clear returns void on a typed collection', () => {
  expectStaticTypeError(`${M} let n: string = m.clear();`);
  expectStaticTypeError(`${S} let n: uint8 = s.clear();`);
  expect(ok(`${M} m.clear();`)).toBe(true);
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.clear(); String(m.size);')).toBe('0');
});

test('keys, values and entries carry their element types', () => {
  // A Map's keys are K, its values are V, and its entries are the pair.
  expect(ok(`${M} let a: [].<string> = m.keys().toArray();`)).toBe(true);
  expect(ok(`${M} let a: [].<uint8> = m.values().toArray();`)).toBe(true);
  expect(ok(`${M} let a: [].<[string, uint8]> = m.entries().toArray();`)).toBe(true);
  expectStaticTypeError(`${M} let a: [].<uint8> = m.keys().toArray();`);
  expectStaticTypeError(`${M} let a: [].<string> = m.values().toArray();`);
  expectStaticTypeError(`${M} let a: [].<[uint8, string]> = m.entries().toArray();`);
});

test('a Set keys and values identically, and entries as a pair of itself', () => {
  // On a Set `keys` IS `values` - the same function object - so the two must
  // answer the same type, and `backcompat.test.mts` asserts the identity.
  expect(ok(`${S} let a: [].<uint8> = s.values().toArray();`)).toBe(true);
  expect(ok(`${S} let a: [].<uint8> = s.keys().toArray();`)).toBe(true);
  expectStaticTypeError(`${S} let a: [].<string> = s.keys().toArray();`);
  // A Set's `entries` yields [v, v], which is odd and is what the language does.
  expect(ok(`${S} let a: [].<[uint8, uint8]> = s.entries().toArray();`)).toBe(true);
});

test('an iterator from a collection chains into the helpers', () => {
  // The property that forced the carrier over the interface. Each step must
  // keep carrying the element type, or the chain is untyped after one call.
  expect(ok(`${M} let a: [].<uint8> = m.values().filter((v) => true).toArray();`)).toBe(true);
  expectStaticTypeError(`${M} let a: [].<string> = m.values().filter((v) => true).toArray();`);
  expect(ok(`${M} let a: [].<string> = m.keys().take(2).drop(1).toArray();`)).toBe(true);
  expect(ok(`${S} let n: uint8 | void = s.values().find((v) => true);`)).toBe(true);
  // And it runs, not merely checks.
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.set("b", 2); m.values().toArray().join(",");')).toBe('1,2');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); m.keys().toArray().join(",");')).toBe('a');
});

test('forEach types its callback, value first', () => {
  // (value, key, collection) - the value FIRST, which is the order the language
  // chose and the order a reader gets wrong. Typing it is most of the value of
  // typing `forEach` at all.
  expectStaticTypeError(`${M} m.forEach((v: string) => {});`);
  expectStaticTypeError(`${M} m.forEach((v: uint8, k: uint8) => {});`);
  expect(ok(`${M} m.forEach((v: uint8, k: string) => {});`)).toBe(true);
  expect(ok(`${M} m.forEach((v: uint8, k: string, c: Map.<string, uint8>) => {});`)).toBe(true);
  // A Set's callback takes the element twice.
  expectStaticTypeError(`${S} s.forEach((v: string) => {});`);
  expect(ok(`${S} s.forEach((v: uint8, v2: uint8) => {});`)).toBe(true);
  // An UNANNOTATED callback still works, and fewer parameters than the
  // signature declares is still a valid callback - both are the ordinary
  // spellings and neither may become an error.
  expect(ok(`${M} m.forEach((v, k) => {});`)).toBe(true);
  expect(ok(`${M} m.forEach(() => {});`)).toBe(true);
  // thisArg is optional and unconstrained.
  expect(ok(`${M} m.forEach(function () {}, {});`)).toBe(true);
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); let out = ""; m.forEach((v, k) => { out = k + v; }); out;')).toBe('a1');
});

test('getOrInsertComputed types its callback parameter but not its return', () => {
  // The parameter is K and is checked.
  expectStaticTypeError(`${M} m.getOrInsertComputed("a", (k: uint8) => 1);`);
  expect(ok(`${M} let v: uint8 = m.getOrInsertComputed("a", (k: string) => 1);`)).toBe(true);
  // The RETURN is left unconstrained on purpose. Constraining it to V refuses
  // the natural spelling `(k) => 1`, because inferring a callback's return from
  // an expected type is the argument-position inference the design defers. An
  // annotated callback working where an unannotated one did not would be a
  // worse trade than under-approximating.
  expect(ok(`${M} m.getOrInsertComputed("a", (k) => 1);`)).toBe(true);
  // The value is checked at INSERTION either way, so a wrong one is refused -
  // just at run time rather than as an Early Error.
  expect(ok('const m = new Map.<string, uint8>(); m.getOrInsertComputed("a", () => 300);')).toBe(false);
  expect(evaluated('const m = new Map.<string, uint8>(); String(m.getOrInsertComputed("a", () => 7));')).toBe('7');
});

// ---------------------------------------------------------------------------
// A weak collection has none of this
// ---------------------------------------------------------------------------

test('a weak collection refuses every enumerating member by name', () => {
  const W = 'let w: WeakMap.<object, uint8> = new WeakMap(); ';
  const WS = 'let w: WeakSet.<object> = new WeakSet(); ';
  for (const member of ['size', 'clear', 'keys', 'values', 'entries', 'forEach']) {
    expectStaticTypeError(`${W} let n = w.${member};`);
    expectStaticTypeError(`${WS} let n = w.${member};`);
  }
  // The members it DOES have are unaffected.
  expect(ok(`${W} let v: uint8 | undefined = w.get({});`)).toBe(true);
  expect(ok(`${W} w.set({}, 1);`)).toBe(true);
  expect(ok(`${WS} w.add({});`)).toBe(true);
  // And an UNTYPED weak collection is untouched: reading an absent property is
  // undefined, not an error.
  expect(evaluated('const w = new WeakMap(); String(w.forEach);')).toBe('undefined');
});

// ---------------------------------------------------------------------------
// OQ4 - the implements relation
// ---------------------------------------------------------------------------

test('OQ4: a typed collection satisfies Iterable at a declared parameter', () => {
  // BUILTIN_IMPLEMENTS calls each entry "a claim kept true by hand, which is why
  // every one has a test". These are the collections' tests.
  expect(ok('function f(i: Iterable.<uint8>) {} let s: Set.<uint8> = new Set(); f(s);')).toBe(true);
  expect(ok('function f(i: Iterable.<[string, uint8]>) {} let m: Map.<string, uint8> = new Map(); f(m);')).toBe(true);
  // ...and the WRONG element type is refused, which is what makes the relation
  // worth having rather than a blanket admission.
  expectStaticTypeError('function f(i: Iterable.<string>) {} let s: Set.<uint8> = new Set(); f(s);');
  expectStaticTypeError('function f(i: Iterable.<[uint8, string]>) {} let m: Map.<string, uint8> = new Map(); f(m);');
  // A non-iterable is refused, so the parameter position is really checked.
  expectStaticTypeError('function f(i: Iterable.<uint8>) {} f(1);');
  // A weak collection is NOT iterable and must not satisfy it.
  expectStaticTypeError('function f(i: Iterable.<object>) {} let w: WeakSet.<object> = new WeakSet(); f(w);');
});

// ---------------------------------------------------------------------------
// D6 - Reflect.typeOf reports the specialization
// ---------------------------------------------------------------------------

test('D6: Reflect.typeOf reports a collection specialization', () => {
  // The design states the wanted answer directly: "Reflect.typeOf(new
  // Map.<string, uint8>()); // Map.<string, uint8>". Before this it was neither
  // the specialization nor the bare nominal - the value fell through to the
  // shape branches and reported the literal type of an object with no own
  // properties, which is what a Map looks like from outside.
  expect(evaluated('String(Reflect.typeOf(new Map.<string, uint8>()) === (type Map.<string, uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new Set.<uint8>()) === (type Set.<uint8>));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new Map.<string, uint8>()) === (type Map.<string, string>));')).toBe('false');
  expect(evaluated('let m: Map.<string, uint8> = new Map(); String(Reflect.typeOf(m) === (type Map.<string, uint8>));')).toBe('true');
});

test('D6: an UNTYPED collection reports the bare nominal', () => {
  // The other half, and the one that keeps sec 0's invariant: an ordinary Map is
  // a `Map`, not a specialization and not a shape.
  expect(evaluated('String(Reflect.typeOf(new Map()) === (type Map));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new Set()) === (type Set));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new WeakMap()) === (type WeakMap));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new WeakSet()) === (type WeakSet));')).toBe('true');
  expect(evaluated('String(Reflect.typeOf(new Map()) === (type Map.<string, uint8>));')).toBe('false');
});

// ---------------------------------------------------------------------------
// D17 - for-of and spread bindings have no type. NOT a collections defect.
// ---------------------------------------------------------------------------

test.fails('D17: a for-of binding takes the element type (general, not collections)', () => {
  // Measured: a `for`-`of` binding is untyped for EVERY receiver - an array, a
  // generator, a string, a range, and a collection alike. So this is the general
  // iteration-to-binding path and not something the collections are missing, and
  // a fix converts all five at once. All five are asserted here for that reason:
  // fixing it only for collections would make them behave differently from
  // arrays for no stated reason.
  expect(ok('let a: [].<uint8> = [1,2,3]; for (const v of a) { let x: string = v; }')).toBe(false);
  expect(ok('function* g(): Generator.<uint8> { yield 1; } for (const v of g()) { let x: string = v; }')).toBe(false);
  expect(ok('for (const c of "abc") { let x: uint8 = c; }')).toBe(false);
  expect(ok('for (const i of 0..<4) { let x: string = i; }')).toBe(false);
  expect(ok(`${S} for (const v of s) { let x: string = v; }`)).toBe(false);
  // And a Map destructures to the pair.
  expect(ok(`${M} for (const [k, v] of m) { let x: uint8 = k; }`)).toBe(false);
});

test.fails('D17: a spread of a typed source takes its element type', () => {
  expect(ok('let a: [].<uint8> = [1,2,3]; let b: [].<string> = [...a];')).toBe(false);
  expect(ok(`${S} let b: [].<string> = [...s];`)).toBe(false);
});

test('control: iteration RUNS correctly whatever the binding is typed at', () => {
  // D17 is about the binding's static type. The values themselves are right,
  // and the run-time element checks still apply - so nothing here is unsound,
  // only unchecked earlier than it could be.
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); let out = ""; for (const [k, v] of m) out = k + v; out;')).toBe('a1');
  expect(evaluated('const s = new Set.<uint8>(); s.add(1); s.add(2); [...s].join(",");')).toBe('1,2');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 1); String([...m][0][0]);')).toBe('a');
  expect(evaluated('const s = new Set.<uint8>(); s.add(7); let t = 0; for (const v of s) t = v; String(Reflect.typeOf(t) === (type uint8));')).toBe('true');
});
