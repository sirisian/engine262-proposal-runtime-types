import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A numeric constant beside an operand of an integer type, in every operator.
 *
 * #sec-contextual-types gives an operand of a binary operator "the type of the other operand" as
 * its context, and rational.md says what that does to a constant: "with an `int32` context the same
 * `1 / 3` is integer division and gives `0`; in an untyped context it is `Number` division". So
 * `z * (7 / 2)` beside a `uint32` is `z * 3`, as `const k: uint32 = 7 / 2` is 3.
 *
 * A comparison gave the same operand another value. `z < 7 / 2` evaluated the Number, 3.5, and
 * raised a RangeError when the line ran; `z === 7 / 2`, a `case 7 / 2:` and `Object.is(z, 7 / 2)`
 * answered *false* for a `z` that is 3. The context is the same in each, so the constant is 3 in
 * each.
 *
 * And a constant the type cannot hold is refused where a literal is, before the program runs:
 * `z < 200 + 100` and `z * K` with `const K = 300` beside a `uint8`, `let k: uint8 = 7.5 / 2`.
 * Each was a RangeError when its line ran.
 */

const early = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-numeric-range' } };
const Z = 'function f(z: uint32) { return ';

test('a comparison reads the constant as arithmetic does', () => {
  expect(evaluated(`${Z}z * (7 / 2); } String(f(3));`)).toBe('9');
  expect(evaluated(`${Z}String(z < 7 / 2) + String(z <= 7 / 2) + String(z > 7 / 2) + String(z >= 7 / 2); } f(3);`)).toBe('falsetruefalsetrue');
  expect(evaluated(`${Z}String(z === 7 / 2) + String(z == 7 / 2) + String(z !== 7 / 2) + String(7 / 2 === z) + String(7 / 2 < z); } f(3);`))
    .toBe('truetruefalsetruefalse');
  expect(evaluated('function f(z: uint32) { switch (z) { case 7 / 2: return "hit"; default: return "miss"; } } f(3) + f(4);')).toBe('hitmiss');
  expect(evaluated(`${Z}String(Object.is(z, 7 / 2)) + String(Object.is(7 / 2, z)); } f(3);`)).toBe('truetrue');
  // A named constant is its initializer written there.
  expect(evaluated(`const H = 7 / 2; ${Z}String(z * H) + String(z < H) + String(z === H) + String(H); } f(3);`)).toBe('9falsetrue3.5');
  // Division truncates toward zero, under a sign as within one.
  expect(evaluated('function f(z: int8) { return String(z === -7 / 2) + String(z === -(7 / 2)) + String(z === (-7) / 2) + String(z < -(7 / 2)); } f(-3);'))
    .toBe('truetruetruefalse');
  // An enum operand is read at its underlying type.
  expect(evaluated('enum E: uint8 { A = 3 } function f(e: E) { return e === 7 / 2; } String(f(E.A));')).toBe('true');
  // Each constant a selection may produce.
  expect(evaluated('function f(z: uint8, c: boolean) { return String(z * (c ? 7 / 2 : 1)) + String(z === (c ? 7 / 2 : 1)); } f(3, true) + f(3, false);'))
    .toBe('9true3false');
});

test('under a sign, each constant a selection may produce is read beside the integer', () => {
  // `-(c ? 7 / 2 : 1)` negates `7 / 2` or `1`, each the constant it is written there without the
  // sign. It was the Number -3.5 beside an `int8`, a RangeError when the line ran.
  const F = 'function f(z: int8, c: boolean) { return ';
  expect(evaluated(`${F}z * -(c ? 7 / 2 : 1); } String(f(3, true)) + String(f(3, false));`)).toBe('-9-3');
  expect(evaluated(`${F}z + -(c ? 7 / 2 : 1); } String(f(3, true));`)).toBe('0');
  expect(evaluated(`${F}String(z === -(c ? 7 / 2 : 1)) + String(z < -(c ? 7 / 2 : 1)); } f(-3, true);`)).toBe('truefalse');
  // The range is judged on the negated value: -128 is an `int8`, -300 and -2 are no `uint8`.
  expect(evaluated(`${F}z * -(c ? 128 : 1); } String(f(1, true));`)).toBe('-128');
  expect(observeScript('function f(z: uint8, c: boolean) { return z * -(c ? 300 : 1); }')).toMatchObject(early);
  expect(observeScript('function f(z: uint8, c: boolean) { return z + -(c ? 2 : 1); }')).toMatchObject(early);
  expectThrown('function f(z: uint8, c: boolean) { return z + -(c ? 2 : 1); }', '"-2" is not in the range of "uint.<8>"');
  // A selection that may also produce a typed value is read as it was.
  expect(evaluated('function f(z: int8, c: boolean, n: int8) { return z * -(c ? n : 1); } String(f(3, true, 2));')).toBe('-6');
});

test('beside anything else the constant is the Number it was', () => {
  expect(evaluated('function f(n: number) { return String(n === 7 / 2) + String(n < 7 / 2); } f(3.5) + f(3);')).toBe('truefalsefalsetrue');
  expect(evaluated('function f(r: float32) { return String(r === 7 / 2) + String(r * (7 / 2)); } f(3.5);')).toBe('true12.25');
  expect(evaluated('function f(r: rational64) { return r === 7 / 2; } const h: rational64 = 7 / 2; String(f(h));')).toBe('true');
  // Beside a `bigint` the constant is the integer it denotes, as it is beside any integer type
  // (Question AN, AN1: `bigint-literal-comparison.test.mts`). Beside a BigInt that names no type,
  // it is compared as the language always has.
  expect(evaluated('function f(b: bigint) { return String(b < 7 / 2) + String(b === 6 / 2); } f(3n);')).toBe('falsetrue');
  expect(evaluated('function f(b) { return String(b < 7 / 2) + String(b === 6 / 2); } f(3n);')).toBe('truefalse');
  // With no annotation in sight, the type is seen only when the line runs: there is no context,
  // the constant is the Number, and 3.5 is not an integer.
  expect(evaluated('function f(x) { return String(x === 7 / 2) + String(x * (6 / 2)); } f(uint8(3));')).toBe('false9');
  expectThrown('function f(x) { return x * (7 / 2); } f(uint8(3));', '3.5 is not in the range');
  expectThrown('function f(x) { return x < 7 / 2; } f(uint8(3));', '3.5 is not in the range');
  expect(evaluated('function f(x) { return String(x * (7 / 2)) + String(x < 7 / 2); } f(3);')).toBe('10.5true');
});

test('a constant computed where no type is declared says so when it does not fit', () => {
  // A declared type would have read `7 / 2` as 3; with none in reach it was computed as a Number,
  // and the refusal says why 3.5 was asked to be a `uint8`.
  const why = 'no type is declared where this constant is written, so it was computed as a number';
  expectThrown('function f(x) { return x * (7 / 2); } f(uint8(3));', `3.5 is not in the range of "uint.<8>"; ${why}`);
  expectThrown('function f(x) { return x < 7 / 2; } f(uint8(3));', why);
  expectThrown('function f(x) { return x * (1 << 9); } f(uint8(3));', why);
  // A compound assignment as its binary operator, for both operators it rewrites.
  expectThrown('function f(x) { x += 7 / 2; return x; } f(uint8(3));', `3.5 is not in the range of "uint.<8>"; ${why}`);
  expectThrown('function f(x) { x *= 7 / 2; return x; } f(uint8(3));', why);
  // Where a declared type would have read it the same, the message is the short one.
  for (const source of ['function f(x) { return x * 3.5; } f(uint8(3));', 'function f(x) { return x * (200 + 100); } f(uint8(3));',
    'function f(x) { x += 300; return x; } f(uint8(3));', 'function f(x) { x += 200 + 100; return x; } f(uint8(3));']) {
    expect(() => expectThrown(source, 'so it was computed as a number'), source).toThrow();
    expectThrown(source, 'is not in the range of "uint.<8>"');
  }
});

test('a constant the type cannot hold is refused where the literal is', () => {
  const U = 'function f(z: uint8) { return ';
  // In an ordering comparison, as `z < 300` is.
  expect(observeScript(`${U}z < 200 + 100; }`)).toMatchObject(early);
  expect(observeScript(`const K = 300; ${U}z < K; }`)).toMatchObject(early);
  expect(observeScript(`${U}z < 1 - 2; }`)).toMatchObject(early);
  expect(observeScript(`${U}200 + 100 > z; }`)).toMatchObject(early);
  // In arithmetic, as `z * 300` is.
  expect(observeScript(`const K = 300; ${U}z * K; }`)).toMatchObject(early);
  expect(observeScript(`${U}z * (200 + 100); }`)).toMatchObject(early);
  // A constant that is no integer, as `z * 3.5` is.
  expect(observeScript(`${U}z * (7.5 / 2); }`)).toMatchObject(early);
  expect(observeScript(`${U}z < 7.5 / 2; }`)).toMatchObject(early);
  expect(observeScript(`${U}z * (1 / 0); }`)).toMatchObject(early);
  expect(observeScript(`${U}z * (2 ** -1); }`)).toMatchObject(early);
  expect(observeScript(`const K = 0.5; ${U}z * K; }`)).toMatchObject(early);
  expectThrown(`${U}z < 200 + 100; }`, '"300" is not in the range of "uint.<8>"');
  expectThrown(`${U}z * (7.5 / 2); }`, '"3.75" is not in the range of "uint.<8>"');
  // An equality with a value the type cannot hold is false, as `z === 300` is.
  expect(evaluated(`${U}String(z === 200 + 100) + String(z === 7.5 / 2); } f(44);`)).toBe('falsefalse');
  // A case label is the test that guards its clause, and one the type cannot hold can never
  // succeed, as `case 300:` and `case K:` with `const K = 300` already were. `case 200 + 100:` was
  // a silent miss.
  const impossible = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } };
  const S = 'function f(z: uint8) { switch (z) { case ';
  expect(observeScript(`${S}300: return 1; } return 0; }`)).toMatchObject(impossible);
  expect(observeScript(`${S}200 + 100: return 1; } return 0; }`)).toMatchObject(impossible);
  expect(observeScript(`${S}-1 + 0: return 1; } return 0; }`)).toMatchObject(impossible);
  expectThrown(`${S}200 + 100: return 1; } return 0; }`, 'the "300" test can never succeed');
  // One the type holds is taken, and so is any label over an untyped discriminant.
  expect(evaluated(`${S}7 / 2: return "hit"; default: return "miss"; } } f(3);`)).toBe('hit');
  expect(evaluated('function f(z) { switch (z) { case 200 + 100: return "hit"; default: return "miss"; } } f(300);')).toBe('hit');
});

test('and at a position of the type', () => {
  expect(observeScript('const k: uint8 = 7.5 / 2;')).toMatchObject(early);
  expect(observeScript('const k: uint8 = 2 ** -1;')).toMatchObject(early);
  expect(observeScript('const k: uint8 = 1 / 0;')).toMatchObject(early);
  expect(observeScript('const k: int8 = -(7.5 / 2);')).toMatchObject(early);
  expect(observeScript('function g(k: uint8) { return k; } g(7.5 / 2);')).toMatchObject(early);
  expect(observeScript('function g(): uint8 { return 1e2 / 3; }')).toMatchObject(early);
  expect(observeScript('let z: uint8 = 0; z = 7.5 / 2;')).toMatchObject(early);
  // A value that is an integer of the type is taken, however it is computed.
  expect(evaluated('const a: uint8 = 7.5 * 2; const b: uint8 = 0.5 + 0.5; const c: uint8 = 7 / 2; String(a) + "," + String(b) + "," + String(c);')).toBe('15,1,3');
  // A conversion converts: it truncates, and does not refuse.
  expect(evaluated('String(uint8(7.5 / 2)) + String((7.5 / 2) := uint8);')).toBe('33');
  // A position of another type is not an integer's. At a union the constant
  // takes a member as the literal 3.75 would, and none takes it (Question BS):
  // it was stored as the string "3.75", where the literal was refused.
  expect(evaluated('const f: float32 = 7.5 / 2; String(f);')).toBe('3.75');
  expect(observeScript('const u: uint8 | string = 7.5 / 2;')).toMatchObject(early);
  expect(observeScript('const u: uint8 | string = 3.75;')).toMatchObject(early);
});
