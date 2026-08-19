import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown, expectThrownKind } from '../../harness.mts';

/**
 * README feature coverage - conversions, casting, and arithmetic.
 * Sections: Conversions, Explicit Casting, Arithmetic and Overflow, Integer
 * Binary Shifts, Integer Division and Remainder.
 *
 * One boundary is documented rather than asserted as runtime behavior:
 *
 *  1. "Two operands of different value types are a TypeError" is a STATIC checker
 *     rule. At run time, mixed-type arithmetic does not throw; it proceeds with
 *     the left operand's type. The static rejection is covered by the checker
 *     tests; here we verify the runtime arithmetic that the checker permits.
 */

// -- Conversions: no implicit widening -----------------------------------------
// A value of one value type never implicitly becomes a value of another. uint8
// does not widen to uint16, float32 does not widen to float64.
test('Conversions: value types do not implicitly widen', () => {
  expect(bool('String(Reflect.isAssignable(uint8, uint16));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(uint16, uint8));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(float32, float64));')).toBe(false);
  expect(bool('String(Reflect.isAssignable(uint32, number));')).toBe(false);
});

// -- Conversions: literals have no type; out-of-range literal is a compile error -
// A numeric literal takes the type of its context; one that does not fit is a
// compile-time error rather than a silent truncation.
test('Conversions: an out-of-range literal in a typed position is rejected', () => {
  expectThrown('let a: uint8 = 300; a;');
  expectThrown('let a: uint8 = -1; a;');
  // an in-range literal takes the contextual type
  expect(bool('let a: uint8 = 200; String(a === (200 := uint8));')).toBe(true);
});

// A checked boundary fails in two ways and they are different errors. When the
// value is already numeric the conversion exists and only this value fails it,
// which is a question of RANGE; when the value is of some other type there is no
// numeric conversion to attempt, which is a question of TYPE. #sec-requiretype
// separates them, and the distinction is worth pinning because both used to
// arrive as a TypeError.
test('Conversions: a checked boundary reports range and type failures differently', () => {
  // numeric source, numeric target, value out of range: a RangeError
  expectThrownKind('function g(){return 300;} let a: uint8 = g();', 'RangeError');
  expectThrownKind('function g(){return 0-1;} let a: uint8 = g();', 'RangeError');
  // a value that would have to be truncated to fit is unrepresentable too
  expectThrownKind('function g(){return 1.5;} let a: uint8 = g();', 'RangeError');
  // a typed value narrowing to a width that cannot hold it
  expectThrownKind('function g(){return (300 := uint16);} let a: uint8 = g();', 'RangeError');
  // a finite value that a float width could only represent as an infinity is
  // unrepresentable, rather than silently becoming that infinity
  expectThrownKind('function g(){return 1e300;} let a: float32 = g();', 'RangeError');
  // the same boundary at a parameter and at a declared return
  expectThrownKind('function f(a: uint8){return a;} function g(){return 300;} f(g());', 'RangeError');
  expectThrownKind('function g(){return 300;} function f(): uint8 { return g(); } f();', 'RangeError');
  // a non-numeric source has no conversion to attempt: still a TypeError
  expectThrownKind('function g(){return {};} let a: uint8 = g();', 'TypeError');
  expectThrownKind('function g(){return "abc";} let a: uint8 = g();', 'TypeError');
  expectThrownKind('function g(){return undefined;} let a: uint8 = g();', 'TypeError');
  // and a value that fits is simply the value
  expect(evaluated('function g(){return 5;} let a: uint8 = g(); String(Number(a));')).toBe('5');
  expect(evaluated('function g(){return 1e300;} let a: float64 = g(); String(Number(a));')).toBe('1e+300');
});

// A CAST is not a boundary: it is an instruction to discard information, so it
// wraps and rounds where the checked boundary above raises. The pair is the
// whole of the distinction.
test('Conversions: a cast wraps where the checked boundary raises', () => {
  expect(evaluated('function g(){return 300;} String(Number(uint8(g())));')).toBe('44');
  expect(evaluated('function g(){return 1.5;} String(Number(uint8(g())));')).toBe('1');
  expect(evaluated('function g(){return 1e300;} String(Number(float32(g())));')).toBe('Infinity');
});

// -- Conversions: untyped bindings are dynamic (any) ---------------------------
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

// -- Explicit Casting: := discards information (truncate / wrap / round) --------
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
  // `number` is the type ToNumber produces, so this cast IS that conversion
  expect(bool('String(("5" := number) === 5);')).toBe(true);
  // to `string`, the sources that have one canonical text convert
  expect(bool('String((5 := string) === "5");')).toBe(true);
  expect(bool('String((5n := string) === "5");')).toBe(true);
  expect(bool('String((true := string) === "true");')).toBe(true);
  expect(bool('String((0 := boolean) === false);')).toBe(true);
  // but the sources that have only a DIAGNOSTIC text do not, which is what stops
  // "undefined" and "[object Object]" reaching a user through an annotation
  expectThrown('(undefined := string);');
  expectThrown('(null := string);');
  expectThrown('({} := string);');
  expectThrown('([1, 2] := string);');
  // a string to a sized numeric type is a parse, not a cast
  expectThrown('("7" := uint8);');
  expectThrown('("300" := uint8);');
  expect(bool('String(uint8.parse("7") === (7 := uint8));')).toBe(true);
  // an object cannot convert to a numeric type
  expectThrown('({} := uint8);');
});

// A cast may also be written as a call on the type, `uint8(v)`, which the spec
// defines as the same operation as `v := uint8`.
test('Explicit Casting: the call form uint8(v) is the same conversion as :=', () => {
  expect(bool('String(uint8(300) === (300 := uint8));')).toBe(true);
  expect(bool('String(uint8(65535) === (255 := uint8));')).toBe(true);
  // the call form performs the ordinary primitive conversions too
  expect(bool('String(string(42) === "42");')).toBe(true);
  // and fails where the conversion cannot be performed
  expectThrown('uint8("hello");');
});

// -- Arithmetic and Overflow ---------------------------------------------------
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

// -- Integer Binary Shifts -----------------------------------------------------
test('Integer Binary Shifts: << and >> stay in the operand type', () => {
  expect(bool('String((1 := uint8) << (3 := uint8) === (8 := uint8));')).toBe(true);
  expect(bool('String((8 := uint8) >> (2 := uint8) === (2 := uint8));')).toBe(true);
  // a shift that overflows the width wraps
  expect(bool('String((1 := uint8) << (8 := uint8) === (0 := uint8));')).toBe(true);
});

// -- Integer Division and Remainder --------------------------------------------
// Integer division truncates toward zero; remainder is the companion.
test('Integer Division and Remainder: integer / truncates, % is the remainder', () => {
  expect(bool('String((10 := uint8) / (3 := uint8) === (3 := uint8));')).toBe(true);
  expect(bool('String((10 := uint8) % (3 := uint8) === (1 := uint8));')).toBe(true);
  expect(bool('String((17 := uint8) / (5 := uint8) === (3 := uint8));')).toBe(true);
});

// A typed annotation is a CHECK, not a coercion. It used to reach for ToNumber
// before checking anything, which made it accept a string, a Boolean, null, and
// any object with a valueOf; at a float width there is no range check to catch
// anything, so a missing field became a NaN that surfaced somewhere else. The
// Parsing clause settles it: a string is deliberately not a conversion source
// for a numeric type, and the parse is always written.
test('Conversions: a numeric annotation accepts only a numeric value', () => {
  for (const t of ['uint8', 'int32', 'float64']) {
    // a well-formed numeric string is refused along with a malformed one
    expectThrownKind(`function g(){return "5";} let a: ${t} = g();`, 'TypeError');
    expectThrownKind(`function g(){return "abc";} let a: ${t} = g();`, 'TypeError');
    // the quiet ones this closes
    expectThrownKind(`function g(){return "";} let a: ${t} = g();`, 'TypeError');
    expectThrownKind(`function g(){return null;} let a: ${t} = g();`, 'TypeError');
    expectThrownKind(`function g(){return true;} let a: ${t} = g();`, 'TypeError');
    expectThrownKind(`function g(){return [7];} let a: ${t} = g();`, 'TypeError');
    expectThrownKind(`function g(){return {valueOf(){return 7;}};} let a: ${t} = g();`, 'TypeError');
    // a numeric value still works, and still range-checks
    expect(evaluated(`function g(){return 5;} let a: ${t} = g(); String(Number(a));`)).toBe('5');
  }
  // THE SILENT NaN this closes: a float annotation could not fail before, so a
  // missing value or an object simply became NaN
  expectThrownKind('function g(){return undefined;} let a: float64 = g();', 'TypeError');
  expectThrownKind('function g(){return {};} let a: float64 = g();', 'TypeError');
});

test('Conversions: the parse is the written form, and it composes', () => {
  // the boundary refuses the string; the parse states what was meant
  expect(evaluated('let a: uint16 = uint16.parse("8080"); String(Number(a));')).toBe('8080');
  // tryParse gives the same reading with the failure handled by narrowing
  expect(evaluated(`
    let p = uint16.tryParse("nope");
    let a: uint16 = p !== null ? p : uint16.parse("3000");
    String(Number(a));
  `)).toBe('3000');
  // and Number(s) is still a written promotion, so this path stays open too
  expect(evaluated('function g(){return "7";} let a: uint8 = Number(g()); String(Number(a));')).toBe('7');
});

// The string arm splits by SOURCE rather than by primitiveness. A Number, a
// BigInt, and a Boolean each have exactly one canonical text and lose nothing.
// undefined, null, an object, and a Symbol have only a diagnostic text.
test('Conversions: a string annotation accepts what has a canonical text', () => {
  expect(evaluated('function g(){return 5;} let s: string = g(); s;')).toBe('5');
  expect(evaluated('function g(){return 5n;} let s: string = g(); s;')).toBe('5');
  expect(evaluated('function g(){return true;} let s: string = g(); s;')).toBe('true');
  expect(evaluated('function g(){return "x";} let s: string = g(); s;')).toBe('x');
  // and refuses the ones whose text is a diagnostic
  expectThrownKind('function g(){return undefined;} let s: string = g();', 'TypeError');
  expectThrownKind('function g(){return null;} let s: string = g();', 'TypeError');
  expectThrownKind('function g(){return {};} let s: string = g();', 'TypeError');
  expectThrownKind('function g(){return [1,2];} let s: string = g();', 'TypeError');
  // String(v) remains the written form for those
  expect(evaluated('function g(){return undefined;} let s: string = String(g()); s;')).toBe('undefined');
});

// The boolean arm REFUSES what it once converted. ToBoolean's totality is what
// disqualifies it at a boundary rather than what recommends it: a conversion
// that cannot fail cannot report, so a missing field became *false* and the
// string `'false'` became *true*, both at the annotation written to catch them.
// #sec-requiretype states that rule for the numeric targets, and `boolean` is
// not an exception to it. A program that means the truthiness says so.
test('Conversions: a boolean annotation takes a Boolean, and the truthiness is written', () => {
  expectThrown('function g(){return {};} let b: boolean = g();');
  expectThrown('function g(){return undefined;} let b: boolean = g();');
  expectThrown('function g(){return "";} let b: boolean = g();');
  expectThrown('function g(){return "false";} let b: boolean = g();');
  expectThrown('function g(){return 1;} let b: boolean = g();');
  // A Boolean crosses, and both spellings of the truthiness are available.
  expect(evaluated('function g(){return true;} let b: boolean = g(); String(b);')).toBe('true');
  expect(evaluated('function g(){return {};} let b: boolean = Boolean(g()); String(b);')).toBe('true');
  expect(evaluated('function g(){return "";} let b: boolean = !!g(); String(b);')).toBe('false');
  // A CAST is an explicit instruction and still converts, as `:= number` does.
  expect(evaluated('function g(){return 1;} let b: boolean = (g() := boolean); String(b);')).toBe('true');
});
