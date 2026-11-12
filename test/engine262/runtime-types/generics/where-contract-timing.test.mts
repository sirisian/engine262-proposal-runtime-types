import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a clause over a call's own values is checked before
 * the body, while each parameter still holds what was passed.
 * #sec-checked-contracts: a clause that names `return` is checked once a
 * result exists, whether a `return` produced it or the body ended without
 * one.
 */
const observe = (declaration: string, call: string, argument = '20'): string => evaluated(`var entered = 'no'; ${declaration}
  function g(v: uint8) { try { ${call}; } catch (e) { return entered + ':' + e.constructor.name; } return entered + ':none'; } g(${argument});`) as string;

test('a parameter contract stops the call before the body runs', () => {
  expect(observe("function f(x: uint8) where x > 100 { entered = 'yes'; return x; }", 'f(v)')).toBe('no:TypeError');
  expect(observe("function f(x: uint8) where x > 100 { entered = 'yes'; return x; }", 'f(v)', '120')).toBe('yes:none');
});

test('a body that ends without a return is held to the contract too', () => {
  expect(observe("function f(x: uint8) where x > 100 { entered = 'yes'; }", 'f(v)')).toBe('no:TypeError');
  expect(observe("function f(x: uint8): void where x > 100 { entered = 'yes'; }", 'f(v)', '120')).toBe('yes:none');
});

test('a body that assigns its parameter does not change what the contract judged', () => {
  expect(observe("function f(x: uint8) where x > 100 { x = 200; entered = 'yes'; return x; }", 'f(v)')).toBe('no:TypeError');
  expect(observe("function f(x: uint8) where x > 100 { x = 5; entered = 'yes'; return x; }", 'f(v)', '120')).toBe('yes:none');
});

test('every function form checks before its body', () => {
  expect(observe("class C { m(x: uint8) where x > 100 { entered = 'yes'; } }", 'new C().m(v)')).toBe('no:TypeError');
  expect(observe("class C { static m(x: uint8) where x > 100 { entered = 'yes'; } }", 'C.m(v)')).toBe('no:TypeError');
  expect(observe("const f = function (x: uint8) where x > 100 { entered = 'yes'; };", 'f(v)')).toBe('no:TypeError');
  expect(observe("const o = { m(x: uint8) where x > 100 { entered = 'yes'; } };", 'o.m(v)')).toBe('no:TypeError');
  expect(observe("function* f(x: uint8) where x > 100 { entered = 'yes'; }", 'f(v).next()')).toBe('no:TypeError');
});

test('a result contract is judged at a return and at the end of the body', () => {
  const f = "function f(x: uint8): uint8 where return > x { entered = 'yes'; return x + 1; }";
  expect(observe(f, 'f(v)', '5')).toBe('yes:none');
  const down = "function f(x: uint8): uint8 where return > x { entered = 'yes'; return x - 1; }";
  expect(observe(down, 'f(v)', '5')).toBe('yes:TypeError');
  const implicit = "function f(x: uint8) where return !== undefined || x > 100 { entered = 'yes'; }";
  expect(observe(implicit, 'f(v)')).toBe('yes:TypeError');
  expect(observe(implicit, 'f(v)', '120')).toBe('yes:none');
});

test('a contract with both halves checks each where it belongs', () => {
  const f = "function f(x: uint8): uint8 where x > 10 where return > x { entered = 'yes'; return x + 1; }";
  expect(observe(f, 'f(v)', '5')).toBe('no:TypeError');
  expect(observe(f, 'f(v)', '50')).toBe('yes:none');
});

/**
 * #sec-generic-where: a member that states no clause keeps the contract of
 * the member it implements or overrides. A call of it is held to that
 * contract before its body, and a constant call is decided where it is
 * written.
 */
test('an inherited contract is enforced before the implementing body', () => {
  const A = 'interface A { m(x: uint8): void where x > 100; } ';
  expect(observe(`${A}class C implements A { m(x: uint8): void { entered = 'yes'; } }`, 'new C().m(v)')).toBe('no:TypeError');
  expect(observe(`${A}class C implements A { m(x: uint8): void { entered = 'yes'; } }`, 'new C().m(v)', '120')).toBe('yes:none');
  expect(observe("abstract class P { abstract m(x: uint8): void where x > 100; } class C extends P { m(x: uint8): void { entered = 'yes'; } }", 'new C().m(v)')).toBe('no:TypeError');
  expect(observe("class P { m(x: uint8): void where x > 100 {} } class C extends P { m(x: uint8): void { entered = 'yes'; } }", 'new C().m(v)')).toBe('no:TypeError');
});

test('a constant call is decided against an inherited contract where it is written', () => {
  const refusedCall = (source: string): void => {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  };
  refusedCall('interface A { m(x: uint8): void where x > 100; } class C implements A { m(x: uint8): void {} } new C().m(20);');
  refusedCall('abstract class P { abstract m(x: uint8): void where x > 100; } class C extends P { m(x: uint8): void {} } new C().m(20);');
  refusedCall('class P { m(x: uint8): void where x > 100 {} } class C extends P { m(x: uint8): void {} } new C().m(20);');
  expect(evaluated('interface A { m(x: uint8): uint8 where x > 100; } class C implements A { m(x: uint8): uint8 { return x; } } String(new C().m(120));')).toBe('120');
});
