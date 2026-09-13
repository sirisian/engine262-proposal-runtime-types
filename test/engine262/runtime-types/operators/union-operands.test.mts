import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * A UNION reaches the value judgments on one line, and the run time is what
 * draws it: `(uint8 | int32) * int32` EVALUATES where the value is the int32
 * and refuses where it is the uint8. The operation is sound for one member, so
 * refusing the union outright would refuse a working program - and narrowing is
 * the escape the language gives for the unsound half.
 *
 * So a union is refused only when NO member works, which is the same line the
 * callability and iterability rules draw.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a union no member of which mixes is refused', () => {
  // A union of one numeric type canonicalizes to that type, so every member
  // mismatches.
  expectThrown(dead('let u: uint8 | uint8 = uint8(1); let b: int32 = int32(1); let q = u * b;'),
    'do not mix');
  expectThrown(dead('let b: int32 = int32(1); let u: uint8 | uint8 = uint8(1); let q = b * u;'),
    'do not mix');
});

test('a union SOME member of which mixes is left alone', () => {
  expect(ok(dead('let u: uint8 | int32 = uint8(1); let b: int32 = int32(1); let q = u * b;'))).toBe(true);
  expect(ok(dead('let u: uint8 | uint8 = uint8(1); let b: uint8 = uint8(1); let q = u * b;'))).toBe(true);
});

test('new on a union follows the same line', () => {
  expectThrown(dead('let u: uint8 | int32 = uint8(1); let q = new u();'), 'is not a constructor');
  expectThrown(dead('let u: uint8 | string = uint8(1); let q = new u();'), 'is not a constructor');
});

test('the three rules agree with each other', () => {
  const U = 'let u: uint8 | int32 = uint8(1); ';
  // No member is callable, constructible or iterable.
  expectThrown(dead(`${U}let q = u();`), 'is not callable');
  expectThrown(dead(`${U}let q = new u();`), 'is not a constructor');
  expectThrown(dead(`${U}for (const x of u) { }`), 'is not iterable');
  // One member is, so none of them judges it.
  const M = 'let m: uint8 | [].<uint8> = uint8(1); ';
  expect(ok(dead(`${M}for (const x of m) { }`))).toBe(true);
  expect(ok(dead('let f: uint8 | (() => uint8) = uint8(1); let q = f();'))).toBe(true);
});
