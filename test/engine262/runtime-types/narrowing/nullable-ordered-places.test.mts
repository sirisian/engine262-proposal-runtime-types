import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: a place that may be `null` is ordered as its other
 * member. A comparison reads `null` as 0, which every numeric domain holds,
 * so the member's interval set is the numeric image of the place, and a
 * clause sequence over it is judged as it would evaluate.
 */
const neverSucceeds = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};
const accepted = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } });
};
const tried = (declaration: string, argument: string): string => evaluated(`${declaration}
  function g(v: uint8 | null) { try { return String(f(v)); } catch (e) { return e.constructor.name; } } g(${argument});`) as string;

test('a nullable place carries an interval through a clause sequence', () => {
  neverSucceeds('function f(x: uint8 | null) where x > 5 where x < 3 { return x; }');
  neverSucceeds('function f(x: uint8 | null) where x < 3 where x > 5 { return x; }');
  neverSucceeds('function f(x: int8 | null) where x > -3 where x < -5 { return x; }');
  accepted('function f(x: uint8 | null) where x < 5 where x > 2 { return x; }');
});

test('null is read as the 0 the comparison converts it to', () => {
  const below = 'function f(x: uint8 | null) where x < 3 { return x; }';
  expect(tried(below, 'null')).toBe('null');
  expect(tried(below, '9')).toBe('TypeError');
  const above = 'function f(x: uint8 | null) where x > 5 { return x; }';
  expect(tried(above, 'null')).toBe('TypeError');
  expect(tried(above, '9')).toBe('9');
});

test('a clause null satisfies does not exclude null, and one it fails does', () => {
  accepted('function f(x: uint8 | null) where x < 1 where x === null { return x; }');
  expect(tried('function f(x: uint8 | null) where x < 1 where x === null { return x; }', 'null')).toBe('null');
  neverSucceeds('function f(x: uint8 | null) where x > 5 where x === null { return x; }');
});

test('a nullable refinement projects where its set holds 0, the value null is read as', () => {
  const SMALL = 'type Small = uint8 where this < 10; ';
  neverSucceeds(`${SMALL}function f(x: Small | null) where x > 100 { return x; }`);
  accepted(`${SMALL}function f(x: Small | null) where x > 5 { return x; }`);
  // A refinement that excludes 0 would say of null what is false of it.
  const BIG = 'type Big = uint8 where this > 5; ';
  accepted(`${BIG}function f(x: Big | null) where x < 3 { return x; }`);
  accepted(`${BIG}function f(x: Big | null) where x > 3 { return x; }`);
});

test('undefined and a non-numeric member leave the place unordered', () => {
  accepted('function f(x: uint8 | undefined) where x > 5 where x < 3 { return x; }');
  accepted('function f(x: uint8 | string) where x > 5 where x < 3 { return x; }');
});
