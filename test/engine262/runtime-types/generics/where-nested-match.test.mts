import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-where-clauses: the implicit `default: false` belongs to a `match` that
 * is a whole predicate or a whole branch predicate. Any other `match` in a
 * predicate is an ordinary expression (#sec-match-exhaustiveness,
 * #sec-pattern-static-semantics), and the rest of the predicate is judged as
 * any test is.
 */
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('the rest of a predicate holding a match is judged', () => {
  refused("function f(k: 'a' | 'b', x: uint8) where x > 300 && match (k) { when 'a': true; default: false } { return k; }", 'rt-numeric-range');
  refused('class C<N: uint8> where N > 300 && match (N) { when 1: true; default: false } {}', 'rt-numeric-range');
  refused("function f(k: 'a' | 'b', x: uint8) where x > 5 where x < 3 && match (k) { when 'a': true; default: false } { return k; }", 'rt-impossible-test');
});

test('a nested match has its patterns judged', () => {
  refused("function f(k: 'a' | 'b') where !match (k) { when 'c': true; default: false } { return k; }", 'rt-pattern-domain');
  refused("function f(k: 'a' | 'b', x: uint8) where x > 5 && match (k) { when 'c': true; default: false } { return k; }", 'rt-pattern-domain');
});

test('a nested match has no implicit default, so it is exhaustive or refused', () => {
  refused("type T = { k: 'a' | 'b', n: uint8 } where this.n > 3 && match (this.k) { when 'a': true };", 'rt-nonexhaustive-match');
  refused("function f(k: 'a' | 'b', x: uint8) where x > 3 && match (k) { when 'a': true } { return k; }", 'rt-nonexhaustive-match');
  expect(evaluated("function f(k: 'a' | 'b', x: uint8) where x > 3 && match (k) { when 'a': true; default: false } { return k; } String(f('a', 9));")).toBe('a');
});

test('a nested match is exhaustive over what the operands before it leave', () => {
  expect(evaluated("function f(k: 'a' | 'b') where k !== 'b' && match (k) { when 'a': true } { return k; } 'ok';")).toBe('ok');
});

test('a boundary answers false where a nested match answers false', () => {
  const T = "type T = { k: 'a' | 'b', n: uint8 } where this.n > 3 && match (this.k) { when 'a': true; when 'b': false }; ";
  expect(evaluated(`${T}const v: { k: 'a' | 'b', n: uint8 } = { k: 'b', n: 9 }; String(v is T);`)).toBe('false');
  expect(evaluated(`${T}const v: { k: 'a' | 'b', n: uint8 } = { k: 'a', n: 9 }; String(v is T);`)).toBe('true');
});

test('a whole-predicate match keeps its implicit default', () => {
  expect(evaluated("type U = { k: 'a' | 'b' } where match (this.k) { when 'a': true }; ({ k: 'b' } is U) ? 'y' : 'n';")).toBe('n');
  expect(evaluated("type U = { k: 'a' | 'b' } where (match (this.k) { when 'a': true }); ({ k: 'a' } is U) ? 'y' : 'n';")).toBe('y');
});
