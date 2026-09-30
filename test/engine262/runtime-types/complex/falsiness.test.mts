import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-complex-numbers. ToBoolean of a complex is false where both components
 * are zero and true otherwise, so `complex(0, 0)` is falsy as every other numeric
 * zero is.
 *
 * A complex is carried as an object, and ToBoolean of an object is otherwise always
 * true, so the rule is stated rather than inherited: without it the origin would be
 * the one numeric zero that is truthy. It is the same exception ToBoolean already
 * makes for a typed number, for the same reason - the value is numeric even though
 * its representation is not a Number.
 */

const truth = (expr: string) => `String(${expr} ? "truthy" : "falsy");`;

test('complex falsiness: the origin is falsy and nothing else is', () => {
  expect(evaluated(truth('complex(0, 0)'))).toBe('falsy');
  expect(evaluated(truth('complex(1, 0)'))).toBe('truthy');
  expect(evaluated(truth('complex(0, 1)'))).toBe('truthy');
  // a negative zero component is still zero, as it is for a Number
  expect(evaluated(truth('complex(-0, 0)'))).toBe('falsy');
  // an imaginary literal follows from the same rule
  expect(evaluated(truth('0i'))).toBe('falsy');
  expect(evaluated(truth('4i'))).toBe('truthy');
});

test('complex falsiness: a NaN component is not zero', () => {
  // NaN is falsy as a Number, but a complex is falsy only AT THE ORIGIN - the
  // rule is about the value being zero, and a NaN component is not zero
  expect(evaluated(truth('complex(NaN, 0)'))).toBe('truthy');
});

test('complex falsiness: it reaches every ToBoolean path', () => {
  expect(evaluated('String(!complex(0, 0));')).toBe('true');
  expect(evaluated('String(Boolean(complex(0, 0)));')).toBe('false');
});

test('complex falsiness: nothing else changed', () => {
  expect(evaluated('const a: uint8 = 0; ' + truth('a'))).toBe('falsy');
  expect(evaluated('String(Boolean({}));')).toBe('true');
  expect(evaluated("String(Boolean(''));")).toBe('false');
});
