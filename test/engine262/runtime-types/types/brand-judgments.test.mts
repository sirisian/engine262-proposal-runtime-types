import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * A BRAND is a ~parameterized~ marker over a base, and the judgments about what
 * a VALUE can do stopped at it exactly as they stopped at `shared`: a branded
 * `uint32` was not callable, not iterable and not a constructor, and the run
 * time said so where a plain `uint32` is refused by the checker.
 *
 * The two markers are NOT the same for mixing, and the run time is what says so:
 * `shared uint8 * uint8` evaluates, so sharing does not change the numeric
 * identity, while `U * p` for a branded `uint32` and a plain one is refused as
 * "different numeric types". A brand is part of the identity; erasing it for
 * mixing would admit the program the brand exists to refuse.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const U = "type U = uint32.<{ brand: 'B' }>; let u: U = U((7 := uint32)); ";

test('what a branded value can DO erases the brand', () => {
  expectThrown(dead(`${U}let q = u();`), 'is not callable');
  expectThrown(dead(`${U}let q = new u();`), 'is not a constructor');
  expectThrown(dead(`${U}for (const x of u) { }`), 'is not iterable');
  expectThrown(dead(`${U}let a = [...u];`), 'is not iterable');
});

test('mixing KEEPS the brand', () => {
  // A different numeric family is refused, brand or no brand.
  expectThrown(dead(`${U}let i: int8 = int8(1); let q = u * i;`), 'do not mix');
  // The same brand on both sides is ordinary.
  expect(ok(dead(`${U}let q = u * u;`))).toBe(true);
  expect(ok(dead(`${U}let q = u < u;`))).toBe(true);
});

test('SHARED is erased for mixing, which a brand is not', () => {
  // The run time evaluates `shared uint8 * uint8`, so the checker must not
  // refuse it.
  expect(ok(dead('let a: shared uint8 = uint8(1); let b: uint8 = uint8(2); let q = a * b;'))).toBe(true);
  expectThrown(dead('let a: shared uint8 = uint8(1); let b: int32 = int32(1); let q = a * b;'),
    'do not mix');
});

test('KNOWN LIMIT: a brand against another brand, or against its own base', () => {
  // `u * v` for two different brands, and `u * p` for a branded and a plain
  // `uint32`, are both refused by the run time and not yet by the checker: the
  // records reach `SameType` and compare equal there, so the mixing rule sees
  // one type. Recorded rather than left to be rediscovered.
  const V = "type V = uint32.<{ brand: 'C' }>; let v: V = V((7 := uint32)); ";
  expect(ok(dead(`${U}${V}let q = u * v;`))).toBe(true);
  expect(ok(dead(`${U}let p: uint32 = uint32(7); let q = u * p;`))).toBe(true);
});
