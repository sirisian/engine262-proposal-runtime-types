import { test, expect } from 'vitest';
import { evaluated, expectEarlyError, expectThrown, observeScript } from '../harness.mts';

/**
 * A partial class names a private member of the class it extends (#sec-partial-classes).
 *
 * "A part may name a private member of the class it extends where the part is in the source
 * text that declares the class. ... A part in another source text has no access to the private
 * names, as no other code has."
 *
 * A part was parsed as a class body of its own, so a private name it used was "not defined":
 * a class written in parts could keep nothing private that a later part worked on.
 */

test('a part in the declaring source text reads, writes and calls the private members', () => {
  expect(evaluated('class A { #n: uint8 = 3; } partial class A { get() { return this.#n; } } String(new A().get());')).toBe('3');
  expect(evaluated('class A { #n: uint8 = 3; } partial class A { bump() { this.#n++; return this.#n; } } String(new A().bump());')).toBe('4');
  expect(evaluated('class A { n: uint8 = 1; #twice() { return this.n * 2; } } partial class A { go() { return this.#twice(); } } String(new A().go());')).toBe('2');
  // The names are the class's own: a brand check in a part is the one the class makes.
  expect(evaluated('class A { #n: uint8 = 3; } partial class A { static is(o) { return #n in o; } } String(A.is(new A())) + String(A.is({}));')).toBe('truefalse');
  // A class with no annotation, and a generic one.
  expect(evaluated('class A { #n = 3; } partial class A { get() { return this.#n; } } String(new A().get());')).toBe('3');
  expect(evaluated('class B<T: type> { #v: T; constructor(v: T) { this.#v = v; } } partial class B { get(): T { return this.#v; } } String(new B.<uint8>(7).get());')).toBe('7');
  // Two parts, each using what the class declares.
  expect(evaluated('class A { #n: uint8 = 1; } partial class A { inc() { this.#n++; } } partial class A { get() { return this.#n; } } const a = new A(); a.inc(); String(a.get());')).toBe('2');
});

test('a name the class does not declare is refused before the program runs', () => {
  expect(observeScript('class A { #n: uint8 = 3; } partial class A { get() { return this.#zzz; } }'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-partial-class' } });
  expectThrown('class A { #n: uint8 = 3; } partial class A { get() { return this.#zzz; } }', '"#zzz" is not a private member of "A"');
});

test('a class that is not a part has no access, as before', () => {
  expectEarlyError('class A { #n: uint8 = 3; } class C { get(a) { return a.#n; } }', 'SyntaxError');
  expectEarlyError('class A { #n: uint8 = 3; } function f(a) { return a.#n; }', 'SyntaxError');
});

test('a part in another source text has no access', () => {
  // Two scripts in one realm: the class is declared by the first, and the part is in the second.
  expect(evaluated('class A { n: uint8 = 1; } partial class A { twice() { return this.n * 2; } } String(new A().twice());')).toBe('2');
  expectThrown('const A = (0, eval)("class A { #n = 3; } A"); partial class A { get() { return this.#n; } }',
    'a partial class names the private member "#n" of "A", which it may do only in the source text that declares the class');
  // The same part without the private name extends the class as any part does.
  expect(evaluated('const A = (0, eval)("class A { n = 3; } A"); partial class A { get() { return this.n; } } String(new A().get());')).toBe('3');
});
