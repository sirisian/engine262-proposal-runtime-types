import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-intrinsic-array-contracts, #sec-array-and-tuple-types: a proved
// mutator that necessarily leaves a tuple's permitted lengths is a type error,
// as it is for an array of stated extent.

const T = 'const t: [uint8, uint8] = [1, 2]; ';

test('a mutator that changes a tuple of fixed length is a type error', () => {
  expectStaticTypeError(`${T}t.pop();`);
  expectStaticTypeError(`${T}t.shift();`);
  expectStaticTypeError(`${T}t.push(3);`);
  expectStaticTypeError(`${T}t.unshift(0);`);
  expectStaticTypeError(`${T}t.splice(0, 1);`);
});

test('a mutation that keeps the length is not rejected', () => {
  expect(evaluated(`${T}t.splice(0, 1, 9); String(t[0]);`)).toBe('9');
  expect(evaluated(`${T}t.push(); String(t.length);`)).toBe('2');
});

test('a tuple with a rest and a spread of unknown count stay dynamic', () => {
  expect(evaluated('const t: [uint8, ...[].<uint8>] = [1, 2]; t.pop(); String(t.length);')).toBe('1');
  expect(evaluated('const a: [2].<uint8> = [1, 2]; const xs: [].<uint8> = []; a.push(...xs); String(a.length);')).toBe('2');
});
