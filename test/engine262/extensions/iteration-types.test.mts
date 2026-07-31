import { test, expect } from 'vitest';
import { ok, evaluated } from '../readme/harness.mts';

/**
 * PLAN-iteration-types-engine.md phases 2 and 4, per #sec-iteration-types.
 *
 * The relations below are DECLARED rather than inspected: a library type is an
 * opaque nominal here, its members held in side tables consulted at the
 * member-access site, so it has no structural form to compare against an
 * interface. The declared-implements table is what makes a generator an
 * iterable iterator, and the entries in that table are exactly the assertions
 * in this file — which is the point of writing them here, since a
 * hand-maintained table of claims is only as true as its tests.
 */

test('the iteration types resolve', () => {
  expect(ok('function f(x: Iterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: Iterable.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: IterableIterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterator.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterable.<uint8>) {}')).toBe(true);
  expect(ok('function f(x: AsyncIterableIterator.<uint8>) {}')).toBe(true);
});

test('a hand-written object satisfies Iterator', () => {
  // The reason the protocols are interfaces rather than the class: `for`-`of`
  // asks whether the members are there, never what the value declared.
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
});

test('the shorthand interns', () => {
  // Not merely assignable — the same interned type. A shorthand producing an
  // equal-but-distinct record would pass an assignability check and fail this.
  expect(ok('const a: boolean = Iterator.<uint8> === Iterator.<uint8, void, void>;')).toBe(true);
});

test('a generator IS an iterator', () => {
  // The relation both documents state and the engine did not hold until the
  // declared-implements table existed.
  const g = 'function* g(): uint8 { yield 1; } ';
  expect(ok(`${g}const i: Iterable.<uint8> = g();`)).toBe(true);
  expect(ok(`${g}const i: Iterator.<uint8> = g();`)).toBe(true);
  expect(ok(`${g}const i: IterableIterator.<uint8> = g();`)).toBe(true);
});

test('an async generator IS an async iterator', () => {
  const ag = 'async function* ag(): uint8 { yield 1; } ';
  expect(ok(`${ag}const i: AsyncIterable.<uint8> = ag();`)).toBe(true);
  expect(ok(`${ag}const i: AsyncIterableIterator.<uint8> = ag();`)).toBe(true);
});

test('the element type still has to match', () => {
  // What keeps the four above from passing vacuously: if the relation were
  // unconditional, this would pass too.
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterable.<string> = g();')).toBe(false);
});

test('no per-collection iteration types', () => {
  // TypeScript has ArrayIterator, MapIterator, SetIterator to carry a narrower
  // return type; the shorthand carries it here, so the family stays at six.
  expect(ok('const t = ArrayIterator.<uint8>;')).toBe(false);
  expect(ok('const t = MapIterator.<uint8>;')).toBe(false);
});

test('the iteration types are values, so they work on object-literal initializers', () => {
  // The last blocker, and the control that found it. Contextually typing an
  // object literal RESOLVES ITS ANNOTATION AS A VALUE — the type has to be in
  // hand before the literal is checked against it — so a name with no binding
  // was undefined there while the same annotation on a parameter resolved
  // through a resolver and worked. `Iterator` was the one member of the family
  // that worked, and it differed in nothing except being a real global, which
  // iterator helpers made it.
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
  expect(evaluated('String(typeof Iterable);')).toBe('object');
  expect(evaluated('String(typeof IteratorResult);')).toBe('object');
  expect(evaluated('String(typeof IterableIterator);')).toBe('object');
});

test('the generator and iteration families default identically', () => {
  // The agreement is load-bearing rather than tidy: it is what makes a
  // Generator.<Y, R, N> satisfy IterableIterator.<Y, R, N>. Both now read the
  // shorthand from one function, and these assertions are what would fail if a
  // second copy ever appeared and drifted.
  expect(ok('const a: boolean = Iterator.<uint8> === Iterator.<uint8, void, void>;')).toBe(true);
  // `Generator` is not a global binding in this engine - it is a library type
  // name, reachable in an annotation and not as a value - so its shorthand is
  // asserted through an annotation rather than an expression.
  expect(ok('function* g(): uint8 { yield 1; } const a: Generator.<uint8, void, void> = g();')).toBe(true);
  expect(ok('const a: boolean = AsyncIterator.<uint8> === AsyncIterator.<uint8, void, void>;')).toBe(true);

  // And the relation those defaults exist to support, asserted through the
  // shorthand on both sides rather than the full form.
  expect(ok('function* g(): uint8 { yield 1; } const i: IterableIterator.<uint8> = g();')).toBe(true);
});

/**
 * `Iterator` in type position denotes the INTERFACE, not the class.
 *
 * The class is real — it is the global iterator helpers introduced, and it is
 * where `map`, `filter`, and `take` live — but a type annotation naming
 * `Iterator.<T>` has to accept a hand-written `{ next() { … } }`, which is what
 * the design's own example does and what the protocol reading requires. The
 * class's instances satisfy the interface like any other value that has the
 * members, so nothing is lost: what a chain gets from the class is its methods
 * at run time, not a different static type.
 */
test('a class instance and a hand-written object both satisfy Iterator', () => {
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterator.<uint8> = g();')).toBe(true);
});

/**
 * PLAN-iteration-types-engine.md phase 5: the helper surface.
 *
 * The helpers live on the `Iterator` class at run time and are reached here
 * from whatever the receiver's type is, because the receiver's static type is
 * the protocol rather than the class - a hand-written iterator has to satisfy
 * the same annotation. `map` is the method that changes the element type and
 * `toArray` is the one that leaves the family; the rest follow those two.
 */

test('a helper chain carries the element type', () => {
  const g = 'function* g(): uint8 { yield 1; yield 2; } ';
  expect(ok(`${g}const a: [].<uint8> = g().toArray();`)).toBe(true);
  expect(ok(`${g}const a: [].<uint8> = g().filter((x) => x > 1).toArray();`)).toBe(true);
  expect(ok(`${g}const a: [].<uint8> = g().take(1).toArray();`)).toBe(true);
  expect(ok(`${g}const a: [].<uint8> = g().drop(1).toArray();`)).toBe(true);
});

test('a mistyped chain fails at the annotation rather than silently', () => {
  // What keeps the four above from passing vacuously: an untyped chain would
  // satisfy every annotation.
  const g = 'function* g(): uint8 { yield 1; } ';
  expect(ok(`${g}const a: [].<string> = g().toArray();`)).toBe(false);
  expect(ok(`${g}const a: [].<string> = g().filter((x) => x > 1).toArray();`)).toBe(false);
});

test('the terminal helpers have their own types', () => {
  const g = 'function* g(): uint8 { yield 1; } ';
  expect(ok(`${g}const a: boolean = g().some((x) => x > 0);`)).toBe(true);
  expect(ok(`${g}const a: boolean = g().every((x) => x > 0);`)).toBe(true);
  expect(ok(`${g}const a: string = g().some((x) => x > 0);`)).toBe(false);
});

test('a chain of several helpers carries its element type', () => {
  // What the carrier exists for. Each helper returns a record holding the
  // element, so the next one can find it; an interface record carries members
  // rather than arguments and the chain went permissive after one step.
  const g = 'function* g(): uint8 { yield 1; yield 2; } ';
  expect(ok(`${g}const a: [].<uint8> = g().filter((x) => x > 1).take(1).toArray();`)).toBe(true);
  expect(ok(`${g}const a: [].<string> = g().filter((x) => x > 1).take(1).toArray();`)).toBe(false);

  // And a chain is still one of the protocols, through the declared-implements
  // table - the carrier is an implementation detail, not a leak into the types
  // a program writes.
  expect(ok(`${g}const a: Iterable.<uint8> = g().filter((x) => x > 1);`)).toBe(true);
  expect(ok(`${g}const a: IterableIterator.<uint8> = g().take(1);`)).toBe(true);
});

test('the carrier does not displace the interface reading', () => {
  // The regression the first attempt caused: reaching the carrier by
  // registering `Iterator` as a library name made the NAME resolve to it in
  // annotation position, and hand-written iterators stopped satisfying
  // `Iterator.<T>`. A separate name is what keeps both true at once.
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterator.<uint8> = g();')).toBe(true);
});

/**
 * PLAN-iteration-types-engine.md phase 6: the interactions.
 *
 * A type whose purpose is composition is proven by what it composes with. Each
 * of these worked untyped before; the assertions are that they still work and
 * now carry a type.
 */

test('the collections are iterable', () => {
  // The declared-implements table beyond the generators, which is most of its
  // value: each of these is true today and was unwritable.
  expect(ok('const s: Set.<uint8> = new Set(); const i: Iterable.<uint8> = s;')).toBe(true);
  expect(ok('const m: Map.<string, uint8> = new Map(); const i: Iterable.<[string, uint8]> = m;')).toBe(true);
  // The element still has to match: a Map iterates entries, not values.
  expect(ok('const m: Map.<string, uint8> = new Map(); const i: Iterable.<uint8> = m;')).toBe(false);
});

test('spread and for-of consume a typed iterator', () => {
  const g = 'function* g(): uint8 { yield 1; yield 2; } ';
  expect(ok(`${g}const a: [].<uint8> = [...g()];`)).toBe(true);
  expect(ok(`${g}for (const a: uint8 of g()) {}`)).toBe(true);
  expect(evaluated(`${g}String([...g()]);`)).toBe('1,2');
});

test('yield* delegates to an iterable', () => {
  expect(ok(`
    function* inner(): uint8 { yield 1; }
    function* outer(): uint8 { yield* inner(); }
  `)).toBe(true);
  expect(evaluated(`
    function* inner(): uint8 { yield 1; }
    function* outer(): uint8 { yield* inner(); yield 2; }
    String([...outer()]);
  `)).toBe('1,2');
});

test('a do * generator satisfies the protocols', () => {
  // It produces a generator, so it satisfies them through the same table entry
  // and needs no rule of its own.
  expect(ok('const i: Iterable.<uint8> = do * { yield uint8.parse("1"); };')).toBe(true);
  expect(evaluated('String([...do * { yield 1; yield 2; }]);')).toBe('1,2');
});

test('a pipeline carries an iterator through a chain', () => {
  const g = 'function* g(): uint8 { yield 1; yield 2; } ';
  expect(ok(`${g}const a: [].<uint8> = g() |> %.take(1) |> %.toArray();`)).toBe(true);
  expect(ok(`${g}const a: [].<string> = g() |> %.take(1) |> %.toArray();`)).toBe(false);
});

/**
 * One gap, and it is not this feature's.
 *
 * `for (const a: string of xs)` is accepted for an `xs` of `[].<uint8>`, so the
 * loop variable's annotation is not checked against the element type. It
 * reproduces over a plain array with no iterator type involved, so it predates
 * this work and is recorded rather than fixed here — but #sec-iteration-types
 * is what makes it statable, since the rule it needs is that the element is the
 * `Iterable`'s parameter.
 */

test('map erases the element type, as it does for arrays', () => {
  // The plan called `map` the method that CHANGES the element type. It does
  // not, here or for arrays: the side-table mechanism these signatures use has
  // no way to bind a callback's return as a type parameter, so both return
  // `any`. Asserted rather than left implied, because the plan's own text says
  // otherwise and someone will check.
  const g = 'function* g(): uint8 { yield 1; } ';
  // The two erase it differently, which is worth pinning. An array's `map`
  // returns bare `any`, which is assignable to anything, so a wrong annotation
  // is ACCEPTED. An iterator's returns a carrier of `any`, so `toArray` gives
  // `[].<any>`, and array invariance REFUSES a wrong annotation. Neither
  // carries the callback's return type; they fail in opposite directions.
  expect(ok(`${g}const a: [].<string> = g().map((x) => 's').toArray();`)).toBe(false);
  expect(ok("const xs: [].<uint8> = [1]; const a: [].<string> = xs.map((x) => 's');")).toBe(true);
  // Which is why `filter` and `take`, which KEEP the element, are the ones the
  // chain tests above lean on.
});

test('destructuring reads a typed iterator', () => {
  const g = 'function* g(): uint8 { yield 1; yield 2; } ';
  expect(ok(`${g}const [a, b] = g();`)).toBe(true);
  expect(evaluated(`${g}const [a, b] = g(); String(a + b);`)).toBe('3');
});

test('composites are unaffected', () => {
  // The existing caller of the structural form, which the plan names as the
  // suite to run first on every iteration.
  expect(evaluated('const k = Composite({ a: 1 }); String(k === Composite({ a: 1 }));')).toBe('true');
});

test('an iterator composes with using', () => {
  // A helper chain over a resource is the motivating case for both features.
  expect(ok(`
    function* g(): uint8 { yield 1; }
    { using d = { [Symbol.dispose]() {} }; const i: Iterable.<uint8> = g(); }
  `)).toBe(true);
});
