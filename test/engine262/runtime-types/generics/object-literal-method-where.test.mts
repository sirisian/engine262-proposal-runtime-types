import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5, Q6: a where clause on an object-literal method. The non-callee
 * specialization `const s = o.f.<0>` evaluated the clause in a declaration
 * context given an empty frame, so `N` was "cannot be used before
 * initialization"; the bound frame is what the clause and the body read.
 */

test('an object-literal method specialization evaluates its clause with its parameters bound', () => {
  expect(evaluated('const o = { f<N: uint32>() where N > 0 { return N; } }; const s = o.f.<1>; String(s());')).toBe('1');
  expect(observeScript('const o = { f<N: uint32>() where N > 0 { return N; } }; const s = o.f.<0>;')).toMatchObject({ errorClass: 'TypeError' });
  expect(observeScript('const o = { f<N: uint32>() where N > 0 { return N; } }; o.f.<0>();')).toMatchObject({ errorClass: 'TypeError' });
  expect(evaluated('const o = { f<N: uint32>() where N > 0 { return N; } }; String(o.f.<1>());')).toBe('1');
});
