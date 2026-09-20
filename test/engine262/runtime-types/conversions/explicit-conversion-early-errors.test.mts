import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-convertvalue: a statically impossible conversion rejects the whole
// source, even when the operation is in a function that is never called.
test.each(['boolean', 'symbol', 'null', 'undefined'])('a known %s has no sized numeric conversion', (source) => {
  for (const target of ['uint8', 'int32', 'float32']) {
    expectStaticTypeError(`function unused(x: ${source}) { x := ${target}; }`);
    expectStaticTypeError(`function unused(x: ${source}) { ${target}(x); }`);
  }
});

test.each(['true', 'false', 'null', 'undefined', '"1"'])('a known literal is checked in both conversion forms: %s', (value) => {
  expectStaticTypeError(`function unused() { (${value}) := uint8; }`);
  expectStaticTypeError(`function unused() { uint8(${value}); }`);
});

test('aliases and wholly impossible unions retain the conversion check', () => {
  expectStaticTypeError('type Small = uint8; function unused(x: boolean) { Small(x); }');
  expectStaticTypeError('function unused(x: boolean | null) { x := uint8; }');
});

test('explicit numeric narrowing remains a conversion rather than assignment', () => {
  expect(evaluated('let x: uint16 = 300; String(x := uint8) + "," + String(uint8(x));')).toBe('44,44');
  expect(evaluated('String(number("5")) + "," + String(true := number) + "," + string(true);')).toBe('5,1,true');
});

test('unknown types, generic bodies and partially convertible unions defer', () => {
  expect(ok('function unused(x: any) { x := uint8; uint8(x); }')).toBe(true);
  expect(ok('function unused<T>(x: T) { x := uint8; uint8(x); }')).toBe(true);
  expect(ok('function unused(x: boolean | uint16) { x := uint8; uint8(x); }')).toBe(true);
  expectThrownKind('function convert(x: any) { return uint8(x); } convert(true);', 'TypeError');
});

test('class conversions and governed crossings are not rejected from a scalar table', () => {
  expect(ok('class Source { operator uint8() { return 1; } } function unused(x: Source) { x := uint8; uint8(x); }')).toBe(true);
  expect(ok('class Box { constructor(x: boolean) {} } function unused(x: boolean) { x := Box; }')).toBe(true);
  expect(evaluated('type Id = uint8.<{ brand: "Id" }>; String(Id(7));')).toBe('7');
});
