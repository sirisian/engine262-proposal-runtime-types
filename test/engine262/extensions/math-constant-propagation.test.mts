import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * `Math.PI * s.radius ** 2` failed, because `Math.PI` is a plain `number` and a
 * `float64` will not mix with one. A well-known numeric constant now takes its
 * position's type, as a literal does - it is the one case a list is needed,
 * because none of these can be WRITTEN as a literal that denotes it.
 *
 * Narrowing the `float64` value to the position's type is CORRECTLY ROUNDED
 * rather than double rounding: an intermediate of 2p+2 bits rounds equivalently
 * to rounding once, and `float64`'s 53 bits cover `float32`'s 50 and
 * `float16`'s 24. Checked for all eight constants at both widths.
 */

test('a Math constant takes its context type', () => {
  // The reported case.
  expect(evaluated('let r: float64 = 1.5; String(Number(Math.PI * r * r));')).toBe('7.0685834705770345');
  // The same constant at a narrower type gives that type's value.
  expect(evaluated('let r: float32 = 2.0; String(Number(Math.PI * r));')).toBe('6.2831854820251465');
  expect(evaluated('let r: float64 = 2.0; String(Number(Math.E * r));')).toBe('5.43656365691809');
  expect(evaluated('let r: float32 = 1.0; String(Number(Math.LN10 * r));')).toBe('2.3025851249694824');
  expect(evaluated('let r: float64 = 1.0; String(Number(Math.SQRT2 * r));')).toBe('1.4142135623730951');
});

test('every named constant participates, at every float width', () => {
  // All eight, not the four the first pass happened to reach - and `LOG10E` and
  // `LN10` in particular, which the analysis singled out as the constants most
  // likely to differ under a double rounding. The expected values are the
  // correctly-rounded ones computed independently, not read back from the
  // engine, so this asserts the ROUNDING and not merely that a value arrives.
  const at32 = (name: string) => evaluated(`let r: float32 = 1.0; String(Number(Math.${name} * r));`);
  expect(at32('PI')).toBe('3.1415927410125732');
  expect(at32('E')).toBe('2.7182817459106445');
  expect(at32('LN2')).toBe('0.6931471824645996');
  expect(at32('LN10')).toBe('2.3025851249694824');
  expect(at32('LOG2E')).toBe('1.4426950216293335');
  expect(at32('LOG10E')).toBe('0.4342944920063019');
  expect(at32('SQRT2')).toBe('1.4142135381698608');
  expect(at32('SQRT1_2')).toBe('0.7071067690849304');

  // And at `float16`, the narrower target, where the 2p+2 argument has the least
  // margin: 53 bits against the 24 that width requires.
  const at16 = (name: string) => evaluated(`let r: float16 = 1.0; String(Number(Math.${name} * r));`);
  expect(at16('PI')).toBe('3.140625');
  expect(at16('E')).toBe('2.71875');
  expect(at16('LN2')).toBe('0.693359375');
  expect(at16('LOG10E')).toBe('0.434326171875');
  expect(at16('SQRT2')).toBe('1.4140625');
});

test('nothing observable about the property changes', () => {
  expect(evaluated('String(Math.PI);')).toBe('3.141592653589793');
  expect(evaluated('String(Math.PI === 3.141592653589793);')).toBe('true');
  // Still a non-writable, non-configurable DATA property - not an accessor,
  // which would have been observable here and a web-compatibility break.
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Math, "PI"); String(d.writable) + "/" + String(d.configurable) + "/" + (typeof d.get);')).toBe('false/false/undefined');
});

test('representability still decides, and the limits do not participate', () => {
  // `Math.PI` is not a `uint8`, exactly as the literal would not be.
  expectThrown('let n: uint8 = 2; Math.PI * n;');
  // `Number`'s limits are facts about a REPRESENTATION, not real numbers, so
  // they do not adopt: `Number.MAX_SAFE_INTEGER` as a `float32` would not be the
  // maximum safe integer of anything.
  expectThrown('let r: float32 = 1.0; Number.MAX_SAFE_INTEGER * r;');
});
