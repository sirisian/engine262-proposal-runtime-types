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
  expect(observeScript('const o = { f<N: uint32>() where N > 0 { return N; } }; const s = o.f.<0>;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(observeScript('const o = { f<N: uint32>() where N > 0 { return N; } }; o.f.<0>();')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(evaluated('const o = { f<N: uint32>() where N > 0 { return N; } }; String(o.f.<1>());')).toBe('1');
});

test('a script-level literal whose method carries a where clause is typed and judged (round 5, Q6)', () => {
  // The clause is a contract the method declares, so it anchors the literal's
  // participation as a declared parameter or return type would.
  expect(observeScript('let z: uint8 = 1; const o = { f<N: uint32>() where N > 0 { return N; } }; let r: string = o.f;')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  expect(observeScript('{ const o = { f<N: uint32>() where N > 0 { return N; } }; o.f.<0>(); }')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(evaluated('const o = { f<N: uint32>() where N > 0 { return N; } }; let r: uint32 = o.f.<1>(); String(r);')).toBe('1');
  expect(evaluated('const o = { f() where true { return 1; } }; let r: uint8 = o.f(); String(r);')).toBe('1');
});
