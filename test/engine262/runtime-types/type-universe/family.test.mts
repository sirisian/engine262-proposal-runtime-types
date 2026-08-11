import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #table-type-families. The family a type belongs to, as a String.
 *
 * #table-family-operations already decides what an operator does by this
 * concept; `family` is how a program asks the same question. Without it a
 * reflective consumer - a schema emitter, a serializer, a form generator - kept
 * a list of the float types of its own, and was wrong the day a family gained a
 * width.
 */

test('family: the numeric families', () => {
  expect(evaluated('String([uint8, int32, uint128].map((t) => t.family).join(","));'))
    .toBe('integer,integer,integer');
  // the general width form too, aliased because `uint.<12>` inside an array
  // literal is where a type argument list and a comparison meet
  expect(evaluated('type U = uint.<12>; String(U.family);')).toBe('integer');
  expect(evaluated('String([float16, float32, float64, float128].map((t) => t.family).join(","));'))
    .toBe('float,float,float,float');
  expect(evaluated('String([decimal32, decimal64, decimal128].map((t) => t.family).join(","));'))
    .toBe('decimal,decimal,decimal');
  expect(evaluated('type R = rational.<int32>; type C = complex.<float32>;'
    + ' String(R.family) + "," + String(C.family);')).toBe('rational,complex');
  expect(evaluated('String(bigint.family);')).toBe('bigint');
});

test('family: the boolean spellings are three different answers', () => {
  // the trio a reader is most likely to get wrong, so they are pinned together
  expect(evaluated('String(boolean.family);')).toBe('boolean');
  // `boolean1` is a one-bit unsigned integer
  expect(evaluated('String(boolean1.family);')).toBe('integer');
  // and `boolean8` is `vector.<boolean1, 8>`, a bit vector
  expect(evaluated('String(boolean8.family);')).toBe('vector');
  expect(evaluated('String(boolean1.min) + "," + String(boolean1.max);')).toBe('0,1');
  expectThrown('boolean.min;');
});

test('family: the remaining families', () => {
  expect(evaluated('String([string, type, any, never].map((t) => t.family).join(","));'))
    .toBe('string,type,any,never');
  expect(evaluated('String([float32x4, int32x4].map((t) => t.family).join(","));')).toBe('vector,vector');
  expect(evaluated('enum E { A = 1 } String(E.family);')).toBe('enum');
});

test('family: a class names the family and nothing further', () => {
  // a nominal type never exposes its declaration, and this exposes none of its
  // fields, its name, or its shape
  expect(evaluated('class C { x: uint8 = 1; } const c = new C(); String(Reflect.typeOf(c).family);')).toBe('class');
  // asking a value rather than a type answers nothing
  expect(evaluated('String((5).family);')).toBe('undefined');
});

test('family: it reads as the dispatch it is meant to be', () => {
  // the shape every consumer wants: one read, one switch, an honest default
  const schema = 'function leaf(t) { switch (t.family) {'
    + ' case "integer": return "integer";'
    + ' case "float": case "decimal": return "number";'
    + ' case "string": return "string";'
    + ' case "boolean": return "boolean";'
    + ' default: return "unknown"; } } ';
  expect(evaluated(`${schema}String([uint8, float64, decimal32, string, boolean, float32x4]`
    + '.map(leaf).join(","));')).toBe('integer,number,number,string,boolean,unknown');
});
