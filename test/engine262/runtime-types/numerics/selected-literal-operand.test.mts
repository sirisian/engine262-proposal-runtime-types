import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A literal that a conditional or a short-circuit operator selects, beside a typed operand.
 *
 * #sec-contextual-types gives an operand of a binary operator "the type of the other operand" as
 * its contextual type, and retains a context "through value-preserving expression selection ...
 * the selected conditional or short-circuit operand, the final comma operand". So the `1` of
 * `z * (scale ?? 1)` is a literal beside `z`, as it is in `const k: uint32 = scale ?? 1`.
 *
 * It was not. A selection of two literals was their union, refused as "numeric alternatives" that
 * do not mix. A selection of a literal and a typed value was accepted by the checker and the
 * literal reached the run time a Number: a TypeError where it computed, `z * (scale ?? 1)`, and a
 * silent *false* where it compared, `z === (c ? 3 : 4)` for a `z` that is 3.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const F = 'function f(z: uint32, c: boolean) { return ';

test('every alternative a literal', () => {
  expect(evaluated(`${F}z * (c ? 16 : 2); } String(f(3, true)) + "," + String(f(3, false));`)).toBe('48,6');
  expect(evaluated(`${F}(c ? 16 : 2) * z; } String(f(3, true));`)).toBe('48');
  expect(evaluated(`${F}z * (c ? 4 * 4 : 2); } String(f(3, true));`)).toBe('48');
  expect(evaluated('function f(z: int32, c: boolean) { return z + (c ? 1 : -1); } String(f(3, false));')).toBe('2');
  expect(evaluated('function f(z: uint32, c: boolean, d: boolean) { return z * (c ? (d ? 1 : 2) : 3); } String(f(3, true, false)) + String(f(3, false, false));')).toBe('69');
  // The result is of the operand's type, as beside a literal.
  expect(evaluated(`${F}Reflect.typeOf(z * (c ? 16 : 2)) === uint32; } String(f(3, true));`)).toBe('true');
  // The last expression of a comma is the operand too.
  expect(evaluated(`${F}z * (0, 16); } String(f(3, true));`)).toBe('48');
});

test('a literal beside a typed value: the default of `??` and `||`', () => {
  expect(evaluated('function f(z: uint32, a: uint32 | null) { return z * (a ?? 16); } String(f(3, null)) + "," + String(f(3, 2));')).toBe('48,6');
  expect(evaluated('function f(z: uint32, a: uint32) { return z * (a || 16); } String(f(3, 0)) + "," + String(f(3, 5));')).toBe('48,15');
  expect(evaluated('function f(z: uint32, opt?: uint32) { return z + (opt ?? 1); } String(f(3)) + String(f(3, 4));')).toBe('47');
  expect(evaluated('interface O { scale?: float32; } function f(z: float32, o: O) { return z * (o.scale ?? 1); } String(f(2, {})) + String(f(2, { scale: 1.5 }));')).toBe('23');
  expect(evaluated('function f(z: uint32, c: boolean, y: uint32) { return z * (c ? 16 : y); } String(f(3, true, 5)) + "," + String(f(3, false, 5));')).toBe('48,15');
  expect(evaluated('function f(z: uint32, c: boolean, d: boolean) { return (c ? 16 : 2) * (d ? 1 : z); } String(f(3, true, false)) + "," + String(f(3, true, true));')).toBe('48,16');
});

test('in a comparison, an equality and a case label', () => {
  expect(evaluated(`${F}z === (c ? 3 : 4); } String(f(3, true)) + String(f(3, false));`)).toBe('truefalse');
  expect(evaluated('function f(z: uint32, a: uint32) { return z === (a || 3); } String(f(3, 0)) + String(f(3, 5));')).toBe('truefalse');
  expect(evaluated(`${F}z < (c ? 16 : 2); } String(f(3, true)) + String(f(3, false));`)).toBe('truefalse');
  expect(evaluated('function f(z: uint32, a: uint32 | null) { return z <= (a ?? 3); } String(f(3, null)) + String(f(3, 2));')).toBe('truefalse');
  expect(evaluated('function f(z: uint32, c: boolean) { switch (z) { case (c ? 3 : 4): return "hit"; default: return "miss"; } } f(3, true) + f(3, false);')).toBe('hitmiss');
});

test('in each numeric family, at the value the literal denotes', () => {
  expect(evaluated('function f(d: decimal128, c: boolean) { return d + (c ? 0.1 : 0.2); } const x: decimal128 = 0.1; String(f(x, true)) + "," + String(f(x, false));')).toBe('0.2,0.3');
  expect(evaluated('function f(d: decimal128, c: boolean) { return d === (c ? 0.1 : 0.2); } const x: decimal128 = 0.1; String(f(x, true)) + String(f(x, false));')).toBe('truefalse');
  expect(evaluated('function f(r: rational64, c: boolean) { return r + (c ? 0.5 : 0.25); } const x: rational64 = 1 / 2; String(f(x, true)) + "," + String(f(x, false));')).toBe('1,3/4');
  expect(evaluated('function f(r: float128, c: boolean) { return r < (c ? 2.5 : 0.5); } const x: float128 = 1.5; String(f(x, true)) + String(f(x, false));')).toBe('truefalse');
  expect(evaluated('function f(z: uint64, c: boolean) { return z + (c ? 9007199254740993 : 0); } String(f(0, true));')).toBe('9007199254740993');
  expect(evaluated('function f(z: uint64, c: boolean) { return z === (c ? 9007199254740993 : 0); } String(f(9007199254740993, true));')).toBe('true');
  expect(evaluated('function f(b: bigint, c: boolean) { return b * (c ? 2 : 3); } String(f(3n, true)) + String(f(3n, false));')).toBe('69');
  expect(evaluated('function f(r: float32, c: boolean) { return r * (c ? Math.PI : 1); } String(f(1, true));')).toBe(String(Math.fround(Math.PI)));
  expect(evaluated('function f(c: boolean) { const v = float32x4(1, 2, 3, 4); return (v * (c ? 2 : 3)).x; } String(f(true));')).toBe('2');
  expect(evaluated('class V { x: float32 = 1; operator*(n: float32): float32 { return this.x * n; } } function f(c: boolean) { return new V() * (c ? 2 : 3); } String(f(false));')).toBe('3');
});

test('a literal the type cannot hold is refused as it is written alone', () => {
  expect(observeScript('function f(z: uint8, c: boolean) { return z * (c ? 300 : 2); }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint8, c: boolean) { return z * (c ? 1.5 : 2); }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint8, c: boolean) { return z < (c ? 300 : 2); }')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('function f(z: uint8) { return z < (0, 300); }')).toMatchObject(early('rt-numeric-range'));
});

test('a typed value among the alternatives is an operand, and is judged as one', () => {
  // A `number` on one arm mixes two numeric types there, as `z * n` does.
  expect(observeScript('function f(z: uint32, c: boolean, n: number) { return z * (c ? 16 : n); }')).toMatchObject(early('rt-numeric-operator'));
  expect(observeScript('function f(z: uint32, c: boolean, n: number) { return z < (c ? 16 : n); }')).toMatchObject(early('rt-numeric-operator'));
  expect(observeScript('function f(z: uint32, c: boolean, y: uint8) { return z * (c ? 16 : y); }')).toMatchObject(early('rt-numeric-operator'));
  // A binding is a value whatever it holds: only the literal that is written takes a type.
  expectThrown('function f(z: uint32, c: boolean) { let k = 16; return z * (c ? k : 2); } f(3, true);', 'do not mix');
});

test('which alternative was selected is read from the evaluation that selected it', () => {
  // The left operand is read before the right is evaluated, and the right operand's evaluation
  // evaluates the same conditional again with the other answer.
  expect(evaluated('function f(z: uint32, n: uint32): uint32 { return (n > 1 ? 2 : z) * (n > 0 ? f(z, n - 1) : 1); } String(f(3, 2));')).toBe('18');
  // With no types anywhere the selection computes as it always has.
  expect(evaluated('function f(z, c) { return z * (c ? 16 : 2); } String(f(3, true)) + typeof f(3, true);')).toBe('48number');
  expect(evaluated('function f(x, c) { return x * (c ? 16 : 2); } String(f(uint32(3), true));')).toBe('48');
  expect(evaluated('function f(s: string, c: boolean) { return s + (c ? 1 : 2); } String(f("a", true));')).toBe('a1');
  expect(evaluated('function f(n: number, c: boolean) { return n * (c ? 2 : 3); } String(f(3, true));')).toBe('6');
});
