import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-checked-contracts and #sec-generic-where: a result contract is judged at
 * its declaration with `return` read at the effective result - the declared
 * type, a generator's return type, an async function's fulfilled type - so a
 * contract no result satisfies, or every result satisfies, is refused there
 * rather than at every return.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a result contract no result satisfies is refused at the declaration', () => {
  refused('function f(x: uint8): uint8 where return > 300 { return x; }', 'rt-numeric-range');
  refused('function f(x: uint8): uint8 where return > 10 where return < 5 { return x; }', 'rt-impossible-test');
  refused('function f(x: string): string where return is uint8 { return x; }', 'rt-impossible-test');
});

test('an unannotated function\'s contract reads its inferred result', () => {
  refused('function f(x: uint8) where return > 300 { return x; }', 'rt-numeric-range');
  expect(evaluated('function f(x: uint8) where return > 10 { return x; } String(f(20));')).toBe('20');
});

test('a result contract every result satisfies is refused', () => {
  refused('function f(x: uint8): uint8 where return >= 0 { return x; }', 'rt-impossible-test');
});

test('the effective result is read for methods, generators and async functions', () => {
  refused('class K { m(x: uint8): uint8 where return > 300 { return x; } }', 'rt-numeric-range');
  refused('function* g(x: uint8): Generator.<uint8, uint8, void> where return > 300 { return x; }', 'rt-numeric-range');
  refused('async function f(x: uint8): Promise.<uint8> where return > 300 { return x; }', 'rt-numeric-range');
});

test('satisfiable result contracts are unchanged', () => {
  expect(evaluated('function f(x: uint8): uint8 where return > 10 { return x; } String(f(20));')).toBe('20');
  expect(evaluated('function h(i: uint32): uint32 where return > i { return i + 1; } String(h(5));')).toBe('6');
  refused('function g(): void where return > 10 {}', 'rt-return-contract');
});
