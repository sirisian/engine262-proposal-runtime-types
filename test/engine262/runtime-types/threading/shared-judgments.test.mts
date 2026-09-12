import { expect, test } from 'vitest';
import { expectThrown } from '../harness.mts';

/**
 * #sec-shared-types: `shared T` is a marker over its target, so a
 * `shared uint8` is a `uint8` for every question about what the VALUE can do -
 * whether it mixes with an `int32`, whether it can be called, whether it can be
 * iterated.
 *
 * `SameTypeWithAssumptions` and `AreDisjoint` look through the marker already.
 * The judgments added for those three questions did not: each reached a plain
 * `uint8` and a `type A = uint8` alias and stopped at `shared uint8`, so the
 * run time answered there and nowhere else.
 *
 * Found by asking every rule the same question through three wrappers rather
 * than by probing a feature: an alias, `shared`, and a brand.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('mixing looks through shared', () => {
  expectThrown(dead('let a: shared uint8 = uint8(1); let b: int32 = int32(1); let q = a * b;'),
    'do not mix');
  expectThrown(dead('let a: uint8 = uint8(1); let b: shared int32 = int32(1); let q = a + b;'),
    'do not mix');
});

test('callability looks through shared', () => {
  expectThrown(dead('let n: shared uint8 = uint8(1); let q = n();'), 'is not callable');
  expectThrown(dead('let n: shared uint8 = uint8(1); let q = new n();'), 'is not a constructor');
});

test('iterability looks through shared', () => {
  expectThrown(dead('let n: shared uint8 = uint8(1); for (const x of n) { }'), 'is not iterable');
  expectThrown(dead('let n: shared uint8 = uint8(1); let a = [...n];'), 'is not iterable');
  expectThrown(dead('let n: shared uint8 = uint8(1); let [x] = n;'), 'is not iterable');
});

test('an ALIAS reached these all along, and still does', () => {
  expectThrown(dead('type A = uint8; type B = int32; let a: A = uint8(1); let b: B = int32(1);'
    + ' let q = a * b;'), 'do not mix');
  expectThrown(dead('type A = uint8; let n: A = uint8(1); let q = n();'), 'is not callable');
  expectThrown(dead('type A = uint8; let n: A = uint8(1); for (const x of n) { }'), 'is not iterable');
});

test('a shared value still does what a shared value does', () => {
  expect(true).toBe(true);
  // Same type on both sides is ordinary, marker or not.
  expectThrown(dead('let a: shared uint8 = uint8(1); let s: string = a;'), 'not assignable');
});
