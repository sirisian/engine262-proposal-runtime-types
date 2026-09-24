import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-trial-specialization.
 *
 * A trial that leaves "zero or more than one" candidate, or that would exceed
 * the ceiling of 64, "is a type error asking for explicit arguments". The
 * trials ran only when the call bound its arguments, so each refusal was a
 * run-time TypeError, and a call in a function nothing invoked raised nothing.
 * The checking pass now runs the run time's own trial over the arguments'
 * Static Types.
 */

const trialOf = (n: number, call = 'one(1 := uint8);') => {
  const lits = Array.from({ length: n }, (_, i) => String(i)).join(' | ');
  return `function pick(B) { return B === type ${n - 1} ? uint8 : string; } `
    + `function one<B: type extends ${lits}>(x: pick(B)): string { return "bound"; } ${call}`;
};

test('a trial that binds none, several, or exceeds the ceiling is refused before the program runs', () => {
  expectStaticTypeError('function pick(B) { return B === type 0 || B === type 1 ? uint8 : string; } '
    + 'function one<B: type extends 0 | 1 | 2>(x: pick(B)): string { return "bound"; } one(1 := uint8);');
  expectStaticTypeError('function pick(B) { return string; } '
    + 'function one<B: type extends 0 | 1>(x: pick(B)): string { return "bound"; } one(1 := uint8);');
  expectStaticTypeError(trialOf(65));
  // Wherever the call is written, called or not.
  expectStaticTypeError(trialOf(65, 'function never() { one(1 := uint8); }'));
});

test('a trial that binds one candidate is unchanged', () => {
  expect(evaluated(trialOf(64))).toBe('bound');
  expect(evaluated('function pick(B) { return B === type 1 ? uint8 : string; } '
    + 'function one<B: type extends 0 | 1 | 2>(x: pick(B)): string { return "bound"; } one(1 := uint8);')).toBe('bound');
});
