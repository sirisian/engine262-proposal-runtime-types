import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * What each operator yields, and of what type, family by family.
 *
 * The specification states dispatch (#sec-operator-dispatch) and which family
 * defines which abstract operation (#table-family-operations), but nothing
 * states the Static Type of an operator APPLICATION. These tests are the
 * measured answers a results table has to record, and they are what will keep
 * such a table honest once written.
 */

// -- integer ------------------------------------------------------------------
test('an integer operator yields the same integer type', () => {
  expect(evaluated('const a: uint8 = 5; const b: uint8 = 3; String((a + b) is uint8);')).toBe('true');
  // arithmetic never promotes: the result wraps at the type's width
  expect(evaluated('const a: uint8 = 1; const b: uint8 = 3; String(a - b);')).toBe('254');
  // and integer division truncates rather than yielding a fraction
  expect(evaluated('const a: uint8 = 7; const b: uint8 = 2; String(a / b);')).toBe('3');
  expect(evaluated('const a: uint8 = 2; const b: uint8 = 3; String(a ** b);')).toBe('8');
  // every operation of the family is defined, the shifts and bitwise included
  expect(evaluated('const a: uint8 = 4; const b: uint8 = 1; String(a << b) + "," + String(a & b);')).toBe('8,0');
  // two different integer types do not combine
  expectThrown('const a: uint8 = 1; const b: uint16 = 3; a + b;');
});

test('a one-bit integer is an integer', () => {
  // `boolean1` is a one-bit unsigned integer, so 1 + 1 wraps to 0. This reads as
  // a defect until the rule is written down, which is a reason to write it down.
  expect(evaluated('const a: boolean1 = 1; const b: boolean1 = 1; String(a + b);')).toBe('0');
});

// -- binary and decimal floating-point ---------------------------------------
test('a floating-point operator yields its own type and has no bitwise operations', () => {
  expect(evaluated('const a: float32 = 7; const b: float32 = 2; String(a / b);')).toBe('3.5');
  expect(evaluated('const a: decimal64 = 1; const b: decimal64 = 2; String(a + b);')).toBe('3');
  // #table-family-operations: a binary floating-point type "does not define
  // bitwiseNOT, the shifts, and the bitwise operations, since each would require
  // converting the operand to an integer type". The decimal family always
  // refused them; the binary one fell through to Number semantics and answered
  // 8 for `(4 := float32) << (1 := float32)`.
  expectThrown('const a: float32 = 4; const b: float32 = 1; a << b;');
  expectThrown('const a: float32 = 4; const b: float32 = 1; a & b;');
  expectThrown('const a: decimal64 = 4; const b: decimal64 = 1; a << b;');
});

// -- comparison ---------------------------------------------------------------
test('a comparison yields a Boolean, not a sized type', () => {
  expect(evaluated('const a: uint8 = 1; const b: uint8 = 3; String(typeof (a < b));')).toBe('boolean');
  expect(evaluated("String('a' < 'b');")).toBe('true');
});

// -- vector -------------------------------------------------------------------
test('a vector operator applies lane-wise and keeps the shape', () => {
  expect(evaluated('String((int32x4(1, 2, 3, 4) + int32x4(1, 1, 1, 1)).x is int32);')).toBe('true');
  // a mask is a vector, so arithmetic on one is arithmetic on its lanes
  expect(evaluated('const m: boolean32x4 = int32x4(1, 1, 9, 9) < int32x4(5, 5, 0, 0);'
    + ' String((m + m).x.any());')).toBe('false');
  // a vector comparison is overloaded on its result type rather than yielding a Boolean
  expectThrown('int32x4(1, 2, 3, 4) < int32x4(4, 3, 2, 1);');
});

// -- bigint, string, enum, nominal, reference ---------------------------------
test('the remaining families behave as their own rules say', () => {
  expect(evaluated('String(1n + 2n);')).toBe('3');
  // a BigInt has the shifts and bitwise operations, where a float does not
  expect(evaluated('String(4n << 1n);')).toBe('8');
  // a BigInt does not mix with a Number, as in ECMAScript today
  expectThrown('1n + 2;');
  expect(evaluated("String('a' + 'b');")).toBe('ab');
  expect(evaluated("String('a' * 'b');")).toBe('NaN');
  // an enum member computes at its underlying type
  expect(evaluated('enum E { A = 1, B = 2 } String((E.A + E.B) is number);')).toBe('true');
  expect(evaluated('enum E { A = 1, B = 2 } String(E.A | E.B);')).toBe('3');
  // a class defines its operators, and without one the ordinary rules apply
  expect(evaluated('class C { operator+(o) { return 7; } } String(new C() + new C());')).toBe('7');
  expect(evaluated('class D {} String(typeof (new D() + new D()));')).toBe('string');
  // a reference reads through to its referent
  expect(evaluated('let x: uint8 = 5; let ref r = x; String(r + 1);')).toBe('6');
  expect(evaluated('let x: uint8 = 5; let ref r = x; String(r === x);')).toBe('true');
});

// -- range-constrained --------------------------------------------------------
test('a range-constrained type is its underlying type for operators', () => {
  expect(evaluated('const a: uint8.<1, 5> = 3; String(a);')).toBe('3');
  expect(evaluated('const a: uint8.<1, 5> = 3; const b: uint8.<1, 5> = 1; String((a + b) is uint8);')).toBe('true');
});
