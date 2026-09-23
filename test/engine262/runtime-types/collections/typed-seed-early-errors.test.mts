import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-collection-construction.
 *
 * "It is a type error if an established surviving key, value or element cannot
 * undergo the conversion required above." An array-literal seed was already
 * checked (construction.test.mts). A seed that is not a literal was not, though
 * its Static Type establishes every element it holds: `let xs: [].<string>`
 * seeding a `Set.<uint8>` failed only at run time. The test for "cannot undergo
 * the conversion" is the explicit conversion's: a string is not a conversion
 * source for a numeric type (#sec-parsing), while a `number` converts.
 */

test('a typed seed whose elements cannot convert is refused', () => {
  expectStaticTypeError('let xs: [].<string> = ["a"]; new Set.<uint8>(xs);');
  expectStaticTypeError('let xs: [].<string> = ["a"]; let u: Set.<uint8> = new Set(xs);');
  expectStaticTypeError('let ts: [string, string] = ["a", "b"]; new Set.<uint8>(ts);');
  expectStaticTypeError('let es: [].<[string, string]> = [["a", "x"]]; new Map.<string, uint8>(es);');
  expectStaticTypeError('let es: [].<[uint8, uint8]> = [[1, 2]]; new Map.<symbol, uint8>(es);');
});

test('a seed that converts, or that the checker cannot type, is unchanged', () => {
  expect(evaluated('let ns: [].<number> = [1, 2]; const s = new Set.<uint8>(ns); String(s.size);')).toBe('2');
  expect(evaluated('let es: [].<[string, number]> = [["a", 1]]; const m = new Map.<string, uint8>(es); String(m.get("a"));')).toBe('1');
  expect(evaluated('let raw = ["a"]; let r = "no"; try { new Set.<uint8>(raw); } catch (e) { r = "run time"; } r;')).toBe('run time');
  expect(evaluated('let s1: Set.<uint8> = new Set([1]); const s2 = new Set.<uint8>(s1); String(s2.size);')).toBe('1');
});
