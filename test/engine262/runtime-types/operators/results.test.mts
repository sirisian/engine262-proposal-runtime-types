import { test, expect } from 'vitest';
import { evaluated, expectThrown, ok, expectStaticTypeError } from '../harness.mts';

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

// ---------------------------------------------------------------------------
// AN OPERATOR OVERLOAD DECLARES ITS OPERAND'S TYPE, AND THE OPERAND IS CHECKED.
//
// `v + 5` for a `class V { operator+(o: V): V }` was "5 is not assignable to
// \"V\"" when the program ran, though the declaration says so and the operand is
// right there. The result type is unchanged; this judges the OPERAND.
//
// Only where the LEFT operand is a class instance declaring an operator for
// this token. A class with no overload is ordinary arithmetic, and a right-hand
// overload - declared on the OTHER operand - is a different resolution that this
// does not attempt.
//
// WHERE the check sits is load-bearing. A first version asked
// `staticType(leftNode)` for itself, above the point the arm computes it, and
// the suite stopped finishing: the arm is computing `staticType(node)` and
// recomputing an operand doubles the work at every nesting level, so deeply
// nested arithmetic went exponential. It reuses the arm's own `leftT` now.
// ---------------------------------------------------------------------------

test('an overloaded operator checks its operand against the declaration', () => {
  const V = 'class V { x: uint8 = 0; operator+(o: V): V { return this; } } const v = new V(); ';
  expectStaticTypeError(`${V} v + 5;`);
  expectStaticTypeError(`${V} v + "s";`);
  // The declared operand type is accepted.
  expect(ok(`${V} const w = v + v;`)).toBe(true);
});

test('what the overload check leaves alone', () => {
  // A class with no overload for the token, and ordinary arithmetic.
  expect(ok('class W { x: uint8 = 0; } const w = new W(); let a: uint8 = 1; let b: uint8 = 2; a + b;')).toBe(true);
  expect(ok('let s: string = "a"; s + "b";')).toBe(true);
  // Deep nesting terminates - the regression the placement guards against.
  expect(ok('let a: uint8 = 1; a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a;')).toBe(true);
});

// ---------------------------------------------------------------------------
// A `+` WITH A STRING OPERAND IS A CONCATENATION, AND ITS TYPE IS `string`.
//
// `#sec-conversions` gives a value of a numeric type a conversion to `string` -
// ToString - because "ToString of a number is total and lossless, while
// ToNumber of a string is partial and lossy, so the direction that cannot fail
// is admitted and the direction that can is written as a parse". So `s + n` is a
// `string` and always was at run time; what was missing is that the CHECKER said
// so. `literalOperand` recognises numeric literals only, so a string operand
// left the expression ~any~ and nothing downstream of it was judged.
//
// This was recorded as an open design question - "what is `string + uint8`?" -
// with three directions for a committee. Two of the three were positions the
// clause above explicitly argues against; the answer had been specified all
// along.
//
// `+` only. For the other operators a string operand would have to convert TO a
// numeric type, which is the parse the same clause refuses to admit implicitly.
// ---------------------------------------------------------------------------

test('a concatenation types as a string, in both operand orders', () => {
  expect(evaluated('let s: string = "a"; let n: uint8 = 1; let r: string = s + n; r;')).toBe('a1');
  expect(evaluated('let s: string = "a"; let n: uint8 = 1; let r: string = n + s; r;')).toBe('1a');
  // ...so a concatenation reaching a NUMERIC binding is refused at the check.
  expectStaticTypeError('let s: string = "a"; let n: uint8 = 1; let r: uint8 = n + s;');
  expectStaticTypeError('let a: uint8 = 0; a = a + "s";');
});

test('what the concatenation type does not disturb', () => {
  expect(evaluated('let s: string = "a"; let r: string = s + "b"; r;')).toBe('ab');
  expect(evaluated('let a: uint8 = 1; let b: uint8 = 2; let c: uint8 = a + b; String(c);')).toBe('3');
  // The out-of-range literal rule still applies to a numeric `+`.
  expectStaticTypeError('let a: uint8 = 0; a = a + 300;');
});

// ---------------------------------------------------------------------------
// A STRICT COMPARISON BETWEEN DISJOINT TYPES CAN NEVER BE TRUE.
//
// The design's position on a test that cannot succeed is stated, not open. The
// disjoint-intersection rule refuses `uint8 & string` because "reduction alone
// would report the mistake at every USE ... rather than at the `&` that made it
// - which is how an erasure checker reports it and is the least useful place to
// say it", and it cites narrowing, "which reports a test that cannot succeed as
// a mistake rather than narrowing to the type with no values".
//
// Three forms were already refused on that principle - `a is string` for a
// `uint8`, a disjoint intersection, and a narrowing that reaches nothing - and
// `===` was the spelling that never got it.
//
// TWO EXCLUSIONS, both found by the corpus:
//   - a LITERAL operand, because `let x: uint32 = 5; x === 5` compares `uint32`
//     with a literal whose Base is `number` - disjoint as TYPES, but the literal
//     adopts, and this arm does not perform that adoption yet;
//   - a `void` operand, which is a genuine tension rather than a limitation: the
//     principle WOULD refuse `a(o: k) === k` for an interface declaring no
//     return, and `callable-interfaces` asserts it must run. Left for whoever
//     reconciles the two.
// ---------------------------------------------------------------------------

test('a strict comparison between disjoint types is refused', () => {
  expectStaticTypeError('let a: uint8 = 1; let b: string = "s"; let c: boolean = a === b;');
  expectStaticTypeError('let a: uint8 = 1; let b: string = "s"; let c: boolean = a !== b;');
});

test('what the disjointness rule leaves alone', () => {
  expect(ok('let a: uint8 | string = 1; let b: string = "s"; let c: boolean = a === b;')).toBe(true);
  expect(ok('let a: uint8 = 1; let b: uint8 = 2; let c: boolean = a === b;')).toBe(true);
  // A LOOSE `==` across numeric types is meaningful - it compares mathematical
  // values - so disjointness of the types says nothing about it.
  expect(ok('let a: uint8 = 1; let b: float32 = 1; let c: boolean = a == b;')).toBe(true);
  // A literal operand adopts the other operand's type.
  expect(ok('let x: uint32 = 5; const b: boolean = x === 5;')).toBe(true);
  // An `any` operand overlaps with everything - AreDisjoint is conservative.
  expect(ok('function g() { return 1; } let b: string = "s"; let c: boolean = g() === b;')).toBe(true);
  // An `if` CONDITION is not typed at all, so this reaches no judgment - the
  // same statement-position gap a bare `a[9];` had, and what 4.6 needs first.
  expect(ok('let a: uint8 = 1; let b: string = "s"; if (a === b) { }')).toBe(true);
});
