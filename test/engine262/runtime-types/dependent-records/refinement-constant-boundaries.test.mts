import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-check-insertion: where the source of a boundary is a constant and the
 * target is a refinement whose predicate can be evaluated at the declaration,
 * the predicate is evaluated there, and a value that fails it is refused
 * where it is written. #sec-where-clauses: a refinement admits a value of
 * its base only where every predicate holds of it, at every boundary alike.
 */
const SMALL = 'type Small = uint8 where this < 10; ';
const refused = (source: string): void => {
  expect(observeScript(SMALL + source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
};
const accepted = (source: string): void => {
  expect(observeScript(SMALL + source)).toMatchObject({ completion: { Type: 'normal' } });
};

test('a binding initializer and an argument decide, as before', () => {
  refused('let x: Small = 20;');
  refused('function g(x: Small) {} g(20);');
  expect(evaluated(`${SMALL}let x: Small = 5; String(x);`)).toBe('5');
});

test('a parameter default decides', () => {
  refused('function f(x: Small = 20) {}');
  expect(evaluated(`${SMALL}function f(x: Small = 5) { return x; } String(f());`)).toBe('5');
});

test('a return decides', () => {
  refused('function f(): Small { return 20; }');
  refused('function f(x: uint8): Small { if (x > 3) return 20; return 1; }');
  refused('const h = (): Small => 20;');
  expect(evaluated(`${SMALL}function f(): Small { return 5; } String(f());`)).toBe('5');
});

test('a field initializer decides, instance and static', () => {
  refused('class K { a: Small = 20; }');
  refused('class K { static a: Small = 20; }');
  expect(evaluated(`${SMALL}class K { a: Small = 5; } String(new K().a);`)).toBe('5');
});

test('an assignment and a conversion decide', () => {
  refused('let x: Small = 5; x = 20;');
  refused('20 := Small;');
  expect(evaluated(`${SMALL}let x: Small = 5; x = 7; String(x);`)).toBe('7');
  expect(evaluated(`${SMALL}String(7 := Small);`)).toBe('7');
});

test('a value that is not a constant is left to the boundary', () => {
  expect(observeScript(`${SMALL}function f(v: uint8): Small { return v := Small; } function h(k: uint8) { return f(k); } h(20);`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  expect(evaluated(`${SMALL}function f(v: uint8): Small { return v := Small; } function h(k: uint8) { return f(k); } String(h(5));`)).toBe('5');
  accepted('function f(v: uint8): Small { return v := Small; }');
});

test('a generic parameter default and a yield decide', () => {
  refused('function f<N: Small = 20>(): void {}');
  refused('function* g(): Generator.<Small> { yield 20; }');
  expect(evaluated(`${SMALL}function* g(): Generator.<Small> { yield 5; } String([...g()].length);`)).toBe('1');
});

test('each constant of a fresh aggregate decides at its position', () => {
  refused('const a: [2].<Small> = [1, 20];');
  refused('const t: [Small, Small] = [1, 20];');
  refused('const o: { a: Small } = { a: 20 };');
  expect(evaluated(`${SMALL}const a: [2].<Small> = [1, 2]; String(a.length);`)).toBe('2');
  expect(evaluated(`${SMALL}const o: { a: Small } = { a: 5 }; String(o.a);`)).toBe('5');
});

test('a return that is never reached is not judged', () => {
  accepted('function f(): Small { return 1; return 20; }');
  accepted("function f(): Small { throw new Error('x'); return 20; }");
});

test('a refinement of a refinement admits a constant that satisfies both', () => {
  const NESTED = 'type Low = uint8 where this < 10; type Mid = Low where this > 3; ';
  expect(evaluated(`${NESTED}let x: Mid = 5; String(x);`)).toBe('5');
  expect(evaluated(`${NESTED}function f(x: Mid) { return x; } String(f(5));`)).toBe('5');
  expect(observeScript(`${NESTED}let x: Mid = 20;`)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
  expect(observeScript(`${NESTED}let x: Mid = 2;`)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
});

test('a fresh aggregate decides at an argument and a return as at an initializer', () => {
  refused('function g(a: [2].<Small>) { return a; } g([1, 20]);');
  refused('function g(o: { a: Small }) { return o; } g({ a: 20 });');
  refused('function f(): [Small, Small] { return [1, 20]; }');
  expect(evaluated(`${SMALL}function g(a: [2].<Small>): uint8 { return a[0]; } String(g([1, 2]));`)).toBe('1');
  expect(evaluated(`${SMALL}function f(): [Small, Small] { return [1, 2]; } String(f()[1]);`)).toBe('2');
});

test('a constant type argument decides a refined domain', () => {
  refused('function f<N: Small>(): string { return "ok"; } f.<20>();');
  expect(evaluated(`${SMALL}function f<N: Small>(): string { return 'ok'; } f.<5>();`)).toBe('ok');
  expect(evaluated(`${SMALL}class C<N: Small> {} String(new C.<5>() instanceof C.<5>);`)).toBe('true');
});

/**
 * #sec-where-clauses: the base's default is the refinement's default where
 * every predicate holds of it; a false predicate means the refinement has
 * none, and a declaration of it needs an initializer.
 */
const noDefault = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-missing-default' } });
};

test('a refinement the base default satisfies has that default', () => {
  expect(evaluated(`${SMALL}let x: Small; String(x);`)).toBe('0');
  expect(evaluated(`${SMALL}class K { a: Small; } String(new K().a);`)).toBe('0');
  expect(evaluated("type Short = string where this.length < 3; let s: Short; String(s.length);")).toBe('0');
});

test('a refinement the base default fails has no default', () => {
  noDefault('type Big = uint8 where this > 5; let x: Big;');
  noDefault('type Big = uint8 where this > 5; class K { a: Big; }');
  noDefault("type Long = string where this.length > 3; let s: Long;");
  noDefault('type Low = uint8 where this < 10; type Mid = Low where this > 3; let x: Mid;');
});

test('an array is filled with its element type\'s default only where there is one', () => {
  noDefault('type Big = uint8 where this > 5; const a: [2].<Big> = new [2].<Big>();');
  expect(evaluated(`${SMALL}const a: [2].<Small> = new [2].<Small>(); String(a.length) + String(a[0]);`)).toBe('20');
  expect(evaluated('const a: [2].<uint8> = new [2].<uint8>(); String(a.length);')).toBe('2');
});
