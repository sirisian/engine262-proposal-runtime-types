import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok, runFlagOff } from '../harness.mts';

test.each(['uint8', 'int64', 'float32', 'decimal128', 'rational', 'complex', 'number', 'bigint', 'string', 'boolean', 'symbol', 'null', 'undefined', 'uint8 | string', 'shared uint8'])(
  'a %s value cannot be the right operand of membership', (type) => {
    expectStaticTypeError(`function unused(n: ${type}) { "x" in n; }`);
    expectStaticTypeError(`function unused(n: ${type}) { return ({}) instanceof n; }`);
  },
);

test('private membership has the same known-object requirement', () => {
  expectStaticTypeError('class C { #x; unused(n: uint8) { return #x in n; } }');
  expect(evaluated('class C { #x; has(o: C) { return #x in o; } } let c = new C(); String(c.has(c));')).toBe('true');
});

test('type objects and custom hasInstance methods remain valid', () => {
  expect(evaluated('let n: uint8 = 1; String(n instanceof uint8);')).toBe('true');
  expect(evaluated('const target = { [Symbol.hasInstance](v) { return true; } }; String(({}) instanceof target);')).toBe('true');
  expect(ok('function unused(t: type, x: any) { x instanceof t; }')).toBe(true);
  expect(ok('function unused(o: Composite.<{ x: uint8 }>) { "x" in o; }')).toBe(true);
});

test('unknown and object-containing types keep runtime eligibility checks', () => {
  expect(ok('function unused(n: uint8 | { x: uint8 }) { "x" in n; }')).toBe(true);
  expect(ok('function unused<T: type>(n: T) { ({}) instanceof n; }')).toBe(true);
  expect(ok('function unused(n: any) { "x" in n; ({}) instanceof n; }')).toBe(true);
  expectThrownKind('function f(n: any) { "x" in n; } f(uint8(1));', 'TypeError');
  expectThrownKind('function f(n: any) { ({}) instanceof n; } f(uint8(1));', 'TypeError');
});

test('feature-disabled scripts keep native runtime timing', () => {
  expect(runFlagOff('function unused() { "x" in 1; ({}) instanceof 1; }')).toMatchObject({ Type: 'normal' });
  expect(evaluated('let o: { x: uint8 } = { x: 1 }; String("x" in o);')).toBe('true');
});
