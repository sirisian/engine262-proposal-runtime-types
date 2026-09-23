import { expect, test } from 'vitest';
import { expectEarlyError, ok } from '../harness.mts';

test.each([
  'class C<out T: type> { x: T; }',
  'class C<in T: type> { x: T; }',
  'class C<out T: type> { readonly f: (x: T) => void; }',
  'class C<in T: type> { f(callback: (x: T) => void) {} }',
  'interface C<out T: type> { readonly f: (x: T) => void; }',
  'class Box<T: type> { x: T; } class C<out T: type> { readonly x: Box.<T>; }',
])('rejects an incompatible composed polarity: %s', (source) => {
  expectEarlyError(source, 'SyntaxError');
});

test.each([
  'class C<T: type> { x: T; }',
  'class C<out T: type> { readonly x: T; }',
  'class C<out T: type> { f(callback: (x: T) => void) {} }',
  'class C<in T: type> { f(): (x: T) => void { throw 0; } }',
  'class C<out T: type> { f<T: type>(x: T) {} }',
  'interface C<out T: type> { f(callback: (x: T) => void); }',
  'class Box<out T: type> { readonly x: T; } class C<out T: type> { readonly x: Box.<T>; }',
])('composes polarity and respects shadowing: %s', (source) => {
  expect(ok(source)).toBe(true);
});
