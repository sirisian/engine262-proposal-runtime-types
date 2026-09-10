import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../harness.mts';

/**
 * A class may declare more than one constructor.
 *
 * Base ECMAScript forbids a second `constructor` in a class body outright, and
 * this proposal previously declined to relax it - `#sec-decorator-contexts` said
 * a constructor "is the one method that may not be overloaded, so its
 * `signatures` has exactly one entry". It now may, where the declarations are
 * distinct signatures and at least one parameter across the set carries an
 * annotation.
 *
 * The annotation is what turns the feature on. A class body with no types in it
 * behaves exactly as it did, which is what keeps untyped code unaffected: this
 * change only ACCEPTS programs that were rejected, and never alters one that
 * already ran.
 *
 * Resolution is `resolveOverload` - the same operation an overloaded FUNCTION
 * call uses - over signatures built from each constructor's own annotations. The
 * checker asks `resolveOverloadByTypes`, its type-based sibling, of the same
 * table. Both sides answer one question with one rule, which is the standing
 * requirement here: four defects in this area have been two sides disagreeing
 * about a type.
 */

const byArity = 'class C { x: uint32 = 0;'
  + ' constructor(a: uint32) { this.x = 1; }'
  + ' constructor(a: uint32, b: uint32) { this.x = 2; } } ';
const byType = 'class D { x: uint32 = 0;'
  + ' constructor(a: uint32) { this.x = 1; }'
  + ' constructor(a: string) { this.x = 2; } } ';

test('an overload set is selected by arity', () => {
  expect(evaluated(`${byArity} String(Number(new C((1 := uint32)).x));`)).toBe('1');
  expect(evaluated(`${byArity} String(Number(new C((1 := uint32), (2 := uint32)).x));`)).toBe('2');
});

test('...and by argument TYPE, not only arity', () => {
  // Both take one parameter, so nothing but the type distinguishes them.
  expect(evaluated(`${byType} String(Number(new D((1 := uint32)).x));`)).toBe('1');
  expect(evaluated(`${byType} String(Number(new D("s").x));`)).toBe('2');
});

test('an unmatched construction is refused, not silently routed', () => {
  // Before dispatch existed the first constructor always ran, so a call meant for
  // the second was refused by the FIRST one's parameter types - a diagnostic
  // naming a type the program never wrote.
  expectThrown(`${byArity} new C();`, 'no overload of');
});

test('`super` reaches the right overload', () => {
  // A derived constructor calls the base's [[Construct]], so it dispatches by the
  // same path rather than by one of its own.
  expect(evaluated(`${byArity} class S extends C { constructor() { super((1 := uint32), (2 := uint32)); } }`
    + ' String(Number(new S().x));')).toBe('2');
});

test('the annotation is what turns it on', () => {
  expect(ok('class A { constructor(a: uint32) {} constructor(a: uint32, b: uint32) {} }')).toBe(true);
  // One annotation anywhere in the set is enough, and it may come second.
  expect(ok('class A { constructor(a: uint32) {} constructor(a, b) {} }')).toBe(true);
  expect(ok('class A { constructor(a) {} constructor(a: uint32, b) {} }')).toBe(true);
  // With none, the class body is exactly what it was: a Syntax Error.
  expectThrown('class A { constructor(a) {} constructor(a, b) {} }', 'Duplicate constructor');
});

test('a single constructor is untouched', () => {
  // The dispatch is skipped entirely where there is nothing to choose between, so
  // an ordinary class pays nothing and behaves as before.
  expect(evaluated('class E { x: uint32 = 0; constructor(a: uint32) { this.x = 7; } }'
    + ' String(Number(new E((1 := uint32)).x));')).toBe('7');
  expect(evaluated('class P { constructor(a) { this.a = a; } } String(new P(5).a);')).toBe('5');
});

test('two constructors with the SAME parameter types are an error at the class', () => {
  // Signature identity is the parameter types, and a constructor cannot differ by
  // return type - a construction yields the class - so identical parameters is
  // one signature declared twice. Reported where the mistake is, in the words the
  // FUNCTION rule already uses.
  //
  // Not the method precedent, deliberately: two identical METHODS are accepted
  // and every call to them is ambiguous, which reports at a distance and is a
  // defect in its own right - `class C { m() { return 1; } m() { return 2; } }`
  // is ordinary JavaScript that behaviour breaks. C++, Java and Rust all reject
  // this at the declaration.
  expectThrown('class A { constructor(a: uint32) {} constructor(a: uint32) {} }',
    '"A" is declared twice with the same parameter types');
  // Static, so it fires for code that never runs.
  expectThrown('if (false) { class A { constructor(a: uint32) {} constructor(a: uint32) {} } }',
    'is declared twice with the same parameter types');
  // Distinct sets are unaffected, by arity or by type.
  expect(ok('class A { constructor(a: uint32) {} constructor(a: uint32, b: uint32) {} }')).toBe(true);
  expect(ok('class A { constructor(a: uint32) {} constructor(a: string) {} }')).toBe(true);
});

test('every one-parameter overload is a converting constructor', () => {
  // `#sec-conversions` makes a one-parameter constructor a converting one. With
  // an overload set there are several, and the conversion resolves by argument
  // type like any other call rather than picking one arbitrarily or refusing.
  const M = 'class M { v: uint32 = 0;'
    + ' constructor(a: uint32) { this.v = 1; }'
    + ' constructor(a: string) { this.v = 2; } } ';
  expect(evaluated(`${M} let t: M = (1 := uint32); String(Number(t.v));`)).toBe('1');
  expect(evaluated(`${M} let t: M = "s"; String(Number(t.v));`)).toBe('2');
  // A sole one-parameter constructor converts as it always did.
  expect(evaluated('class N { v: uint32 = 0; constructor(a: uint32) { this.v = 9; } }'
    + ' let t: N = (1 := uint32); String(Number(t.v));')).toBe('9');
  // An overload of another arity is not a converting constructor and does not
  // disturb the one that is.
  expect(evaluated('class P { v: uint32 = 0; constructor(a: uint32) { this.v = 1; }'
    + ' constructor(a: uint32, b: uint32) { this.v = 2; } }'
    + ' let t: P = (1 := uint32); String(Number(t.v));')).toBe('1');
});
