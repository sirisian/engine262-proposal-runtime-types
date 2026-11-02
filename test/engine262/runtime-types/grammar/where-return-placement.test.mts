import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-checked-contracts: `return` is a PrimaryExpression only within a
 * function's clauses, and a Syntax Error anywhere else.
 */

test('return in a clause without a result is a Syntax Error', () => {
  expect(observeScript('type T = { a: uint8 } where return > 0;')).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
  expect(observeScript('class V<N: uint32> where return > 0 { }')).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
});

test('return stays a reference in every function form\'s clauses', () => {
  expect(evaluated('function f(x: uint8): uint8 where return > 10 { return x; } String(f(20));')).toBe('20');
  expect(evaluated("interface I { m(x: uint8): uint8 where return > 10; } 'ok';")).toBe('ok');
  expect(evaluated("abstract class A { abstract m(x: uint8): uint8 where return > 10; } 'ok';")).toBe('ok');
});
