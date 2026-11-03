import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-generic-where, #sec-checked-contracts: a value generic's argument is a
 * value of its named type, and a contract over a call's own values reads it
 * at the call, where the arguments and the result are bound.
 */

test('a contract reads a value generic at the call', () => {
  expect(evaluated('function f<N: uint32>(i: uint32) where i < N { return i; } String(f.<10>((5 := uint32)));')).toBe('5');
  expect(evaluated("function f<N: uint32>(i: uint32) where i < N { return i; } let m = 'none'; try { f.<10>((15 := uint32)); m = 'ran'; } catch (e) { m = 'threw'; } m;")).toBe('threw');
  expect(evaluated('function g<N: uint32>(): uint32 where return < N { return (5 := uint32); } String(g.<10>());')).toBe('5');
});

test('a body reads a value generic as before', () => {
  expect(evaluated('function h<N: uint32>(): string { return String(N); } h.<10>();')).toBe('10');
});
