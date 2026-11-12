import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-check-insertion: a call is judged against the callee's contract with
 * each parameter read at the static type of its argument. Where a clause can
 * then never succeed, no value the argument can hold satisfies the contract,
 * and the call is a type error where it is written.
 */
const SMALL = 'type Small = uint8 where this < 10; ';
const G = 'function g(x: uint8): uint8 where x > 100 { return x; } ';
const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-where-unsatisfied' } });
};

test('an argument of a refined type that the contract excludes is refused at the call', () => {
  refused(`${SMALL}${G}function h(y: Small) { return g(y); }`);
  refused(`${SMALL}class C { m(x: uint8): uint8 where x > 100 { return x; } } function h(y: Small) { return new C().m(y); }`);
  expect(evaluated(`${SMALL}function g(x: uint8): uint8 where x > 5 { return x; } function h(y: Small) { return g(y); } const v: Small = 7; String(h(v));`)).toBe('7');
});

test('an argument of a narrower member type is judged the same way', () => {
  refused('function g(x: uint8 | null): uint8 where x !== null { return 1; } function h(y: null) { return g(y); }');
  refused("function g(k: 'a' | 'b'): string where k === 'a' { return k; } function h(j: 'b') { return g(j); }");
  expect(evaluated("function g(k: 'a' | 'b'): string where k === 'a' { return k; } function h(j: 'a' | 'b') { return g(j); } h('a');")).toBe('a');
});

test('an argument of the parameter\'s own type says nothing, and is left to the call', () => {
  expect(evaluated(`${G}function h(y: uint8) { return g(y); } String(h(120));`)).toBe('120');
  expect(observeScript(`${G}function h(y: uint8) { return g(y); } h(20);`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});

test('a conversion to the base drops the refinement, and with it the verdict', () => {
  expect(observeScript(`${SMALL}${G}function h(y: Small) { return g(y := uint8); } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
});

test('a clause that reads a name outside the parameters is not judged this way', () => {
  expect(observeScript(`${SMALL}const LIMIT: uint8 = 200; function g2(x: uint8): uint8 where x > LIMIT { return x; } function h(y: Small) { return g2(y); } 'ok';`))
    .toMatchObject({ completion: { Type: 'normal' } });
});
