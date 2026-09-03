import { test, expect } from 'vitest';
import { evaluated, ok, bool, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-value-types (Value Types), #sec-decimal-floating-point-types,
 * #sec-rational-types, #sec-complex-types. Design: complex.md, decimal.md,
 * rational.md (the extended numeric types).
 *
 * `float128` and `decimal32/64/128` are core type-universe members whose TYPE
 * NAMES are registered: they resolve, intern, reflect as primitives, and are
 * distinct. Decimal literals and rational values work; `float128`'s value
 * level, the `complex` type, and the imaginary literal remain refusals,
 * pinned below so a partial landing is noticed rather than mistaken for
 * support.
 */

// -- float128 and decimal type names -------------------------------------------
test('numeric types: float128 is a registered type name', () => {
  // #sec-type-names excepts `typeof` from ADMITTING, so a text containing only a
  // probe does not admit and the name is unbound - which is what keeps an
  // existing `typeof string === "undefined"` true. Where the text admits for any
  // other reason the probe reports the Type Object, as the next line shows.
  expect(evaluated('typeof float128;')).toBe('undefined');
  expect(evaluated('type A = float128; typeof float128;')).toBe('object');
  expect(evaluated('Reflect.getReflection(float128).kind;')).toBe('primitive');
  // interns and is distinct from float64
  expect(ok('type A = float128; type B = float128; A === B;')).toBe(true);
  expect(bool('String(float128 === float64);')).toBe(false);
});

test('numeric types: the decimal types are registered type names', () => {
  expect(evaluated('typeof decimal128;')).toBe('undefined');
  expect(evaluated('type D = decimal128; typeof decimal128;')).toBe('object');
  expect(evaluated('typeof decimal64;')).toBe('undefined');
  expect(evaluated('typeof decimal32;')).toBe('undefined');
  // distinct from one another and from float128
  expect(bool('String(decimal128 === decimal64);')).toBe(false);
  expect(bool('String(decimal128 === float128);')).toBe(false);
});

test('numeric types: float128 and decimal are usable in annotation position', () => {
  // An alias: `float128` has no values at all in this engine, so after
  // #sec-defaultvalueof's refusal there is no way to write a binding of it -
  // neither a default nor an initializer exists. Recorded as a known
  // divergence.
  expect(evaluated('type A = float128; typeof float128;')).toBe('object');
  expect(evaluated('let a: decimal128; typeof decimal128;')).toBe('object');
});

test('numeric types: the type names are shadowable', () => {
  expect(evaluated('let float128 = 5; String(float128);')).toBe('5');
});

// -- Documented gaps: the value level ------------------------------------------
test('numeric types: a decimal literal converts, and so does a float128', () => {
  // Target (decimal.md): `let a: decimal128 = 1.5` gives a decimal128 value.
  // The value-level conversion/arithmetic is deferred.
  // A DECIMAL literal converts: it is read from its
  // SOURCE TEXT, so the cohort member is the one written - `1.5` and `1.50` are
  // two values of one numerical value, which a double cannot tell apart.
  expect(evaluated('let a: decimal128 = 1.5; a.toString();')).toBe('1.5');
  expect(evaluated('let a: decimal128 = 1.50; a.toString();')).toBe('1.50');
  expect(evaluated('let a: decimal128 = 1.5; let b: decimal128 = 1.50; String(Object.is(a, b));')).toBe('false');
  // `float128` still has no value level, for the same representational
  // reason decimals once had: it does not fit a double either.
  // float128 takes one too, and holds the double EXACTLY - the conformance
  // file checks that digit for digit against the double's own bit pattern.
  expect(evaluated('let a: float128 = 1.5; a.toString();')).toBe('1.5');
});

test('numeric types: rational and complex are both registered value types', () => {
  expect(evaluated('typeof rational;')).toBe('function');
  expect(evaluated('let r: rational = rational(1, 2); typeof r;')).toBe('object');
  // #sec-complex-numbers: `complex(re, im)` is how the clause writes its own
  // example, `4i` being `complex(0, 4)`.
  expect(evaluated('typeof complex;')).toBe('function');
  expect(evaluated('const z = complex(3, 4); `${z.real}:${z.imaginary}`;')).toBe('3:4');
});

test('numeric types: an imaginary literal is a complex value', () => {
  // #sec-imaginary-literals: `DecimalImaginaryLiteral :: DecimalLiteral
  // ImaginaryLiteralSuffix`, and the suffix "attaches to any DecimalLiteral, so
  // `4i`, `2.5i`, and `1e3i` are all imaginary literals".
  expect(evaluated('const z = 4i; `${z.real}:${z.imaginary}`;')).toBe('0:4');
  expect(evaluated('(2.5i).toString();')).toBe('2.5i');
  expect(evaluated('(1e3i).toString();')).toBe('1000i');
  // "The rule that the source character following a numeric literal must not be
  // an identifier start continues to apply, so `4if` remains a syntax error."
  expectThrown('let a = 4if;');
  // The text reads back as the literal reads: a pure imaginary prints its
  // suffix, and a pair prints both parts.
  expect(evaluated('complex(3, 4).toString();')).toBe('3+4i');
  expect(evaluated('complex(3, -4).toString();')).toBe('3-4i');
});

test('numeric types: a plain integer literal takes the bigint type from its context', () => {
  // The `n` suffix exists because BigInt arrived before there was a type system
  // to take a literal's type FROM. Where a type is written the suffix is
  // redundant, and the literal rule reaches `bigint` as it reaches the
  // sixteen types this proposal adds.
  expect(evaluated('let x: bigint = 65; String(x) + "/" + String(typeof x);')).toBe('65/bigint');
  expect(evaluated('function f(v: bigint) { return typeof v; } String(f(65));')).toBe('bigint');
  expect(evaluated('function g(): bigint { return 7; } String(typeof g());')).toBe('bigint');
  expect(evaluated('let x: bigint = 65; let y: bigint = 1; String(x + y);')).toBe('66');
  // The suffix keeps working, and is now a choice rather than a requirement.
  expect(evaluated('let x: bigint = 65n; String(x);')).toBe('65');
  // A literal with a fraction has no BigInt, and an `any` value with one is a
  // RangeError at the boundary rather than a silent truncation.
  expect(evaluated('let r = "no"; try { eval("function nc() { let x: bigint = 1.5; }"); } catch (e) { r = "rejected"; } r;')).toBe('rejected');
  expect(evaluated('function anyv() { return 1.5; } let r = "no"; try { let x: bigint = anyv(); } catch (e) { r = String(e.constructor.name); } r;')).toBe('RangeError');
  // Untyped code is untouched: a bare literal is still a Number.
  expect(evaluated('String(65 + 1) + "/" + String(typeof 65) + "/" + String(65n + 1n);')).toBe('66/number/66');
  // AND THERE IS NO 2**53 BOUNDARY: the specification converts a literal
  // from "the mathematical value denoted by the literal", which is exact.
  // The lexer turns a NumericLiteral into a double at scan time, so the
  // parse node retains the literal's SOURCE TEXT, which is where the digits
  // beyond 2**53 still exist. What the assertion guards: this boundary must
  // never report digits the source did not write.
  expect(evaluated('let r = "no"; try { eval("function nc() { let x: bigint = 9007199254740993; }"); } catch (e) { r = "refused"; } r;')).toBe('no');
  expect(evaluated('let x: bigint = 9007199254740993; String(x);')).toBe('9007199254740993');
  expect(evaluated('let x: bigint = 9007199254740993n; String(x);')).toBe('9007199254740993');
  expect(evaluated('let x: bigint = 9007199254740991; String(x);')).toBe('9007199254740991');
});

test('numeric types: a typed value is never strictly equal to a plain number of equal magnitude', () => {
  // Strict equality keeps identity semantics, and the values of distinct value
  // types are distinct, so a typed value is never `===` a plain number of the
  // same magnitude, nor a value of another numeric type. The plain magnitude is
  // recovered with Number(), which does compare equal. This underlies why
  // comparisons in these tests extract with Number() before asserting a value.
  // The literal rule reaches equality: a LITERAL operand takes the typed
  // operand's type, so `(5 := uint8) === 5` compares uint8 against uint8. A
  // `const` bound to a compile-time constant adopts the same way, so the
  // identity assertions below use variables - a `let`, an annotated `const`,
  // a function return - which adopt nothing; `const n: number = 5` is the
  // way to pin an ordinary number.
  expect(evaluated('String((5 := uint8) === 5);')).toBe('true');
  expect(evaluated('String((0 := uint8) === 0);')).toBe('true');
  expect(evaluated('String((0.5 := float32) === 0.5);')).toBe('true');
  // The rule itself: a typed value is not strictly equal to a plain Number,
  // nor to a value of another numeric type.
  expect(evaluated('let n = 5; String((5 := uint8) === n);')).toBe('false');
  expect(evaluated('function anyv() { return 5; } String((5 := uint8) === anyv());')).toBe('false');
  expect(evaluated('String((5 := uint8) === (5 := uint16));')).toBe('false');
  expect(evaluated('String((5 := uint8) === (5 := uint8));')).toBe('true');
  expect(evaluated('String(Number((5 := uint8)) === 5);')).toBe('true');
  expect(evaluated('String(Number((0 := uint8)) === 0);')).toBe('true');
});

test('numeric types: an immutable binding with a constant initializer is a literal', () => {
  // The literal rule reaches equality, and an unannotated `const` whose
  // initializer is compile-time evaluable IS a literal for it: the binding
  // cannot be reassigned and its value is known, so it adopts the other
  // operand's type exactly as the written literal does.
  expect(evaluated('const n = 5; String((5 := uint8) === n);')).toBe('true');
  expect(evaluated('const n = 5; String((5 := uint16) === n);')).toBe('true');
  expect(evaluated('const n = 2 + 3; String((5 := uint8) === n);')).toBe('true');
  // it is the literal's VALUE that must match, not merely its presence
  expect(evaluated('const n = 6; String((5 := uint8) === n);')).toBe('false');
  // and everything that can be reassigned, or that states its own type, adopts
  // nothing
  expect(evaluated('let n = 5; String((5 := uint8) === n);')).toBe('false');
  expect(evaluated('var n = 5; String((5 := uint8) === n);')).toBe('false');
  expect(evaluated('const n: number = 5; String((5 := uint8) === n);')).toBe('false');
  expect(evaluated('function f(n) { return (5 := uint8) === n; } String(f(5));')).toBe('false');
});

test('numeric types: loose equality compares mathematical values across the numeric types', () => {
  // Where strict equality asks about identity, loose equality asks a question and
  // answers with a Boolean whatever its operands' types, so it has no result type
  // to fix and nothing to lose by comparing mathematical values. A value of one
  // numeric type is therefore loosely equal to the same number of another type,
  // and to a plain Number or BigInt, while arithmetic across two value types
  // stays an error: the two are deliberately not aligned.
  expect(evaluated('String(uint8(1) == uint16(1));')).toBe('true');
  expect(evaluated('String((5 := uint8) == (5 := uint16));')).toBe('true');
  expect(evaluated('String((5 := uint8) == 5);')).toBe('true');
  expect(evaluated('String(5 == (5 := uint8));')).toBe('true');
  expect(evaluated('String((0.5 := float32) == 0.5);')).toBe('true');
  expect(evaluated('String((5 := uint8) == 5n);')).toBe('true');
  // and it answers false where the mathematical values differ
  expect(evaluated('String((5 := uint8) == 6);')).toBe('false');
  expect(evaluated('String((5 := uint8) == 6n);')).toBe('false');
  expect(evaluated('String((5 := uint8) != 5);')).toBe('false');
  expect(evaluated('String((5 := uint8) != 6);')).toBe('true');
  // a NaN equals nothing, itself included
  expect(evaluated('String((0 / 0 := float32) == 0 / 0);')).toBe('false');
  // a non-numeric operand keeps the ordinary algorithm's own steps
  expect(evaluated('String((1 := uint8) == true);')).toBe('true');
  expect(evaluated('String((5 := uint8) == null);')).toBe('false');
});

test('numeric types: a float16 value is rounded at its own width, not at float32', () => {
  // float16 has an 11-bit significand, so a conversion to it must land on the
  // binary16 grid. Rounding through float32 would keep more precision than the
  // format holds and give a value a binary16 store and load would not.
  expect(evaluated('let x = (0.1 := float16); String(Number(x) - Math.f16round(0.1));')).toBe('0');
  expect(evaluated('let x = (0.1 := float16); String(Number(x) - Math.fround(0.1) === 0);')).toBe('false');
  // arithmetic rounds per operation at the same width
  expect(evaluated('let a = (0.1 := float16); let b = (0.2 := float16); String(Number(a + b) - Math.f16round(Math.f16round(0.1) + Math.f16round(0.2)));')).toBe('0');
  // a value the format holds exactly is unchanged, and an overflow goes to Infinity
  expect(evaluated('let x = (0.5 := float16); String(Number(x));')).toBe('0.5');
  expect(evaluated('let x = (1e39 := float16); String(Number(x));')).toBe('Infinity');
  // the wider floats are unaffected
  expect(evaluated('let x = (0.1 := float32); String(Number(x) - Math.fround(0.1));')).toBe('0');
  expect(evaluated('let x = (0.1 := float64); String(Number(x) - 0.1);')).toBe('0');
});

test('numeric types: a typed float keeps a negative zero', () => {
  // A float type has a signed zero and the specification makes the distinction
  // observable through SameValue, so a conversion must hand the value back as it
  // was given. The payload is the Number; taking its mathematical value instead
  // would normalize the sign away, since the real number negative zero is zero.
  expect(evaluated('let z = -0; String(1 / Number((z := float16)));')).toBe('-Infinity');
  expect(evaluated('let z = -0; String(1 / Number((z := float32)));')).toBe('-Infinity');
  expect(evaluated('let z = -0; String(1 / Number((z := float64)));')).toBe('-Infinity');
  // the same at an annotation boundary, which takes the checked conversion
  expect(evaluated('let z = -0; let x: float32 = z; String(1 / Number(x));')).toBe('-Infinity');
  // a positive zero is unaffected
  expect(evaluated('String(1 / Number((0 := float32)));')).toBe('Infinity');
  // an integer type has no signed zero, so a negative zero reaching one becomes
  // positive zero rather than carrying a sign the type cannot represent
  expect(evaluated('let z = -0; String(1 / Number((z := int32)));')).toBe('Infinity');
});

test('numeric types: a library position that means NUMERIC accepts a numeric value', () => {
  // A builtin written before the numeric types existed
  // asks "is this a Number" where it means "is this numeric", and a value of
  // this proposal's numeric types is not a Number - so it took the wrong branch
  // silently. Three sites answered wrongly and everything else already routed
  // through unwrapToNumber, which is the convention these had missed.

  // The Array constructor's one argument is a LENGTH or an element, and it
  // decided by asking for a Number: `Array(3 := uint32)` built a ONE-element
  // array holding the 3. The design writes a length at an integer type
  // (`[n].<uint8, uint64>`), so a numeric value is exactly what a length is.
  expect(evaluated('String(Array((3 := uint32)).length);')).toBe('3');
  expect(evaluated('String(new Array((3 := uint32)).length);')).toBe('3');
  expect(evaluated('String(Array((3 := uint8)).length);')).toBe('3');
  // The element path still holds for a NON-numeric argument, and the multi
  // argument form is unchanged - both are what the branch is for.
  expect(evaluated('const a = Array("x"); String(a.length) + "/" + a[0];')).toBe('1/x');
  expect(evaluated('String(new Array((1 := uint8), (2 := uint8)).length);')).toBe('2');
  // A typed length out of the uint32 range is still a RangeError, which is the
  // check the unwrap had to preserve: SameValueZero of a plain uint32
  // against a TYPED value is false under identity semantics, so an unwrap
  // that stopped short would have
  // turned every valid typed length into an error.
  expectThrownKind('Array((4.5 := float64));', 'RangeError');
  // The array this produces is an ORDINARY array, not a typed one: the
  // `length` typing applies at the [[Get]] of a TYPED array, and a plain array
  // built from a typed length is still plain. Pinned in both directions so
  // neither is "fixed" into the other.
  expect(evaluated('String(Array((3 := uint32)).length is uint64);')).toBe('false');
  expect(evaluated('let t: [].<uint8> = [1, 2, 3]; String(t.length is uint64);')).toBe('true');

  // JSON.stringify's indentation is the same shape: a numeric position that
  // silently ignored a typed value, so the output came back unindented.
  expect(evaluated('JSON.stringify({ a: 1 }, null, (3 := uint32));')).toBe(JSON.stringify({ a: 1 }, null, 3));
  expect(evaluated('JSON.stringify({ a: 1 }, null, (3 := uint8));')).toBe(JSON.stringify({ a: 1 }, null, 3));
  // The serialization half was already right and is pinned so it stays that way.
  expect(evaluated('JSON.stringify({ a: (3 := uint32), b: [(1.5 := float32)] });')).toBe('{"a":3,"b":[1.5]}');
});

test('numeric types: ToBigInt refuses a numeric value rather than crashing', () => {
  // A typed value took NO branch of ToBigInt and fell through to the
  // non-exhaustive throw, which is a host crash rather than a language error:
  // `BigInt(3 := uint32)` killed the host. The rule it takes now is the one
  // already written for a Number on the line above it.
  expectThrownKind('BigInt((3 := uint32));', 'TypeError');
  expectThrownKind('BigInt((1.5 := float64));', 'TypeError');
  expectThrownKind('BigInt.asIntN(64, (3 := uint32));', 'TypeError');
  // The asymmetry is deliberate and is between two different operations. The
  // BigInt CONSTRUCTOR is ECMAScript's own, has its own Number step, and takes
  // no typed value - a plain 3 converts where a typed 3 does not.
  expect(evaluated('String(BigInt(3));')).toBe('3');
  // The `bigint` CONVERSION is this proposal's, and #sec-requiretype converts
  // between two numeric types: an integer type's values are mathematical
  // integers, so each is a BigInt exactly.
  expect(evaluated('String(bigint((3 := uint32)));')).toBe('3');
  // A float is refused for the reason the line above it gives - it has a
  // fraction to lose, and a BigInt has nowhere to put one.
  expectThrownKind('bigint((1.5 := float64));', 'TypeError');
});

test('numeric types: a literal at `bigint` is read from its source text', () => {
  // #sec-literalvalueintype converts from "the mathematical value denoted by
  // the literal", which is EXACT. The lexer turns a NumericLiteral into a
  // double at scan time - digits beyond 2**53 are gone by then - so the
  // parse node retains the literal's SOURCE TEXT, which is where that value
  // still exists.
  expect(evaluated('let x: bigint = 9007199254740993; String(x);')).toBe('9007199254740993');
  expect(evaluated('let x: bigint = 123456789012345678901234567890; String(x);')).toBe('123456789012345678901234567890');
  // Every spelling of an integer literal, since the text is read as written.
  expect(evaluated('let x: bigint = 0x1FFFFFFFFFFFFF1; String(x);')).toBe('144115188075855857');
  expect(evaluated('let x: bigint = 1_000_000_000_000_000_003; String(x);')).toBe('1000000000000000003');
  expect(evaluated('let x: bigint = 0b1011; String(x);')).toBe('11');
  expect(evaluated('let x: bigint = 0o17; String(x);')).toBe('15');
  // At the other contextual positions, not only a binding.
  expect(evaluated('function f(b: bigint) { return b; } String(f(9007199254740993));')).toBe('9007199254740993');
  expect(evaluated('function g(): bigint { return 9007199254740993; } String(g());')).toBe('9007199254740993');
  expect(evaluated('let x: bigint | string = 9007199254740993; String(x);')).toBe('9007199254740993');
  // A BigInt literal is untouched, and so is the small case.
  expect(evaluated('let x: bigint = 2n; String(x);')).toBe('2');
  expect(evaluated('let x: bigint = 5; String(x);')).toBe('5');

  // WHAT MUST NOT CHANGE. A literal outside a `bigint` context is the double
  // it always was - this reads the source text only where the target is known
  // to want the exact value.
  expect(evaluated('let n = 9007199254740993; String(n);')).toBe('9007199254740992');
  expect(evaluated('String(9007199254740993);')).toBe('9007199254740992');
  // A non-integer literal denotes no BigInt and is still refused.
  expectThrown('let x: bigint = 1.5;');
  expectThrown('let x: bigint = 1e400;');
  // A Number that is NOT a literal keeps the 2**53 bound, and there the bound
  // is the truth rather than a limitation: the information is gone by the time
  // the value exists, so admitting it would report digits the source never
  // wrote.
  expectThrownKind('function anyv() { return 9007199254740993; } let x: bigint = anyv();', 'RangeError');
});

test('numeric types: the `number` target admits numeric values only', () => {
  // #table-implicit-conversions, the `any`-in-a-typed-position row: "if it is a
  // NUMERIC VALUE the target represents exactly, converted; a value the target
  // cannot represent raises a *RangeError*, and one of the WRONG TYPE a
  // *TypeError*." The engine called ToNumber unconditionally, so every value of
  // the wrong type reached a `number` position as whatever ToNumber made of it.
  // Those are the classic silent failures, and they are exactly what the
  // `string` target has been gated against since the conversion rule was
  // written - the same reasoning, at the target that had no gate.
  expectThrownKind('function a() { return "s"; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return "5"; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return true; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return null; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return undefined; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return {}; } let x: number = a();', 'TypeError');
  expectThrownKind('function a() { return []; } let x: number = a();', 'TypeError');

  // A NUMERIC value passes, which is the clause's own condition: a typed value
  // IS numeric and `number` represents it exactly.
  expect(evaluated('function a() { return 5; } let x: number = a(); String(x);')).toBe('5');
  expect(evaluated('function a(): any { return (5 := uint8); } let x: number = a(); String(x);')).toBe('5');

  // A CAST is not a boundary and is untouched: it is the explicit conversion a
  // program writes when it wants ToNumber's answer, and it still wraps and
  // truncates where the annotated binding throws.
  expect(evaluated('String("5" := number);')).toBe('5');
  expect(evaluated('String(("s" := number) !== ("s" := number));')).toBe('true');
  expect(evaluated('String(true := number);')).toBe('1');
  // And every other boundary takes the same rule, since they share the
  // operation: an array element and an object member refuse what a binding
  // refuses.
  expectThrownKind('function a() { return ["s"]; } let arr: [].<number> = a();', 'TypeError');
  expectThrownKind('function a() { return { x: "s" }; } let o: { x: number } = a();', 'TypeError');
});

test('memory layout: a value type class lays out by natural alignment', () => {
  // #sec-natural-alignment: "Each field is placed at the next offset that is a
  // multiple of its own alignment, a class's alignment is the largest alignment
  // among its fields, and its byteLength is rounded up to that alignment so
  // that every element of an array of the class is aligned too." The design's
  // own worked examples are the test vector.
  const V = 'class Vertex { x: float32; y: float32; z: float32; } ';
  expect(evaluated(`${V} String((type Vertex).byteLength) + "/" + String((type Vertex).alignment);`)).toBe('12/4');
  expect(evaluated(`${V} String((type Vertex).bitLength);`)).toBe('96');
  // Padded from 3 to 4 so `b` stays aligned in an array of A.
  expect(evaluated('class A { a: uint8; b: uint16; } String((type A).byteLength) + "/" + String((type A).alignment);')).toBe('4/2');
  // DECLARATION ORDER, never reordered: the clause is explicit that field order
  // is a performance decision the program makes, because views, serialization,
  // and interop depend on it. These two hold the same fields.
  expect(evaluated('class P { a: uint8; b: float64; c: uint8; } String((type P).byteLength);')).toBe('24');
  expect(evaluated('class T { b: float64; a: uint8; c: uint8; } String((type T).byteLength);')).toBe('16');
  // Inheritance APPENDS: a base's fields keep their offsets and a subclass's
  // follow, so a subclass lays out as the flattening of both.
  expect(evaluated('class B { a: uint8; } class S extends B { b: uint8; } class F { a: uint8; b: uint8; } String((type S).byteLength === (type F).byteLength);')).toBe('true');
  // A field that is itself a laid-out type - a class, a fixed array - carries
  // its own alignment up into the enclosing class.
  expect(evaluated('class V2 { x: float32; y: float32; } class N { v: V2; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('8/4');
  expect(evaluated('class Ar { a: [4].<uint8>; b: uint32; } String((type Ar).byteLength) + "/" + String((type Ar).alignment);')).toBe('8/4');
  // An enum's layout is its underlying type's, read off the Type Record's
  // underlying type, so this row costs one line.
  expect(evaluated('enum E: uint8 { A, B } String((type E).byteLength) + "/" + String((type E).bitLength);')).toBe('1/8');
  expect(evaluated('enum W: uint32 { A } String((type W).byteLength);')).toBe('4');

  // THE ROWS WITH NO LAYOUT, proved by rejection, since reading a size off one
  // must be a TypeError rather than "a number that hides the mistake".
  expectThrownKind('class U { a: uint8; b; } (type U).byteLength;', 'TypeError');
  expectThrownKind('class S2 { s: string; } (type S2).byteLength;', 'TypeError');
  expectThrownKind('dynamic class D { d: uint8; } (type D).byteLength;', 'TypeError');
});

test('memory layout: a field reports its offset through the ClassField reflection', () => {
  // #sec-layout-properties: "A field's offset is read through the reflection of
  // its declaration rather than from the type, because it belongs to the field:
  // Reflect.getReflection.<Reflect.ClassFieldLayout, T>(name) reports an offset and a
  // byteLength ... This is the offsetof a serializer, a placement
  // construction, or a vertex attribute descriptor needs."
  const V = 'class Vertex { x: float32; y: float32; z: float32; } ';
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassFieldLayout, Vertex>("y").offset);`)).toBe('4');
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassFieldLayout, Vertex>("y").byteLength);`)).toBe('4');
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassFieldLayout, Vertex>("z").offset);`)).toBe('8');
  // The offset is the LAID-OUT one, so the padding the alignment rule inserts
  // is visible here: `b` is at 2 and not at 1.
  expect(evaluated('class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('2');
  // Inheritance appends, so a base's field keeps its offset when read through
  // the subclass and the subclass's field follows it.
  const S = 'class B { a: uint8; } class S extends B { b: uint8; } ';
  expect(evaluated(`${S} String(Reflect.getReflection.<Reflect.ClassFieldLayout, S>("a").offset) + "/" + String(Reflect.getReflection.<Reflect.ClassFieldLayout, S>("b").offset);`)).toBe('0/1');

  // A context is used in TYPE position, so it has to BE a type for the call to
  // resolve; `Reflect.ClassField` is a Type Object for the same reason
  // `never` is one.
  expect(evaluated('String(typeof Reflect.ClassField);')).toBe('object');

  // A class with no layout now READS, and reports no placement. The reflection
  // draws on two sources: the DECLARATION record says what the field was
  // declared as and reaches a field on any class, while the LAYOUT says where
  // it sits and only a laid-out class has that to say. Before they were merged
  // this threw, so a declared field on a class carrying an untyped one was
  // unreflectable although the record held it.
  // `kind` names the CONTEXT that produced the reflection.
  expect(evaluated('class U { a: uint8; b; } Reflect.getReflection.<Reflect.ClassField, U>("a").kind;')).toBe('ClassField');
  expect(evaluated('class U { a: uint8; b; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, U>("a").offset);')).toBe('undefined');
  expectThrownKind('class V2 { x: float32; } Reflect.getReflection.<Reflect.ClassField, V2>("nope");', 'TypeError');
  // The one-argument form is untouched.
  expect(evaluated('class V3 { x: float32; } Object.keys(Reflect.getReflection(type V3)).join(",");')).toBe('kind,type');
});

test('memory layout: a fixed array and a value type class hold zero-filled defaults', () => {
  // #sec-defaultvalueof: a FIXED extent defaults to "a new array of the type _t_
  // whose _t_.[[Extent]] elements are each _d_", and a value type class to "the
  // instance of _t_ each of whose fields holds the default of the field's type".
  // The clause is explicit that zero-filling is part of the semantics rather
  // than an optimization, and gives security as the reason: an allocation
  // exposing a previous one's bytes leaks whatever was there.
  expect(evaluated('let p: [3].<uint8>; String(p.length) + "/" + String(Number(p[0]));')).toBe('3/0');
  expect(evaluated('class A { a: uint8; b: uint16; } let c: A; String(Number(c.a)) + "/" + String(Number(c.b));')).toBe('0/0');
  expect(evaluated('class A { a: uint8; } let d: [3].<A>; String(d.length) + "/" + String(Number(d[0].a));')).toBe('3/0');
  // A DYNAMIC extent defaults to a new EMPTY array, not to *undefined*.
  expect(evaluated('let dyn: [].<uint8>; String(dyn.length);')).toBe('0');

  // Each element is its OWN instance. A shared one would make `d[0].a = 5`
  // visible at `d[1]`, which is the defect this is written to catch.
  expect(evaluated('class A { a: uint8; } let d: [3].<A>; d[0].a = 5; String(Number(d[0].a)) + "/" + String(Number(d[1].a));')).toBe('5/0');

  // The instance comes into existence WITHOUT its constructor running, which
  // #sec-typed-classes endorses: "a value type class is a shape with a zero,
  // not an object with an invariant its constructor establishes". It still
  // carries its field types, so a store into a defaulted instance is checked
  // exactly as one into a constructed instance is, and it is sealed.
  expect(evaluated('class A { a: uint8; } let d: [3].<A>; function anyv() { return 300; } try { d[0].a = anyv(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('class A { a: uint8; } let d: [2].<A>; String(Object.isExtensible(d[0]));')).toBe('false');

  // Field-wise regardless of LAYOUT: a class holding a `string` has no layout
  // and still has a default.
  expect(evaluated('class W { s: string; } let w: W; JSON.stringify(w.s);')).toBe('""');

  // #sec-layout-properties, the dynamic-array row: "An instance has a
  // byteLength, its length times its element's" - a property of the INSTANCE,
  // where the length is known, rather than of the type, which has no extent.
  expect(evaluated('class A { a: uint8; b: uint16; } let d: [3].<A>; String(d.byteLength);')).toBe('12');
  expect(evaluated('let p: [10].<uint8>; String(p.byteLength);')).toBe('10');
  // An untyped array is untouched.
  expect(evaluated('const plain = [1, 2]; String(plain.byteLength);')).toBe('undefined');
});

// -- The representation of a wide integer type (#sec-integer-types) -----------
//
// "`int.<N>` is a value type whose values are the integers from -2**(N-1)
// through 2**(N-1) - 1 inclusive ... Each has exactly 2**N values", for _N_ up
// to 2**16. A double holds those exactly only to 53 bits, so a value of a wider
// type has to be carried as a BigInt.
//
// The carrier is widened without constructing anything wide, so these pin what
// must not change, and what is still wrong so the gap is recorded rather than
// assumed.

test('a narrow integer type is unchanged', () => {
  expect(evaluated('let a: uint8 = 200; `${a}:${typeof a}`;')).toBe('200:number');
  expect(evaluated('String((255 := uint8) + (1 := uint8));')).toBe('0');
  expect(evaluated('`${Math.clz((1 := uint8))}:${Math.clz((1 := uint32))}`;')).toBe('7:31');
  expect(evaluated('String(uint32.parse("4294967295"));')).toBe('4294967295');
});

test('a wide integer type still works for values inside the exact range', () => {
  // Everything below 2**53 is exact in a double, so these are the cases that
  // must keep working through the representation change.
  expect(evaluated('String((1000000 := uint64) / (3 := uint64));')).toBe('333333');
  expect(evaluated('String(Math.mod((1000000 := uint64), (3 := uint64)));')).toBe('1');
  expect(evaluated('String((12 := uint64) & (10 := uint64));')).toBe('8');
  expect(evaluated('String(Math.addSaturating((1 := uint64), (1 := uint64)));')).toBe('2');
  expect(evaluated('`${(2 := uint64) < (3 := uint64)}:${(2 := uint64) === (2 := uint64)}`;')).toBe('true:true');
  expect(evaluated('let a: [].<uint64> = [1]; a[0] = (3 := uint64); String(a[0]);')).toBe('3');
  expect(evaluated('let x: uint64 = 5; String(Atomics.compareExchange(ref x, 5, 9)) + ":" + String(x);')).toBe('5:9');
  expect(evaluated('String(uint8((300 := uint64)));')).toBe('44');
  expect(evaluated('`${uint64.byteLength}:${uint128.byteLength}`;')).toBe('8:16');
});

test('a wide type reaches its own values', () => {
  // Each of these was wrong, and each is what the exactness work closes.
  // Adjacent values are distinct - the entry's headline symptom.
  expect(evaluated('String(int64.parse("1152921504606846976") === int64.parse("1152921504606846977"));')).toBe('false');
  expect(evaluated('String(int64.parse("1152921504606846976"));')).toBe('1152921504606846976');
  // A type can parse its own maximum and minimum, which the rounded range
  // check refused as one past the end.
  expect(evaluated('String(int64.parse("9223372036854775807"));')).toBe('9223372036854775807');
  expect(evaluated('String(int64.parse("-9223372036854775808"));')).toBe('-9223372036854775808');
  expect(evaluated('String(uint64.parse("18446744073709551615"));')).toBe('18446744073709551615');
  expect(evaluated('String(uint128.parse("340282366920938463463374607431768211455"));'))
    .toBe('340282366920938463463374607431768211455');
  // In another base, and one past the end is still refused.
  expect(evaluated('String(uint64.parse("0xFFFFFFFFFFFFFFFF", 16));')).toBe('18446744073709551615');
  expect(() => evaluated('uint64.parse("18446744073709551616");')).toThrow();
  // Identity follows the value, so a wide value serves as a Map key by value.
  expect(evaluated('const a = int64.parse("1152921504606846976");'
    + ' const b = int64.parse("1152921504606846977");'
    + ' const m = new Map(); m.set(a, "A"); `${Object.is(a, b)}:${m.get(b)}`;')).toBe('false:undefined');
});

test('clz counts over the exact bit pattern', () => {
  // Reading the payload as a Number rounded it, and the rounded value's bit
  // length came out as the width - which is the answer clz gives for zero.
  expect(evaluated('`${Math.clz((1 := uint8))}:${Math.clz((1 := uint.<40>))}`;')).toBe('7:39');
  expect(evaluated('`${Math.clz((1 := uint64))}:${Math.clz((1 := uint128))}`;')).toBe('63:127');
});

test('a wide operation is exact', () => {
  // The arithmetic computes in the exact integers for a type a double cannot
  // hold, and the wrap is the reduction modulo 2**N at the type's own width.
  expect(evaluated('const a = int64.parse("4611686018427387904"); String(a + a);')).toBe('-9223372036854775808');
  expect(evaluated('String((0 := uint64) - (1 := uint64));')).toBe('18446744073709551615');
  expect(evaluated('String((1 := uint64) << (60 := uint64));')).toBe('1152921504606846976');
  // The shift is performed at the TYPE'S width with the distance taken modulo
  // that width, so a wide shift no longer inherits JavaScript's 32-bit rule.
  expect(evaluated('String((1 := uint64) << (40 := uint64));')).toBe('1099511627776');
});

test('a shift is performed at the type\'s width, whatever the carrier', () => {
  // #sec-integer-operations gives each type the operations of its family at its
  // own width. JavaScript's shifts truncate their operand to 32 bits, so a
  // width above 32 and at or below 53 - Number-backed, because a double holds
  // it exactly - answered a 32-bit shift. The exact path above 53 had computed
  // these at the width all along, so the two disagreed across the carrier's
  // line rather than across anything the language says.
  expect(evaluated('String((1 := uint.<33>) << (32 := uint.<33>));')).toBe('4294967296');
  expect(evaluated('String((1 := uint.<40>) << (39 := uint.<40>));')).toBe('549755813888');
  // The band and the wide path now answer the same at the join.
  expect(evaluated('String((1 := uint.<53>) << (32 := uint.<53>));'))
    .toBe(evaluated('String((1 := uint.<54>) << (32 := uint.<54>));'));
});

test('a literal reaches a wide type exactly', () => {
  // #sec-literalvalueintype takes "the mathematical value denoted by the
  // literal, as defined by the numeric literal grammar, BEFORE ANY ROUNDING",
  // and the lexer has already produced a double by then - so the value comes
  // from the literal's source text, as it already did for a decimal and a
  // BigInt contextual position.
  expect(evaluated('let x: int64 = 9007199254740993; String(x);')).toBe('9007199254740993');
  expect(evaluated('let y: uint64 = 18446744073709551615; String(y);')).toBe('18446744073709551615');
  // A cast is a contextual position for a literal too.
  expect(evaluated('String((1152921504606846977 := int64));')).toBe('1152921504606846977');
  // And the literal is a value OF the type, not a BigInt that happened to
  // arrive - which matters because the checker may elide the annotation it has
  // just proved.
  expect(evaluated('let x: int64 = 9007199254740993; `${typeof x}:${x is int64}`;')).toBe('number:true');
});

test('a literal outside a wide position is unaffected', () => {
  // The same digits at `number` still round, because that is what a Number is.
  expect(evaluated('let n: number = 9007199254740993; String(n);')).toBe('9007199254740992');
  expect(evaluated('let s: uint8 = 200; String(s);')).toBe('200');
  // A literal a wide type cannot hold is still refused rather than wrapped.
  expect(() => evaluated('let x: uint64 = 18446744073709551616;')).toThrow();
});

test('a cast does not offer its target as a contextual type to anything else', () => {
  // A contextual type also RANKS OVERLOADS, so offering the target to an
  // arbitrary operand would collapse the numeric library's distinction between
  // converting the result and converting the operand.
  expect(evaluated('String((Math.sqrt((10 := uint8)) := float64));')).toBe('3');
  expect(evaluated('String(Math.sqrt((10 := float64)));')).toBe('3.1622776601683795');
});

test('a BigInt converts to an integer type, and back', () => {
  // #sec-requiretype: "If _t_ is a numeric type and RuntimeTypeOf(_value_) is a
  // numeric type", convert. A BigInt is a numeric type - #sec-numeric-types
  // defines Number and BigInt that way - so both directions are conversions,
  // and this is the only spelling that expresses a wide value in an UNTYPED
  // position, which is what the `n` suffix is for.
  expect(evaluated('String(int64(9007199254740993n));')).toBe('9007199254740993');
  expect(evaluated('String(9007199254740993n := int64);')).toBe('9007199254740993');
  expect(evaluated('String(uint64(18446744073709551615n));')).toBe('18446744073709551615');
  // A narrow type takes one too, and keeps its Number carrier.
  expect(evaluated('`${uint8(5n)}:${typeof uint8(5n)}`;')).toBe('5:number');
  // And back, at both carriers - written as the EXPLICIT conversion, because
  // #sec-the-conversion-rule makes a primitive assignable only to itself and
  // `any`, so an annotation is refused where the checker knows the type. The
  // conversion is the spelling that asks for it.
  expect(evaluated('const b = bigint(int64.parse("9007199254740993")); `${b}:${typeof b}`;'))
    .toBe('9007199254740993:bigint');
  expect(evaluated('const b = bigint((5 := uint8)); `${b}:${typeof b}`;')).toBe('5:bigint');
});

test('a BigInt the width cannot hold is refused rather than wrapped', () => {
  // "except that a conversion that would wrap, truncate toward zero, or round a
  // finite value to an infinity instead yields ~unrepresentable~".
  expect(() => evaluated('uint8(300n);')).toThrow();
  expect(() => evaluated('uint8(-1n);')).toThrow();
  expect(() => evaluated('uint64(18446744073709551616n);')).toThrow();
});

test('a wide value reads the same however it is looked at', () => {
  // String, a template, and the INSPECTOR agree. The inspector is where a
  // program usually looks at a value, so rendering it through a Number would
  // report the exactness as absent even though it is there.
  expect(evaluated('const x = int64.parse("9007199254740993");'
    + ' `${String(x)}:${`${x}`}`;')).toBe('9007199254740993:9007199254740993');
});

test('numeric types: the complex type names', () => {
  // #sec-type-names: the width-named shorthands "count total bits rather than
  // component bits, following the convention of NumPy and Go, so `complex64` is
  // a pair of `float32` and not a pair of `float64`".
  expect(evaluated('String((type complex64) === (type complex.<float32>));')).toBe('true');
  expect(evaluated('String((type complex128) === (type complex.<float64>));')).toBe('true');
  // "the bare name `complex` is `complex.<number>`" - so unlike its neighbours
  // among the parameterized primitives, the bare name IS an application and
  // denotes a type.
  expect(evaluated('String((type complex) === (type complex.<number>));')).toBe('true');
  // And that default is what keeps the two apart: "`complex` expands through
  // `number` rather than `float64`, so `complex` and `complex128` are distinct
  // types, as `number` and `float64` are".
  expect(evaluated('String((type complex) === (type complex128));')).toBe('false');
  // The neighbours are unaffected: a bare parameterized primitive with no
  // default still denotes a type only when applied.
  expect(() => evaluated('type U = uint; "ok";')).toThrow();
});

test('numeric types: a complex value belongs to its own component type', () => {
  // The values are "the ordered pairs of a real part and an imaginary part, each
  // a value of _T_", so the component type is part of membership.
  expect(evaluated('type C = complex; String(complex(1, 2) is C);')).toBe('true');
  expect(evaluated('type C64 = complex64; String(complex(1, 2) is C64);')).toBe('false');
  expect(evaluated('type C = complex; let z: C = complex(1, 2); z.toString();')).toBe('1+2i');
  // Literal propagation applies "as it does to any numeric literal".
  expect(evaluated('type C = complex; let z: C = 4i; z.toString();')).toBe('4i');
});

test('numeric types: a complex type has a zero', () => {
  // #sec-defaultvalueof: "If _t_ is a numeric type, return the value of _t_
  // representing 0", and the complex family is a numeric one. This is the row
  // that could not be closed while the type objects were absent.
  expect(evaluated('type C = complex; let z: C; z.toString();')).toBe('0i');
  expect(evaluated('type C64 = complex64; let z: C64; z.toString();')).toBe('0i');
  expect(evaluated('type C = complex; let z: C; `${z.real}:${z.imaginary}`;')).toBe('0:0');
});

test('numeric types: the complex conversions are componentwise', () => {
  // #sec-complex-numbers: "`complex64` and `complex128` convert to and from
  // `complex` explicitly and not implicitly, exactly as `float32` and `float64`
  // convert to and from `number`, and the treatment of a value outside the
  // component type's range is [the same]'s as it is for that component."
  expect(evaluated('complex64(complex(1.5, 2.5)).toString();')).toBe('1.5+2.5i');
  expect(evaluated('type C64 = complex64; String(complex64(complex(1, 2)) is C64);')).toBe('true');
  // Each part crosses the boundary of the COMPONENT type, so a float32 part
  // rounds as a float32 does rather than by a rule of its own.
  expect(evaluated('String(complex64(complex(0.1, 0)).real);')).toBe('0.10000000149011612');
  expect(evaluated('String(complex128(complex(0.1, 0)).real);')).toBe('0.1');
  // The result belongs to the type converted to, and not to the other.
  expect(evaluated('type C = complex; String(complex64(complex(1, 2)) is C);')).toBe('false');
});

test('numeric types: a complex lays out as two components', () => {
  // The width-named shorthands "count total bits rather than component bits",
  // which is the same statement as the layout: a `complex64` is a pair of
  // `float32` and so is 8 bytes, not 16.
  expect(evaluated('`${(type complex64).byteLength}:${(type complex128).byteLength}`;')).toBe('8:16');
  expect(evaluated('String((type complex).byteLength);')).toBe('16');
  // It aligns as its COMPONENT does rather than as its whole width, which is
  // what makes `[].<complex128>` "the interleaved buffer an FFT expects" rather
  // than a sequence of padded records.
  expect(evaluated('String((type complex128).alignment);')).toBe('8');
});

// -- A family base applied in expression position (#sec-types-in-expression-position)
//
// "A type name is already an expression, since a type is a value, so `uint8` and
// `Map.<string, uint8>` may be written where a value is expected." The named
// shorthands obeyed this and the parameterized families did not, because their
// bases are not bindings: `int.<8>` was a ReferenceError.

test('a family base applied denotes its type', () => {
  expect(evaluated('String(int.<8> === int8);')).toBe('true');
  expect(evaluated('String(vector.<float32, 4> === float32x4);')).toBe('true');
  // A width with no shorthand to compare against, which tests the general form
  // rather than a named alias.
  expect(evaluated('typeof uint.<4>;')).toBe('object');
  expect(evaluated('String((type uint.<4>) === uint.<4>);')).toBe('true');
});

test('the result IS a Type Object, not something that interns like one', () => {
  // Identity alone would pass if the arm returned the interned object by a route
  // that skipped part of its construction. It did, once: resolving the argument
  // as a literal TYPE rather than as the number 8 produced a record with no
  // layout, which resolved and had no byteLength.
  expect(evaluated('String(int.<8>.byteLength);')).toBe('1');
  expect(evaluated('String(int.<8>(65));')).toBe('65');
  expect(evaluated('String((5 := int8) instanceof int.<8>);')).toBe('true');
  expect(evaluated('let m = ""; try { new (int.<8>)(); } catch (e) { m = e.constructor.name; } m;')).toBe('TypeError');
});

test('a family base is not bound, and a program may bind the name itself', () => {
  // #sec-vector-widths: "a bare parameterized primitive is not a value" - so the
  // fix may not bind them, and `typeof int` stays undefined.
  expect(evaluated('`${typeof int}:${typeof uint}:${typeof vector}`;')).toBe('undefined:undefined:undefined');
  // And these are ORDINARY IDENTIFIERS a program may bind. The application is
  // resolved only where the name does NOT resolve, so a binding keeps its
  // meaning - resolving before the lookup would have changed a working program.
  expect(evaluated('let int = 5; `${int}:${typeof int}`;')).toBe('5:number');
  expect(evaluated('let vector = { m() { return "bound"; } }; vector.m();')).toBe('bound');
  expect(evaluated('let vector = { m() { return "bound"; } }; String(vector.<float32, 4> === float32x4);')).toBe('false');
});

test('the neighbouring forms are unchanged', () => {
  // A base WITH a constructor specializes it rather than denoting a type, which
  // is what `new Map.<string, uint8>()` needs and what `complex` does too.
  expect(evaluated('typeof Map.<string, uint8>;')).toBe('function');
  expect(evaluated('typeof complex.<float32>;')).toBe('function');
  expect(evaluated('String((type complex.<float32>) === (type complex64));')).toBe('true');
  // Type position is untouched, and an application composes where a type may.
  expect(evaluated('String((type int.<8>) === (type int8));')).toBe('true');
  expect(evaluated('`${typeof (type Map.<string, int.<8>>)}:${typeof vector.<int.<8>, 4>}`;')).toBe('object:object');
});
