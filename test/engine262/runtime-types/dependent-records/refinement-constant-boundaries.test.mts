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
