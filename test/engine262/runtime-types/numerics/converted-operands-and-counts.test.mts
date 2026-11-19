import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * Question AQ: an operand that ToNumeric converts, and what a count may be.
 *
 * A String, a Boolean, *null*, *undefined*, a Symbol and an Object reach an operator beside a
 * typed number as the value ToNumeric makes of them (#sec-tonumeric-revised), and every step
 * after is that value's: a Number does not mix with a value of another numeric type, and an
 * exponent or a shift distance is a count, which a Number holding an integer may give.
 *
 * Before running, a String was admitted beside a typed number where a Boolean and a Number were
 * refused, and an exponent of another integer type was refused where a shift distance was
 * admitted. When run, `uint8(3) < "4"` compared 3 with 4, a Boolean count was refused though its
 * Number is an integer, an Object operand was computed as two Numbers, a power past 2**53 lost
 * the low bits its reduction keeps, and a negative exponent truncated.
 */

const F = 'function f(v, n) { return ';

test('a String beside a typed number is refused before running wherever a Number is', () => {
  for (const op of ['*', '-', '%', '&', '<<', '**', '<', '>=']) {
    expectStaticTypeError(`function f(n: uint8, s: string) { return n ${op} s; }`);
    expectStaticTypeError(`function f(n: uint8, s: string) { return s ${op} n; }`);
  }
  expectStaticTypeError('function f(n: uint8) { return n * "3"; }');
  expectStaticTypeError('function f(n: uint8, s: "3") { return n * s; }');
  expectStaticTypeError('function f(n: uint8, k: number) { return n * `${k}`; }');
  expectStaticTypeError('function f(n: uint8, s: string | boolean) { return n * s; }');
  expectStaticTypeError('function f(n: float32, s: string) { return n * s; }');
  expectStaticTypeError('function f(n: decimal64, s: string) { return n * s; }');
  // `+` concatenates, a Number keeps its coercion, and a union with a working path is admitted.
  expect(evaluated('function f(n: uint8, s: string) { return n + s; } f(3, "x");')).toBe('3x');
  expect(evaluated('function f(n: number, s: string) { return n * s; } String(f(3, "2"));')).toBe('6');
  expect(evaluated('function f(n: uint8, s: string | uint8) { return n * s; } String(f(3, 2));')).toBe('6');
});

test('a vector and an enum are judged by the same rule', () => {
  expectStaticTypeError('function f(v: float32x4, s: string) { return v * s; }');
  expectStaticTypeError('function f(v: int32x4, s: string) { return v << s; }');
  expectStaticTypeError('function f(v: float32x4, b: boolean) { return v * b; }');
  expect(evaluated('function f(v: float32x4, s: string) { return v + s; } f(float32x4(1, 2, 3, 4), "x");')).toBe('(1, 2, 3, 4)x');
  expectStaticTypeError('enum E : uint8 { A = 1 } function f(e: E, s: string) { return e * s; }');
  expectStaticTypeError('enum E : uint8 { A = 1 } function f(e: E, b: boolean) { return e * b; }');
});

test('a String in a comparison beside a typed number is refused when run, as its Number is', () => {
  expectThrown(`${F}v < n; } f(uint8(3), "4");`, 'a value of the "string" type and a "uint.<8>"');
  expectThrown(`${F}n > v; } f(uint8(3), "4");`, 'a value of the "string" type and a "uint.<8>"');
  expectThrown(`${F}v <= n; } f(uint8(3), "x");`, 'a value of the "string" type and a "uint.<8>"');
  expectThrown(`${F}v < n; } f(uint8(3), 4);`, 'a value of the "number" type and a "uint.<8>"');
  expect(evaluated(`${F}v < n; } String(f(3, "4"));`)).toBe('true');
});

test('a Symbol beside a typed number throws as ToNumeric does', () => {
  for (const op of ['*', '+', '<<', '<']) {
    expectThrown(`${F}v ${op} n; } f(uint8(3), Symbol());`, 'Cannot convert a symbol value');
  }
});

test('an Object beside a typed number is the value its ToPrimitive gives', () => {
  expectThrown(`${F}v * n; } f(uint8(3), { valueOf() { return 3; } });`, 'a value of the "number" type and a "uint.<8>"');
  expectThrown(`${F}n * v; } f(uint8(3), { valueOf() { return 3; } });`, 'a value of the "number" type and a "uint.<8>"');
  expectThrown(`${F}v + n; } f(uint8(3), { valueOf() { return 2; } });`, 'a value of the "number" type and a "uint.<8>"');
  expectThrown(`${F}v * n; } f(uint8(3), { valueOf() { return 2n; } });`, 'Cannot mix BigInt');
  expect(evaluated(`${F}v << n; } const r = f(uint8(3), { valueOf() { return 2; } }); String(r) + " " + String(Reflect.typeOf(r));`)).toBe('12 uint.<8>');
  expect(evaluated(`${F}v * n; } const r = f(uint8(3), { valueOf() { return uint8(2); } }); String(r) + " " + String(Reflect.typeOf(r));`)).toBe('6 uint.<8>');
  expect(evaluated(`${F}v + n; } f(uint8(3), { valueOf() { return "x"; } });`)).toBe('3x');
  // The conversion runs once.
  expect(evaluated(`let log = ""; ${F}v * n; } try { f(uint8(3), { valueOf() { log += "v"; return 1; } }); } catch { log += "!"; } log;`)).toBe('v!');
  expect(evaluated(`${F}v * n; } String(f(3, { valueOf() { return 2; } }));`)).toBe('6');
});

test('an Object in a comparison beside a typed number is the value its ToPrimitive gives', () => {
  // It was refused as though it were a Number, whatever its valueOf gave.
  expect(evaluated(`${F}v < n; } String(f(uint8(3), { valueOf() { return uint8(4); } }));`)).toBe('true');
  expect(evaluated(`${F}v >= n; } String(f({ valueOf() { return uint8(4); } }, uint8(3)));`)).toBe('true');
  expectThrown(`${F}v < n; } f(uint8(3), { valueOf() { return 4; } });`, 'a value of the "number" type and a "uint.<8>"');
  expectThrown(`${F}v < n; } f(uint8(3), { valueOf() { return uint16(4); } });`, '"uint.<8>" and "uint.<16>"');
  // The left operand converts first, for `>` as for `<`, and once.
  expect(evaluated(`let log = ""; const o = (k) => ({ valueOf() { log += k; return uint8(1); } }); ${F}v > n; } f(o("a"), o("b")); f(o("c"), uint8(0)); log;`)).toBe('abc');
});

test('a union operand is refused where no alternative of it can run', () => {
  // Each alternative fails by a rule of its own, a Boolean as the Number it
  // becomes and a number as a number, and neither rule saw the whole union.
  for (const x of ['boolean | number', 'string | number', 'null | number', '3 | "a"']) {
    expectStaticTypeError(`function f(n: uint8, x: ${x}) { return n * x; }`);
  }
  expectStaticTypeError('function f(n: uint8, x: boolean | number) { return n < x; }');
  // An alternative that can run keeps the union admitted.
  expect(evaluated('function f(n: uint8, x: uint8 | string) { return n * x; } String(f(uint8(2), uint8(3)));')).toBe('6');
  expect(evaluated('function f(n: uint8, x: string | number) { return n + x; } f(uint8(2), "a");')).toBe('2a');
});

test('a count given by a union of integer types is a count', () => {
  // Refused as though each alternative were mixed into the left operand.
  expect(evaluated('function f(n: uint8, x: uint16 | int8) { return n << x; } String(f(uint8(1), int8(3)));')).toBe('8');
  expect(evaluated('function f(n: uint8, x: uint16 | int8) { return n ** x; } String(f(uint8(2), int8(3)));')).toBe('8');
  expect(evaluated('function f(d: decimal64, k: int8 | uint16) { return d ** k; } String(f(decimal64(2), int8(3)));')).toBe('8');
  expectStaticTypeError('function f(n: uint8, x: uint16 | int8) { return n * x; }');
});

test('a count is any value whose Number is an integer when run', () => {
  expect(evaluated(`${F}v << n; } String(f(uint8(3), true)) + " " + String(f(uint8(3), null));`)).toBe('6 3');
  expect(evaluated(`${F}v ** n; } String(f(uint8(3), true)) + " " + String(f(uint8(3), false));`)).toBe('3 1');
  expect(evaluated(`${F}v << n; } String(Reflect.typeOf(f(uint8(3), true)));`)).toBe('uint.<8>');
  expectThrown(`${F}v << n; } f(uint8(3), undefined);`, 'a value of the "undefined" type');
  // Beside a typed number anywhere else a Boolean is refused, as its Number is.
  expectThrown(`${F}v * n; } f(uint8(3), true);`, 'a value of the "boolean" type');
  expectThrown(`${F}n << v; } f(uint8(3), true);`, 'a value of the "boolean" type');
  // Before running, a count is of an integer type or a literal.
  expectStaticTypeError('function f(n: uint8, b: boolean) { return n << b; }');
  expectStaticTypeError('function f(n: uint8, m: number) { return n << m; }');
});

test('an exponent of another integer type is a count, as a shift distance is', () => {
  expect(evaluated('function f(n: uint8, k: int8) { return n ** k; } String(f(3, 2));')).toBe('9');
  expect(evaluated('function f(n: uint8, k: uint32) { return Reflect.typeOf(n ** k); } String(f(3, 2));')).toBe('uint.<8>');
  expect(evaluated('enum E : uint8 { A = 3 } function f(e: E, k: int8) { return e ** k; } String(f(E.A, 2));')).toBe('9');
  expectStaticTypeError('function f(n: uint8, k: float32) { return n ** k; }');
  expectStaticTypeError('function f(n: float32, k: int8) { return n ** k; }');
  expectStaticTypeError('function f(n: uint8, m: number) { return n ** m; }');
  // A literal exponent is taken as written, not as a value of the left type.
  expect(evaluated('function f(n: uint8) { return n ** 300; } String(f(3));')).toBe('113');
  expect(evaluated('function f(n: uint8) { n **= 300; return n; } String(f(3));')).toBe('113');
  expectStaticTypeError('function f(n: uint8) { return n ** 2.5; }');
});

test('an integer power is computed exactly, then reduced', () => {
  expect(evaluated('String(uint32(3) ** 40);')).toBe('689956897');
  expect(evaluated(`${F}v ** n; } String(f(uint8(3), 300));`)).toBe('113');
  expect(evaluated('String(int8(-2) ** 7) + " " + String(int8(-2) ** 8);')).toBe('-128 0');
  expect(evaluated('String(int32(-3) ** 21);')).toBe('-1870418611');
  expect(evaluated(`${F}v ** n; } String(f(uint64(3), 1000000000));`)).toBe('9215150800219179009');
  expect(evaluated('String(uint8(3) ** 0) + " " + String(uint8(0) ** 0);')).toBe('1 1');
});

test('a negative exponent at an integer type throws, as BigInt\'s does', () => {
  for (const call of ['f(uint8(3), -1)', 'f(uint8(0), -1)', 'f(int8(-1), -1)', 'f(uint8(3), int8(-1))', 'f(uint64(2), -1)']) {
    expectThrown(`${F}v ** n; } ${call};`, 'with a negative exponent is not defined for an integer type');
  }
  for (const source of [
    'function f(n: uint8) { return n ** -1; }',
    'function f(n: int8) { return n ** -1; }',
    'const K = -1; function f(n: uint8) { return n ** K; }',
    'function f(n: uint8) { return n ** int8(-1); }',
    'function f(n: uint8) { n **= -1; }',
  ]) {
    expectStaticTypeError(source);
    expectThrown(source, 'a literal negative exponent of "-1" is not a power at');
  }
  expect(evaluated('function f(n: float32) { return n ** -1; } String(f(2));')).toBe('0.5');
});
