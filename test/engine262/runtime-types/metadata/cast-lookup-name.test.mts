import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * THE NAME A PRIMITIVE CAST IS REGISTERED UNDER.
 *
 * A WIDTH argument spells the familiar name - `int` with 32 is `int32`,
 * `decimal` with 128 is `decimal128` - but a TYPE argument does not. `complex`
 * with `float64` is not `complexfloat64`, and interpolating the record produced
 * the literal string `"complex[object Object]"`, which matched nothing.
 *
 * So a cast declared for `complex` was invisible to every complex
 * parameterization. Measured at the lookup: **0** casts found before, **2**
 * after, for a cast the program had declared.
 *
 * The families whose argument IS a number must keep spelling their width names,
 * which is what the rows below pin - the change touches how the name is built,
 * so every family that builds one is worth holding still.
 */

test('a decimal cast is still found under its width name', () => {
  const DC = `type C = { scale: int32 };
    meta C { default = { scale: 0 }; subtype(a: C, b: C): boolean { return true; } }
    primitive decimal128 { operator decimal128.<C>() { return this; } }
    type Cents = decimal128.<{ scale: 2 }>;
  `;
  expect(evaluated(`${DC}const d: decimal128 = 19.9; const p: Cents = d; String(p);`)).toBe('19.9');
  expect(evaluated(`${DC}const p: Cents = 19.9; String(p);`)).toBe('19.9');
});

test('a float cast is still found', () => {
  expect(evaluated(`type D = { m: int32 };
    meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return true; } }
    primitive float32 { operator float32.<D>() { return this; } }
    type Meter = float32.<{ m: 1 }>;
    String(5 := Meter);`)).toBe('5');
});

test('a rational cast is still found, through its default width', () => {
  expect(evaluated(`type U = { unit: int32 };
    meta U { default = { unit: 0 }; subtype(a: U, b: U): boolean { return true; } }
    primitive rational { operator rational.<U>() { return this; } }
    type R = rational.<64>.<{ unit: 1 }>;
    const r: rational = 1 / 3; String(r := R);`)).toBe('1/3');
});

test('a complex crossing works in the converting spelling', () => {
  expect(evaluated(`type P = { phase: int32 };
    meta P { default = { phase: 0 }; subtype(a: P, b: P): boolean { return true; } }
    primitive complex { operator complex.<P>() { return this; } }
    type Ph = complex.<float64>.<{ phase: 1 }>;
    const c: complex128 = 1 + 2i; String(c := Ph);`)).toBe('1+2i');
});
