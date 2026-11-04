import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: within a sequence of `where` clauses a float16 place
 * is ordered as any float is, its constants rounded as a literal in a
 * float16 position rounds (#sec-literalvalueintype); a range pattern bounds
 * a decimal or String place as the comparisons its endpoints spell would;
 * and a String's or a value pack's `length` is a place, as an array's is.
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

test('a float16 place is ordered in every clause position, its constants rounded to float16', () => {
  impossible('function f(x: float16) where x > 5 where x < 3 { return x; }');
  impossible('function f(x: float16) where x >= 1 where x >= 0.5 { return x; }', 'never fail');
  impossible('function f(x: float16) where x is 1..=2 where x > 3 { return x; }');
  impossible('class C { m(x: float16) where x > 5 where x < 3 { return x; } }');
  impossible('interface I { m(x: float16): void where x > 5 where x < 3; }');
  impossible('class D { x: float16 = 0; m() where this.x > 5 where this.x < 3 { return 1; } }');
  // 0.09998 and 0.09997 both round to 0.0999755859375, so the clauses admit it.
  accepted('function f(x: float16) where x >= 0.09998 where x <= 0.09997 { return x; }');
  expect(evaluated('let y: float16 = 0.09998; let z: float16 = 0.09997; String(y === z) + " " + String(y === 0.1);')).toBe('true true');
});

test('a range pattern bounds a decimal place', () => {
  impossible('function f(x: decimal128) where x is 0.1..=0.2 where x > 0.3 { return x; }');
  impossible('function f(x: decimal128) where x is 0.1..<0.2 where x >= 0.2 { return x; }');
  impossible('function f(x: decimal128) where x > 0.1 where x < 0.2 where x is 0.1..=0.2 { return x; }', 'never fail');
  accepted('function f(x: decimal128) where x is 0.1..=0.2 where x > 0.15 { return x; }');
});

test('a range pattern bounds a String place in code-unit order', () => {
  impossible("function f(s: string) where s is 'a'..='c' where s > 'd' { return s; }");
  impossible("function f(s: string) where s is 'a'..<'b' where s >= 'b' { return s; }");
  impossible("function f(s: string) where s > 'a' where s < 'b' where s is 'a'..='b' { return s; }", 'never fail');
  accepted("function f(s: string) where s is 'a'..='c' where s > 'b' { return s; }");
});

test("a String's length and a value pack's length are places", () => {
  impossible('function f(s: string) where s.length > 3 where s.length < 2 { return s; }');
  impossible('function f(s: string) where s.length >= 0 { return s; }', 'never fail');
  impossible('function f<...I: [].<uint8>>() where I.length > 3 where I.length < 2 { return 1; }');
  accepted('function f(s: string) where s.length > 3 where s.length < 6 { return s; }');
  expect(evaluated("function f(s: string) where s.length > 3 where s.length < 6 { return s; } String(f('abcd'));")).toBe('abcd');
});
