import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-higher-kinded-parameters: a higher-kinded parameter "is not a type, so a
// type position naming one unapplied is a type error". It may be forwarded as
// the argument for a higher-kinded parameter of the same arity.

test('a slot that takes a type rejects an unapplied parameter', () => {
  expectStaticTypeError('function f<F<_>: type>() { let x: [].<F>; }');
  expectStaticTypeError('class Box<T: type> { v: T; } function f<F<_>: type>() { let x: Box.<F>; }');
});

test('is and := targets and alias right-hand sides are type positions', () => {
  expectStaticTypeError('function f<F<_>: type>(v: any) { return v is F; }');
  expectStaticTypeError('function f<F<_>: type>(v: any) { return v := F; }');
  expectStaticTypeError('function f<F<_>: type>() { type A = F; }');
});

test('forwarding to a higher-kinded slot and an applied use stay valid', () => {
  expect(evaluated('class Box<T: type> { v: T; } function g<G<_>: type>() {} function f<F<_>: type>() { g.<F>(); } f.<Box>(); \'ok\';')).toBe('ok');
  expect(evaluated('function f<F<_>: type>() { type A = F.<uint8>; } \'ok\';')).toBe('ok');
});
