import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// OQ-library-nominal-subtyping.md D2. The built-in ERROR hierarchy.
//
// `TypeError` was not a subtype of `Error`, and the engine disagreed with
// itself: `new TypeError('x') is Error` and `instanceof` both answered *true*
// while `let e: Error = new TypeError('x')` was refused. That is the defect
// `relations.mts` records for user classes - "the run time walks a prototype
// chain and the checker had nothing to walk" - and the fix landed there for
// classes DECLARED IN SOURCE, leaving the built-ins behind for want of a
// declaration to read.
//
// EVERY assertion here uses the DECLARATION form rather than
// `Reflect.isAssignable`. That is not a style preference. An API taking both
// types as arguments cannot distinguish "the relation holds" from "the two
// arguments became one", and the first version of this work was verified with
// `Reflect.isAssignable` and passed while being asked the wrong question - the
// relation had been added to `SameTypeWithAssumptions`, which interning compares
// with, so `type RangeError === type Error` answered *true* and the second
// argument of a two-type call silently became the first. A declaration names
// the target once and cannot collapse.

const SUBCLASSES = [
  ['TypeError', 'new TypeError("x")'],
  ['RangeError', 'new RangeError("x")'],
  ['SyntaxError', 'new SyntaxError("x")'],
  ['ReferenceError', 'new ReferenceError("x")'],
  ['EvalError', 'new EvalError("x")'],
  ['URIError', 'new URIError("x")'],
  ['AggregateError', 'new AggregateError([], "x")'],
];

test('every error subclass is assignable to Error', () => {
  for (const [name, ctor] of SUBCLASSES) {
    expect(evaluated(`let e: Error = ${ctor}; String(e instanceof ${name});`)).toBe('true');
    expect(evaluated(`function f(p: Error) { return "ok"; } String(f(${ctor}));`)).toBe('ok');
  }
});

test('all seven in ONE program', () => {
  // The multi-subclass case is what exposed the misplacement: with the relation
  // in the wrong operation, the FIRST subclass in a program answered correctly
  // and every later one did not. One at a time would not have caught it.
  const decls = SUBCLASSES.map(([, ctor], i) => `let e${i}: Error = ${ctor};`).join(' ');
  expect(evaluated(`${decls} String("ok");`)).toBe('ok');
});

test('the relation is DIRECTIONAL', () => {
  expectThrown('let t: TypeError = new Error("x");');
  expectThrown('function f(p: TypeError) { return 1; } f(new Error("x"));');
});

test('siblings stay unrelated', () => {
  expectThrown('let r: RangeError = new TypeError("x");');
  expectThrown('let s: SyntaxError = new RangeError("x");');
});

test('the subclass and its base remain DISTINCT types', () => {
  // The guard on the misplacement. Subtyping belongs in the asymmetric
  // operation; a subtype fact added to the sameness one makes interning fold
  // two types into one Type Object, and every later question about either is
  // then answered about whichever was interned first.
  expect(evaluated('String((type TypeError) === (type Error));')).toBe('false');
  expect(evaluated('String((type RangeError) === (type Error));')).toBe('false');
  expect(evaluated('String((type TypeError) === (type RangeError));')).toBe('false');
});

test('it matches what `is` and `instanceof` already answered', () => {
  // The point of the rule: the three agree. Before, the first two said *true*
  // and the annotation refused the same value.
  for (const [, ctor] of SUBCLASSES) {
    expect(evaluated(`String(${ctor} is Error);`)).toBe('true');
    expect(evaluated(`String(${ctor} instanceof Error);`)).toBe('true');
  }
});

test('a catch annotation admits any error', () => {
  // The most ordinary thing anyone writes about errors, and it could not be
  // written.
  expect(evaluated('try { throw new TypeError("x"); } catch (e: Error) { String("caught"); }')).toBe('caught');
  expect(evaluated('try { throw new RangeError("x"); } catch (e: Error) { String("caught"); }')).toBe('caught');
});

test('an unrelated library nominal is untouched', () => {
  // The table states a chain and answers nothing else. `Map` and `Set` are
  // siblings under no common library type.
  expectThrown('let m: Map = new Set();');
  expectThrown('let e: Error = new Map();');
  expectThrown('let m: Map = new TypeError("x");');
});

test('a USER class extending a library nominal reaches it', () => {
  // The chain the subtype relation walks is [[Base]], and a class's [[Base]] was
  // taken from `classTypeOf`, which finds only classes declared in SOURCE. A
  // library heritage left it undefined and the walk stopped short, so
  // `let e: Error = new MyErr()` was refused while `new MyErr() is Error` and
  // `instanceof` both answered *true*.
  expect(evaluated('class MyErr extends Error { } let e: Error = new MyErr();'
    + ' String(e instanceof Error);')).toBe('true');
  expect(evaluated('class M extends Map { } let m: Map = new M(); String(m instanceof Map);')).toBe('true');
  expect(evaluated('class S extends Set { } let s: Set = new S(); String(s instanceof Set);')).toBe('true');
});

test('the chain is walked all the way, through both kinds of link', () => {
  // A user class over a library SUBCLASS reaches the library BASE, which needs
  // both this rule and the error table: one link is `Base`, the next is the
  // built-in hierarchy.
  expect(evaluated('class MyErr extends TypeError { } let e: Error = new MyErr();'
    + ' String(e instanceof TypeError);')).toBe('true');
  expect(evaluated('class MyErr extends TypeError { } let e: TypeError = new MyErr();'
    + ' String(e instanceof TypeError);')).toBe('true');
  // Two user links then a library one.
  expect(evaluated('class B extends Error { } class C extends B { } let e: Error = new C();'
    + ' String(e instanceof Error);')).toBe('true');
});

test('extending a library nominal relates to THAT one and no other', () => {
  // The risk in taking a heritage name for a base is admitting too much. A
  // library base is a chain link, not a licence.
  expectThrown('class MyErr extends Error { } let r: RangeError = new MyErr();');
  expectThrown('class MyErr extends Error { } let m: Map = new MyErr();');
  expectThrown('class MyErr extends Map { } let e: Error = new MyErr();');
  // Still directional, and a class that extends nothing relates to nothing.
  expectThrown('class MyErr extends Error { } let m: MyErr = new Error("x");');
  expectThrown('class Plain { x: uint8 = 1; } let e: Error = new Plain();');
});
