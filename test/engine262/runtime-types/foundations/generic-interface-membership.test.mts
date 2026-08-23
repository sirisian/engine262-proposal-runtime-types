import { test, expect } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

const P = 'interface P<T> { x: T; } ';
const o = 'let o = {}; o.x = (1 := uint8); ';

test('a generic interface discriminates its type arguments', () => {
  // OUTSTANDING item O. A generic interface's [[Structure]] was built ONCE, at
  // the declaration, with its parameters resolved to ~any~ - there is no
  // argument to resolve them to yet - so membership compared every application
  // against `{ x: any }` and admitted them all.
  //
  // #sec-issubtype requires invariance: "a generic class is invariant in its
  // arguments". The type RELATION already obeyed it; membership did not.
  expect(evaluated(`${P} ${o} String(o is P.<uint8>);`)).toBe('true');
  expect(evaluated(`${P} ${o} String(o is P.<string>);`)).toBe('false');
});

test('the wrong argument is refused at every boundary, not just `is`', () => {
  // The hole was not confined to the operator. A value crossed at a parameter
  // and at an annotation, and could then be READ at a type it did not have -
  // a `uint8` returned from a function declared `: string`. That is the only
  // SOUNDNESS defect this cycle found; every other was a wrong refusal.
  expectThrown(`${P} ${o} function f(p: P.<string>) { return 1; } f(o);`);
  expectThrown(`${P} ${o} let q: P.<string> = o;`);
  expectThrown(`${P} ${o} function f(p: P.<string>): string { return p.x; } f(o);`);
  // And a declared, checked implementation crossed it too - not only ad-hoc
  // object literals.
  expectThrown('interface GS<T> { x: T; } class GI implements GS.<uint8> { x: uint8; } '
    + 'let h: GS.<string> = new GI();');
});

test('subtyping discriminates the arguments too, in both directions', () => {
  // The same erasure damaged THREE consumers: membership, and the two
  // object-to-interface arms of IsSubtype. Fixing membership alone left those
  // comparing an object type against unsubstituted ~parameter~ records, which
  // matched nothing - a regression no suite caught, because nothing exercised
  // object-to-generic-interface assignability. These are that test.
  expect(evaluated(`${P} String(Reflect.isAssignable(type { x: uint8 }, type P.<uint8>));`)).toBe('true');
  expect(evaluated(`${P} String(Reflect.isAssignable(type { x: uint8 }, type P.<string>));`)).toBe('false');
  // Interface-to-interface was always right: it compares declarations and
  // arguments and never reads [[Structure]].
  expect(evaluated(`${P} String(Reflect.isAssignable(type P.<uint8>, type P.<string>));`)).toBe('false');
});

test('what the fix must not disturb', () => {
  // An interface whose parameter is UNUSED must still admit every application.
  // A rule phrased as "the argument must match" rather than "the parameter must
  // be substituted" gets this backwards and refuses them all.
  expect(evaluated('interface U<T> { y: uint8; } let s = {}; s.y = (1 := uint8); String(s is U.<string>);')).toBe('true');
  // `any` substituted is still `any`.
  expect(evaluated(`${P} ${o} String(o is P.<any>);`)).toBe('true');
  // A NON-generic interface has no parameters to substitute.
  expect(evaluated('interface S { x: uint8; } let s = {}; s.x = (1 := uint8); String(s is S);')).toBe('true');
  // A value of the wrong SHAPE was always refused, and still is - the structure
  // was right about the shape and wrong only about the parameter positions.
  expect(evaluated(`${P} let s = {}; s.y = (1 := uint8); String(s is P.<string>);`)).toBe('false');
  // A class implementing a generic interface still satisfies it. The
  // `implements` clause is REQUIRED - a class does not satisfy an interface by
  // shape alone.
  expect(ok('interface GS2<T> { x: T; } class GI2 implements GS2.<uint8> { x: uint8; } '
    + 'let g: GS2.<uint8> = new GI2();')).toBe(true);
  // A generic ALIAS was already correct and is untouched.
  expect(evaluated('type A<T> = { x: T }; let s = {}; s.x = (1 := uint8); String(s is A.<string>);')).toBe('false');
});
