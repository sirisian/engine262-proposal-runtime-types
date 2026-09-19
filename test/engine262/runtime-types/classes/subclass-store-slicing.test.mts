import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A subclass may not be stored where a base VALUE TYPE CLASS is declared: the
 * base's storage is `Base.byteLength` wide and the subclass does not fit, so the
 * store kept `instanceof Sub` while the subclass's own fields read *undefined* -
 * a method declared `(): uint32` returned *undefined*.
 *
 * Two conditions, and the second was missing at first:
 *
 *  - the source must reach the target through its base chain, AND
 *  - it must be WIDER. `class Q extends P { }` has `P`'s layout exactly, so
 *    storing a `Q` into a `P` loses nothing and stays legal. Refusing it was a
 *    defect of its own, introduced by the first half of this rule.
 *
 * Compared by BYTE LENGTH rather than field count: the question is whether the
 * value fits the target's storage. Where either layout is missing there is no
 * fixed storage to overflow, which is what keeps a library nominal - `class
 * MyErr extends Error {}` - assignable to `Error`.
 */
const P = 'class P { x: uint32 = 1; } ';

test('a wider subclass may not be stored in a base-typed position', () => {
  expectThrown(`${P}class R extends P { y: uint32 = 2; }
    class H { p: P = new P(); } const h = new H(); h.p = new R();`, 'is not assignable to');
  expectThrown(`${P}class R extends P { y: uint32 = 2; }
    const a: [2].<P>; a[0] = new R();`, 'is not assignable to');
});

test('a subclass arriving through `any` is refused by the same rule', () => {
  // The dynamic boundary needs no separate rule: it already admits a source only
  // where the target represents it exactly, and a wider subclass never does.
  expectThrown(`${P}class R extends P { y: uint32 = 2; }
    class H { p: P = new P(); } const h = new H(); const z: any = new R(); h.p = z;`,
  'is not assignable to');
});

test('a subclass that adds no storage is still assignable', () => {
  // `Q` is `P`'s layout exactly. Nothing is lost, so nothing is refused.
  expect(evaluated(`${P}class Q extends P { }
    class H { p: P = new P(); } const h = new H(); h.p = new Q(); String(h.p.x);`)).toBe('1');
});

test('the cases that must keep working do', () => {
  expect(evaluated(`${P}class H { p: P = new P(); } const h = new H(); h.p = new P(); String(h.p.x);`)).toBe('1');
  // A library nominal has no fixed layout to overflow.
  expect(evaluated('class MyErr extends Error { } let e: Error = new MyErr(); String(e instanceof Error);')).toBe('true');
  // The subtype relation itself is untouched - only the store is refused.
  expect(evaluated(`${P}class R extends P { y: uint32 = 2; } const r = new R();
    String(r is P) + '/' + String(r instanceof P);`)).toBe('true/true');
  // And each concrete class keeps its own array.
  expect(evaluated(`${P}class R extends P { y: uint32 = 2; }
    const a: [2].<R>; a[0].y = 5; String(a[0].y);`)).toBe('5');
});

/**
 * The run-time rule reaches a STORE. A local, a `return` and a parameter have no
 * store to hang it on, and accepting them produced a value whose declared type
 * no store would take:
 *
 *   let p: P = new R();     // accepted
 *   h.f = p;                // refused - `p` is stuck
 *
 * That is worse than a lossy conversion, since the error lands far from the line
 * that caused it. `requireAssignable` now refuses the same stores at the line
 * that writes them, using a width the DECLARATION can answer.
 */
const PR = 'class P { x: uint32 = 1; } class R extends P { y: uint32 = 2; } class Q extends P { } ';

test('a wider subclass is refused where no store would take it either', () => {
  expectThrown(`${PR}let p: P = new R();`, 'is not assignable to');
  expectThrown(`${PR}function f(): P { return new R(); }`, 'is not assignable to');
  expectThrown(`${PR}function f(v: P): uint32 { return v.x; } f(new R());`, 'is not assignable to');
  expectThrown(`${PR}class H { t(v: P): uint32 { return v.x; } } new H().t(new R());`,
    'is not assignable to');
});

test('a subclass adding no storage is accepted in those positions too', () => {
  // `inlineFieldsOf`, the resolver that answers this before a layout exists, was
  // written for CYCLE DETECTION and reports the base slice as a synthetic field
  // keyed `[[Base]]`. Counting it made `class Q extends P {}` look as though it
  // had declared storage, and every position refused a store that loses nothing.
  expect(evaluated(`${PR}let p: P = new Q(); String(p.x);`)).toBe('1');
  expect(evaluated(`${PR}function f(): P { return new Q(); } String(f().x);`)).toBe('1');
  expect(evaluated(`${PR}function f(v: P): uint32 { return v.x; } String(f(new Q()));`)).toBe('1');
});

test('the keepers survive the static rule as well', () => {
  expect(evaluated(`${PR}let p: P = new P(); String(p.x);`)).toBe('1');
  expect(evaluated('class MyErr extends Error { } let e: Error = new MyErr(); String(e instanceof Error);')).toBe('true');
  expect(evaluated(`${PR}function g<T extends P>(a: T): uint32 { return a.y; } String(g.<R>(new R()));`)).toBe('2');
  expect(evaluated(`${PR}const a: [2].<R>; a[0].y = 5; String(a[0].y);`)).toBe('5');
});
