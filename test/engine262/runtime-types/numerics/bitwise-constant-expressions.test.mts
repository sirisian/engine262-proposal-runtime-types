import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * The bitwise operators and the shifts in a constant expression (#sec-contextual-types).
 *
 * `1 << 4`, `0xF0 | 0x0F` and `~0xFF` are how a flag and a mask are written, and they were not
 * constants: arithmetic over literals took its context's type and these did not. Beside a typed
 * operand `z & (1 << 4)` was a TypeError when the line ran, `z & ~0xFF` was refused as a `number`
 * beside `z`, and `z === 1 << 4` was *false* for a `z` that is 16. At a declaration they were
 * computed as 32-bit Numbers and converted: `const k: uint64 = 1 << 40` was 256, `const k: uint32
 * = 1 << 31` a RangeError, and `const k: uint8 = ~0` not accepted at all.
 *
 * They are constant expressions, and a typed context computes them in its type. A mathematical
 * integer has no bits until it has a type, so these operators are the type's own: `~0` at a
 * `uint8` is 255, `1 << 31` at an `int32` is the sign bit and at a `uint32` is 2147483648. The
 * arithmetic around them stays exact, as it is in any constant.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const Z = 'function f(z: uint32) { return ';

test('beside a typed operand, in arithmetic and in a comparison', () => {
  expect(evaluated(`${Z}String(z & (1 << 4)) + "," + String(z | (1 << 4)) + "," + String(z * (1 << 4)); } f(0x1234);`)).toBe('16,4660,74560');
  expect(evaluated(`${Z}String(z & ~0xFF) + "," + String(z & ~1) + "," + String(z ^ ~0); } f(0x1234);`)).toBe('4608,4660,4294962635');
  expect(evaluated(`${Z}String(z + (0xF0 | 0x0F)) + "," + String(z & (0xF0 ^ 0xFF)); } f(255);`)).toBe('510,15');
  expect(evaluated(`${Z}String(z === 1 << 4) + String(z < 1 << 5) + String(z === (0x10 | 0)) + String(Object.is(z, 1 << 4)); } f(16);`))
    .toBe('truetruetruetrue');
  expect(evaluated('function f(z: uint32) { switch (z) { case 1 << 4: return "hit"; default: return "miss"; } } f(16) + f(4);')).toBe('hitmiss');
  expect(evaluated(`${Z}String(z === ~0); } f(4294967295);`)).toBe('true');
  // Arithmetic around them is exact, as in any constant.
  expect(evaluated(`${Z}String(z * (2 + (1 << 4))) + "," + String(z + (1 << 4) * 2); } f(2);`)).toBe('36,34');
  // A type the result is not an integer of takes the value the Numbers give.
  expect(evaluated('function f(r: float32, n: number) { return String(r * (1 << 4)) + "," + String(n * (1 << 4)) + "," + String(r * ~0); } f(1.5, 1.5);'))
    .toBe('24,24,-1.5');
});

test('a named constant is its initializer computed where it is used', () => {
  expect(evaluated(`const MASK = 1 << 4; ${Z}String(z & MASK) + String(z === MASK) + "," + String(z * MASK); } f(16);`)).toBe('16true,256');
  expect(evaluated(`const A = 1; const B = 2; const FLAGS = A | B; ${Z}z & FLAGS; } String(f(7));`)).toBe('3');
  // One mask, the right one at every width; on its own it is the Number it always was.
  expect(evaluated('const MASK = ~0xFF; function f(a: uint32, b: uint64, c: int32) { return [a & MASK, b | MASK, c & MASK, MASK].map(String).join(); } '
    + 'f(0x1234, 0, 0x1234);')).toBe('4608,18446744073709551360,4608,-256');
  // A `let` is a binding of the `number` type, as with any constant.
  expect(observeScript(`${Z}{ let m = 1 << 4; return z & m; } }`).errorClass).toBeDefined();
});

test('at a declaration the operators are the type\'s', () => {
  expect(evaluated('const a: uint32 = 1 << 31; const b: int32 = 1 << 31; const c: uint64 = 1 << 40; [a, b, c].map(String).join();'))
    .toBe('2147483648,-2147483648,1099511627776');
  expect(evaluated('const a: uint8 = ~0; const b: int8 = ~0; const c: uint32 = ~0; const d: uint16 = 1 << 15 | 1; [a, b, c, d].map(String).join();'))
    .toBe('255,-1,4294967295,32769');
  // Bits a shift moves out are lost, as they are from a value of the type.
  expect(evaluated('const a: uint8 = 0xFF << 4; const b: int8 = 1 << 7; const c: int32 = -2 >>> 1; const d: int32 = -8 >> 1; [a, b, c, d].map(String).join();'))
    .toBe('240,-128,2147483647,-4');
  expect(evaluated('const a: bigint = 1 << 40; const b: bigint = ~0; String(a) + "," + String(b);')).toBe('1099511627776,-1');
  expect(evaluated('enum Flags: uint32 { A = 1 << 0, B = 1 << 1, C = A | B, Top = 1 << 31 } [Flags.B, Flags.C, Flags.Top].map((f) => String(uint32(f))).join();'))
    .toBe('2,3,2147483648');
  expect(evaluated('type Small = uint8 where this < 1 << 4; const s: Small = 3; String(s);')).toBe('3');
});

test('what the type refuses of a value it refuses of a constant', () => {
  // A distance that shifts every bit out, as `z << 8` is refused of a `uint8`.
  expect(observeScript('const k: uint8 = 1 << 8;')).toMatchObject(early('rt-shift-distance'));
  expect(observeScript('const k: uint8 = 1 << -1;')).toMatchObject(early('rt-shift-distance'));
  expect(observeScript('function f(z: uint8) { return z & (1 << 8); }')).toMatchObject(early('rt-shift-distance'));
  // Arithmetic on the result is exact, and a value the type cannot hold is refused.
  expect(observeScript('const k: uint8 = ~0 + 1;')).toMatchObject(early('rt-numeric-range'));
  expect(observeScript('const k: int32 = (1 << 31) - 1;')).toMatchObject(early('rt-numeric-range'));
  expect(evaluated('const k: uint8 = (1 << 4) - 1; const m: int32 = ~(1 << 31); String(k) + "," + String(m);')).toBe('15,2147483647');
  // An operand the type cannot hold has no bits of the type: the Numbers compute it, and the
  // result is taken or refused as a literal would be.
  expect(evaluated('const a: uint8 = 256 >> 1; const b: uint8 = 0x1FF & 0xFF; const c: uint8 = 1.5 | 0; [a, b, c].map(String).join();')).toBe('128,255,1');
  expect(observeScript('function f(z: uint8) { return z & ~0x100; }')).toMatchObject(early('rt-numeric-range'));
  expect(evaluated('function f(z: uint8) { return z === ~0x100; } String(f(255));')).toBe('false');
});

test('with no type in sight they are the Numbers they were', () => {
  expect(evaluated('[1 << 31, ~0, 1 << 40, -1 >>> 0, 0xF0 | 0x0F].map(String).join();')).toBe('-2147483648,-1,256,4294967295,255');
  expect(evaluated('const n: number = 1 << 40; const m = 1 << 31; String(n) + "," + String(m);')).toBe('256,-2147483648');
  // Beside a value typed only when the line runs there is no context: the Number is computed,
  // and takes the type if it is a value of it.
  expect(evaluated('function f(x) { return String(x & (1 << 4)) + String(x === 1 << 4) + String(x * (1 << 4)); } f(uint32(16));')).toBe('16true256');
  expect(evaluated('function f(x) { return x & ~0xFF; } String(f(int32(0x1234)));')).toBe('4608');
  expectThrown('function f(x) { return x & ~0xFF; } f(uint32(0x1234));', '-256 is not in the range');
  // A shift by a value, and of a value, is the operator it was.
  expect(evaluated('function f(z: uint8) { return String(1 << z) + "," + String(z << (1 << 1)) + "," + String(z << 1); } f(4);')).toBe('16,16,8');
});
