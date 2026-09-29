import { expect, test } from 'vitest';
import { expectThrown } from '../harness.mts';

/**
 * Spec: #sec-threading-shared-modifier. Between a `shared` type and one that is
 * not, the modifier is transparent because it is not observable in the value, so a
 * `shared uint8` is a `uint8` for every question about what the VALUE can do -
 * whether it mixes with an `int32`, whether it can be called, whether it can be
 * iterated.
 *
 * Each question is asked through more than one wrapper of the same target - a plain
 * type, an alias of it, and `shared` - so that a judgment which sees through one
 * wrapper but stops at another is caught, rather than probing one feature at a
 * time.
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
  // Assignability is still judged against the target: a `shared uint8` is not
  // assignable to `string`.
  expectThrown(dead('let a: shared uint8 = uint8(1); let s: string = a;'), 'not assignable');
});
