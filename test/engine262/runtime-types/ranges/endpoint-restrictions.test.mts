import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-ranges and #sec-range-literals.
 *
 * Two early errors that keep a range's endpoints ordered:
 *
 * - It is a type error if a present endpoint has a participating Static Type restricted to
 *   ~symbol~, ~null~ or ~undefined, whose intrinsic domains supply no range ordering. A union
 *   establishes this only when every alternative is excluded, and unknown types do not. An
 *   omitted endpoint is not a present *undefined* value.
 * - It is a type error to use a value statically known to be a built-in range as a range
 *   endpoint, or as an operand on the built-in path of `<`, `<=`, `>` or `>=`: a range's
 *   endpoints being ordered does not make the range itself ordered. Equality and the interval
 *   operations are unaffected.
 */

test('a present endpoint restricted to symbol, null or undefined is a type error', () => {
  expectStaticTypeError('function f(s: symbol) { return s..<5; }');
  expectStaticTypeError('function f(n: null) { return 0..<n; }');
  expectStaticTypeError('function f(u: undefined) { return u..<5; }');
});

test('a union establishes the failure only when every alternative is excluded', () => {
  expectStaticTypeError('function f(x: symbol | null) { return x..<5; }');
  expect(ok('function f(x: symbol | uint8) { return x..<5; }')).toBe(true);
});

test('an unknown type does not establish the failure, and an omitted endpoint is not a present undefined', () => {
  expect(ok('function f(x: any) { return x..<5; }')).toBe(true);
  expect(ok('const r = 0..;')).toBe(true);
  expect(ok('const r = ..<5;')).toBe(true);
});

test('a range is not a range endpoint, however it is reached', () => {
  expectStaticTypeError('const r = (0..<3)..<5;');
  expectStaticTypeError('const r = 0..<(1..<2);');
  // A constant alias preserves the fact that the value is a range.
  expectStaticTypeError('const a = 0..<3; const r = a..<5;');
});

test('a range is not an operand of the built-in relational operators', () => {
  expectStaticTypeError('function f() { return (0..<3) < 5; }');
  expectStaticTypeError('function f() { return 5 >= (0..<3); }');
});

test('equality on ranges is unaffected', () => {
  expect(ok('const r = (0..<3) == (0..<3);')).toBe(true);
});
