import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-structural-matching, R8. `Reflect.inferSlot(name)` "returns a fresh slot,
 * a Type Object standing for a position a match is to bind", and
 * `Reflect.matchType(pattern, subject)` "performs one-sided structural
 * unification of pattern against subject: where every slot in pattern can be
 * bound consistently so that the pattern becomes subject, it returns an object
 * mapping each slot's name to the Type Object bound there, and otherwise it
 * returns null."
 *
 * The unification itself was already here, binding the ~parameter~ records of a
 * generic signature - a slot and a type parameter are one thing rather than two
 * that behave alike - so what was missing was the reflective surface. The clause
 * was deferred on the measurement that the catalog needed it zero times, and
 * records why that changed: a decorator dispatching on the structure of a type
 * it is handed "cannot be written without this operation".
 */

const S = 'let S = Reflect.inferSlot("S"); ';
const arrayOfSlot = 'Reflect.makeType({ kind: "array", element: S })';

test('a slot binds what stands in its position', () => {
  expect(evaluated(`${S} let m = Reflect.matchType(${arrayOfSlot}, type [].<uint8>); String(m.S === uint8);`)).toBe('true');
});

test('a pattern that does not fit returns null, not a partial binding', () => {
  expect(evaluated(`${S} String(Reflect.matchType(${arrayOfSlot}, type string));`)).toBe('null');
});

test('a slot occurring twice binds once and must bind alike', () => {
  const P = 'let P = Reflect.makeType({ kind: "tuple", elements: [{ type: S, rest: false }, { type: S, rest: false }] }); ';
  expect(evaluated(`${S}${P} String(Reflect.matchType(P, type [uint8, uint8]).S === uint8);`)).toBe('true');
  expect(evaluated(`${S}${P} String(Reflect.matchType(P, type [uint8, string]));`)).toBe('null');
});

test('a pattern with no slots is an ordinary structural comparison', () => {
  expect(evaluated('String(Reflect.matchType(uint8, uint8) !== null);')).toBe('true');
  expect(evaluated('String(Reflect.matchType(uint8, type string));')).toBe('null');
});

test('a constraint on a binding is a check of the result afterwards', () => {
  // "so `Reflect.isAssignable` supplies what an `infer S extends string` says" -
  // the match binds, and the caller decides whether the binding is acceptable.
  expect(evaluated(`${S} let m = Reflect.matchType(${arrayOfSlot}, type [].<"x">);`
    + ' String(m !== null) + "/" + String(Reflect.isAssignable(m.S, type string));')).toBe('true/true');
});
