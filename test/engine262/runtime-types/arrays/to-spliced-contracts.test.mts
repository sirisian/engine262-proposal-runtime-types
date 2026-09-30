import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-intrinsic-array-contracts: `toSpliced` creates an ordinary array copy
// with the receiver's element contract, and the items it inserts are converted
// to and checked against that contract.

test('an inserted item the element type cannot hold is a type error', () => {
  expectStaticTypeError('const a: [].<uint8> = [1, 2]; a.toSpliced(0, 0, 300);');
  expectStaticTypeError('const a: [].<uint8> = [1, 2]; a.toSpliced(0, 0, "s");');
});

test('the copy carries the element type', () => {
  expect(evaluated('const a: [].<uint8> = [1, 2]; const b = a.toSpliced(0, 1, 9); String(b) + " " + String(Reflect.typeOf(b));')).toBe('9,2 [].<uint.<8>>');
});
