import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: within a sequence of `where` clauses a place holds a
 * set of intervals. A join unions pieces, an equality test reads the set, an
 * exclusion cuts a hole, and a refinement's disjunction or conditional
 * projects as pieces (#sec-refinement-narrowing).
 */
const messageOf = (observed: ReturnType<typeof observeScript>): string => {
  const value = observed.completion.Value as { properties?: Iterable<[{ stringValue?(): string }, { Value?: { stringValue?(): string } }]> } | undefined;
  for (const [key, descriptor] of value?.properties ?? []) if (key?.stringValue?.() === 'message') return descriptor?.Value?.stringValue?.() ?? '';
  return '';
};
const impossible = (source: string, verdict: 'never succeed' | 'never fail' = 'never succeed'): void => {
  const observed = observeScript(source);
  expect(observed).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
  expect(messageOf(observed)).toContain(`can ${verdict}`);
};
const accepted = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } });
};

test('a disjunction keeps both pieces, so a later test between them never succeeds', () => {
  impossible('function f(x: int32) where x > 5 || x < -5 where x === 0 { return x; }');
  impossible('function f(x: int32) where x < 0 || x > 10 where x >= 2 && x <= 8 { return x; }');
  impossible('function f(x: int32) where x < 0 || (x > 10 && x < 20) || x > 30 where x >= 20 where x <= 30 { return x; }');
  impossible('function f(x: bigint) where x > 5n || x < -5n where x === 0n { return x; }');
  accepted('function f(x: int32) where x < 0 || x > 10 where x === 11 { return x; }');
  accepted('function f(x: int32) where x < 0 || x > 10 where x < 20 { return x; }');
  expect(evaluated('function f(x: int32) where x < 0 || x > 10 where x === 11 { return x; } String(f(11));')).toBe('11');
});

test('a disjunction that covers the domain never fails', () => {
  impossible('function f(x: uint8) where x < 100 || x >= 100 { return x; }', 'never fail');
});

test('an equality test reads the set', () => {
  impossible('function f(x: int32) where x > 5 && x < 10 where x === 20 { return x; }');
  impossible('function f(x: int32) where x === 5 where x > 10 { return x; }');
  impossible('function f(x: int32) where !(x > 5) where x > 5 { return x; }');
});

test('an exclusion inside an interval cuts a hole, whichever order the clauses come in', () => {
  impossible('function f(x: uint8) where x >= 5 where x <= 5 where x !== 5 { return x; }');
  impossible('function f(x: uint8) where x > 5 where x < 7 where x !== 6 { return x; }');
  impossible('function f(x: uint8) where x !== 5 where x > 4 where x < 6 { return x; }');
  impossible('enum E { a, b, c } function f(l: E) where l > E.a where l !== E.b where l < E.c { return l; }');
  accepted('function f(x: uint8) where x > 5 where x < 8 where x !== 6 { return x; }');
  expect(evaluated('function f(x: uint8) where x > 5 where x < 8 where x !== 6 { return x; } String(f(7));')).toBe('7');
});

test('both zeros are one value to an exclusion, and NaN stays on the edge where an inequality succeeds', () => {
  impossible('function f(x: float64) where x >= 0 where x <= 0 where x !== 0 { return x; }');
  impossible('function f(x: float64) where x !== 0 where x >= 0 where x <= 0 { return x; }');
  accepted('function f(x: float64) where x !== 0 where x >= 0 where x <= 1 { return x; }');
  expect(evaluated('function f(x: float64) where x !== 0 { return x; } String(Number.isNaN(f(NaN)));')).toBe('true');
});

test("a negated range pattern's false edge keeps both sides of the range", () => {
  impossible('function f(x: uint8) where !(x is 10..=20) where x >= 10 where x <= 20 { return x; }');
  accepted('function f(x: uint8) where !(x is 10..=20) where x >= 10 where x <= 25 { return x; }');
});

test('a refinement written as a disjunction projects as pieces', () => {
  impossible('type T = uint8 where this < 10 || this > 200; function f(x: T) where x > 50 where x < 150 { return x; }');
  impossible('type N = uint8 where (this < 10 || this > 200) && this !== 5; function f(x: N) where x >= 5 where x <= 5 { return x; }');
  accepted('type T = uint8 where this < 10 || this > 200; function f(x: T) where x > 5 where x < 220 { return x; }');
  expect(evaluated('type T = uint8 where this < 10 || this > 200; function f(x: T) where x > 5 where x < 220 { return x; } String(f(7));')).toBe('7');
});

test('a conditional refinement projects the union of its branches under their tests', () => {
  impossible('type C = uint8 where if (this > 100) { this > 200 } else { true }; function f(x: C) where x > 100 where x < 150 { return x; }');
  impossible('type E = uint8 where if (this > 100) { this > 200 } else { this < 50 }; function f(x: E) where x >= 50 where x <= 100 { return x; }');
  impossible('type G = uint8 where !(this > 100); function f(x: G) where x > 100 { return x; }');
  accepted('type G = uint8 where !(this > 100); function f(x: G) where x > 50 { return x; }');
});

test('a disjunction over two places projects nothing', () => {
  accepted('type M = { a: uint8, b: uint8 } where this.a < 10 || this.b > 200; function f(m: M) where m.a > 50 { return m; }');
});
