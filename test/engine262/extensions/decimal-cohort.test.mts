import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decimal.md stage A: a representation for the decimal types, and the
 * equality split that is the whole reason it has to be a PAIR.
 *
 * A decimal value is a SIGNIFICAND and an EXPONENT. `1.0`, `1.00` and `1.000`
 * are three values of `decimal128` with one numerical value - IEEE 754 calls
 * such a set a COHORT - and a JS number cannot hold that distinction, since all
 * three are the same double. That is why the deferral was representational
 * rather than lazy.
 */

test('SameValue DISTINGUISHES cohort members', () => {
  // spec: "SameValue distinguishes cohort members, so `Object.is(1.0, 1.00)` is
  // *false* for two `decimal128` values of different exponents".
  expect(evaluated('String(Object.is(decimal128("1.0"), decimal128("1.00")));')).toBe('false');
  // The same member twice IS the same value, which is what says the answer
  // above is about the EXPONENT and not about two objects being two objects.
  expect(evaluated('String(Object.is(decimal128("1.00"), decimal128("1.00")));')).toBe('true');
  expect(evaluated('String(Object.is(decimal128("19.99"), decimal128("19.99")));')).toBe('true');
});

test('SameValueZero compares NUMERICAL VALUE, so a cohort is one key', () => {
  // "while SameValueZero and `==` compare numerical value and find them equal."
  expect(evaluated('const m = new Map(); m.set(decimal128("1.0"), "a"); String(m.get(decimal128("1.00")));')).toBe('a');
  expect(evaluated('String(new Set([decimal128("1.0"), decimal128("1.00"), decimal128("1.000")]).size);')).toBe('1');
  // Different VALUES remain different keys - the guarantee is about
  // significance, not about collapsing everything.
  expect(evaluated('String(new Set([decimal128("1.0"), decimal128("2.0")]).size);')).toBe('2');
});

test('THE JAVA DEFECT, as an explicit negative test', () => {
  // Java's `BigDecimal.equals` compares value AND scale while `compareTo` does
  // not, so a HashSet treats `1.0` and `1.00` as two elements where a TreeSet
  // treats them as one - the class violating its own documented consistency
  // recommendation. **Every structure that keys by SameValueZero must agree
  // here**, and that is the assertion Java fails.
  expect(evaluated('const s = new Set([decimal128("1.0"), decimal128("1.00")]); '
    + 'const m = new Map([[decimal128("1.0"), 1], [decimal128("1.00"), 2]]); '
    + 'String(s.size) + "," + String(m.size);')).toBe('1,1');
  // And the later write wins on one key, rather than adding a second.
  expect(evaluated('const m = new Map(); m.set(decimal128("1.0"), 1); m.set(decimal128("1.00"), 2); '
    + 'String(m.get(decimal128("1.000")));')).toBe('2');
});

test('a decimal reads its cohort member from the DIGITS', () => {
  // "a decimal type reads its cohort member from the source text rather than
  // from the mathematical value, since `1.0` and `1.00` have the same
  // mathematical value" - so the places written are the places kept, which is
  // what a printed price wants.
  expect(evaluated('decimal128("1.0").toString();')).toBe('1.0');
  expect(evaluated('decimal128("1.00").toString();')).toBe('1.00');
  expect(evaluated('decimal128("19.99").toString();')).toBe('19.99');
  expect(evaluated('decimal128("-0.50").toString();')).toBe('-0.50');
  expect(evaluated('decimal128("100").toString();')).toBe('100');
  // 34 significant digits, exactly - the width `decimal128` carries, and the
  // value a double cannot hold at all.
  expect(evaluated('decimal128("9.999999999999999999999999999999999").toString();'))
    .toBe('9.999999999999999999999999999999999');
  // The three widths are distinct types over one representation.
  expect(evaluated('decimal32("1.0").toString();')).toBe('1.0');
  expect(evaluated('decimal64("1.0").toString();')).toBe('1.0');
});

test('PINNED: a NUMBER argument is refused', () => {
  // `decimal128(0.1)` would have to choose a cohort member for a binary double
  // whose exact expansion is 55 digits - the specification flags this as the
  // hard conversion, "the difficulty is not arithmetic but WHICH COHORT MEMBER
  // RESULTS". Stage F owns it; refusing is what keeps a wrong answer from being
  // shipped meanwhile.
  expect(evaluated('try { decimal128(0.1); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('try { decimal128(1); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('PINNED: stage A is the representation ALONE', () => {
  // No arithmetic, no literals in a decimal context, no conversions, no width
  // limits - each is a later stage, and each is pinned rather than left to be
  // discovered.
  // A `valueOf` returning the digit STRING would make `+` CONCATENATE - measured,
  // it gave '1.02.0' - and one returning a Number would give a silently rounded
  // ANSWER through the very double this type exists to avoid. Both are worse
  // than an error, so `valueOf` refuses until stage C.
  expect(evaluated('try { decimal128("1.0") + decimal128("2.0"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  // A decimal32 does not yet refuse a value too wide for it.
  expect(evaluated('decimal32("9.999999999999999999999999999999999").toString();'))
    .toBe('9.999999999999999999999999999999999');
});

test('STAGE B: a literal at a decimal type is read from its SOURCE TEXT', () => {
  // "In a decimal context the literal `0.1` is the decimal one tenth, where in a
  // `float64` context the same `0.1` is the nearest binary float."
  //
  // The mechanism is the one bigint literals already use (F85): the checker
  // marks the node, the run time consults the mark. The reason is sharper here
  // than for bigint - a double is not merely imprecise for `1.00`, it CANNOT
  // REPRESENT THE ANSWER, since `1.0` and `1.00` are one double and two
  // decimals.
  expect(evaluated('let d: decimal128 = 1.0; d.toString();')).toBe('1.0');
  expect(evaluated('let d: decimal128 = 1.00; d.toString();')).toBe('1.00');
  expect(evaluated('let p: decimal128 = 19.99; p.toString();')).toBe('19.99');
  expect(evaluated('let d: decimal64 = 2.50; d.toString();')).toBe('2.50');
  // The cohort survives the literal path, which is the whole point of taking it.
  expect(evaluated('let a: decimal128 = 1.0; let b: decimal128 = 1.00; String(Object.is(a, b));')).toBe('false');
  expect(evaluated('let a: decimal128 = 1.0; let b: decimal128 = 1.00; '
    + 'const m = new Map(); m.set(a, "x"); String(m.get(b));')).toBe('x');
  // A FIELD initializer is a typed position too.
  expect(evaluated('class C { d: decimal128 = 1.50; } new C().d.toString();')).toBe('1.50');
});

test('STAGE B: a decimal belongs to the type of its own WIDTH', () => {
  expect(evaluated('let d: decimal128 = 1.0; String(d is decimal128);')).toBe('true');
  expect(evaluated('let d: decimal128 = 1.0; String(d is decimal32);')).toBe('false');
  expect(evaluated('let d: decimal32 = 1.0; String(d is decimal32);')).toBe('true');
});

test('STAGE B: every other literal is UNAFFECTED', () => {
  // The mark is consulted only where the checker set it, so a float context
  // still gives the nearest binary float and an untyped literal is a Number.
  expect(evaluated('let f: float64 = 0.1; String(f);')).toBe('0.1');
  expect(evaluated('String(0.1 + 0.2);')).toBe('0.30000000000000004');
  expect(evaluated('let b: bigint = 9007199254740993; String(b);')).toBe('9007199254740993');
  expect(evaluated('let u: uint8 = 3; String(u);')).toBe('3');
});
