import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

test.each(['number', 'bigint', 'uint8', 'int8', 'uint64', 'int128'])('rational powers accept an integer %s exponent', (type) => {
  const value = type === 'bigint' ? '3n' : `${type}(3)`;
  expect(evaluated(`function power(n:${type}){return rational(2,3)**n;}String(power(${value}));`)).toBe('8/27');
});

test('negative integer powers invert the fraction', () => {
  expect(evaluated('function power(n:int8){return rational(2,3)**n;}String(power(int8(-2)));')).toBe('9/4');
});

test('a wide exponent keeps its exact parity', () => {
  expect(evaluated('function power(n:uint64){return rational(-1)**n;}String(power(uint64(9007199254740993)));')).toBe('-1');
});

test.each(['1.5', 'NaN', 'Infinity'])('a non-integer Number exponent %s keeps its runtime error', (value) => {
  expectThrownKind(`function power(n:number){return rational(2,3)**n;}power(${value});`, 'TypeError');
});

test('zero to a negative integer power keeps its runtime RangeError', () => {
  expectThrownKind('function power(n:int8){return rational(0)**n;}power(int8(-1));', 'RangeError');
});
