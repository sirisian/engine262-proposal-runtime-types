import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a clause reads only its declaration's own inputs and
 * never suspends. It may not read new.target or contain await or yield, and
 * it reads `this` and `super` only as a refinement's subject or a method's
 * receiver, judged at the declaration against the instance type.
 */

const refused = (source: string, rule = 'rt-compile-time-evaluability'): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a clause may not read new.target, or suspend', () => {
  refused('function h(i: uint8) where new.target === undefined { return i; }');
  refused('async function a(p: Promise.<uint8>) where (await p) > 0 { return 1; }');
  refused('function* g(i: uint8) where (yield i) > 0 { yield 7; }');
});

test('a declaration without a receiver may not read this', () => {
  refused('function f(i: uint8) where this.x > 0 { return i; }');
  refused('class V<N: uint32> where this.x > 0 { }');
});

test('a method\'s clause reads its receiver, judged at the declaration and checked at each call', () => {
  refused('class C { x: uint8 = 1; m() where this.x > 300 { return 1; } }', 'rt-numeric-range');
  expect(evaluated('class C { x: uint8 = 6; m() where this.x > 5 { return 1; } } String(new C().m());')).toBe('1');
  expect(observeScript('class C { x: uint8 = 1; m() where this.x > 5 { return 1; } } new C().m();')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  expect(evaluated('class B { get y(): uint8 { return (1 := uint8); } } class D extends B { m() where super.y > 0 { return 1; } } String(new D().m());')).toBe('1');
});

test('a refinement still reads this as its subject', () => {
  expect(evaluated("type P = { a: uint8 } where this.a > 0; 'ok';")).toBe('ok');
});
