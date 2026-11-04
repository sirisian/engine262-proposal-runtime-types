import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: within a sequence of `where` clauses, an ordered
 * comparison of a place against a constant narrows the place to the values of
 * its type that satisfy it, in the order the relational judgment of
 * #sec-narrowing gives the type, and a later comparison those values settle
 * can never succeed, or never fail (#sec-generic-where). NaN satisfies no
 * comparison, so the edge on which a comparison succeeds excludes it and the
 * other edge keeps it.
 */
const impossible = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};

test('floating clauses carry their order to the clauses after them', () => {
  impossible('function f(x: float64) where x > 5 where x < 3 { return x; }');
  impossible('function f(x: float32) where x > 5 where x < 3 { return x; }');
  impossible('function f(x: number) where x > 5 where x < 3 { return x; }');
  impossible('function f(x: float32) where x > 0.1 where x < 0.1 { return x; }');
  impossible('function f(x: float64) where x > 5 && x < 3 { return x; }');
  impossible('function f(x: float64): float64 where return > 5 where return < 3 { return x; }');
  impossible('class C { a: float64 = 0; m() where this.a > 5 where this.a < 3 { } }');
  impossible('function f<V: float64>() where V > 5 where V < 3 { return V; }');
});

test('both zeros lie on the same side of every comparison', () => {
  impossible('function f(x: float64) where x >= 0 where x < 0 { return x; }');
  expect(evaluated("function f(x: float64) where x <= 0 where x >= 0 { return x; } f(-0); f(0); 'ok';")).toBe('ok');
});

test('a floating test can never fail only once an earlier clause excludes NaN', () => {
  impossible('function f(x: float64) where x > 5 where x > 3 { return x; }');
  impossible('function f(x: float64) where x > 5 where Number.isNaN(x) { return x; }');
  impossible('function f(x: int32) where x <= 5 || x > 5 { return x; }');
  expect(evaluated("function f(x: float64) where x <= 5 || x > 5 { return x; } 'ok';")).toBe('ok');
});

test('bigint clauses carry their order without limits', () => {
  impossible('function f(x: bigint) where x > 5n where x < 3n { return x; }');
  impossible('function f<N: bigint>() where N > 5n where N < 3n { return N; }');
  expect(evaluated('function f(x: bigint) where x > 3n where x < 5n { return x; } String(f(4n));')).toBe('4');
});

test('enum clauses carry their enumerators\' order', () => {
  impossible('enum E { a, b, c } function f(l: E) where l > E.b where l < E.b { return l; }');
  impossible('enum E { a, b, c } function f<L: E>() where L > E.b where L < E.b { return L; }');
  impossible('enum E { a, b, c } function f(l: E) where l > E.a && l < E.b { return l; }');
  expect(evaluated("enum E { a, b, c } function f(l: E) where l > E.a where l < E.c { return l; } f(E.b); 'ok';")).toBe('ok');
});

test('a range-pattern clause bounds its place for the clauses after it', () => {
  impossible('function f(x: uint8) where x is 5..=10 where x < 3 { return x; }');
  impossible('function f(x: uint8) where x is 5..=10 where x <= 10 { return x; }');
  impossible('function f(x: float64) where x is 5..=10 where x is 20..=30 { return x; }');
  impossible('function f(x: float64) where x > 20 where x is 5..=10 { return x; }');
  expect(evaluated('function f(x: uint8) where x is 5..=10 where x > 7 { return x; } String(f(8));')).toBe('8');
});

test('string clauses carry their code-unit order', () => {
  impossible("function f(s: string) where s > 'b' where s < 'a' { return s; }");
  impossible("function f(s: string) where s >= 'b' where s < 'b' { return s; }");
  impossible("function f(s: string) where s > 'b' where s > 'a' { return s; }");
  impossible("function f(s: string) where s <= 'b' && s > 'b' { return s; }");
  expect(evaluated("function f(s: string) where s > 'a' where s < 'b' { return s; } f('ab');")).toBe('ab');
});

test('an enum over string compares with a String in code-unit order and with an enumerator by position', () => {
  impossible("enum U: string { b = 'b', a = 'a' }; function f(u: U) where u > 'b' where u < 'a' { return u; }");
  expect(evaluated("enum U: string { b = 'b', a = 'a' }; function f(u: U) where u >= U.b where u < U.a { return u; } f(U.b); 'ok';")).toBe('ok');
});

test('satisfiable floating sequences are accepted and run', () => {
  expect(evaluated('function f(x: float64) where x > 3 where x < 5 { return x; } String(f(4.5));')).toBe('4.5');
  expect(evaluated('function f(x: float32) where x >= 1 where x <= 1 { return x; } String(f(1));')).toBe('1');
});

test('an ordinary branch is not narrowed by order', () => {
  expect(evaluated('function f(x: float64) { if (x > 5) { if (x < 3) { return 1; } } return 0; } String(f(1));')).toBe('0');
});
