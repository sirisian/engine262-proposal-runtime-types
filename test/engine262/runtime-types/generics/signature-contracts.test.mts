import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 follow-up, Q10: a member's `where` clauses are a contract its
 * overrides and implementations keep. A caller holding the base relies on the
 * base's clauses, so a call through it is decided against them, and an
 * override may repeat or weaken them but not strengthen them or add one the
 * base does not state (Eiffel's rule for preconditions). Identical clauses,
 * and one ordered comparison whose region contains what the base allows, are
 * implied; anything else is refused, conservatively.
 */

const V = 'abstract class V { lane<I: uint32>(): uint32 where I < 4; } ';
const inherited = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-inherited-contract' } });
};

test('a call through the base is decided against the base contract', () => {
  expect(observeScript(`${V}class W extends V { lane<I: uint32>(): uint32 { return (1 := uint32); } } const v: V = new W(); v.lane.<9>();`))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  expect(evaluated(`${V}class W extends V { lane<I: uint32>(): uint32 { return (1 := uint32); } } const v: V = new W(); String(v.lane.<2>());`)).toBe('1');
});

test('an override may repeat, weaken or omit the inherited clause', () => {
  expect(evaluated(`${V}class W extends V { lane<I: uint32>(): uint32 { return (1 := uint32); } } String(new W().lane.<2>());`)).toBe('1');
  expect(evaluated(`${V}class W extends V { lane<I: uint32>(): uint32 where I < 4 { return (1 := uint32); } } String(new W().lane.<2>());`)).toBe('1');
  expect(evaluated(`${V}class W extends V { lane<I: uint32>(): uint32 where I < 8 { return (1 := uint32); } } String(new W().lane.<2>());`)).toBe('1');
  expect(evaluated(`${V}class W extends V { lane<J: uint32>(): uint32 where J < 8 { return (1 := uint32); } } 'ok';`)).toBe('ok');
});

test('an override may not strengthen the inherited clause or add one', () => {
  inherited(`${V}class W extends V { lane<I: uint32>(): uint32 where I < 2 { return (1 := uint32); } }`);
  inherited('abstract class V { lane<I: uint32>(): uint32; } class W extends V { lane<I: uint32>(): uint32 where I < 2 { return (1 := uint32); } }');
  inherited('abstract class V { lane<I: uint32>(): uint32 where I % 4 == 0; } class W extends V { lane<I: uint32>(): uint32 where I % 2 == 0 { return (1 := uint32); } }');
  inherited('class A { m<N: uint32>(): uint32 where N > 0 { return N; } } class B extends A { m<N: uint32>(): uint32 where N > 5 { return N; } }');
  inherited('class A { m<N: uint32>(): uint32 { return N; } } class B extends A { m<N: uint32>(): uint32 where N > 0 { return N; } }');
});
