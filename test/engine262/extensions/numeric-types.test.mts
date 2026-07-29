import { test, expect } from 'vitest';
import { evaluated, ok, bool, expectThrown, expectThrownKind } from '../readme/harness.mts';

/**
 * Extension coverage — complex.md, decimal.md, rational.md (extended numeric types).
 *
 * `float128` and `decimal32/64/128` are core type-universe members whose TYPE
 * NAMES are now registered (fixed this session): they resolve, intern, reflect as
 * primitives, and are distinct. The VALUE level (literals, arithmetic, layout) of
 * these types, and the `complex`/`rational` extension types plus the imaginary
 * literal, are deferred (capability R).
 */

// ── float128 and decimal type names ───────────────────────────────────────────
test('numeric types: float128 is a registered type name', () => {
  expect(evaluated('typeof float128;')).toBe('object');
  expect(evaluated('Reflect.getReflection(float128).kind;')).toBe('primitive');
  // interns and is distinct from float64
  expect(ok('type A = float128; type B = float128; A === B;')).toBe(true);
  expect(bool('String(float128 === float64);')).toBe(false);
});

test('numeric types: the decimal types are registered type names', () => {
  expect(evaluated('typeof decimal128;')).toBe('object');
  expect(evaluated('typeof decimal64;')).toBe('object');
  expect(evaluated('typeof decimal32;')).toBe('object');
  // distinct from one another and from float128
  expect(bool('String(decimal128 === decimal64);')).toBe(false);
  expect(bool('String(decimal128 === float128);')).toBe(false);
});

test('numeric types: float128 and decimal are usable in annotation position', () => {
  expect(evaluated('let a: float128; typeof float128;')).toBe('object');
  expect(evaluated('let a: decimal128; typeof decimal128;')).toBe('object');
});

test('numeric types: the type names are shadowable', () => {
  expect(evaluated('let float128 = 5; String(float128);')).toBe('5');
});

// ── Documented gaps: the value level ──────────────────────────────────────────
test('numeric types: a literal in a decimal or float128 type does not convert (documents the gap)', () => {
  // Target (decimal.md): `let a: decimal128 = 1.5` gives a decimal128 value.
  // The value-level conversion/arithmetic is deferred.
  expectThrown('let a: decimal128 = 1.5;');
  expectThrown('let a: float128 = 1.5;');
});

test('numeric types: rational is a registered value type; complex remains deferred', () => {
  // rational.md is implemented as a value type: `rational` is a global and a
  // usable type name. complex.md is its deferred sibling.
  expect(evaluated('typeof rational;')).toBe('function');
  expect(evaluated('let r: rational = rational(1, 2); typeof r;')).toBe('object');
  expect(evaluated('typeof complex;')).toBe('undefined');
});

test('numeric types: the imaginary literal does not parse (documents the gap)', () => {
  // Target: `4i`, `2.5i`, `1e3i` are imaginary literals typed by the complex
  // extension. The suffix does not lex.
  expectThrown('let a = 3i; typeof a;');
});

test('numeric types: a plain integer literal takes the bigint type from its context', () => {
  // The `n` suffix exists because BigInt arrived before there was a type system
  // to take a literal's type FROM. Where a type is written the suffix is
  // redundant, and the literal rule should reach `bigint` as it reaches the
  // sixteen types this proposal adds - it did not, and worse, `let x: bigint =
  // 65n` was itself a TypeError, so the type could not be used with an
  // annotation at all (F66).
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
  // AND THE BOUNDARY OF THE RULE (F67): only up to 2**53. The specification
  // converts a literal from "the mathematical value denoted by the literal",
  // which is exact. PIN FLIPPED (F85): this asserted the REFUSAL, which was the
  // honest boundary while the exact value was unreachable - the lexer turns a
  // NumericLiteral into a double at scan time, so the digits beyond 2**53 were
  // gone before any contextual type could be consulted, and refusing at least
  // never corrupted. The parse node now retains the literal's SOURCE TEXT, so
  // the value is reachable and the whole range works. The assertion is kept in
  // its new form because what it guards is unchanged: this boundary must never
  // report digits the source did not write.
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
  // DECISION CHANGED (F74): the literal rule reaches equality, so a LITERAL in
  // one of these positions takes the other operand's type and the comparison
  // is uint8 against uint8. R1 is untouched by that - what changed is that a
  // literal is no longer a Number here - and the assertions below hold it,
  // using a VARIABLE, which adopts nothing.
  expect(evaluated('String((5 := uint8) === 5);')).toBe('true');
  expect(evaluated('String((0 := uint8) === 0);')).toBe('true');
  expect(evaluated('String((0.5 := float32) === 0.5);')).toBe('true');
  // R1 itself: a typed value is not strictly equal to a plain Number, nor to a
  // value of another numeric type.
  expect(evaluated('const n = 5; String((5 := uint8) === n);')).toBe('false');
  expect(evaluated('function anyv() { return 5; } String((5 := uint8) === anyv());')).toBe('false');
  expect(evaluated('String((5 := uint8) === (5 := uint16));')).toBe('false');
  expect(evaluated('String((5 := uint8) === (5 := uint8));')).toBe('true');
  expect(evaluated('String(Number((5 := uint8)) === 5);')).toBe('true');
  expect(evaluated('String(Number((0 := uint8)) === 0);')).toBe('true');
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
  // The sweep F54 asked for. A builtin written before the numeric types existed
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
  // check the unwrap had to preserve: SameValueZero of a plain uint32 against a
  // TYPED value is false by R1, so an unwrap that stopped short would have
  // turned every valid typed length into an error.
  expectThrownKind('Array((4.5 := float64));', 'RangeError');
  // The array this produces is an ORDINARY array, not a typed one: F54's
  // `length` typing applies at the [[Get]] of a TYPED array, and a plain array
  // built from a typed length is still plain. Pinned in both directions so
  // neither is "fixed" into the other.
  expect(evaluated('String(Array((3 := uint32)).length is uint32);')).toBe('false');
  expect(evaluated('let t: [].<uint8> = [1, 2, 3]; String(t.length is uint32);')).toBe('true');

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
  // already written for a Number on the line above it, since this proposal has
  // no conversion from a sized integer to a bigint at all.
  expectThrownKind('BigInt((3 := uint32));', 'TypeError');
  expectThrownKind('BigInt((1.5 := float64));', 'TypeError');
  expectThrownKind('BigInt.asIntN(64, (3 := uint32));', 'TypeError');
  // The asymmetry is deliberate: the BigInt CONSTRUCTOR has its own Number
  // step, so a plain 3 converts where a typed 3 does not. If those are ever to
  // converge the lever is the cast, which refuses today for the same reason.
  expect(evaluated('String(BigInt(3));')).toBe('3');
  expectThrownKind('bigint((3 := uint32));', 'TypeError');
});

test('numeric types: a literal at `bigint` is read from its source text', () => {
  // #sec-literalvalueintype converts from "the mathematical value denoted by
  // the literal", which is EXACT. The lexer turns a NumericLiteral into a
  // double at scan time, so by the time a contextual type is known the digits
  // beyond 2**53 are gone - the rule was therefore bounded at 2**53 and
  // REFUSED above it, which never corrupted but left the `n` suffix required
  // exactly where it is most tedious (F67). The parse node now retains the
  // literal's SOURCE TEXT, which is where that value still exists.
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
  expect(evaluated('function a() { return (5 := uint8); } let x: number = a(); String(x);')).toBe('5');

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
  // An enum's layout is its underlying type's. The pin that said the Type
  // Record carried no underlying type is stale: F62 added it for the enum
  // subtype relation, so this row costs one line.
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
  // Reflect.getReflection.<Reflect.ClassField, T>(name) reports an offset and a
  // byteLength ... This is the offsetof a serializer, a placement
  // construction, or a vertex attribute descriptor needs."
  const V = 'class Vertex { x: float32; y: float32; z: float32; } ';
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassField, Vertex>("y").offset);`)).toBe('4');
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassField, Vertex>("y").byteLength);`)).toBe('4');
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassField, Vertex>("z").offset);`)).toBe('8');
  // The offset is the LAID-OUT one, so the padding the alignment rule inserts
  // is visible here: `b` is at 2 and not at 1.
  expect(evaluated('class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassField, A>("b").offset);')).toBe('2');
  // Inheritance appends, so a base's field keeps its offset when read through
  // the subclass and the subclass's field follows it.
  const S = 'class B { a: uint8; } class S extends B { b: uint8; } ';
  expect(evaluated(`${S} String(Reflect.getReflection.<Reflect.ClassField, S>("a").offset) + "/" + String(Reflect.getReflection.<Reflect.ClassField, S>("b").offset);`)).toBe('0/1');

  // A context is used in TYPE position, so it has to BE a type for the call to
  // resolve; `Reflect.ClassField` is a Type Object for the same reason
  // `Reflect.never` is one.
  expect(evaluated('String(typeof Reflect.ClassField);')).toBe('object');

  // A class with no layout now READS, and reports no placement. The reflection
  // draws on two sources: the DECLARATION record says what the field was
  // declared as and reaches a field on any class, while the LAYOUT says where
  // it sits and only a laid-out class has that to say. Before they were merged
  // this threw, so a declared field on a class carrying an untyped one was
  // unreflectable although the record held it.
  expect(evaluated('class U { a: uint8; b; } Reflect.getReflection.<Reflect.ClassField, U>("a").kind;')).toBe('field');
  expect(evaluated('class U { a: uint8; b; } String(Reflect.getReflection.<Reflect.ClassField, U>("a").offset);')).toBe('undefined');
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
