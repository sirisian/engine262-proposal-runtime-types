import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-memory-layout (the `min` and `max` members). Design: ranges.md.
 *
 * The least and greatest value a type admits - the question a range check asks
 * and a saturating operation obeys. The engine computed both and exposed
 * neither, so a program was told "300 is not in the range of uint.<8>" about a
 * bound it could not read, and every reader that wanted one kept a table of
 * widths of its own.
 *
 * The specification orders the sources: `bounds` metadata first, then the
 * width. Only the width case is implemented here, the `bounds` meta type
 * belonging to the ranges extension.
 */

test('bounds: an integer type reports what its width admits', () => {
  expect(evaluated('String(uint8.min) + "," + String(uint8.max);')).toBe('0,255');
  expect(evaluated('String(int8.min) + "," + String(int8.max);')).toBe('-128,127');
  expect(evaluated('String(uint32.min) + "," + String(uint32.max);')).toBe('0,4294967295');
  expect(evaluated('String(int32.min) + "," + String(int32.max);')).toBe('-2147483648,2147483647');
  // a one-bit integer is an integer, and reports as one
  expect(evaluated('String(boolean1.min) + "," + String(boolean1.max);')).toBe('0,1');
});

test('bounds: a width past 53 bits answers in BigInt', () => {
  // a Number holds no value of a wider integer exactly, so answering in one
  // would round the very bound a program is asking for
  expect(evaluated('String(typeof uint64.max);')).toBe('bigint');
  expect(evaluated('String(uint64.max);')).toBe('18446744073709551615');
  expect(evaluated('String(int64.min);')).toBe('-9223372036854775808');
  // and a width within 53 bits answers in Number
  expect(evaluated('String(typeof uint32.max);')).toBe('number');
});

test('bounds: a float reports its finite extremes, min being the most negative', () => {
  // NOT the least positive, which is what `Number.MIN_VALUE` means and the
  // reason these members are not spelled that way
  expect(evaluated('String(float32.min);')).toBe('-3.4028234663852886e+38');
  expect(evaluated('String(float32.max);')).toBe('3.4028234663852886e+38');
  expect(evaluated('String(float64.max === Number.MAX_VALUE);')).toBe('true');
  expect(evaluated('String(float64.min === -Number.MAX_VALUE);')).toBe('true');
  // the other reading has a name of its own
  expect(evaluated('String(float32.minPositive);')).toBe('1.401298464324817e-45');
  expect(evaluated('String(float64.minPositive === Number.MIN_VALUE);')).toBe('true');
  expect(evaluated('String(float64.epsilon === Number.EPSILON);')).toBe('true');
});

test('bounds: asking a type that has none is the mistake', () => {
  // as reading `byteLength` from a `string` is
  expectThrown('string.min;');
  expectThrown('string.max;');
  // `minPositive` and `epsilon` are float-only, and absent rather than undefined
  expectThrown('uint8.epsilon;');
  expectThrown('uint8.minPositive;');
});

test('bounds: the members agree with the checks that already used them', () => {
  // the saturating forms clamp at the same value `max` reports
  expect(evaluated('const a: uint8 = 255; String(Number(Math.addSaturating(a, 1)) === uint8.max);')).toBe('true');
  expect(evaluated('const a: uint8 = 0; String(Number(Math.subSaturating(a, 1)) === uint8.min);')).toBe('true');
  // and a value one past `max` is what the range check refuses
  expect(evaluated('function past() { return uint8.max + 1; }'
    + ' try { const a: uint8 = past(); "no"; } catch (e) { String(e.constructor.name); }')).toBe('RangeError');
});
