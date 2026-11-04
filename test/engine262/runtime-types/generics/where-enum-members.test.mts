import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing: a relational comparison narrows a closed set read by its
 * members, and an enum's enumerators are such members. Each enumerator
 * answers by its own value, by its declaration position against one of its
 * enum's enumerators, and by code units against a String; a constant that is
 * no enumerator compares by value.
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
const S = 'enum S { a = 0, b = 5, c = 10 }';
const U = "enum U: string { b = 'b', a = 'a', c = 'c' };";

test('a sparse enum narrows to the enumerators a comparison admits', () => {
  impossible(`${S} function f(l: S) where l > S.a where l < S.b { return l; }`);
  impossible(`${S} function f(l: S) where l > S.a where l >= S.b { return l; }`, 'never fail');
  impossible(`${S} function f(l: S) where l !== S.b where l > S.a where l < S.c { return l; }`);
  accepted(`${S} function f(l: S) where l > S.a where l < S.c { return l; }`);
  expect(evaluated(`${S} function f(l: S) where l > S.a where l < S.c { return l; } String(f(S.b));`)).toBe('5');
});

test('a constant that is no enumerator compares by value', () => {
  impossible(`${S} function f(l: S) where l > 2 where l < 5 { return l; }`);
  accepted(`${S} function f(l: S) where l > 2 where l < 6 { return l; }`);
});

test('a field read through this narrows as a parameter does', () => {
  impossible(`${S} class C { l: S = S.a; m() where this.l > S.a where this.l < S.b { return 1; } }`);
});

test('an enum over string narrows by code units against a String and by position against an enumerator', () => {
  impossible(`${U} function f(u: U) where u > 'b' where u < U.a { return u; }`);
  impossible(`${U} function f(u: U) where u > 'a' where u < 'b' { return u; }`);
  impossible(`${U} function f(u: U) where u > U.b where u < 'c' where u < 'b' { return u; }`, 'never fail');
  accepted(`${U} function f(u: U) where u >= 'b' where u < U.a { return u; }`);
  accepted(`${U} function f(u: U) where u > 'a' where u > U.b { return u; }`);
  accepted(`${U} function f(u: U) where u > U.b where u < 'c' { return u; }`);
  expect(evaluated(`${U} function f(u: U) where u >= 'b' where u < U.a { return u; } String(f(U.b));`)).toBe('b');
});

test('the narrowing reaches ordinary branches, as it does for a union of literals', () => {
  impossible(`${S} function f(l: S) { if (l > S.a) { if (l < S.b) { return 1; } } return 0; }`);
  accepted(`${S} function f(l: S) { if (l > S.a) { if (l < S.c) { return 1; } } return 0; }`);
  expect(evaluated(`${S} function f(l: S) { if (l > S.a) { if (l < S.c) { return 1; } } return 0; } String(f(S.b) + f(S.c));`)).toBe('1');
});
