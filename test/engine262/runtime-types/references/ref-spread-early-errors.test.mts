import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test('a known prefix before an iterable spread still requires ref syntax', () => {
  expectStaticTypeError('function take(ref x: uint8, ...rest: [].<uint8>) {} function unused(x: uint8, xs: Iterable.<uint8>) { take(x, ...xs); }');
  expectStaticTypeError('function take(ref x: uint8, ...rest: [].<string>) {} function unused(x: uint8, xs: string) { take(x, ...xs); }');
  expectStaticTypeError('function take(ref x: uint8, ...rest: [].<string>) {} function unused(x: uint8) { take(x, ..."tail"); }');
});

test('a known prefix before a spread checks the invariant referent type', () => {
  expectStaticTypeError('function take(ref x: number, ...rest: [].<number>) {} function unused(x: uint8, xs: Iterable.<number>) { take(ref x, ...xs); }');
  expectStaticTypeError('function take(ref x: float64, ...rest: [].<float64>) {} function unused(x: uint8, xs: Iterable.<float64>) { take(ref x, ...xs); }');
});

test('methods and constructors share reference-prefix checking', () => {
  expectStaticTypeError('class C { m(ref x: uint8, ...rest: [].<uint8>) {} } function unused(c: C, x: uint8, xs: Iterable.<uint8>) { c.m(x, ...xs); }');
  expectStaticTypeError('class C { constructor(ref x: uint8, ...rest: [].<uint8>) {} } function unused(x: uint8, xs: Iterable.<uint8>) { new C(x, ...xs); }');
});

test('correct references, decay, and iterator effects are preserved', () => {
  expect(evaluated('let effects = 0; function* gen(): uint8 { effects++; yield 2; } function take(ref x: uint8, ...rest: [].<uint8>) { x = 3; } function run(x: uint8, xs: Iterable.<uint8>): uint8 { take(ref x, ...xs); return x; } String(run(1, gen())) + ":" + effects;')).toBe('3:1');
  expect(evaluated('function* gen(): uint8 { yield 2; } function take(x: uint8, ...rest: [].<uint8>) { x = 3; } function run(x: uint8, xs: Iterable.<uint8>): uint8 { take(ref x, ...xs); return x; } String(run(1, gen()));')).toBe('1');
});

test('unknown positions, optional prefixes, rests and object protocols are deferred', () => {
  for (const source of [
    'function take(ref x: uint8) {} function unused(xs: Iterable.<uint8>) { take(...xs); }',
    'function take(x: uint8 = 0, ref y: uint8) {} function unused(x: uint8, xs: Iterable.<uint8>) { take(x, ...xs); }',
    'function take(...rest: [].<uint8>, ref x: uint8) {} function unused(x: uint8, xs: Iterable.<uint8>) { take(x, ...xs); }',
    'function take(ref x: uint8, ...rest: [].<uint8>) {} function unused(x: uint8, xs: any) { take(x, ...xs); }',
    'function take(ref x: uint8, ...rest: [].<uint8>) {} function unused(x: uint8, xs: [].<uint8>) { take(x, ...xs); }',
    'function unused(take: any, x: uint8, xs: Iterable.<uint8>) { take(x, ...xs); }',
  ]) expect(ok(source), source).toBe(true);
});
