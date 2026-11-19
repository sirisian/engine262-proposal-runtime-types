import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * A conversion that cannot succeed, refused before running where its operands are known.
 *
 * `uint8()` converts *undefined*, as `undefined := uint8` does, and that is refused before running;
 * the call was refused only when it ran. A primitive converts to a class only by a conversion the
 * class declares (#sec-user-defined-conversions), so `"s" := V` for a class that declares none
 * cannot succeed, as `"3" := uint8` cannot, and was refused only when it ran.
 */

test('a conversion call with no argument converts undefined', () => {
  for (const source of ['uint8();', 'float32();', 'type U = uint8; U();']) {
    expectStaticTypeError(source);
    expectThrown(source, 'has no explicit conversion to');
  }
  expect(evaluated('String(uint8(7));')).toBe('7');
});

test('a primitive converts to a class only by a conversion the class declares', () => {
  const V = 'class V { x: uint8 = 0; } ';
  for (const operand of ['"s" := V', 'null := V', 'undefined := V', '3 := V', 'true := V', 'V("s")', '[{ x: 1 }, "s"] := [].<V>']) {
    expectStaticTypeError(`${V}const v = ${operand};`);
  }
  expect(evaluated(`${V}String(({ x: 1 } := V).x);`)).toBe('1');
  // A constructor that takes the value converts it, and is left to it.
  const C = 'class V { x: uint8 = 0; constructor(n: uint8) { this.x = n; } } ';
  expect(evaluated(`${C}String((3 := V).x) + " " + String(V(4).x);`)).toBe('3 4');
  expectThrown(`${C}"s" := V;`, 'a string is not a conversion source');
  // A class over a built-in is left to the run time.
  expectThrown('class V extends Error { x: uint8 = 0; } "s" := V;', 'is not assignable to');
});
