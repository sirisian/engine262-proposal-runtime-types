import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec 3149: "It is a type error if the Static Types of the operands of an
 * arithmetic, bitwise, shift, or RELATIONAL operator are numeric types that are
 * not the same type."
 *
 * The relational arm reached none of it, so `n < i` for a `uint8` and an
 * `int32` was the run time's error where `n * i` was an Early Error - one
 * clause answering two ways by which operator was written.
 *
 * Judged in the comparison arm rather than by routing the relational nodes
 * through the arithmetic one, where the rule for the other three lives: a
 * comparison's result is a `boolean` rather than the operand type, and that arm
 * ends by answering the operand type and by adopting a literal into it. Only
 * the mixing judgment belongs to a comparison.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const D = 'let n: uint8 = uint8(1); let i: int32 = int32(1);'
  + ' let f: float64 = float64(1); let g: float32 = float32(1);'
  + ' let d: decimal64 = decimal64("1"); let s: string = "x"; ';

test('two different numeric types do not compare', () => {
  for (const e of ['n < i', 'n <= i', 'n > i', 'n >= i']) {
    expectThrown(dead(`${D}let q = ${e};`), 'different numeric types');
  }
  // Across families as well as widths.
  expectThrown(dead(`${D}let q = f >= g;`), 'different numeric types');
  expectThrown(dead(`${D}let q = n > d;`), 'different numeric types');
  expectThrown(dead(`${D}let q = f < n;`), 'different numeric types');
});

test('the ordering operators only', () => {
  // `===` and `!==` compare without converting, so two numeric types are not a
  // mistake there - that is the DISJOINTNESS question, which refuses only
  // because the answer is always the same, with its own wording.
  expectThrown(dead(`${D}let q = n === i;`), 'disjoint');
  expectThrown(dead(`${D}let q = f !== g;`), 'disjoint');
});

test('what the rule does not reach', () => {
  // One type on both sides.
  expect(ok(dead(`${D}let q = n < n;`))).toBe(true);
  expect(ok(dead(`${D}let q = f < f;`))).toBe(true);
  expect(ok(dead(`${D}let q = s < s;`))).toBe(true);

  // A LITERAL operand adopts the other side's type, at either position.
  expect(ok(dead(`${D}let q = n < 5;`))).toBe(true);
  expect(ok(dead(`${D}let q = 5 < n;`))).toBe(true);
  expect(ok(dead(`${D}let q = 1 < 2;`))).toBe(true);

  // `number` is not a numeric VALUE type, and an unknown operand is not judged.
  expect(ok(dead(`${D}let x: number = 1; let q = n < x;`))).toBe(true);
  expect(ok(dead(`${D}let a: any = 1; let q = n < a;`))).toBe(true);
  expect(ok(dead('let a = 1; let b = 2; let q = a < b;'))).toBe(true);

  // `in` and `instanceof` are relational by grammar and compare no numbers.
  expect(ok(dead(`${D}let o: { a: uint8 } = { a: uint8(1) }; let q = "a" in o;`))).toBe(true);
  expect(ok(dead('class C {} let c: C = new C(); let q = c instanceof C;'))).toBe(true);
});
