import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each(['<', '<=', '>', '>='])('known ranges are excluded from built-in %s', (operator) => {
  expectStaticTypeError(`function unused(r: Range.<uint8>) { r ${operator} 1; }`);
  expectStaticTypeError(`function unused(r: Range.<uint8>) { 1 ${operator} r; }`);
  expectStaticTypeError(`function unused() { (0..<3) ${operator} 5; }`);
});

test.each(['Range.<uint8>', 'RangeFrom.<uint8>', 'RangeTo.<uint8>', 'RangeFull'])('a %s is not an ordered endpoint', (type) => {
  expectStaticTypeError(`function unused(r: ${type}) { const x = r..=r; }`);
});

test('aliases, parentheses and all-range unions retain the exclusion', () => {
  expectStaticTypeError('type R = Range.<uint8>; function unused(r: R) { const s = r; ((s)) < 1; }');
  expectStaticTypeError('function unused(r: Range.<uint8> | RangeFrom.<uint8>) { r < 1; }');
  expectStaticTypeError('function unused(r: Range.<uint8> | RangeFrom.<uint8>) { r..; }');
  expectStaticTypeError('function unused(x: any) { (x..) < 1; }');
});

test('custom operators can accept a range, including derived comparisons', () => {
  expect(evaluated(`class P { operator<(r: Range.<uint8>): boolean { return true; } }
    String(new P() < (uint8(1)..<uint8(3)));`)).toBe('true');
  expect(ok('class P { operator<(r: Range.<uint8>): boolean { return true; } } function unused(p: P, r: Range.<uint8>) { p >= r; }')).toBe(true);
  expect(ok('class P { operator<(r: Range.<uint8>): boolean { return true; } } function unused(p: P | uint8, r: Range.<uint8>) { p < r; }')).toBe(true);
});

test('range equality and interval operations remain available', () => {
  expect(evaluated('const r = uint8(1)..<uint8(3); String(r === r && r.contains(uint8(1)));')).toBe('true');
});

test('a user class named Range does not acquire the built-in exclusion', () => {
  expect(evaluated('class Range { operator<(other: Range): boolean { return true; } } String(new Range() < new Range());')).toBe('true');
  expect(evaluated('const C = class Range { operator<(other: Range): boolean { return true; } }; String(new C() < new C());')).toBe('true');
});

test('open operands and mixed unions retain runtime dispatch', () => {
  expect(ok('function f(x: Range.<uint8> | number) { return x < 5; } f(1);')).toBe(true);
  expect(ok('function unused(x: object, r: Range.<uint8>) { x < r; }')).toBe(true);
  expectThrownKind('function f(x: any) { return x < 5; } f(0..<3);', 'TypeError');
});
