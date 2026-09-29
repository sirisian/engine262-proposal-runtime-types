import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-iteration-types: a pattern with no rest whose every requested step
// definitely yields ends with the iterator not done, and so closes it. Plain
// targets cannot throw first and suppress the closing failure.

const NEVER = '{ [Symbol.iterator](): { next(): { done: false, value: uint8 }, return: uint8 } }';

test('a non-empty pattern over a never-finishing iterator closes it', () => {
  expectStaticTypeError(`function g(x: ${NEVER}) { const [a] = x; }`);
  expectStaticTypeError(`function g(x: ${NEVER}) { const [a, , b] = x; }`);
  expectStaticTypeError(`function g(x: ${NEVER}) { let a; [a] = x; }`);
});

test('possible exhaustion, a default or a rest prevents the proof', () => {
  const MAYBE = '{ [Symbol.iterator](): { next(): { done: boolean, value: uint8 }, return: uint8 } }';
  expect(evaluated(`function g(x: ${MAYBE}) { const [a] = x; } 'ok';`)).toBe('ok');
  expect(evaluated(`function g(x: ${NEVER}) { const [a = 1] = x; } 'ok';`)).toBe('ok');
  expect(evaluated(`function g(x: ${NEVER}) { const [...r] = x; } 'ok';`)).toBe('ok');
});
