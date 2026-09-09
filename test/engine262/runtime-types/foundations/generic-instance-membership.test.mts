import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const G = 'class G<T> { x: uint8; } ';

test('a specialized instance is a member of its own type', () => {
  // OUTSTANDING item N. A generic class APPLICATION is a distinct constructor
  // with its own prototype, and an instance of it sits on THAT chain - but an
  // annotation's Type Record carried the DECLARATION's constructor, so
  // membership tested against a prototype the instance is never on.
  //
  // The two chains are disjoint, measured: the specialization's prototype does
  // not inherit from the declaration's, so no prototype walk reaches it either.
  // The record had to carry the right constructor.
  expect(evaluated(`${G} String(new G.<uint8>() is G.<uint8>);`)).toBe('true');
  // The intermediate binding the item was filed on.
  expect(evaluated(`${G} const i = new G.<uint8>(); let b: G.<uint8> = i; String(b.x);`)).toBe('0');
});

test('membership still discriminates, and still refuses what it should', () => {
  // #sec-issubtype: "a generic class is invariant in its arguments, so
  // Map.<string, uint8> is a subtype of no other instantiation of Map." One
  // specialization is not a member of another.
  expect(evaluated(`${G} String(new G.<uint8>() is G.<string>);`)).toBe('false');
  // There is no UNSPECIALIZED type to be a member of: a bare `G` in type
  // position names `G.<>`, an error where T has no default (PLAN-v3 Q7-a),
  // and the FAMILY is spelled `G.<any>`, which every specialization satisfies
  // (the collections' wildcard rule, extended to a user class).
  expectThrown(`${G} String(new G.<uint8>() is G);`);
  expect(evaluated(`${G} String(new G.<uint8>() is G.<any>);`)).toBe('true');
  expect(evaluated(`${G} String(Reflect.isAssignable(type G.<uint8>, type G.<any>));`)).toBe('true');
  expect(evaluated(`${G} String(Reflect.isAssignable(type G.<any>, type G.<uint8>));`)).toBe('false');
});

test('the shapes that already worked are unchanged', () => {
  expect(evaluated('class P { x: uint8; } String(new P() is P);')).toBe('true');
  // A bare construction of a generic class constructs a specialization, from
  // its context where the arguments reach nothing (PLAN-v3 Q1, Q2-c); with
  // neither, the naming error (Q4) rather than an instance of an open type.
  expect(evaluated(`${G} let b: G.<uint8> = new G(); String(b is G.<uint8>);`)).toBe('true');
  expectThrown(`${G} new G();`, 'is not determined by the arguments and has no default');
  expect(evaluated(`${G} let b: G.<uint8> = new G.<uint8>(); String(b.x);`)).toBe('0');
  expect(evaluated('class C<T = uint8> { x: uint8; } let c: C = new C(); String(c.x);')).toBe('0');
});

test('the three-way contradiction is resolved, not traded', () => {
  // The evidence this defect was found by: SameType true, IsAssignable true,
  // `is` FALSE. A fix that made `is` true by changing what `typeOf` answers
  // would have broken the first two instead. All three now agree.
  const s = `${G} const s = new G.<uint8>(); `;
  expect(evaluated(`${s} String(Reflect.typeOf(s) === (type G.<uint8>));`)).toBe('true');
  expect(evaluated(`${s} String(Reflect.isAssignable(Reflect.typeOf(s), type G.<uint8>));`)).toBe('true');
  expect(evaluated(`${s} String(s is G.<uint8>);`)).toBe('true');
});
