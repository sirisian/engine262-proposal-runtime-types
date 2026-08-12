import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// Spec: sec-ordered-element-types.
//
// `sort` and `toSorted` compare by String when given no comparator, so
// `[].<uint8> = [10, 9, 1]` sorted to "1,10,9" while `Uint8Array` on the same
// input gave "1,9,10" - two array types with the same element type disagreeing.
// Where the element type carries an order, that order is used.
//
// Every input here DISCRIMINATES: string order and the correct order differ.
// Three shapes pass under the old behaviour by coincidence and are useless as
// tests - floats whose orders coincide, enums of ten or fewer members, and the
// NaN input [NaN, 1, -0, 0, -1].

test('the headline: a typed array agrees with its TypedArray', () => {
  const input = '[2, 10, 1, 20, 3]';
  const typed = evaluated(`let a: [].<uint8> = ${input}; a.sort(); a.join(",");`);
  const builtin = evaluated(`const a = new Uint8Array(${input}); a.sort(); a.join(",");`);
  expect(typed).toBe('1,2,3,10,20');
  expect(typed).toBe(builtin);
});

test('every numeric width and sign', () => {
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  expect(evaluated('let a: [].<uint16> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  expect(evaluated('let a: [].<uint32> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  // Signed: string order puts "-1" before "-10", value order does not.
  expect(evaluated('let a: [].<int8> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  expect(evaluated('let a: [].<int16> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  expect(evaluated('let a: [].<int32> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  // Floats, with an input whose string and numeric orders differ.
  expect(evaluated('let a: [].<float32> = [2.5, 10.5, 1.5]; a.sort(); a.join(",");')).toBe('1.5,2.5,10.5');
  expect(evaluated('let a: [].<float64> = [2.5, 10.5, 1.5]; a.sort(); a.join(",");')).toBe('1.5,2.5,10.5');
});

test('bigint compares as a BigInt, not through Number', () => {
  expect(evaluated('let a: [].<bigint> = [10n, 9n, 1n]; a.sort(); a.join(",");')).toBe('1,9,10');
  // Above 2**53, where converting to Number would give a wrong ORDER rather
  // than merely losing precision - the one case that is a wrong answer.
  expect(evaluated('let a: [].<bigint> = [9007199254740993n, 9007199254740992n]; a.sort(); a.join(",");')).toBe('9007199254740992,9007199254740993');
});

test('float NaN and -0 follow %TypedArray%.prototype.sort', () => {
  const input = '[NaN, 2, 10, 1]';
  const typed = evaluated(`let a: [].<float64> = ${input}; a.sort(); a.map(v => String(Number(v))).join(",");`);
  const builtin = evaluated(`const a = new Float64Array(${input}); a.sort(); Array.from(a).join(",");`);
  expect(typed).toBe('1,2,10,NaN');
  expect(typed).toBe(builtin);
  // -0 before +0.
  expect(evaluated('let a: [].<float64> = [0, -0]; a.sort(); a.map(v => Object.is(Number(v), -0) ? "-0" : "0").join(",");')).toBe('-0,0');
});

test('a numeric enum sorts by its ordinal', () => {
  // An enum whose underlying type is numeric holds typed numbers, so it reaches
  // the same comparison the numeric types do.
  //
  // The ordinals here are 2, 10, 1 - numeric order 1,2,10 against string order
  // 1,10,2. An input of 10, 1, 0 would pass under EITHER rule and prove nothing,
  // which is the trap this file's header warns about.
  const E = 'enum L: uint8 { A,B,C,D,E,F,G,H,I,J,K } ';
  expect(evaluated(`${E}let a: [].<L> = [L.C, L.K, L.B]; a.sort(); a.join(",");`)).toBe('1,2,10');
  // Identical to the plain numeric array of the same values.
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
});

test('the types that already sorted correctly still do', () => {
  expect(evaluated('let a: [].<string> = ["b", "a", "c"]; a.sort(); a.join(",");')).toBe('a,b,c');
  expect(evaluated('let a: [].<boolean> = [true, false]; a.sort(); a.join(",");')).toBe('false,true');
});

test('nothing else changes', () => {
  // An untyped array keeps ECMA-262 behaviour, which programs depend on.
  expect(evaluated('const a = [10, 9, 1]; a.sort(); a.join(",");')).toBe('1,10,9');
  // An explicit comparator wins over the element type.
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; a.sort((x, y) => Number(y) - Number(x)); a.join(",");')).toBe('3,2,1');
  // toSorted takes the same path and does not mutate.
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; const b = a.toSorted(); b.join(",") + "|" + a.join(",");')).toBe('1,2,10|2,10,1');
  // Sorting preserves element typing and returns the same array.
  expect(evaluated('let a: [].<uint8> = [2, 1]; const b = a.sort(); String(b === a) + "/" + String(a[0] is uint8);')).toBe('true/true');
  // A fixed-length array sorts in place.
  expect(evaluated('let a: [3].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
});
