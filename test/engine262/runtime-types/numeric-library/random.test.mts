import { test, expect } from 'vitest';
import { evaluated, ok, evaluatedSeeded } from '../harness.mts';

/**
 * Design: random.md; the typed form belongs to #sec-numeric-library, which
 * writes that "`Math.random` takes no numeric argument, and its typed form
 * `Math.random.<T>()` belongs to the random extension".
 *
 * A typed draw carries its value type, an integer type draws across its own
 * full range, and a seeded stream is reproducible across typed and untyped
 * draws alike.
 */

test('random: untyped Math.random works, and the typed no-argument form carries its value type', () => {
  // untyped baseline
  expect(ok('let r = Math.random(); r >= 0 && r < 1;')).toBe(true);
  // random.md: Math.random.<float32>() is a value in [0, 1) at the float value type
  expect(evaluated('let r = Math.random.<float32>(); (r is float32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('Reflect.typeOf(Math.random.<float32>()) === float32 ? "f32" : "num";')).toBe('f32');
  expect(ok('let r = Math.random.<float32>(); r >= 0 && r < 1;')).toBe(true);
  // a draw is exactly representable at its width, so the checked conversion's
  // rounding (wrapToType) leaves it unchanged: float32 draws are fround-stable
  // and float16 draws sit on the 11-bit significand grid (Number() extracts the
  // plain value, since a typed zero is not === a plain zero)
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let n = Number(Math.random.<float32>()); if (n - Math.fround(n) !== 0) good = false; } good;')).toBe(true);
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let n = Number(Math.random.<float16>()); if (n - Math.f16round(n) !== 0) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<float16>(); (r is float16) ? "yes" : "no";')).toBe('yes');
  // an integer value type draws across its full range, inclusive, at that type
  expect(evaluated('let r = Math.random.<uint8>(); (r is uint8) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<uint8>(); if (!(r >= 0 && r <= 255)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<int8>(); (r is int8) ? "yes" : "no";')).toBe('yes');
  // Deferred: the array-fill and range overloads, wider integers, a plain number
  // or bigint type argument, and the seeded PRNG named by Math.PRNG. These fall
  // through to the ordinary untyped call or are absent.
  expect(evaluated('typeof Math.random.<number>();')).toBe('number');
  expect(evaluated('typeof Math.random.<uint64>();')).toBe('number');
  expect(evaluated('typeof Math.PRNG;')).toBe('undefined');
});

// -- random: a seed makes the stream reproducible, and typed draws share it -----

test('random: a fixed seed reproduces the stream, and a typed draw advances that same stream', () => {
  // random.md: the seed pins the pseudorandom stream, so the same seed yields the
  // same sequence of untyped draws, and a different seed yields a different one.
  const drawFour = 'let a = []; for (let i = 0; i < 4; i += 1) { a.push(Math.random()); } a.join(",");';
  const first = evaluatedSeeded('12345', drawFour);
  expect(evaluatedSeeded('12345', drawFour)).toBe(first);
  expect(evaluatedSeeded('67890', drawFour)).not.toBe(first);
  // A typed draw is taken from the one shared stream, so it advances it by
  // exactly one step: after a typed draw consumes the first value, the next
  // untyped draw is the second value of the all-untyped sequence.
  const untypedPair = evaluatedSeeded('999', 'let a = []; a.push(Math.random()); a.push(Math.random()); a.join(",");');
  const secondUntyped = untypedPair.split(',')[1];
  const afterTyped = evaluatedSeeded('999', 'Math.random.<float32>(); String(Math.random());');
  expect(afterTyped).toBe(secondUntyped);
});

// -- random: every integer value type draws across its own full range ----------

test('random: each integer value type draws an in-range value at that type', () => {
  // random.md: an integer type draws across its full range, inclusive. int8 spans
  // the negative side too, and the wider integer widths carry their own type.
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int8>(); if (!(r >= -128 && r <= 127)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<uint16>(); (r is uint16) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<uint16>(); if (!(r >= 0 && r <= 65535)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<int16>(); (r is int16) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int16>(); if (!(r >= -32768 && r <= 32767)) good = false; } good;')).toBe(true);
  expect(evaluated('let r = Math.random.<uint32>(); (r is uint32) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('let r = Math.random.<int32>(); (r is int32) ? "yes" : "no";')).toBe('yes');
  expect(ok('let good = true; for (let i = 0; i < 100; i += 1) { let r = Math.random.<int32>(); if (!(r >= -2147483648 && r <= 2147483647)) good = false; } good;')).toBe(true);
});

// -- memorylayout: the three layout properties a laid-out type exposes ---------
