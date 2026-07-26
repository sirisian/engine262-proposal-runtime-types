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
