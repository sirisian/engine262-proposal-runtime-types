import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * `Math.floor`, `Math.ceil`, `Math.round` and `Math.trunc` OF A RATIONAL.
 *
 * rational.md: these "return the `int.<N>` nearest in their direction" - as
 * distinct from `Math.abs`, `Math.sign`, `Math.min` and `Math.max`, which are
 * overloaded to return a rational. A rounding function answers a whole number,
 * and the type says so.
 *
 * They raised "a rational has no Number value" instead, because they routed
 * through `ToNumber`, so four documented overloads did not exist.
 *
 * Computed on the fraction rather than through a double, which matters beyond
 * tidiness: a rational whose numerator exceeds 2^53 has an exact floor, and a
 * double cannot give it.
 */
const R = (n: string) => `const r: rational = ${n}; `;

test('each rounds in its own direction', () => {
  expect(evaluated(`${R('7 / 2')}String(Math.floor(r));`)).toBe('3');
  expect(evaluated(`${R('7 / 2')}String(Math.ceil(r));`)).toBe('4');
  expect(evaluated(`${R('7 / 2')}String(Math.round(r));`)).toBe('4');
  expect(evaluated(`${R('7 / 2')}String(Math.trunc(r));`)).toBe('3');
});

test('a negative value distinguishes floor from trunc', () => {
  // The case that tells the four apart, and the one a truncating implementation
  // of `floor` would get wrong.
  expect(evaluated(`${R('-7 / 2')}String(Math.floor(r));`)).toBe('-4');
  expect(evaluated(`${R('-7 / 2')}String(Math.trunc(r));`)).toBe('-3');
  expect(evaluated(`${R('-7 / 2')}String(Math.ceil(r));`)).toBe('-3');
});

test('a tie rounds toward positive infinity, as Math.round does', () => {
  // `Math.round(2.5)` is 3 and `Math.round(-2.5)` is -2; the rational rows
  // follow, so the two spellings of a half agree.
  expect(evaluated(`${R('5 / 2')}String(Math.round(r));`)).toBe('3');
  expect(evaluated(`${R('-5 / 2')}String(Math.round(r));`)).toBe('-2');
  expect(evaluated('String(Math.round(2.5)) + "/" + String(Math.round(-2.5));')).toBe('3/-2');
});

test('the result is an integer type, not a rational', () => {
  expect(evaluated(`${R('7 / 2')}String(Reflect.typeOf(Math.floor(r)) === int64);`)).toBe('true');
});

test('a rational that is already whole is itself', () => {
  expect(evaluated(`${R('4 / 2')}String(Math.floor(r)) + '/' + String(Math.ceil(r));`)).toBe('2/2');
});

test('the overloads that return a rational still do', () => {
  expect(evaluated(`${R('-1 / 3')}String(Math.abs(r));`)).toBe('1/3');
  expect(evaluated(`${R('-1 / 3')}String(Reflect.typeOf(Math.abs(r)));`)).toBe('rational');
  expect(evaluated(`${R('-1 / 3')}String(Math.sign(r));`)).toBe('-1');
});

test('a Number argument is untouched', () => {
  expect(evaluated('String(Math.floor(3.7)) + "/" + String(Math.ceil(3.2));')).toBe('3/4');
});
