import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test('the static-error helper distinguishes syntax and runtime errors', () => {
  expect(() => expectStaticTypeError('let = ;')).toThrow();
  expect(() => expectStaticTypeError('throw new StaticTypeError("runtime");')).toThrow();
  expectStaticTypeError('function f() { let n: uint8 = "s"; }');
});

test.each(['0.5', '-1', '-0.5', '1', '1e309'])('tuple store rejects invalid literal position %s before evaluation', (index) => {
  expectStaticTypeError(`function f() { let t: [uint8] = [1]; t[${index}] = 1; }`);
});

test('tuple stores preserve fixed and rest position types', () => {
  expect(ok('function f() { let t: [uint8, ...[].<string>] = [1, "s"]; t[0] = 2; t[1] = "ok"; }')).toBe(true);
  expectStaticTypeError('function f() { let t: [uint8, ...[].<string>] = [1, "s"]; t[1] = (2 := uint8); }');
});

test.each(['&&', '||'])('logical %s checks both operands', (operator) => {
  expectStaticTypeError(`function take(v: uint8) {} function f(b: boolean) { b ${operator} take("s"); }`);
  expectStaticTypeError(`function take(v: uint8): boolean { return true; } function f(b: boolean) { take("s") ${operator} b; }`);
});

test('logical operands see the appropriate narrowing', () => {
  expect(ok('function take(v: uint8) {} function f(x: uint8 | null) { x !== null && take(x); x === null || take(x); }')).toBe(true);
  expectStaticTypeError('function take(v: string) {} function f(x: uint8 | null) { x !== null && take(x); }');
});

test.each([
  'if (guard()) { let n: uint8 = "s"; }',
  'if (!guard()) {} else { let n: uint8 = "s"; }',
  'if ((guard())) { function nested() { let n: uint8 = "s"; } }',
  'let x: uint8 | string = "s"; if (guard(x)) { let n: uint8 = x; }',
])('an ordinary unresolved callback cannot suppress independent errors: %s', (body) => {
  expectStaticTypeError(`function f(guard) { ${body} }`);
});
