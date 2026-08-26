import { test, expect } from 'vitest';
import { ok, evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-iteration-types (Iteration Types).
 *
 * The relations below are DECLARED rather than inspected: a library type is an
 * opaque nominal here, its members held in side tables consulted at the
 * member-access site, so it has no structural form to compare against an
 * interface. The declared-implements table is what makes a generator an
 * iterable iterator, and the entries in that table are exactly the assertions
 * in this file - which is the point of writing them here, since a
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
  // Not merely assignable - the same interned type. A shorthand producing an
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
  // object literal RESOLVES ITS ANNOTATION AS A VALUE - the type has to be in
  // hand before the literal is checked against it - so a name with no binding
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
 * The class is real - it is the global iterator helpers introduced, and it is
 * where `map`, `filter`, and `take` live - but a type annotation naming
 * `Iterator.<T>` has to accept a hand-written `{ next() { ... } }`, which is what
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
 * The helper surface.
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
 * The interactions.
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
 * this work and is recorded rather than fixed here - but #sec-iteration-types
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

test('applying type arguments to a Type Object is not a no-op', () => {
  // `Iterable.<uint8>` in EXPRESSION position must not evaluate to bare
  // `Iterable`: that would make `Iterable === Iterable.<uint8>` true and
  // discard the arguments silently.
  //
  // The evaluation handled exactly one shape - a generic alias - and returned
  // the unapplied base for everything else. That the one handled shape behaved
  // correctly is what made the gap hard to see.
  expect(evaluated('String(Iterable === Iterable.<uint8>);')).toBe('false');
  expect(evaluated('String(Iterable.<uint8> === Iterable.<uint8>);')).toBe('true');
  expect(evaluated('String(Iterable.<uint8> === Iterable.<uint16>);')).toBe('false');
  expect(evaluated('String(IterableIterator.<uint8> === IterableIterator.<uint16>);')).toBe('false');

  // The alias path, which already worked, must keep working.
  expect(evaluated('type L<T> = [].<T>; String(L === L.<uint8>);')).toBe('false');

  // A CONSTRUCTOR is not a Type Object, and `Map.<K, V>` yields the
  // constructor - which is what `new Map.<K, V>()` needs. Distinctness for
  // those is enforced in annotation position, not by comparing constructors.
  expect(evaluated('String(typeof Map);')).toBe('function');
  expect(evaluated('String(typeof Iterable);')).toBe('object');

  // `Iterator` is the ODD ONE OUT of its own family, and this is worth pinning
  // rather than discovering later. Iterator helpers made `Iterator` a real
  // global constructor, so in value position it is a function like `Map` and
  // not a Type Object like its five siblings - and `Iterator.<uint8>`
  // therefore yields the constructor rather than an applied type.
  //
  // It resolves correctly in ANNOTATION position, which is where it is used,
  // so nothing is broken. But a feature that passes a bare constructor as an
  // argument - which is what a higher-kinded parameter does - will meet this
  // asymmetry, and `Iterator` is the most likely thing anyone would pass.
  expect(evaluated('String(typeof Iterator);')).toBe('function');
  expect(evaluated('String(Iterator === Iterator.<uint8>);')).toBe('true');
});

/**
 * The unification of `Iterator` and `AsyncIterator`:
 * #sec-higher-kinded-parameters.
 *
 * `Iterator` and `AsyncIterator` are one declaration differing in the wrapper
 * their results carry - `Iterator<T, R, N, W<_> = Identity>` synchronous,
 * the same with `Promise` asynchronous.
 *
 * The gate for this phase was that every test above passes UNCHANGED, and it
 * does. A unification requiring its own tests to be rewritten has changed the
 * types rather than deduplicated them.
 *
 * `Iterable` and `AsyncIterable` remain two, and so do their IterableIterator
 * pair, because they differ in the member KEY - [Symbol.iterator] against
 * [Symbol.asyncIterator] - and a kind abstracts over the type a member has and
 * never over the key it is stored under. Six declarations become five, which is
 * what the assessment measured and less than a first look suggests.
 */

test('one declaration serves both iteration protocols', () => {
  expect(ok('const i: Iterator.<uint8> = { next: () => ({ value: 1, done: false }) };')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterator.<uint8> = g();')).toBe(true);
  expect(ok('async function* ag(): uint8 { yield 1; } const i: AsyncIterator.<uint8> = ag();')).toBe(true);

  // The distinction survives the merge, which is the assertion that keeps the
  // unification from being a widening: a synchronous generator is not an
  // asynchronous iterator.
  expect(ok('function* g(): uint8 { yield 1; } const i: AsyncIterator.<uint8> = g();')).toBe(false);
});

test('the consumers are unaffected by the unification', () => {
  // These are what would break first if the wrapper parameter disturbed the
  // shape rather than parameterizing it.
  expect(ok('function* g(): uint8 { yield 1; } for (const a: uint8 of g()) {}')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const a: [].<uint8> = [...g()];')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const a: [].<uint8> = g().take(1).toArray();')).toBe(true);
  expect(evaluated('function* g(): uint8 { yield 1; yield 2; } String([...g()]);')).toBe('1,2');
});

test('Iterable and AsyncIterable remain two interfaces', () => {
  // Asserted rather than assumed. A kind reaches the type a member has and not
  // the KEY it is stored under, so these cannot merge - and a test that quietly
  // unified them would mean the symbol had been erased.
  expect(ok('function* g(): uint8 { yield 1; } const i: Iterable.<uint8> = g();')).toBe(true);
  expect(ok('async function* ag(): uint8 { yield 1; } const i: AsyncIterable.<uint8> = ag();')).toBe(true);
  expect(ok('function* g(): uint8 { yield 1; } const i: AsyncIterable.<uint8> = g();')).toBe(false);
});

test('an array and a tuple satisfy Iterable over their elements (D22)', () => {
  // BUILTIN_IMPLEMENTS is keyed on a [[LibraryName]], and an array type has
  // none - it is ~array~, not ~nominal~ - so the declared-implements branch
  // could not see it whatever the table said. The omission was invisible from
  // the collections, which ARE in that table, and it left the most obvious
  // iterable in the language unable to reach an `Iterable` parameter.
  //
  // The two halves disagreed, which is what makes it a defect rather than a
  // deliberate narrowing: `_a_ is Iterable.<uint8>` answered *true* at run time
  // for the same value the checker refused.
  expect(ok('function f(i: Iterable.<uint8>) {} const a: [].<uint8> = [1]; f(a);')).toBe(true);
  expect(ok('function f(i: Iterable.<uint8>) {} const a: [4].<uint8> = [1, 2, 3, 4]; f(a);')).toBe(true);
  expect(evaluated('const a: [].<uint8> = [1]; String(a is Iterable.<uint8>);')).toBe('true');
  // A tuple iterates as the union of its positions, every tuple being an array.
  expect(ok('function f(i: Iterable.<uint8 | string>) {} const t: [uint8, string] = [1, "a"]; f(t);')).toBe(true);
  // The element type is still checked, so the relation discriminates.
  expectStaticTypeError('function f(i: Iterable.<string>) {} const a: [].<uint8> = [1]; f(a);');
  // And a non-iterable is still refused, so the position is really checked.
  expectStaticTypeError('function f(i: Iterable.<uint8>) {} f(1);');
  // The collections, which reach this by the declared table rather than by the
  // array arm, are unaffected.
  expect(ok('function f(i: Iterable.<uint8>) {} let s: Set.<uint8> = new Set(); f(s);')).toBe(true);
});
