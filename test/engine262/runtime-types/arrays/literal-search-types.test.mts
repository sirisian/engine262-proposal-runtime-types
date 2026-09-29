import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-array-literal-static-type (The Static Type of an Array Literal).
 *
 * Where no contextual type reaches it, the Static Type of an array literal is the array type whose
 * element is the join of its elements' Static Types. A member of that array is then read at that
 * element type: `includes` and `indexOf` search for a value of the element type, and an argument
 * the element type cannot hold is a type error rather than a search that quietly answers false.
 */

test('a search argument the element type holds is answered as before', () => {
  expect(evaluated('String([1, 2, 3].includes(2)) + "/" + String([1, 2, 3].indexOf(3));')).toBe('true/2');
  expect(evaluated('String(["a", "b"].includes("b"));')).toBe('true');
});

test('a search for a value the element type cannot hold is a type error', () => {
  // Each searches for a value the array's element type cannot hold - the mistake this proposal exists
  // to report - where the answer they gave before concealed it (false, and the not-found index).
  expectStaticTypeError('[1, 2, 3].includes("2");');
  expectStaticTypeError('["a"].includes(1);');
  expectStaticTypeError('[1, 2, 3].indexOf("2");');
});

test('a bigint array is searched with a bigint: the literal argument is built as one', () => {
  // The literal is a `[].<bigint>`, so `includes` is read at that element type and its argument is a
  // bigint position; literal propagation builds the argument as a BigInt, which compares against a
  // BigInt element holding the same mathematical value.
  expect(evaluated('String([1n, 2n].includes(1)) + "/" + String([1n, 2n].includes(3));')).toBe('true/false');
});
