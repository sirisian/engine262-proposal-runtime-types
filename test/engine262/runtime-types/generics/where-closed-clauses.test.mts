import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a clause that reads none of its subjects is closed at its
 * declaration. It gets the judgment of #sec-narrowfrom as any test does, so a
 * test its static types settle is refused whichever way they settle it, and an
 * explicit constant keeps its written meaning. Where a failing clause would
 * refuse every use, what that judgment leaves open is evaluated at the checking
 * boundary and refused if false; a declaration that shares its group is only
 * made inapplicable by a failing clause (#sec-callable-overload-contracts), so
 * it gets the judgment alone.
 */

const refused = (source: string, rule = 'rt-impossible-test'): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};
const accepted = (source: string): void => {
  expect(evaluated(`${source} 'ok';`)).toBe('ok');
};

test('a closed clause its static types settle is refused, as the same test in an if is', () => {
  refused('function f(i: uint8) where 1 > 2 { return i; }');
  refused('function f(i: uint8) where 2 > 1 { return i; }');
  refused('class V where 1 > 2 { }');
  refused('type T = { a: uint8 } where 1 > 2;');
  refused('const LIMIT: uint8 = 10; function f(i: uint8) where LIMIT > 300 { return i; }', 'rt-numeric-range');
});

test('an explicit constant keeps its written meaning', () => {
  for (const clause of ['true', 'false', '0', '1', '!false', '(true)']) accepted(`function f() where ${clause} { return 1; }`);
  accepted('class V where false { }');
  accepted('type T = { a: uint8 } where false;');
  expect(observeScript('function g() where false { return 1; } g();')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});

test('a lone declaration whose closed clause evaluates false is refused', () => {
  refused('function f(i: uint8) where Reflect.isAssignable(type string, uint8) { return i; }');
  refused('function k(T: type): type where Reflect.isAssignable(type string, uint8) { return T; }');
});

test('a declaration that shares its group is only made inapplicable', () => {
  accepted("function p<A: type, B: type>(): string { return 'owner'; } function p<uint32, _>(): string where Reflect.isAssignable(type string, uint8) { return 'fixed'; }");
  accepted('function f(x: uint8): uint8 where Reflect.isAssignable(type string, uint8) { return x; } function f(x: string): string { return x; }');
  refused("function p<A: type, B: type>(): string { return 'owner'; } function p<uint32, _>(): string where 1 > 2 { return 'fixed'; }");
});

test('a closed clause that holds stands, as a static assertion', () => {
  accepted('function f(i: uint8) where Reflect.isAssignable(type "x", type string) { return i; }');
});

test('a closed clause whose input is not yet initialized keeps its deferral', () => {
  expect(observeScript('const ENABLED = false; function h(i: uint8) where ENABLED { return i; } h(5);')).toMatchObject({ bodyEntered: true });
  expect(evaluated('const ENABLED = true; function h(i: uint8) where ENABLED { return i; } String(h(5));')).toBe('5');
});
