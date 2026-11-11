import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-check-insertion: a `where` clause the arguments decide is a type error
 * at the call, and #sec-iscompiletimeevaluable says what a constant is:
 * `null` and `undefined` as much as a number, and a fresh aggregate of such
 * values. #sec-checked-contracts: a constant result decides a result
 * contract, a reachable implicit exit as `undefined`. #sec-generic-where: a
 * default is judged against each clause that reads only parameters with
 * defaults.
 */
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('null and undefined arguments decide a clause', () => {
  refused('function g(x: uint8 | null): void where x !== null {} g(null);', 'rt-where-unsatisfied');
  refused('function g(x: uint8 | undefined): void where x !== undefined {} g(undefined);', 'rt-where-unsatisfied');
  refused('class C { m(x: uint8 | null): void where x !== null {} } new C().m(null);', 'rt-where-unsatisfied');
  expect(evaluated("function g(x: uint8 | null): string where x !== null { return 'ok'; } g(5);")).toBe('ok');
  expect(evaluated("function g(x: uint8 | null): string where x === null { return 'ok'; } g(null);")).toBe('ok');
});

test('a fresh aggregate of constants decides a clause', () => {
  refused('function g(t: [uint8, uint8]): void where t[0] > 10 {} g([5, 6]);', 'rt-where-unsatisfied');
  refused('function g(o: { a: uint8 }): void where o.a > 10 {} g({ a: 5 });', 'rt-where-unsatisfied');
  refused('function g(a: [].<uint8>): void where a.length > 3 {} g([1, 2]);', 'rt-where-unsatisfied');
  expect(evaluated("function g(t: [uint8, uint8]): string where t[0] > 10 { return 'ok'; } g([50, 6]);")).toBe('ok');
  expect(evaluated("function g(o: { a: uint8 }): string where o.a > 10 { return 'ok'; } g({ a: 50 });")).toBe('ok');
});

test('a read through a const object is not a constant', () => {
  expect(observeScript('function g(x: uint8): uint8 where x > 10 { return x; } const o = { v: 5 }; g(o.v);')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});

test('a null or undefined result decides a result contract', () => {
  refused('function f(): uint8 | null where return !== null { return null; }', 'rt-return-contract');
  refused('function f(): uint8 | undefined where return !== undefined { return undefined; }', 'rt-return-contract');
  refused('function f(): uint8 | undefined where return !== undefined { return; }', 'rt-return-contract');
  expect(evaluated('function f(): uint8 | null where return !== null { return 5; } String(f());')).toBe('5');
});

test('a reachable implicit exit decides a result contract as undefined', () => {
  refused('function f(): uint8 | undefined where return !== undefined {}', 'rt-return-contract');
  refused('function f(x: uint8): uint8 | undefined where return !== undefined { if (x > 3) return x; }', 'rt-return-contract');
  expect(evaluated('function f(x: uint8): uint8 | undefined where return !== undefined { if (x > 3) return x; return 9; } String(f(1));')).toBe('9');
  expect(evaluated("function f(): uint8 | undefined where return === undefined {} String(f());")).toBe('undefined');
});

test('a default is judged against a clause that reads only defaulted parameters', () => {
  refused('function f<N: uint8, M: uint8 = 3>(): void where M > 5 {}', 'rt-unreachable-default');
  refused('class C<N: uint8, M: uint8 = 3> where M > 5 {}', 'rt-unreachable-default');
  refused('type A<N: uint8, M: uint8 = 3> = [N].<uint8> where M > 5;', 'rt-unreachable-default');
  expect(evaluated("function f<N: uint8, M: uint8 = 3>(): string where M < 5 { return 'ok'; } f.<1>();")).toBe('ok');
  // A clause that also reads a parameter without a default can hold for some application.
  expect(evaluated("function f<N: uint8, M: uint8 = 3>(): string where N < M { return 'ok'; } f.<1>();")).toBe('ok');
});
