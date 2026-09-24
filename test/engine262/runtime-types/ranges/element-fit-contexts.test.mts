import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-range-literals.
 *
 * "A range literal read at an element type _T_, where a contextual type gives
 * it one, is a type error unless every element it produces is a value of _T_."
 * The judgment was made for a `for`-`of` head and a `Range.<T>` annotation. An
 * array literal's spread, a spread argument into a typed rest parameter, and a
 * collection's seed give a range an element type too, and the range failed
 * there only when the out-of-range element reached a typed store.
 */

test('a range read at an element type through a spread or a seed must fit it', () => {
  expectStaticTypeError('let a: [].<uint8> = [...0..=256];');
  expectStaticTypeError('function f(...xs: [].<uint8>) { return xs.length; } f(...0..=256);');
  expectStaticTypeError('new Set.<uint8>(0..=256);');
  expectStaticTypeError('let s: Set.<uint8> = new Set(0..=256);');
});

test('ranges that fit, and element types without a bound, are unchanged', () => {
  expect(evaluated('let a: [].<uint8> = [...0..=255]; String(a.length);')).toBe('256');
  expect(evaluated('function f(...xs: [].<uint8>) { return xs.length; } String(f(...0..<256));')).toBe('256');
  expect(evaluated('String(new Set.<uint8>(0..<256).size);')).toBe('256');
  expect(evaluated('let a: [].<number> = [...0..=300]; String(a.length);')).toBe('301');
});
