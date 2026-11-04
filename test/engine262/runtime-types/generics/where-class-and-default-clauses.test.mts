import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a method's clause over its class's value parameters is
 * judged as a clause of the class; a default inside a parameter's pattern is
 * checked as a parameter's is; and a function declared `never` has no result
 * for a contract to constrain.
 */

const outcome = (source: string) => observeScript(source).diagnostic?.rule;

test('a method clause over the class parameter is judged as a class clause', () => {
  expect(outcome("class C<N: uint8> { m() where N > 300 { return 1; } } 'ok';")).toBe('rt-numeric-range');
  expect(outcome("class C<N: uint8> { static s() where N > 300 { return 1; } } 'ok';")).toBe('rt-numeric-range');
  expect(outcome("class C<N: uint8> { static m() where N > 300 { return 'm'; } } C.<5>.m();")).toBe('rt-where-unsatisfied');
  expect(evaluated("class C<N: uint8> { static m() where N > 2 { return 'm'; } } C.<5>.m();")).toBe('m');
});

test('a destructured default its clause rejects is refused', () => {
  expect(outcome("function g({ x = 5 }: { x?: uint32 }) where x > 10 { return x; } 'ok';")).toBe('rt-unreachable-default');
  expect(evaluated('function g({ x = 15 }: { x?: uint32 }) where x > 10 { return x; } String(g({}));')).toBe('15');
});

test('a never function has no result to constrain', () => {
  expect(outcome("function f(): never where return > 0 { throw 1; } 'ok';")).toBe('rt-return-contract');
});
