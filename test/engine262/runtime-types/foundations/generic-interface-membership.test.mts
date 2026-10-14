import { test, expect } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

const P = 'interface P<T: type> { x: T; } ';
const o = 'let o = {}; o.x = (1 := uint8); ';

test('a generic interface discriminates its type arguments', () => {
  // A generic interface's [[Structure]] is built once, at the declaration, with its
  // parameters resolved to ~any~ - there is no argument to resolve them to yet - so
  // membership must be judged against the application's own structure, not against
  // `{ x: any }`, which would admit every application.
  //
  // #sec-issubtype requires invariance: "a generic class is invariant in its arguments".
  // Membership obeys it as the type relation does.
  expect(evaluated(`${P} ${o} String(o is P.<uint8>);`)).toBe('true');
  expect(evaluated(`${P} ${o} String(o is P.<string>);`)).toBe('false');
});

test('an inadmissible member is refused at every boundary, not just `is`', () => {
  // Membership and boundary conversion are different judgments. Numeric to
  // String conversion is permitted; a numeric value cannot become a Boolean
  // at a checked boundary. Keep that genuinely inadmissible target here.
  expectThrown(`${P} ${o} function f(p: P.<boolean>) { return 1; } f(o);`);
  expectThrown(`${P} ${o} let q: P.<boolean> = o;`);
  expectThrown(`${P} ${o} function f(p: P.<boolean>): boolean { return p.x; } f(o);`);
  expectThrown('interface GS<T: type> { x: T; } class GI implements GS.<uint8> { x: uint8; } '
    + 'let h: GS.<string> = new GI();');
});

test('a permitted structural conversion preserves identity and changes the member', () => {
  expect(evaluated(`${P} ${o} function f(p: P.<string>): string { return p.x; } String(f(o)) + ":" + typeof o.x;`)).toBe('1:string');
  expect(evaluated(`${P} ${o} let q: P.<string> = o; String(q === o) + ":" + typeof q.x;`)).toBe('true:string');
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
  expect(evaluated('interface U<T: type> { y: uint8; } let s = {}; s.y = (1 := uint8); String(s is U.<string>);')).toBe('true');
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
  expect(ok('interface GS2<T: type> { x: T; } class GI2 implements GS2.<uint8> { x: uint8; } '
    + 'let g: GS2.<uint8> = new GI2();')).toBe(true);
  // A generic ALIAS was already correct and is untouched.
  expect(evaluated('type A<T: type> = { x: T }; let s = {}; s.x = (1 := uint8); String(s is A.<string>);')).toBe('false');
});
