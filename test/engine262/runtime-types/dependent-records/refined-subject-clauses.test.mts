import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-refinement-narrowing: within a sequence of `where` clauses, a place
 * whose type is a source refinement carries what that refinement's clauses
 * establish, as if a narrowing transfer had just established it, and an
 * ordered assertion among them bounds the place as the same comparison would
 * (#sec-narrowing-flow). A clause being judged projects nothing of itself
 * (#sec-generic-where).
 */
const SMALL = 'type Small = uint8 where this < 10;';
const impossible = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};

test('a formal declared at a refinement carries its bound into the clauses', () => {
  impossible(`${SMALL} function f(x: Small) where x > 100 { return x; }`);
  impossible(`${SMALL} function f(x: Small) where x < 10 { return x; }`);
});

test('a refined result carries its bound into a contract', () => {
  impossible(`${SMALL} function f(x: Small): Small where return > 100 { return x; }`);
});

test('an is test against a refinement inside a clause sequence projects it', () => {
  impossible(`${SMALL} function f(x: uint8) where x is Small where x > 100 { return x; }`);
});

test('a refinement is judged under the bound of the refinement it refines', () => {
  impossible('type Big = uint8 where this > 200; type Narrow = Big where this < 100;');
  impossible(`${SMALL} type R = { a: Small } where this.a > 100;`);
});

test('a floating refinement\'s conjunction bounds its subject', () => {
  impossible('type Unit = float64 where this >= 0 && this <= 1; function f(x: Unit) where x > 2 { return x; }');
});

test('satisfiable clauses over refined subjects are accepted', () => {
  expect(evaluated(`${SMALL} function f(x: Small) where x > 3 { return x; } String(f(5));`)).toBe('5');
  expect(evaluated("type Big = uint8 where this > 200; type Mid = Big where this < 250; 'ok';")).toBe('ok');
});
