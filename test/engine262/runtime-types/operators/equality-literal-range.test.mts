import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-arithmetic-never-promotes: "A literal the type cannot represent is not
// equal to any value of it, so the comparison is *false* rather than an error -
// unlike an arithmetic position", and a relational operator is judged as
// arithmetic is.

test('an equality with an unrepresentable literal answers false', () => {
  expect(evaluated('function f(x: uint8) { return x === 300; } String(f(1));')).toBe('false');
  expect(evaluated('function f(x: uint8) { return x != 1.5; } String(f(1));')).toBe('true');
});

test('a relational operator with an unrepresentable literal is a type error', () => {
  expectStaticTypeError('function f(x: uint8) { return x < 300; }');
});
