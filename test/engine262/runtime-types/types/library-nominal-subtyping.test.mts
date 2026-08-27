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
