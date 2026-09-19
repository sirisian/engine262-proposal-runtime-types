import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * `const p: [4].<B>` where `B extends A` adds a field ABORTED the engine with an
 * internal assertion. Not a wrong layout - the array could not be created at all.
 *
 * The cause was a disagreement about which fields a class has.
 * `Constructor.Fields` is built from "each ClassElement of elements", this
 * class's own body, so for a subclass it held only what the subclass declared.
 * The LAYOUT holds the base's fields too, and so does the value-type copy that
 * walks it. So the default instance of `B` defined `y` and left `x` absent, the
 * copy read *undefined* for `x`, and `DefineOwnProperty` refused it -
 * "undefined is not assignable to uint32" - inside an `X()` assertion, which is
 * why it surfaced as an abort rather than a diagnosis.
 *
 * `DefaultValueOf` now walks the heritage. The chain is the ENGINE's
 * [[Prototype]] - a subclass constructor's [[Prototype]] is its superclass
 * constructor - and not the host object's, which finds nothing.
 */

const AB = 'class A { x: uint32 = 1; } class B extends A { y: uint32 = 2; } ';

test('an array of a field-adding subclass can be created and used', () => {
  expect(evaluated(`${AB}const p: [4].<B>; String(p.length);`)).toBe('4');
  expect(evaluated(`${AB}const p: [4].<B>; p[0].x = 7; p[0].y = 9;
    String(p[0].x) + '/' + String(p[0].y);`)).toBe('7/9');
});

test('a multi-level hierarchy works, base fields first', () => {
  expect(evaluated(`${AB}class C extends B { z: uint32 = 3; }
    const p: [2].<C>; p[0].z = 5;
    String(p[0].x) + '/' + String(p[0].y) + '/' + String(p[0].z);`)).toBe('0/0/5');
});

test('a bare field of a subclass gets ALL its fields', () => {
  // The same defect without an array: `h.b.x` read *undefined* before, because
  // the inherited field was never defaulted.
  expect(evaluated(`${AB}class H { b: B; } const h = new H();
    String(h.b.x) + '/' + String(h.b.y);`)).toBe('0/0');
});

test('a default is the field TYPE\u2019s zero, not the declared initializer', () => {
  // `x = 1` and `y = 2` are constructor work; a default instance comes into
  // existence without running one, so both read 0. Pinned because the fix makes
  // the inherited field visible for the first time and 1/2 would look right.
  expect(evaluated(`${AB}const p: [4].<B>; String(p[0].x) + '/' + String(p[0].y);`)).toBe('0/0');
});

test('the cases that already worked are unchanged', () => {
  expect(evaluated(`${AB}const p: [4].<A>; p[0].x = 3; String(p[0].x);`)).toBe('3');
  expect(evaluated(`${AB}const b = new B(); String(b.x) + '/' + String(b.y);`)).toBe('1/2');
  expect(evaluated('class P { x: uint32 = 0; y: uint32 = 0; } const p: [4].<P>; String(p.length);')).toBe('4');
});
