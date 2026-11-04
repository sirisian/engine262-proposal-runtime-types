import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing: an ordered comparison of a place that may hold undefined
 * or null reads each as evaluation does. undefined converts to NaN and fails
 * every comparison; null converts to 0 and compares by value, against a
 * String's Number value where the other operand is a String.
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

test('an omitted or undefined operand fails every ordered comparison', () => {
  impossible('function f(i?: uint8) where i > 300 { return i; }');
  impossible('function f(i?: uint8) where i < 0 { return i; }');
  impossible('function f(x: uint8 | undefined) where x > 300 { return x; }');
  impossible('function f(i?: uint8) where !(i > 300) { return i; }');
  accepted('function f(i?: uint8) where i <= 300 { return i; }');
  accepted('function f(i?: uint8) where i === undefined || i > 10 { return i; }');
  expect(evaluated('function f(i?: uint8) where i === undefined || i > 10 { return i; } String(f());')).toBe('undefined');
});

test('a null operand compares as 0', () => {
  impossible('function f(x: uint8 | null) where x > 300 { return x; }');
  impossible('function f(x: uint8 | null) where x < 0 { return x; }');
  impossible('function f(x: uint8 | null) where x >= 0 { return x; }', 'never fail');
  accepted('function f(x: uint8 | null) where x < 1 { return x; }');
  expect(evaluated('function f(x: uint8 | null) where x < 1 { return x; } String(f(null));')).toBe('null');
});

test("against a String, a nullish operand compares its 0 with the String's Number value", () => {
  impossible("function f(s?: string) where s > 'a' where s < 'a' { return s; }");
  impossible("function f(s: string | null) where s > 'a' where s < 'a' { return s; }");
  impossible("function f(s: string | null) where s > 'a' where s <= 'z' where s > 'z' { return s; }");
  accepted("function f(s: string | null) where s < '5' { return s; }");
  expect(evaluated("function f(s: string | null) where s < '5' { return s; } String(f(null));")).toBe('null');
  // null may sit on the edge where the first test fails, so nothing there never fails.
  accepted("function f(s: string | null) where !(s > 'a') where s <= 'z' { return s; }");
});
