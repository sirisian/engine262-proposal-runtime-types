import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * A constant expression that is a conversion's operand is folded exactly and
 * then WRAPS, where the same expression in a declaration is refused.
 *
 * The explicit-conversion clause: "The two are the same operation", and "a
 * literal operand, whether a numeric literal or an expression built only of
 * literals, is converted from its exact value ... and `uint8(300)` is 44, because
 * the conversion then wraps as it always does." The integer fold refused a value
 * that did not fit whatever it was folding for, so `uint8(200 + 100)` was a
 * static error while `(200 + 100) := uint8` wrapped to 44.
 */

const v = (expr: string) => evaluated(`String(${expr});`);

test('a folded constant wraps in either spelling', () => {
  for (const src of ['uint8(200 + 100)', '(200 + 100) := uint8', 'uint8((200 + 100))', '((200 + 100)) := uint8']) {
    expect(v(src)).toBe('44');
  }
  for (const src of ['uint8(-1)', '-1 := uint8']) expect(v(src)).toBe('255');
  for (const src of ['int8(100 + 100)', '(100 + 100) := int8']) expect(v(src)).toBe('-56');
  for (const src of ['uint8(-(200 + 100))', '-(200 + 100) := uint8']) expect(v(src)).toBe('212');
});

test('the fold stays exact past 2**53, in either spelling', () => {
  for (const src of ['uint64(9007199254740992 + 1)', '(9007199254740992 + 1) := uint64']) {
    expect(v(src)).toBe('9007199254740993');
  }
});

test('a declaration still refuses what does not fit', () => {
  expectStaticTypeError('let x: uint8 = 200 + 100;');
  expect(evaluated('let x: uint8 = 300 - 299; String(x);')).toBe('1');
});
