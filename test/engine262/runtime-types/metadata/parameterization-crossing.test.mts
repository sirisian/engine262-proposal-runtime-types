import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A DECIMAL, COMPLEX OR RATIONAL SOURCE REACHES A CAST. `ApplyImplicitCast`
 * admitted only a typed number or a Number - the representations of the integer
 * and float families - so a value of a family with its OWN object
 * representation could not cross into a parameterization of its own base.
 *
 * The float case hid it: `const f: float32 = 5; const m: Meter = f;` works
 * because a float IS a typed number. The decimal equivalent was refused with
 * `[object Object] is not assignable to "decimal128.<{ scale: 2 }>"`, falling
 * past the cast arm to the membership step - while `d := Cents` succeeded by
 * another route, so the same crossing worked in one spelling and not the other.
 *
 * Together with `decimalWidthOf` unwrapping a parameterization, this closes both
 * directions: a literal reaching a decimal parameterization is read from its
 * digits, and a decimal value reaching one crosses through the cast.
 */
const DC = `type C = { scale: int32 };
meta C { default = { scale: 0 }; subtype(a: C, b: C): boolean { return true; } }
primitive decimal128 { operator decimal128.<C>() { return this; } }
type Cents = decimal128.<{ scale: 2 }>;
`;
const DIM = `type D = { m: int32 };
meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m == b.m; } }
primitive float32 { operator float32.<D>() { return this; } }
type Meter = float32.<{ m: 1 }>; type SqMeter = float32.<{ m: 2 }>;
`;

test('a decimal value crosses into a parameterization of its base', () => {
  expect(evaluated(`${DC}const d: decimal128 = 19.9; const p: Cents = d; String(p);`)).toBe('19.9');
  expect(evaluated(`${DC}const d: decimal128 = 19.9; class K { p: Cents = d; } String(new K().p);`)).toBe('19.9');
});

test('a decimal literal reaches one too, in both spellings', () => {
  expect(evaluated(`${DC}const p: Cents = 19.9; String(p);`)).toBe('19.9');
  expect(evaluated(`${DC}String(19.9 := Cents);`)).toBe('19.9');
  expect(evaluated(`${DC}String(Reflect.typeOf(19.9 := Cents));`)).toBe('decimal128.<{ scale: 2 }>');
});

test('the float family is unchanged, and carries its metadata', () => {
  // These are the spellings that worked throughout; they are pinned because an
  // earlier attempt at this fix regressed the first of them, and because a
  // silent loss of the metadata here would look like success.
  expect(evaluated(`${DIM}String(5 := Meter);`)).toBe('5');
  expect(evaluated(`${DIM}String(Reflect.typeOf(5 := Meter));`)).toBe('float32.<{ m: 1 }>');
  expect(evaluated(`${DIM}const f: float32 = 5; const m: Meter = f; String(m);`)).toBe('5');
});

test('a crossing into the WRONG parameterization is still refused', () => {
  expectThrown(`${DIM}const q: SqMeter = (5 := Meter);`, 'is not assignable to');
});

test('an unparameterized decimal is untouched', () => {
  expect(evaluated('const d: decimal128 = 1.00; String(d);')).toBe('1.00');
  expect(evaluated('String(19.9 := decimal128);')).toBe('19.9');
});
