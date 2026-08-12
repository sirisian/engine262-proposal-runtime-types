import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

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
  // an enum member computes at its underlying type, which for an enum declared
  // without a `: Type` is `int32` and not `number` - the clause names int32,
  // and this engine defaulted to number until the enumerators began carrying
  // the type at all.
  expect(evaluated('enum E { A = 1, B = 2 } String((E.A + E.B) is int32);')).toBe('true');
  expect(evaluated('enum E { A = 1, B = 2 } String((E.A + E.B) is number);')).toBe('false');
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

// -- Unary operators (#sec-unary-operators-for-typed-values) -------------------
//
// "Unary `+` returns its operand unchanged when the operand is a value of a
// numeric type of this proposal. It continues to throw a *TypeError* for a
// BigInt, and continues to apply ToNumber otherwise."

test('unary + returns a typed operand unchanged', () => {
  expect(evaluated('const a = (7 := uint8); String(Reflect.typeOf(+a) === uint8);')).toBe('true');
  expect(evaluated('const a = (7 := uint8); String(+a);')).toBe('7');
  expect(evaluated('const a = (1.5 := float32); String(Reflect.typeOf(+a) === float32);')).toBe('true');
  // A signed type, and a negative operand, since `+` must not be reading the
  // sign the way `-` does.
  expect(evaluated('const a = ((0 - 5) := int8); `${Reflect.typeOf(+a) === int8}:${+a}`;')).toBe('true:-5');
});

test('unary + returns the other numeric families unchanged', () => {
  // Each of these took a different wrong path before: a rational answered NaN
  // silently, and a decimal and a vector threw with a message about an
  // arithmetic this operator does not perform.
  expect(evaluated('String(+rational(1, 2));')).toBe('1/2');
  // The decimal keeps its COHORT MEMBER, which is the sharpest test that the
  // operand came back untouched: `1.50` is not `1.5`.
  expect(evaluated('let d: decimal128 = 1.50; (+d).toString();')).toBe('1.50');
  expect(evaluated('const v = float32x4(1, 2, 3, 4); `${(+v).x}:${(+v).w}`;')).toBe('1:4');
  expect(evaluated('const m = boolean8(0); String((+m).any());')).toBe('false');
});

test('unary + composes, because the result keeps its type', () => {
  // This was refused as "different numeric types and do not mix", since `+a`
  // handed back a plain Number.
  expect(evaluated('let a: uint8 = 7; String((+a) + a);')).toBe('14');
  expect(evaluated('let a: uint8 = 7; String(Reflect.typeOf((+a) + a) === uint8);')).toBe('true');
});

test('unary + is unchanged for everything else', () => {
  // The BigInt TypeError is the reason the clause calls this a decision: `+x`
  // is the coercion idiom, and BigInt refuses it rather than defeating it.
  expectThrown('+1n;');
  expect(evaluated('String(+5);')).toBe('5');
  expect(evaluated('`${+"3"}:${typeof +"3"}`;')).toBe('3:number');
  expect(evaluated('String(+true);')).toBe('1');
  // A class unary-plus overload still wins, and is dispatched before this rule.
  expect(evaluated('class P { constructor(x) { this.x = x; } operator+() { return this.x; } }'
    + ' let p = new P(42); String(+p);')).toBe('42');
});

test('Number is how a program asks for the untyped Number', () => {
  // `+a` no longer serves as the coercion for a typed value - it returns the
  // value - so this records the replacement idiom beside the change.
  expect(evaluated('let a: uint8 = 7; const n = Number(a); `${n}:${typeof n}`;')).toBe('7:number');
  expect(evaluated('let a: uint8 = 7; let n: number = Number(a); String(n === 7);')).toBe('true');
});

test('the other unary operators were already right', () => {
  // Recorded so the next reader does not have to re-derive which of them the
  // entry was about.
  expect(evaluated('const a = (7 := uint8); `${Reflect.typeOf(-a) === uint8}:${-a}`;')).toBe('true:249');
  expect(evaluated('const a = (7 := uint8); `${Reflect.typeOf(~a) === uint8}:${~a}`;')).toBe('true:248');
  expect(evaluated('const a = (7 := uint8); `${typeof !a}:${typeof a}`;')).toBe('boolean:number');
  expect(evaluated('let a: uint8 = 7; a++; ++a; `${a}:${Reflect.typeOf(a) === uint8}`;')).toBe('9:true');
  expect(evaluated('let b: uint8 = 0; b--; String(b);')).toBe('255');
});
