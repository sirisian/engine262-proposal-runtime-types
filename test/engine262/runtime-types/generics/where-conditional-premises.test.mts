import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-where-clauses: a conditional-form predicate establishes the facts of
 * the conditional expression over the same test and branches, an absent
 * `else` holding where the test fails. #sec-narrowing-flow: each clause is
 * judged under the clauses written before it, the conditional form included.
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

test('a later clause is judged under the join of both branches', () => {
  impossible('function f(x: int32) where if (x > 5) { x > 10 } else { x < 2 } where x === 7 { return x; }');
  accepted('function f(x: int32) where if (x > 5) { x > 10 } else { x < 2 } where x === 12 { return x; }');
  expect(evaluated('function f(x: int32) where if (x > 5) { x > 10 } else { x < 2 } where x === 12 { return x; } String(f(12));')).toBe('12');
});

test('a conditional without an else holds where its test fails', () => {
  impossible('function f(x: uint8) where if (x > 5) { x > 10 } where x > 5 where x < 9 { return x; }');
  expect(evaluated('function f(x: uint8) where if (x > 5) { x > 10 } where x < 9 { return x; } String(f(3));')).toBe('3');
});

test('a branch written as false contributes no value', () => {
  impossible('function f(x: uint8) where if (x > 5) { false } where x > 5 { return x; }');
  impossible('function f(x: uint8) where if (x > 5) { false } where x < 9 { return x; }', 'never fail');
  // Both branches false is the explicit constant, which keeps its written meaning.
  accepted('function f(x: uint8) where if (x > 5) { false } else { false } { return x; }');
});

test('the form is read the same on a class, an alias, a refinement and a result', () => {
  impossible('class C<N: uint8> where if (N > 5) { N > 10 } else { false } where N < 8 {}');
  impossible('type T<N: uint8> = [N].<uint8> where if (N > 5) { N > 10 } else { false } where N < 8;');
  impossible('type T = uint8 where if (this > 5) { this > 10 } else { false } where this < 8;');
  impossible('function f(x: uint8): uint8 where if (return > 5) { return > 10 } else { false } where return < 8 { return x; }');
});

test('branches over a place the test does not read are joined too', () => {
  impossible('function f(x: uint8, y: uint8) where if (x > 5) { y > 10 } else { y > 20 } where y < 5 { return x; }');
  impossible("function f(k: 'a' | 'b', x: uint8) where if (k === 'a') { x > 10 } else { x > 20 } where x < 5 { return x; }");
  expect(evaluated('function f(x: uint8, y: uint8) where if (x > 5) { y > 10 } else { y > 20 } where y < 15 { return y; } String(f(9, 12));')).toBe('12');
});

test('the conditional form and the conditional expression agree', () => {
  for (const clause of ['if (x > 5) { x > 10 } else { x < 2 }', 'x > 5 ? x > 10 : x < 2']) {
    impossible(`function f(x: int32) where ${clause} where x === 7 { return x; }`);
    accepted(`function f(x: int32) where ${clause} where x === 0 { return x; }`);
  }
});

test('an enclosing conditional clause over two places is a premise of a retained obligation', () => {
  const g = 'function g<N: uint8>() where N < 5 { return N; } ';
  expect(observeScript(`${g}function h<K: uint8, M: uint8>() where if (K > 5) { M > 10 } else { M > 20 } { return g.<M>(); }`))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
  accepted(`${g}function h<K: uint8, M: uint8>() where if (K > 5) { M > 10 } else { M < 3 } { return g.<M>(); }`);
});

test('a contract in the conditional form is evaluated at the call', () => {
  const f = 'function f(x: uint8, y: uint8) where if (x > 5) { y > 10 } { return y; } function g(a: uint8, b: uint8) { return f(a, b); } ';
  expect(evaluated(`${f}String(g(9, 12));`)).toBe('12');
  expect(evaluated(`${f}String(g(1, 2));`)).toBe('2');
  expect(observeScript(`${f}g(9, 2);`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});
