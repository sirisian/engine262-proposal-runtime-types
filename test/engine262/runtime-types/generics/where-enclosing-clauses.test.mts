import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a clause is judged at its declaration under the clauses
 * of each generic declaration lexically enclosing it, over that declaration's
 * generic parameters. A value generic parameter is read at its domain whoever
 * declares it, and a method under its class is the nearest case of the rule.
 */
const refused = (source: string, rule: string, verdict?: 'never succeed' | 'never fail'): void => {
  const observed = observeScript(source);
  expect(observed).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
  if (verdict) {
    const value = observed.completion.Value as { properties?: Iterable<[{ stringValue?(): string }, { Value?: { stringValue?(): string } }]> } | undefined;
    let message = '';
    for (const [key, descriptor] of value?.properties ?? []) if (key?.stringValue?.() === 'message') message = descriptor?.Value?.stringValue?.() ?? '';
    expect(message).toContain(`can ${verdict}`);
  }
};

test('an enclosing value generic is read at its domain', () => {
  refused('function outer<N: uint8>(): void { function inner(): void where N > 300 {} }', 'rt-numeric-range');
  refused('function outer<N: uint8>(): void { function inner(): void where N > 5 where N < 3 {} }', 'rt-impossible-test', 'never succeed');
});

test('a nested function is judged under the enclosing clauses', () => {
  refused('function outer<N: uint8>(): void where N > 100 { function inner(): void where N < 50 {} }', 'rt-impossible-test', 'never succeed');
  refused('function outer<N: uint8>(): void where N > 100 { function inner(): void where N > 50 {} }', 'rt-impossible-test', 'never fail');
  refused('function outer<N: uint8>(): void where N > 100 { function mid(): void { function inner(): void where N < 50 {} } }', 'rt-impossible-test', 'never succeed');
  expect(evaluated('function outer<N: uint8>(): uint8 where N > 100 { function inner(): uint8 where N < 200 { return 1; } return inner(); } String(outer.<120>());')).toBe('1');
});

test('a nested class, alias and object-literal method are judged the same way', () => {
  refused('function outer<N: uint8>(): void where N > 100 { class K where N < 50 {} }', 'rt-impossible-test', 'never succeed');
  refused('function outer<N: uint8>(): void where N > 100 { class K { m(): void where N < 50 {} } }', 'rt-impossible-test', 'never succeed');
  refused('function outer<N: uint8>(): void where N > 100 { type L = [N].<uint8> where N < 50; }', 'rt-impossible-test', 'never succeed');
  refused('function outer<N: uint8>(): void where N > 100 { const o = { m(): void where N < 50 {} }; }', 'rt-impossible-test', 'never succeed');
});

test('a function nested in a class member is judged under the class clauses', () => {
  refused('class C<N: uint8> where N > 100 { m(): void { function inner(): void where N < 50 {} } }', 'rt-impossible-test', 'never succeed');
  refused('class C<N: uint8> where N > 100 { f = function (): void where N < 50 {}; }', 'rt-impossible-test', 'never succeed');
  refused('class C<N: uint8> where N > 100 { m(): void where N < 50 {} }', 'rt-impossible-test', 'never succeed');
  expect(evaluated('class C<N: uint8> where N > 100 { m<M: uint8>(): uint8 where M < N { return M; } } String(new C.<120>().m.<5>());')).toBe('5');
});

test('a name a nearer declaration rebinds is another binding', () => {
  expect(evaluated("function outer<N: uint8>(): void where N > 100 { function inner<N: uint8>(): void where N < 50 {} } 'ok';")).toBe('ok');
  expect(evaluated("function outer<N: uint8>(): void where N > 100 { function inner(N: uint8): void where N < 50 {} } 'ok';")).toBe('ok');
  expect(evaluated("function outer<N: uint8>(): void where N > 100 { { const N = 3; function inner(): void where N < 50 {} } } 'ok';")).toBe('ok');
});

test('an enclosing contract over a formal carries nothing to a nested declaration', () => {
  expect(evaluated("function outer(x: uint8): void where x > 100 { function inner(): void where x < 50 {} } 'ok';")).toBe('ok');
  expect(evaluated("function outer<N: uint8>(x: uint8): void where N > 100 where x > N { function inner(): void where N < 200 {} } 'ok';")).toBe('ok');
});

test('an ordinary branch in the body is not narrowed by order', () => {
  expect(evaluated("function outer<N: uint8>(): void where N > 100 { if (N < 50) {} } 'ok';")).toBe('ok');
});
