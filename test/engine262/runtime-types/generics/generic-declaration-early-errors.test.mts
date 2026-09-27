import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

// #sec-generics: generic method bodies are checked even when never called.
test.each([
  'class C { f<T: type>(x: T) { let v: T = 5; } }',
  'class C { static f<T: type>(): T { return 5; } }',
  'const o = { f<T: type>(x: T) { let v: T = 5; } };',
  'class C { f<T: type extends string>(x: T) { let v: uint8 = x; } }',
  'type T = uint8; class C { f<T: type>(): T { return 5; } }',
  'class C<T: type> { f<T: type>(x: T) { let v: T = 5; } }',
])('rejects an invalid generic method body: %s', expectStaticTypeError);

test.each([
  'class C { f<T: type>(x: T): T { return x; } }',
  'class C<T: type> { f<U: type>(x: T, y: U): U { return y; } }',
  'class C<T: type> { f<T: type>(x: T): T { return x; } }',
  "const T = 'method'; class C { [T]<T: type>(x: T): T { return x; } }",
  'const o = { f<T: type>(x: T): T { return x; } };',
])('preserves valid method scopes: %s', (source) => expect(ok(source)).toBe(true));

// #sec-generic-variance: a mutable reference is invariant on every annotation surface.
test.each([
  'interface I<out T: type> { get(): ref T; }',
  'interface I<in T: type> { set(ref x: T): void; }',
  'class C<in T: type> { set(ref x: T) {} }',
  'function f<in T: type>(ref x: T) {}',
  'class C { f<in T: type>(ref x: T) {} }',
  'type F<out T: type> = () => ref T;',
])('rejects variant reference targets: %s', (source) => expectEarlyError(source, 'SyntaxError'));

test.each([
  'interface I<T: type> { get(): ref T; set(ref x: T): void; }',
  'class C<T: type> { set(ref x: T) {} }',
  'function f<T: type>(ref x: T) {}',
  'interface I<out T: type> { readonly value: [T]; }',
])('preserves invariant references and tuple covariance: %s', (source) => expect(ok(source)).toBe(true));

// #sec-generic-variance: declaration lookup and argument binding precede polarity.
test.each([
  'type P<out T: type> = { readonly value: T }; interface I<out T: type> { readonly value: P.<T>; }',
  'type P<out T: type> = { readonly value: T }; { type P<T: type> = { value: T }; interface I<T: type> { readonly value: P.<T>; } }',
  'type P<T: type> = { value: T }; { type P<out T: type> = { readonly value: T }; interface I<out T: type> { readonly value: P.<T>; } }',
  'interface P<out T: type, U: type> { readonly value: T; } interface I<out T: type> { readonly value: P.<U: uint8, T: T>; }',
  'interface P<out T: type, U: type = uint8> { readonly value: T; } interface I<out T: type> { readonly value: P.<T: T>; }',
  'type P<out T: type, U: type> = { readonly value: T }; interface I<out T: type> { readonly value: P.<U: uint8, T: T>; }',
  'interface P<in T: type, U: type> { accept(x: T): void; } interface I<in T: type> { readonly value: P.<U: uint8, T: T>; }',
])('accepts correctly composed variance: %s', (source) => expect(ok(source)).toBe(true));

test.each([
  'type P<out T: type> = { readonly value: T }; { type P<T: type> = { value: T }; interface I<out T: type> { readonly value: P.<T>; } }',
  'interface P<T: type, out U: type> { value: T; readonly other: U; } interface I<out T: type> { readonly value: P.<U: string, T: T>; }',
  'type P<T: type, out U: type> = { value: T; readonly other: U }; interface I<out T: type> { readonly value: P.<U: string, T: T>; }',
  'type Promise<T: type> = { value: T }; interface I<out T: type> { readonly value: Promise.<T>; }',
])('rejects the parameter actually bound invariantly: %s', (source) => expectEarlyError(source, 'SyntaxError'));

// #sec-generics: both nominal and structural substitution descend into ref targets.
const referenceDeclarations = [
  ['interface I<T: type> { get(): ref T; }', 'a: I.<uint8>', 'a.get()'],
  ['class C<T: type> { get(): ref T { throw 0; } }', 'a: C.<uint8>', 'a.get()'],
  ['type F<T: type> = () => ref T;', 'a: F.<uint8>', 'a()'],
  ['function first<T: type>(a: [].<T>): ref T { return ref a[0]; }', 'a: [].<uint8>', 'first.<uint8>(a)'],
];
for (const [declaration, parameter, location] of referenceDeclarations) {
  test(`specialized reference reads, stores and borrows: ${declaration}`, () => {
    expect(ok(`${declaration} function take(ref x: uint8) {} function f(${parameter}) {
      let v: uint8 = ${location}; ${location} = 1; let ref r = ${location}; take(ref ${location});
    }`)).toBe(true);
    expectStaticTypeError(`${declaration} function f(${parameter}) { ${location} = 'bad'; }`);
  });
}

test('a generic reference still aliases the original storage', () => {
  expect(evaluated('function first<T: type>(a: [].<T>): ref T { return ref a[0]; } let a: [].<uint8> = [1]; first.<uint8>(a) = 2; String(a[0]);')).toBe('2');
});

test.each([
  'interface I<T: type> { get<T: type>(x: T): ref T; } function f(a: I.<uint8>) { let s: string = a.get.<string>("ok"); }',
  'class C<T: type> { get<T: type>(x: T): ref T { throw 0; } } function f(a: C.<uint8>) { let s: string = a.get.<string>("ok"); }',
  'type I<T: type> = { get<T: type>(x: T): ref T }; function f(a: I.<uint8>) { let s: string = a.get.<string>("ok"); }',
  'interface I<T: type> { get(): ref T; readonly next: I.<T>; } function f(a: I.<uint8>) { a.next.get() = 1; }',
])('recursion and nested generic shadowing: %s', (source) => expect(ok(source)).toBe(true));
