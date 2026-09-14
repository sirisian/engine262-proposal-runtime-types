import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

test('known match results are checked at their enclosing position', () => {
  expectStaticTypeError('function f(v: any): [uint8] { return match(v) { when 1: uint8(1); default: uint8(2); }; }');
  expectStaticTypeError('function f(v: any): uint8 { return match(v) { when 1: 300; default: 1; }; }');
  expect(evaluated('function f(v: any): uint8 { return match(v) { when 1: 1; default: 2; }; } String(f(0));')).toBe('2');
});

test('block completions keep local and pattern binding types', () => {
  expectStaticTypeError('function f(v: any): [uint8] { return match(v) { when {x: let x: uint8}: { const local: uint8 = x; local; } default: { const other: uint8 = 0; other; } }; }');
  expect(evaluated('function f(v: any): uint8 { return match(v) { when 1: { let local: uint8 = 2; local; } default: { 3; } }; } String(f(1));')).toBe('2');
});

test('decimal context reaches both expression and block arms', () => {
  expect(evaluated('function f(v: any): decimal128 { return match(v) { when 1: 1.00; default: 2.00; }; } String(f(1));')).toBe('1.00');
  expect(evaluated('function f(v: any): decimal128 { return match(v) { when 1: { 1.00; } default: { 2.00; } }; } String(f(0));')).toBe('2.00');
});

test('throw arms contribute no value type', () => {
  expect(evaluated('function f(v: any): uint8 { return match(v) { when 1: uint8(1); default: throw new Error(); }; } String(f(1));')).toBe('1');
});
