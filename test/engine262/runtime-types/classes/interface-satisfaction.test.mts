import { test, expect } from 'vitest';
import { evaluated, ok, expectError } from '../harness.mts';

/**
 * PLAN-iteration-types-engine.md phase 1: pin the ground.
 *
 * Every behaviour here already works and none of it was asserted anywhere,
 * which is the whole reason the file exists. The iteration types rest on all of
 * it — `Iterator` is a class declaring that it implements `IterableIterator`,
 * and a hand-written `{ next() { … } }` has to satisfy the interface without
 * declaring anything — so a silent regression in any row below would surface
 * later as a confusing failure in a feature that did not cause it.
 *
 * The specification calls these out in #sec-object-types, which defines the
 * structural form of an interface, and in IsOfType, which states that a
 * structural check reads each member once.
 */

test('an object literal satisfies an interface by having its members', () => {
  expect(ok(`
    interface I { a: string; }
    function f(x: I) {}
    f({ a: 's' });
  `)).toBe(true);
});

test('a class satisfies an interface it declares', () => {
  expect(ok(`
    interface I { a: string; }
    class C implements I { a: string = 's'; }
    function f(x: I) {}
    f(new C());
  `)).toBe(true);
});

test('a class satisfies an interface it does NOT declare', () => {
  // The case the structural form exists for. A class states a construction and
  // an identity as well as a shape, so it would be refused by a rule that
  // compared kinds before members — which is what the specification's kind
  // guard does, and why the structural form is consulted before it.
  expect(ok(`
    interface I { a: string; }
    class D { a: string = 's'; }
    function f(x: I) {}
    f(new D());
  `)).toBe(true);
});

test('a value of the wrong shape is refused', () => {
  // The assertion that keeps the three above from passing vacuously: if
  // satisfaction were unchecked they would all pass and so would this.
  expectError(`
    interface I { a: string; }
    class E { b: string = 's'; }
    function f(x: I) {}
    f(new E());
  `);
});

test('a structural check reads each member once', () => {
  // #sec-isoftype: a structural check reads each member of the type once and
  // decides on what it read, so a Proxy trap or a getter runs at most once per
  // member per check and cannot answer one way to the step that admits a value
  // and another to a later one. Unobservable except by counting.
  expect(evaluated(`
    interface I { a: string; b: string; }
    let reads = 0;
    const p = new Proxy({ a: 's', b: 't' }, {
      get(t, k) { if (k === 'a' || k === 'b') { reads += 1; } return t[k]; },
    });
    function f(x: I) {}
    f(p);
    String(reads);
  `)).toBe('2');
});

test('an interface and a class coexist in one script', () => {
  // Asserted because an earlier draft of the plan reported this as a blocking
  // bug. It was not: the failure reproduced only in a harness evaluating
  // several scripts in ONE realm, where a second `interface I` collides with
  // the first. The test is kept so the claim stays falsifiable.
  expect(ok(`
    interface I { a: string; }
    class C { a: string = 's'; }
  `)).toBe(true);
  expect(ok(`
    interface I { a: string; }
    interface J { b: string; }
  `)).toBe(true);
});
