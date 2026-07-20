import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown } from './harness.mts';

/**
 * README feature coverage — conversions, casting, and arithmetic.
 * Sections: Conversions, Explicit Casting, Arithmetic and Overflow, Integer
 * Binary Shifts, Integer Division and Remainder.
 *
 * Two boundaries are documented rather than asserted as runtime behavior:
 *
 *  1. The `T(v)` CALL form of a cast ("a cast is a call on the type") is not yet
 *     wired up: Type Objects are not callable, so `uint8(v)` throws. The `:=`
 *     operator form, which the spec defines as "the same operation", is
 *     implemented and is what these tests use. Making Type Objects callable is a
 *     change to the interning path tracked separately.
 *
 *  2. "Two operands of different value types are a TypeError" is a STATIC checker
 *     rule. At run time, mixed-type arithmetic does not throw; it proceeds with
 *     the left operand's type. The static rejection is covered by the checker
 *     tests; here we verify the runtime arithmetic that the checker permits.
 */

// ── Conversions: no implicit widening ─────────────────────────────────────────
// A value of one value type never implicitly becomes a value of another. uint8
// does not widen to uint16, float32 does not widen to float64.
test('Conversions: value types do not implicitly widen', () => {
  expect(bool('String(Reflect.isAssignable(uint8, uint16));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(uint16, uint8));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(float32, float64));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(uint32, number));')).toBe(false);
});

// ── Conversions: literals have no type; out-of-range literal is a compile error ─
// A numeric literal takes the type of its context; one that does not fit is a
// compile-time error rather than a silent truncation.
test('Conversions: an out-of-range literal in a typed position is rejected', () => {
  expectThrown('let a: uint8 = 300; a;');
  expectThrown('let a: uint8 = -1; a;');
  // an in-range literal takes the contextual type
  expect(bool('let a: uint8 = 200; String(a === (200 := uint8));')).toBe(true);
});

// ── Conversions: untyped bindings are dynamic (any) ───────────────────────────
// A binding without an annotation has the `any` static type and converts at
// runtime with a check, exactly as today. `Reflect.typeOf` reads the runtime
// value's type (a plain number is `number`), not the binding's static type, so
// the "any" here shows up as an untyped binding freely holding values of any
// type rather than as a typeOf result.
test('Conversions: an unannotated binding is dynamic', () => {
  // it accepts values of unrelated types in turn without a conversion error
  expect(bool('let x = 5; x = "s"; x = true; String(x === true);')).toBe(true);
  // Reflect.typeOf reads the value, so it reports the value's runtime type
  expect(bool('let x = 5; String(Reflect.typeOf(x) === number);')).toBe(true);
  expect(bool('let x = "s"; String(Reflect.typeOf(x) === string);')).toBe(true);
});

// ── Explicit Casting: := discards information (truncate / wrap / round) ────────
// A cast is an instruction to discard information. `v := uint8` wraps to the low
// bits; it does not fail because information is lost.
test('Explicit Casting: := wraps a numeric value to the target width', () => {
  expect(bool('String((65535 := uint8) === (255 := uint8));')).toBe(true);
  expect(bool('String((300 := uint8) === (44 := uint8));')).toBe(true);
  // a variable (non-literal) numeric source wraps too
  expect(bool('let x = 300; String((x := uint8) === (44 := uint8));')).toBe(true);
  // signed target wraps in two's complement
  expect(bool('String((200 := int8) === (-56 := int8));')).toBe(true);
});

test('Explicit Casting: := also performs the ordinary primitive conversions', () => {
  expect(bool('String(("5" := number) === 5);')).toBe(true);
  expect(bool('String((5 := string) === "5");')).toBe(true);
  expect(bool('String((0 := boolean) === false);')).toBe(true);
  // a String in range of the numeric type converts; out of range it is rejected
  // (a String is not a numeric family the wrap rule covers)
  expect(bool('String(("7" := uint8) === (7 := uint8));')).toBe(true);
  expectThrown('("300" := uint8);');
  // an object cannot convert to a numeric type
  expectThrown('({} := uint8);');
});

// ── Arithmetic and Overflow ───────────────────────────────────────────────────
// Arithmetic never promotes: two operands of the same value type produce that
// type. Integer overflow wraps; signed types wrap in two's complement; unary
// minus on an unsigned value wraps.
test('Arithmetic: same-type operands produce that type', () => {
  expect(bool('String(Reflect.typeOf((5 := uint8) + (3 := uint8)) === uint8);')).toBe(true);
  expect(bool('String((5 := uint8) + (3 := uint8) === (8 := uint8));')).toBe(true);
  expect(bool('String((6 := uint8) * (7 := uint8) === (42 := uint8));')).toBe(true);
});

test('Arithmetic: unsigned overflow wraps modulo 2**N', () => {
  expect(bool('String((200 := uint8) + (100 := uint8) === (44 := uint8));')).toBe(true); // 300 mod 256
  expect(bool('String((0 := uint8) - (1 := uint8) === (255 := uint8));')).toBe(true); // underflow
  expect(bool('String((65535 := uint16) + (1 := uint16) === (0 := uint16));')).toBe(true);
});

test('Arithmetic: signed overflow wraps in two\'s complement', () => {
  expect(bool('String((100 := int8) + (100 := int8) === (-56 := int8));')).toBe(true);
  expect(bool('String((127 := int8) + (1 := int8) === (-128 := int8));')).toBe(true);
});

test('Arithmetic: unary minus and bitwise NOT preserve type and wrap', () => {
  // -x on a uint is 2**width - x
  expect(bool('String(-(1 := uint8) === (255 := uint8));')).toBe(true);
  expect(bool('String(~(0 := uint8) === (255 := uint8));')).toBe(true);
  expect(bool('String(-(5 := int8) === (-5 := int8));')).toBe(true);
});

test('Arithmetic: increment and decrement preserve type and wrap', () => {
  expect(bool('let x = (255 := uint8); x++; String(x === (0 := uint8));')).toBe(true);
  expect(bool('let x = (0 := uint8); x--; String(x === (255 := uint8));')).toBe(true);
});

// ── Integer Binary Shifts ─────────────────────────────────────────────────────
test('Integer Binary Shifts: << and >> stay in the operand type', () => {
  expect(bool('String((1 := uint8) << (3 := uint8) === (8 := uint8));')).toBe(true);
  expect(bool('String((8 := uint8) >> (2 := uint8) === (2 := uint8));')).toBe(true);
  // a shift that overflows the width wraps
  expect(bool('String((1 := uint8) << (8 := uint8) === (0 := uint8));')).toBe(true);
});

// ── Integer Division and Remainder ────────────────────────────────────────────
// Integer division truncates toward zero; remainder is the companion.
test('Integer Division and Remainder: integer / truncates, % is the remainder', () => {
  expect(bool('String((10 := uint8) / (3 := uint8) === (3 := uint8));')).toBe(true);
  expect(bool('String((10 := uint8) % (3 := uint8) === (1 := uint8));')).toBe(true);
  expect(bool('String((17 := uint8) / (5 := uint8) === (3 := uint8));')).toBe(true);
});
