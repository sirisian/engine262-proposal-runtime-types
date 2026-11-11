import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: within a sequence of `where` clauses a proved ordered
 * comparison or strict equality of two places of one ordered type retains the
 * order relation between them, closed by a fixed rule list: mirror,
 * complement, transitivity, strict cycle, limit exchange with each place's
 * interval set, and equality sharing one set. #sec-narrowfrom: an ordered
 * comparison of one preserved value with itself is decided as its
 * self-equality is.
 */
const verdictOf = (source: string): string => {
  const observed = observeScript(source);
  expect(observed).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
  const value = observed.completion.Value as { properties?: Iterable<[{ stringValue?(): string }, { Value?: { stringValue?(): string } }]> } | undefined;
  for (const [key, descriptor] of value?.properties ?? []) if (key?.stringValue?.() === 'message') return descriptor?.Value?.stringValue?.() ?? '';
  return '';
};
const neverSucceeds = (source: string): void => { expect(verdictOf(source)).toContain('can never succeed'); };
const neverFails = (source: string): void => { expect(verdictOf(source)).toContain('can never fail'); };
const unsatisfied = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};
const accepted = (source: string): void => { expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } }); };
const call2 = ' function g(x: uint8, y: uint8) { return f(x, y); } ';

test('one place compared with itself is decided', () => {
  neverSucceeds('function f(a: uint8) where a < a { return a; }');
  neverSucceeds('function f(a: uint8) where a > a { return a; }');
  neverFails('function f(a: uint8) where a <= a { return a; }');
  neverSucceeds('function f<N: uint8>(): void where N < N {}');
  // Outside a clause sequence too, as self-equality is.
  neverSucceeds('function f(a: uint8) { if (a < a) {} }');
});

test('a floating place may be NaN, which is not less than or equal to itself', () => {
  neverSucceeds('function f(a: float64) where a < a { return a; }');
  accepted('function f(a: float64) where a <= a { return a; }');
});

test('a recorded relation decides its complement and its mirror', () => {
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where a >= b { return a; }');
  neverFails('function f(a: uint8, b: uint8) where a < b where b > a { return a; }');
  neverFails('function f(a: uint8, b: uint8) where a < b where a <= b { return a; }');
  neverFails('function f(a: uint8, b: uint8) where a < b where a !== b { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where a === b { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a === b where a !== b { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a === b where a < b { return a; }');
});

test('a failed floating comparison retains no relation until NaN is excluded', () => {
  accepted('function f(a: float64, b: float64) where !(a < b) where a >= b { return a; }');
  neverSucceeds('function f(a: float64, b: float64) where a < b where a >= b { return a; }');
});

test('each operand contributes its interval set', () => {
  neverSucceeds('function f(a: uint8, b: uint8) where a < 5 where b > 10 where a > b { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a < 5 where b > 10 where a === b { return a; }');
  neverFails('function f(a: uint8, b: uint8) where a < 5 where b > 10 where a < b { return a; }');
  expect(evaluated(`function f(a: uint8, b: uint8) where a < 5 where b > 3 where a === b { return a; }${call2}String(g(4, 4));`)).toBe('4');
});

test('relations close by transitivity and a strict cycle leaves nothing', () => {
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where b < a { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8, c: uint8) where a < b where b < c where c < a { return a; }');
  neverFails('function f(a: uint8, b: uint8, c: uint8) where a < b where b < c where a < c { return a; }');
  expect(evaluated('function f(a: uint8, b: uint8, c: uint8) where a < b where b < c { return c; } function g(x: uint8, y: uint8, z: uint8) { return f(x, y, z); } String(g(1, 2, 3));')).toBe('3');
  expect(evaluated(`function f(a: uint8, b: uint8) where a <= b where b <= a { return a; }${call2}String(g(4, 4));`)).toBe('4');
});

test('a relation exchanges limits with the interval sets', () => {
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where b === 0 { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where a === 255 { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a < b where a > 100 where b < 50 { return a; }');
  neverSucceeds('function f(a: uint8, b: uint8) where a === b where a > 5 where b < 3 { return a; }');
  neverSucceeds('function f<N: uint32, I: uint32>(): void where I < N where N === 0 {}');
  expect(evaluated(`function f(a: uint8, b: uint8) where a < b where b > 5 { return a; }${call2}String(g(3, 9));`)).toBe('3');
});

test('a disjunction keeps the orders either side leaves', () => {
  expect(evaluated(`function f(a: uint8, b: uint8) where a < b || b < a { return a; }${call2}String(g(4, 5));`)).toBe('4');
  neverSucceeds('function f(a: uint8, b: uint8) where a < b || b < a where a === b { return a; }');
});

test('an enclosing relation is a premise of a retained obligation', () => {
  const g = 'function g<N: uint32, I: uint32>(): uint32 where I < N { return I; } ';
  unsatisfied(`${g}function h<M: uint32, K: uint32>(): uint32 where K >= M { return g.<M, K>(); }`);
  unsatisfied(`${g}function h<M: uint32>(): uint32 { return g.<M, M>(); }`);
  expect(evaluated(`${g}function h<M: uint32, K: uint32>(): uint32 where K < M { return g.<M, K>(); } String(h.<5, 2>());`)).toBe('2');
});

test('a relation to an enclosing value generic reaches a nested clause', () => {
  neverSucceeds('function outer<N: uint8>(): void where N > 100 { function inner<M: uint8>(): void where M > N where M < 50 {} }');
});

test('an ordinary branch is not narrowed by a relation', () => {
  expect(evaluated("function f(a: uint8, b: uint8) { if (a < b) { if (a >= b) {} } } 'ok';")).toBe('ok');
});
