import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5, Q8 (#sec-constraint-and-argument-environments): a value parameter in
 * an extent position, `[N].<T>`, is inferred from the argument's stated extent,
 * as Rust infers a const generic from `[u8; N]`. Three defects stood in the
 * way: the signature's extent was evaluated as an expression while `N` was the
 * unapplied `any` of the declaration-time reading ("[Function] is not a
 * type"); neither mention walk counted the extent as a parameter position, so
 * structural inference returned before binding it; and the unifier matched
 * elements only.
 */

test('a value parameter infers from an argument\'s stated extent', () => {
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>) { return x.length; } const t: [2].<uint8> = [1, 2]; String(g(t));')).toBe('2');
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>): uint32 { return N; } const t: [3].<uint8> = [1, 2, 3]; String(g(t));')).toBe('3');
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>): [N].<uint8> { return x; } const t: [2].<uint8> = [1, 2]; String(g(t).length);')).toBe('2');
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>, y: [N].<uint8>): uint32 { return N; } const a: [2].<uint8> = [1, 2]; const b: [2].<uint8> = [3, 4]; String(g(a, b));')).toBe('2');
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>): uint32 { return N; } const t: [3].<uint8> = [1, 2, 3]; String(g.<3>(t));')).toBe('3');
});

test('a where clause over an inferred extent is judged, and disagreeing extents are refused', () => {
  expect(evaluated('function g<N: uint32>(x: [N].<uint8>) where N > 2 { return N; } const t: [3].<uint8> = [1, 2, 3]; String(g(t));')).toBe('3');
  expect(observeScript('function g<N: uint32>(x: [N].<uint8>) where N > 2 { return N; } const t: [1].<uint8> = [1]; g(t);')).toMatchObject({ errorClass: 'TypeError' });
  expect(observeScript('function g<N: uint32>(x: [N].<uint8>) where N > 2 { return N; } const t: [1].<uint8> = [1]; g.<1>(t);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(observeScript('function g<N: uint32>(x: [N].<uint8>, y: [N].<uint8>): uint32 { return N; } const a: [2].<uint8> = [1, 2]; const b: [3].<uint8> = [1, 2, 3]; g(a, b);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
});
