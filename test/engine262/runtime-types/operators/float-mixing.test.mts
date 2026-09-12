import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec 3149: "It is a type error if the Static Types of the operands of an
 * arithmetic, bitwise, shift, or relational operator are numeric types that are
 * not the same type."
 *
 * The rule reached the integers and the decimals and not the binary floats,
 * because `isNumericValueTypeName` matched the family name `float` while a
 * binary float record carries its width IN the name, `float64`. So the
 * predicate matched nothing, every rule reading it passed a float by, and
 * `float64 * float32` was the run time's error where `uint8 * int32` was an
 * Early Error - one rule answering two ways by the family of its operands.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const D = 'let f: float64 = float64(1); let g: float32 = float32(1);'
  + ' let n: uint8 = uint8(1); let d: decimal64 = decimal64("1"); ';

test('two binary floats of different widths do not mix', () => {
  for (const e of ['f * g', 'f + g', 'f - g', 'f / g']) {
    expectThrown(dead(`${D}let q = ${e};`), 'different numeric types');
  }
});

test('a binary float does not mix with another family', () => {
  expectThrown(dead(`${D}let q = f * n;`), 'different numeric types');
  expectThrown(dead(`${D}let q = f + d;`), 'different numeric types');
});

test('same-width arithmetic and literal adoption are unchanged', () => {
  // One type on both sides is the ordinary case.
  for (const e of ['f * f', 'f + f', 'f - f', 'f / f', 'g * g']) {
    expect(ok(dead(`${D}let q = ${e};`))).toBe(true);
  }
  // A literal beside a float adopts it, at either position and either width -
  // the adoption the predicate gates, which is why widening it had to keep
  // these working.
  for (const e of ['f + 1', '1 + f', 'f * 2.5', 'g + 1', '1 * g']) {
    expect(ok(dead(`${D}let q = ${e};`))).toBe(true);
  }
  expect(ok(`${D}let x: float64 = f + 1; "ok";`)).toBe(true);
  expect(ok(`${D}let x: float32 = g + 1; "ok";`)).toBe(true);
  // The integer and decimal families, which the rule reached all along.
  expect(ok(dead(`${D}let q = n + 1;`))).toBe(true);
  expect(ok(dead(`${D}let q = d + 1;`))).toBe(true);
});
