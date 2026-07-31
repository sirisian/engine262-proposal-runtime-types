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

test('STAGE C: IEEE 754 clause 5.1 decides WHICH COHORT MEMBER results', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // ADDITION's preferred exponent is min(Q(x), Q(y)) - so `1.5 + 1.50` is
  // `3.00`, not `3.0`. **The rule is the standard's**, and taking it from there
  // is what stops a result's significance being invented per operation.
  expect(evaluated(`(${D('1.5')} + ${D('1.50')}).toString();`)).toBe('3.00');
  expect(evaluated(`(${D('1.0')} + ${D('2.0')}).toString();`)).toBe('3.0');
  expect(evaluated(`(${D('1.30')} - ${D('1.07')}).toString();`)).toBe('0.23');
  // MULTIPLICATION's is Q(x) + Q(y): -2 and -1 give -3.
  expect(evaluated(`(${D('1.20')} * ${D('1.2')}).toString();`)).toBe('1.440');
  // Unary minus changes the sign and NOTHING about the significance.
  expect(evaluated(`(-${D('1.50')}).toString();`)).toBe('-1.50');
});

test('STAGE C: the arithmetic is EXACT where binary floats are not', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // The reason the type exists. `0.1 + 0.2` is `0.30000000000000004` in binary
  // and `0.3` here.
  expect(evaluated(`(${D('0.1')} + ${D('0.2')}).toString();`)).toBe('0.3');
  expect(evaluated('String(0.1 + 0.2);')).toBe('0.30000000000000004');
  // A price times a quantity, which is what money arithmetic asks for.
  expect(evaluated(`(${D('19.99')} * ${D('3')}).toString();`)).toBe('59.97');
  expect(evaluated(`(${D('7')} % ${D('2')}).toString();`)).toBe('1');
});

test('STAGE C: DIVISION is where exactness runs out, and rounds half-even', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // An exact quotient stays exact.
  expect(evaluated(`(${D('1')} / ${D('8')}).toString();`)).toBe('0.125');
  // `1/3` has no finite decimal expansion, so it is computed to the type's
  // PRECISION - 34 significant digits for `decimal128`, IEEE 754-2008 Table
  // 3.1 - and rounded.
  expect(evaluated(`(${D('1')} / ${D('3')}).toString();`)).toBe('0.3333333333333333333333333333333333');
  // Division by zero is a RangeError, as decimal.md says: "decimals raise a
  // RangeError, since their range is a property of the type rather than of the
  // format".
  expect(evaluated(`try { ${D('1')} / ${D('0')}; "OK"; } catch (e) { e.constructor.name; }`)).toBe('RangeError');
  expect(evaluated(`try { ${D('1')} % ${D('0')}; "OK"; } catch (e) { e.constructor.name; }`)).toBe('RangeError');
});

test('STAGE C: `==` and `<` compare NUMERICAL VALUE, Object.is does not', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // The split, now complete across all three predicates: "`==` compares
  // numerical value, so `1.0 == 1.00` is `true`", while SameValue distinguishes
  // the cohort members. IEEE provides both as `compareQuietEqual` and
  // `totalOrder`.
  expect(evaluated(`String(${D('1.0')} == ${D('1.00')});`)).toBe('true');
  expect(evaluated(`String(Object.is(${D('1.0')}, ${D('1.00')}));`)).toBe('false');
  // The ORDER is over numerical value too, so a cohort is invisible to it.
  expect(evaluated(`String(${D('1.0')} < ${D('2.0')});`)).toBe('true');
  expect(evaluated(`String(${D('1.0')} < ${D('1.00')});`)).toBe('false');
  expect(evaluated(`String(${D('2.5')} >= ${D('2.50')});`)).toBe('true');
});

test('PINNED: a decimal mixes with nothing implicitly', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // The other operand would have to be converted, and `float64` -> decimal is
  // the conversion the specification flags as hard - "the difficulty is not
  // arithmetic but WHICH COHORT MEMBER RESULTS". Stage F owns it; refusing is
  // the same answer stage A gave to `decimal128(0.1)`.
  expect(evaluated(`try { ${D('1.0')} + 1; "ACCEPTED"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  expect(evaluated(`try { ${D('1.0')} * uint8(2); "ACCEPTED"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  // And an operator with no decimal meaning is refused rather than answered.
  expect(evaluated(`try { ${D('1.0')} ** ${D('2.0')}; "ACCEPTED"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
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

test('STAGE D: a composite stores the REDUCED cohort member', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // composites.md: "Where the type declares no scale, the REDUCED member is
  // stored: trailing zeros are stripped, THE ONE MEMBER COMPUTABLE FROM THE
  // NUMERICAL VALUE ALONE, independent of the width."
  expect(evaluated(`Composite({ v: ${D('1.00')} }).v.toString();`)).toBe('1');
  expect(evaluated(`Composite({ v: ${D('19.90')} }).v.toString();`)).toBe('19.9');
  expect(evaluated(`Composite({ v: ${D('0.00')} }).v.toString();`)).toBe('0');
  // A value with no trailing zeros is already its own reduced member.
  expect(evaluated(`Composite({ v: ${D('19.99')} }).v.toString();`)).toBe('19.99');
});

test('STAGE D: the reduction is what makes the composite ORDER-FREE', () => {
  const D = (x: string) => `decimal128("${x}")`;
  // The argument for reducing rather than keeping what arrived. A composite is
  // interned by structure, so its contents are OBSERVABLE - and any other rule
  // makes them depend on which member reached the creation FIRST.
  //
  // Python's `Decimal` hashes a dict key by value and keeps whichever
  // representation was inserted first. That is fine for a dict and wrong here.
  expect(evaluated(`const a = Composite({ v: ${D('1.00')} }); const b = Composite({ v: ${D('1.0')} }); `
    + 'a.v.toString() + "," + b.v.toString();')).toBe('1,1');
  expect(evaluated(`const b = Composite({ v: ${D('1.0')} }); const a = Composite({ v: ${D('1.00')} }); `
    + 'a.v.toString() + "," + b.v.toString();')).toBe('1,1');
  // And the two ARE one composite, which is the property the reduction exists
  // to give: SameValueZero equates the members, so the registry must too.
  expect(evaluated(`String(Object.is(Composite({ v: ${D('1.0')} }), Composite({ v: ${D('1.00')} })));`)).toBe('true');
  // Distinct VALUES stay distinct, and so do distinct WIDTHS - `decimal64` and
  // `decimal128` are different types, and SameValueZero tells them apart.
  expect(evaluated(`String(Object.is(Composite({ v: ${D('1.0')} }), Composite({ v: ${D('2.0')} })));`)).toBe('false');
  expect(evaluated(`String(Object.is(Composite({ v: ${D('1.0')} }), Composite({ v: decimal64("1.0") })));`)).toBe('false');
});

test('PINNED: the SCALE half of the rule has no metadata to read', () => {
  // "Where the field's type declares a scale, the value arrives at that scale -
  // quantization at an assignment boundary is the decimal rule, and a
  // composite's field is such a boundary - so the cohort has collapsed before
  // interning sees it."
  //
  // `DecimalContext` is the primitive-metadata extension's, and does not exist
  // here - so the quantization never happens and the reduction above is the
  // only half in force. A money type would keep its two places through this
  // step once it can be written.
  expect(evaluated('try { eval("type Cents = decimal128.<{ scale: 2 }>;"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).not.toBe('ACCEPTED');
});

test('STAGE E: a decimal field has the IEEE 754 width and alignment', () => {
  const R = (f: string, p: string) => `String(Reflect.getReflection.<Reflect.ClassField, C>("${f}").${p})`;
  // IEEE 754-2008's interchange formats: decimal32 is 4 bytes, decimal64 is 8,
  // decimal128 is 16. **The width is a property of the TYPE, not of the
  // representation** - the interpreter holds a BigInt significand and an
  // exponent, and a laid-out field still occupies the format's bytes.
  expect(evaluated(`class C { d: decimal32 = 1.0; } ${R('d', 'byteLength')} + "/" + ${R('d', 'alignment')};`)).toBe('4/4');
  expect(evaluated(`class C { d: decimal64 = 1.0; } ${R('d', 'byteLength')} + "/" + ${R('d', 'alignment')};`)).toBe('8/8');
  expect(evaluated(`class C { d: decimal128 = 1.0; } ${R('d', 'byteLength')} + "/" + ${R('d', 'alignment')};`)).toBe('16/16');
  expect(evaluated(`class C { d: decimal128 = 1.0; } ${R('d', 'bitLength')};`)).toBe('128');
  // And it PARTICIPATES in the layout: a decimal64 after a uint32 aligns to 8.
  expect(evaluated(`class C { x: uint32 = 0; d: decimal64 = 1.0; } ${R('d', 'offset')};`)).toBe('8');
});

test('STAGE E: a decimal field stores and reads, cohort intact', () => {
  // The property that matters for a field: the significance survives storage,
  // which a double-backed field could not have given.
  expect(evaluated('class C { d: decimal128 = 1.50; } new C().d.toString();')).toBe('1.50');
  expect(evaluated('class C { d: decimal128 = 1.0; } const c = new C(); c.d = decimal128("2.50"); c.d.toString();')).toBe('2.50');
  expect(evaluated('class C { d: decimal128 = 1.0; } const c = new C(); c.d = decimal128("2.50"); '
    + 'String(Object.is(c.d, decimal128("2.50")));')).toBe('true');
  // A wrong-width value is refused, as any typed field refuses one.
  expect(evaluated('class C { d: decimal32 = 1.0; } const c = new C(); '
    + 'try { c.d = decimal128("2.5"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('PINNED: buffer round-trip is not a DECIMAL question', () => {
  // A placement view does not read another view's write - and NEITHER DOES A
  // `float64`, measured. So the buffer round-trip is a pre-existing limitation
  // of placement in this engine rather than something decimals lack, and
  // fixing it belongs to whatever owns placement.
  //
  // Recorded with its BASELINE beside it, because without the baseline this
  // reads as a decimal gap and would be chased as one.
  expect(evaluated('class C { f: float64 = 1; } const b = new ArrayBuffer(64); '
    + 'const c1 = new C.<placement>(b, 0); c1.f = 7.25; const c2 = new C.<placement>(b, 0); String(c2.f);')).toBe('1');
  expect(evaluated('class C { d: decimal64 = 1.0; } const b = new ArrayBuffer(64); '
    + 'const c1 = new C.<placement>(b, 0); c1.d = decimal64("7.25"); const c2 = new C.<placement>(b, 0); c2.d.toString();')).toBe('1.0');
});
