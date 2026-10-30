import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Round 5, Q7: a method clause that reads its class's parameters is decided
 * where the receiver's specialization is known, with the class's parameters
 * bound from the receiver's Static Type beside the method's own; the run time
 * already answered correctly, the checker decided nothing.
 */

const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};

const V = 'class V<N: uint32> { lane<I: uint32>(): uint32 where I < N { return (1 := uint32); } } ';

test('a method clause over the class\'s parameters is decided from the receiver', () => {
  refused(`${V}new V.<4>().lane.<5>();`);
  refused(`${V}const v = new V.<4>(); v.lane.<5>();`);
  refused(`${V}function f(v: V.<4>) { return v.lane.<5>(); }`);
  refused('class W<N: uint32> { m() where N > 2 { return 1; } } new W.<1>().m();');
  expect(evaluated(`${V}String(new V.<4>().lane.<1>());`)).toBe('1');
  expect(evaluated('class W<N: uint32> { m() where N > 2 { return 1; } } String(new W.<3>().m());')).toBe('1');
});

test('a static method under a class application is decided from the written arguments', () => {
  refused('class V<N: uint32> { static m<I: uint32>() where I < N { return I; } } V.<4>.m.<5>();');
  expect(evaluated('class V<N: uint32> { static m<I: uint32>() where I < N { return I; } } String(V.<4>.m.<1>());')).toBe('1');
});

test('a method\'s contract message names the method', () => {
  expectThrown('class C { m(i: uint32) where i > 10 { return i; } } let v: any = 5; new C().m(v);', 'the contract of "m"');
  expectThrown('const o = { f(i: uint32) where i > 10 { return i; } }; let v: any = 5; o.f(v);', 'the contract of "f"');
});
