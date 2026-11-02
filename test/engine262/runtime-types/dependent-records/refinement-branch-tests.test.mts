import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-where-clauses: the conditional form's AssignmentExpression decides a
 * branch and a `match` predicate's patterns are pattern positions, so both are
 * judged as they are anywhere else (#sec-narrowfrom,
 * #sec-pattern-static-semantics). #sec-discriminated-where-chains: the last
 * test of a chain whose conditions exhaust its discriminant may be certain.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a conditional refinement\'s test is judged as any test is', () => {
  refused("type T = { k: 'a' | 'b', x?: uint8 } where if (this.k == 'c') { this.x != null };", 'rt-impossible-test');
  refused('function f(i: uint8) where if (i > 300) { i > 1 } { return i; }', 'rt-numeric-range');
});

test('a match refinement\'s patterns are judged and its implicit default spares exhaustiveness', () => {
  refused("type U = { k: 'a' | 'b' } where match (this.k) { when 'c': true };", 'rt-pattern-domain');
  expect(evaluated("type U = { k: 'a' | 'b' } where match (this.k) { when 'a': true }; ({ k: 'a' } is U) ? 'y' : 'n';")).toBe('y');
});

test('the last test of a chain that exhausts its discriminant may be certain', () => {
  const S = "type S = { kind: 'c' | 's', r?: string, w?: string } where if (this.kind == 'c') { this.r != null } else { if (this.kind == 's') { this.w != null } };";
  expect(evaluated(`${S} ({ kind: 's', w: 'x' } is S) ? 'y' : 'n';`)).toBe('y');
  expect(evaluated(`${S} ({ kind: 's' } is S) ? 'y' : 'n';`)).toBe('n');
  refused("type S = { kind: 'c' | 's', r?: string, w?: string } where if (this.kind == 'c') { this.r != null } else { if (this.kind == 's') { this.w != null } else { false } };", 'rt-impossible-test');
});

test('only a discriminating chain spares its certain last test', () => {
  refused("type R = { a: uint8 } where if (this.a > 5) { this.a < 200 } else { if (this.a <= 5) { this.a > 1 } };", 'rt-impossible-test');
  refused("type R = { k: 'a' | 'b', j: 'x' | 'y' } where if (this.k == 'a') { true } else { if (this.j == 'x' || this.j == 'y') { true } };", 'rt-impossible-test');
  // A condition of a discriminating chain is one equality comparison; testing
  // several constants is the match form's `or`.
  refused("type K = { k: 'a' | 'b' | 'c', n?: string } where if (this.k == 'a') { this.n != null } else { if (this.k == 'b' || this.k == 'c') { true } };", 'rt-impossible-test');
  expect(evaluated("type K = { k: 'a' | 'b' | 'c', n?: string } where if (this.k == 'a') { this.n != null } else { if (this.k == 'b') { true } else { if (this.k == 'c') { true } } }; 'ok';")).toBe('ok');
});

test('the explicit branch constants stay legal', () => {
  expect(evaluated("type D = { kind: 'email' | 'sms', email?: string } where if (this.kind === 'email') { this.email !== undefined } else { true }; 'ok';")).toBe('ok');
  expect(evaluated("type D = { kind: 'email' | 'sms', email?: string } where if (this.kind === 'email') { this.email !== undefined } else { false }; 'ok';")).toBe('ok');
});
