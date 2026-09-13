import { expect, test } from 'vitest';
import { expectEarlyError, ok } from '../harness.mts';

test.each([
  'class C<out T> { x: T; }',
  'class C<in T> { x: T; }',
  'class C<out T> { readonly f: (x: T) => void; }',
  'class C<in T> { f(callback: (x: T) => void) {} }',
  'interface C<out T> { readonly f: (x: T) => void; }',
  'class Box<T> { x: T; } class C<out T> { readonly x: Box.<T>; }',
])('rejects an incompatible composed polarity: %s', (source) => {
  expectEarlyError(source, 'SyntaxError');
});

test.each([
  'class C<T> { x: T; }',
  'class C<out T> { readonly x: T; }',
  'class C<out T> { f(callback: (x: T) => void) {} }',
  'class C<in T> { f(): (x: T) => void { throw 0; } }',
  'class C<out T> { f<T>(x: T) {} }',
  'interface C<out T> { f(callback: (x: T) => void); }',
  'class Box<out T> { readonly x: T; } class C<out T> { readonly x: Box.<T>; }',
])('composes polarity and respects shadowing: %s', (source) => {
  expect(ok(source)).toBe(true);
});
