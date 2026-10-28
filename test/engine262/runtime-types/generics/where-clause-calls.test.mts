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

test('a satisfied or undecidable argument keeps the runtime contract', () => {
  expect(evaluated('function f(i: uint32) where i > 10 { return i; } String(f(11));')).toBe('11');
  expect(evaluated('function h(a: uint32, b: uint32) where a < b { return a; } String(h(1, 5));')).toBe('1');
  expect(evaluated('function f(i: uint32) where i > 10 { return i; } function g(x: uint32) { return f(x); } String(g(12));')).toBe('12');
  expect(observeScript('function f(i: uint32) where i > 10 { return i; } let v: any = 5; f(v);')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  expect(evaluated('function h(i: uint32): uint32 where return > i { return i + 1; } String(h(5));')).toBe('6');
});
