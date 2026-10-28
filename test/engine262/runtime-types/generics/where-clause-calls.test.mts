import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5, Gap 1: a runtime-subject where clause decided by the call.
 *
 * #sec-where-checks-are-inserted leaves to the boundary only "a where clause
 * that cannot be decided statically"; a predicate over value parameters whose
 * arguments are compile-time evaluable is decided at the call, as a
 * specialization predicate is at its application, and refused before the
 * body, including a call in an uncalled function.
 */

const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};

test('a literal argument the clause rejects is refused before the body', () => {
  refused('function f(i: uint32) where i > 10 { return i; } f(5);');
  refused('function h(a: uint32, b: uint32) where a < b { return a; } h(5, 5);');
  refused('function s(t: string) where t.length > 2 { return t; } s("a");');
  refused('function f(i: uint32) where i > 10 { return i; } function g() { return f(5); }');
});

test('a method specialization predicate is judged as a function one is (round 5, Gap 10)', () => {
  expect(observeScript('class K { m<N: uint32>() where N > 0 { return N; } } new K().m.<0>();')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(observeScript('class S { static m<N: uint32>() where N > 0 { return N; } } S.m.<0>();')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(evaluated('class K { m<N: uint32>() where N > 0 { return N; } } String(new K().m.<1>());')).toBe('1');
  // The predicate is evaluated in the callee's declaration context, where its
  // own type parameters resolve; a method's used to be "not defined".
  expect(evaluated('class V<N: uint32> { lane<I: uint32>(): uint32 where I < N { return (1 := uint32); } } String(new V.<4>().lane.<1>());')).toBe('1');
  expect(observeScript('class V<N: uint32> { lane<I: uint32>(): uint32 where I < N { return (1 := uint32); } } new V.<4>().lane.<5>();')).toMatchObject({ errorClass: 'TypeError' });
  expect(observeScript('const o = { f<N: uint32>() where N > 0 { return N; } }; o.f.<0>();')).toMatchObject({ errorClass: 'TypeError' });
});

test('a result contract is decided at a return whose operand is a literal (round 5, Gap 8)', () => {
  expect(observeScript('function f(): uint32 where return > 10 { return 5; }')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-return-contract' } });
  expect(observeScript('function g(b: boolean): uint32 where return > 10 { if (b) return 5; return 20; }')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-return-contract' } });
  expect(evaluated('function f(): uint32 where return > 10 { return 20; } String(f());')).toBe('20');
  expect(evaluated('let k: uint32 = 20; function f(): uint32 where return > 10 { return k; } String(f());')).toBe('20');
  expect(evaluated('function h(i: uint32): uint32 where return > i { return i + 1; } String(h(5));')).toBe('6');
});

test('a satisfied or undecidable argument keeps the runtime contract', () => {
  expect(evaluated('function f(i: uint32) where i > 10 { return i; } String(f(11));')).toBe('11');
  expect(evaluated('function h(a: uint32, b: uint32) where a < b { return a; } String(h(1, 5));')).toBe('1');
  expect(evaluated('function f(i: uint32) where i > 10 { return i; } function g(x: uint32) { return f(x); } String(g(12));')).toBe('12');
  expect(observeScript('function f(i: uint32) where i > 10 { return i; } let v: any = 5; f(v);')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  expect(evaluated('function h(i: uint32): uint32 where return > i { return i + 1; } String(h(5));')).toBe('6');
});
