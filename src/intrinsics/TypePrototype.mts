import { EnsureCompletion, Q } from '../completion.mts';
import { Value, JSStringValue, NumberValue, TypedNumberValue, INDEX_TYPE, ObjectValue, Descriptor, type Arguments, type FunctionCallContext, type NativeSteps } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { isTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { IsPlainData, ReportedLayoutOf, SoAColumnsOf } from '../type-system/layout.mts';
import { IsOfType, fitsNumericType } from '../type-system/runtime.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { CreateComplexValue } from './Complex.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { Realm, Throw, R, wellKnownSymbols, CreateBuiltinFunction, X } from '#self';
import { ParseDecimalDigits, CreateDecimalValue, DecimalPartsInRange } from './Decimal.mts';
import { Float128FromNumber } from './Float128.mts';
import { surroundingAgent } from '#self';
import { canonicalTypeText } from '../type-system/records.mts';

/**
 * proposal-runtime-types: %Type.prototype%, the prototype of every Type
 * Object. Its %Symbol.hasInstance% method makes `value instanceof T` the
 * IsOfType membership test.
 */
/** https://sirisian.github.io/ecmascript-types/#sec-isoftype */
function* TypeProto_hasInstance([V = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const result = Q(yield* IsOfType(V, thisValue.TypeRecord));
  return result ? Value.true : Value.false;
}

/**
 * proposal-runtime-types (spec sec-parse-for-numeric-types): a numeric Type
 * Object has a `parse` method. `uint8.parse('1')` returns the enumerator's
 * value as that type. The accepted input is exactly a literal of the type, with
 * optional surrounding whitespace and an optional sign; numeric separators are
 * accepted and the radix form accepts the matching prefix. Unlike parseInt and
 * parseFloat no trailing text is consumed and a failed parse throws rather than
 * returning NaN: a malformed string is a SyntaxError, and a well-formed literal
 * whose value is out of range is a RangeError.
 */
/** https://sirisian.github.io/ecmascript-types/#sec-parse-for-numeric-types */
/**
 * The string form of a complex, as the imaginary literal writes it: an optional
 * real part, an optional signed imaginary part suffixed `i`, or either alone.
 * Whitespace around the whole is ignored; a sign between the parts is required,
 * since `3 2i` denotes nothing.
 */
/** Exported so the bare `complex` constructor reads the same grammar its
 * width-named shorthands do; one reader, one accepted form. */
export function ParseComplexLiteral(text: string): { real: number, imaginary: number } | null {
  const source = text.trim();
  if (source === '') {
    return null;
  }
  const num = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
  // Both parts: a real, then a SIGNED imaginary.
  const both = new RegExp(`^(${num})([+-](?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)i$`);
  const pair = both.exec(source);
  if (pair) {
    return { real: Number(pair[1]), imaginary: Number(pair[2]) };
  }
  const onlyImaginary = new RegExp(`^(${num})i$`).exec(source);
  if (onlyImaginary) {
    return { real: 0, imaginary: Number(onlyImaginary[1]) };
  }
  const onlyReal = new RegExp(`^(${num})$`).exec(source);
  if (onlyReal) {
    return { real: Number(onlyReal[1]), imaginary: 0 };
  }
  return null;
}

/** https://sirisian.github.io/ecmascript-types/#sec-parse-for-numeric-types */
function* TypeProto_parse([S = Value.undefined, radix = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const t = thisValue.TypeRecord;
  const isInteger = t.Kind === 'primitive' && (t.Name === 'uint' || t.Name === 'int');
  const isBigInt = t.Kind === 'primitive' && t.Name === 'bigint';
  const isFloat = t.Kind === 'primitive' && (t.Name === 'float16' || t.Name === 'float32' || t.Name === 'float64' || t.Name === 'float128');
  // decimal.md names `decimal128.parse('19.99')` as the EXACT construction form,
  // beside a literal: "an exact decimal comes from a literal or a string, never
  // from a round trip through binary". So parse reads the DIGITS and takes the
  // cohort member from them - going through `Number` first would lose the
  // significance this form exists to keep.
  //
  // Answered BEFORE the integer and float paths so their narrowing of `t` is
  // left exactly as it was.
  if (t.Kind === 'primitive' && (t.Name === 'decimal32' || t.Name === 'decimal64' || t.Name === 'decimal128')) {
    if (!(S instanceof JSStringValue)) {
      return Throw.SyntaxError('$1 is not a valid literal', S);
    }
    const digits = ParseDecimalDigits(S.stringValue());
    if (!digits) {
      return Throw.SyntaxError('$1 is not a valid literal', S);
    }
    const decimalWidth = t.Name === 'decimal32' ? 32 : t.Name === 'decimal64' ? 64 : 128;
    // #sec-parsing: "`parse` throws ... a *RangeError* when it is a LITERAL
    // WHOSE VALUE THE TYPE CANNOT REPRESENT."
    //
    // The same range rule the conversion applies, and the same reason
    // #table-numeric-conversions gives for it - "a decimal's range is a property
    // of the type rather than of the format". Reached only now that the grammar
    // admits an exponent: `decimal32.parse('1e300')` had no way to be written
    // before, and silently built a value no `decimal32` holds once it did.
    if (!DecimalPartsInRange(digits, decimalWidth)) {
      return Throw.RangeError('$1 is not in the range of $2', S, Value(t.Name));
    }
    return CreateDecimalValue(digits.significand, digits.exponent, decimalWidth, surroundingAgent.currentRealmRecord);
  }
  // proposal-runtime-types: "for the binary floating-point, decimal, rational,
  // and complex types it is `parse(_string_)`". complex.md names
  // `complex.parse('3-2i')` beside the literal, so a complex is constructible
  // from a string as every other numeric type is.
  //
  // The grammar is the one the literal writes: an optional real part, an
  // optional signed imaginary part carrying the `i` suffix, and either alone.
  // `'3-2i'`, `'4i'`, and `'5'` are each valid; a bare `'i'` is not, the suffix
  // being on a numeric literal rather than a name.
  if (t.Kind === 'primitive' && t.Name === 'complex') {
    if (!(S instanceof JSStringValue)) {
      return Throw.SyntaxError('$1 is not a valid literal', S);
    }
    const parsed = ParseComplexLiteral(S.stringValue());
    if (!parsed) {
      return Throw.SyntaxError('$1 is not a valid literal', S);
    }
    return CreateComplexValue(parsed.real, parsed.imaginary, t.Arguments?.[0], surroundingAgent.currentRealmRecord);
  }
  // #sec-parsing: "For an integer type AND FOR `BIGINT` its signature is
  // `parse(_string_, _radix_ = 10)`." The family was absent, so `bigint.parse`
  // refused with "parse is not defined for bigint" - a message that was true of
  // the engine and false of the clause.
  if (!isInteger && !isFloat && !isBigInt) {
    return Throw.TypeError('parse is not defined for $1', thisValue);
  }
  if (!(S instanceof JSStringValue)) {
    // parse takes a string; anything else is a SyntaxError like a malformed literal.
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  const raw = S.stringValue();
  const text = raw.trim();
  if (text.length === 0) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  // Determine the radix. For integer types parse(string, radix = 10); a radix
  // argument is honoured, and the matching base prefix is accepted.
  let base = 10;
  if ((isInteger || isBigInt) && radix !== Value.undefined) {
    const rNum = radix instanceof NumberValue ? (R(radix) as number) : NaN;
    if (Number.isInteger(rNum) && rNum >= 2 && rNum <= 36) {
      base = rNum;
    } else {
      return Throw.SyntaxError('$1 is not a valid radix', radix);
    }
  }
  // Reject numeric separators only in invalid positions; accept them between
  // digits (mirroring the literal grammar), then strip for the numeric parse.
  if (/__|^_|_$|_(?=[.eExXbBoO])|(?<=[.eExXbBoO])_/.test(text)) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  const cleaned = text.replace(/_/g, '');
  let value: number | bigint;
  if (isBigInt) {
    // Read as an EXACT integer, never through a Number. A bigint has no width,
    // so there is no rounding that could be harmless and no range to check -
    // the only failure this family has is a malformed literal.
    const exact = exactIntegerLiteral(cleaned, base);
    if (exact === null) {
      return Throw.SyntaxError('$1 is not a valid literal', S);
    }
    return Value(exact);
  }
  if (isInteger) {
    value = parseIntegerLiteral(cleaned, base);
    // #sec-integer-types: a type wider than 53 bits has values a double cannot
    // distinguish, so the digits are read as an exact integer rather than
    // through a Number - which is what let `int64.parse` round its own argument
    // and then refuse the type's own maximum for being one past the end.
    const bits = typeof t.Arguments[0] === 'number' ? t.Arguments[0] : 0;
    if (bits > 53 && !Number.isNaN(value)) {
      const exact = exactIntegerLiteral(cleaned, base);
      if (exact !== null) {
        value = exact;
      }
    }
  } else {
    value = parseFloatLiteral(cleaned);
    // A literal whose value OVERFLOWED THE DOUBLE is a *RangeError* at every
    // float width, not only the narrow ones.
    //
    // #sec-parsing gives `parse` "a *RangeError* when it is a literal whose
    // value the type cannot represent". `float16.parse('1e300')` and
    // `float32.parse('1e300')` refused, and `float64.parse('1e400')` answered
    // *Infinity* - because the overflow happened in a different place. At the
    // narrow widths 1e300 is a finite double, and rounding it to the width is
    // what overflows, which `fitsNumericType` sees. At `float64` the double
    // itself overflows while being read, so the predicate receives an infinity
    // and, correctly for a conversion, counts an infinity as a value of the
    // type.
    //
    // That predicate is right for what it serves: a CONVERSION saturates, and
    // `JSON.parse.<float16>('1e300')` is *Infinity* by the conversion table.
    // What differs here is that `parse` reads a LITERAL, and a literal naming
    // a finite value the type cannot hold is refused - so the distinction is
    // made where the literal is still in hand, not in the shared predicate.
    //
    // A literal that WRITES an infinity is not an overflow and is unaffected:
    // `float64.parse('Infinity')` names a value of the type and answers it.
    if (typeof value === 'number' && !Number.isFinite(value) && !Number.isNaN(value)
      && !/^[+-]?Infinity$/.test(cleaned)) {
      return Throw.RangeError('$1 is out of range for the type', S);
    }
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  if (!fitsNumericType(value, t.Name, t.Arguments)) {
    return Throw.RangeError('$1 is out of range for the type', S);
  }
  // proposal-runtime-types #sec-binary-floating-point-types: a float128's values
  // are software pairs rather than Numbers, so a parse builds one of those - a
  // TypedNumberValue carrying a double would be a value of the wrong shape, and
  // `float128.parse("0.1")` would answer the double's SHORTEST text rather than
  // the exact value the format holds.
  if (t.Kind === 'primitive' && t.Name === 'float128') {
    return Float128FromNumber(typeof value === 'bigint' ? Number(value) : value, surroundingAgent.currentRealmRecord);
  }
  // #sec-parsing: `parse` "returns A VALUE OF THE TYPE the function belongs to".
  //
  // A narrow float's parse returned the DOUBLE it read, tagged with the type:
  // `float16.parse('0.1')` was `0.1` where `float16(0.1)` is
  // `0.0999755859375`, and `float16.parse('1e300')` was `1e+300`, a value no
  // `float16` holds, answering `float16` to `Reflect.typeOf`. The range test
  // above cannot catch either - `fitsNumericType` answers *true* for every
  // float name, so it is a no-op on this family.
  //
  // Rounded by the same helper the conversion uses rather than a second rule:
  // the digits a literal names are not generally a value of a narrow float, and
  // rounding to the width is what makes one.
  if (isFloat) {
    const rounded = wrapToType(value, t);
    // "a *RangeError* when it is a literal whose value the type cannot
    // represent". A finite literal that rounds to an infinity is exactly that -
    // the type has no value for it - which is where a parse parts company with
    // a CONVERSION, whose table row says a finite source outside the range
    // "becomes an infinity of the same sign".
    if (typeof rounded === 'number' && !Number.isFinite(rounded)
      && typeof value === 'number' && Number.isFinite(value)) {
      return Throw.RangeError('$1 is out of range for the type', S);
    }
    return new TypedNumberValue(rounded, t);
  }
  return new TypedNumberValue(value, t);
}

/**
 * The same literal as an EXACT integer, for a type a double cannot hold. Returns
 * *null* where the text is not an integer literal of the base, leaving the
 * Number reader's own diagnosis to stand.
 */
function exactIntegerLiteral(text: string, base: number): bigint | null {
  let s = text;
  let sign = 1n;
  if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.startsWith('-')) {
    sign = -1n;
    s = s.slice(1);
  }
  const prefixes: Record<number, RegExp> = { 16: /^0[xX]/, 8: /^0[oO]/, 2: /^0[bB]/ };
  const prefix = prefixes[base];
  if (prefix && prefix.test(s)) {
    s = s.slice(2);
  }
  const digits: Record<number, RegExp> = { 16: /^[0-9a-fA-F]+$/, 10: /^[0-9]+$/, 8: /^[0-7]+$/, 2: /^[01]+$/ };
  const pattern = digits[base];
  if (!pattern || !pattern.test(s)) {
    return null;
  }
  const markers: Record<number, string> = { 16: '0x', 8: '0o', 2: '0b', 10: '' };
  try {
    return sign * BigInt(`${markers[base]}${s}`);
  } catch {
    return null;
  }
}

/**
 * Parse the entire string as an integer literal in the given base, honouring an
 * optional sign and a base-matching prefix. Returns NaN when the whole string is
 * not such a literal (no trailing text is consumed).
 */
function parseIntegerLiteral(text: string, base: number): number {
  let s = text;
  let sign = 1;
  if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  // Accept the matching prefix for the common bases.
  if (base === 16 && /^0[xX]/.test(s)) {
    s = s.slice(2);
  } else if (base === 8 && /^0[oO]/.test(s)) {
    s = s.slice(2);
  } else if (base === 2 && /^0[bB]/.test(s)) {
    s = s.slice(2);
  }
  if (s.length === 0) {
    return NaN;
  }
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
  const re = new RegExp(`^[${digits}]+$`, 'i');
  if (!re.test(s)) {
    return NaN;
  }
  const parsed = parseInt(s, base);
  return sign * parsed;
}

/** Parse the entire string as a decimal float literal; NaN when it is not one. */
function parseFloatLiteral(text: string): number {
  // A full float literal: optional sign, digits with an optional fraction and an
  // optional exponent. The whole string must match (no trailing text).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    // Also accept the special forms a float literal admits: Infinity.
    if (/^[+-]?Infinity$/.test(text)) {
      return text.startsWith('-') ? -Infinity : Infinity;
    }
    return NaN;
  }
  return Number(text);
}

/**
 * proposal-runtime-types (spec, the Parsing clause): every numeric type that has
 * `parse` also has `tryParse`, with the same parameters, returning a value of the
 * type where `parse` would return one and *null* where `parse` would fail. Its
 * return type is the union of the type and the null type.
 *
 * The union is the point of it. A sentinel would have to be a value of the type,
 * and an integer type has none to spare (`parse` throws rather than returning NaN
 * for exactly that reason), so the failure is reported beside the type instead of
 * inside it and is then handled by narrowing: the result is a `uint8` in the
 * branch that has tested it against *null*, and needs no cast there.
 *
 * This delegates to `parse` rather than restating its grammar, so the two cannot
 * drift: whatever `parse` accepts, `tryParse` accepts, and every rejection
 * becomes *null*. What does NOT become *null* is misuse of the method itself. A
 * receiver that is not a type, or a type with no parse at all, is a mistake in
 * the program rather than a string that failed to parse, and answering *null*
 * there would report a bad call as a bad input.
 */
/**
 * Whether a thrown value is a *SyntaxError*, which is the one failure `tryParse`
 * converts to *null*.
 *
 * Read from the error's own [[ErrorData]]-bearing prototype chain rather than
 * from its `constructor` property, which a program may replace: a `tryParse`
 * that consulted a writable property would answer differently after
 * `SyntaxError.prototype.constructor = RangeError`.
 */
function isSyntaxErrorCompletion(thrown: Value): boolean {
  if (!(thrown instanceof ObjectValue)) {
    return false;
  }
  const intrinsic = surroundingAgent.currentRealmRecord.Intrinsics['%SyntaxError.prototype%'];
  let proto = EnsureCompletion(X(thrown.GetPrototypeOf())).Value as Value;
  while (proto instanceof ObjectValue) {
    if (proto === intrinsic) {
      return true;
    }
    proto = EnsureCompletion(X(proto.GetPrototypeOf())).Value as Value;
  }
  return false;
}

/** https://sirisian.github.io/ecmascript-types/#sec-parse-for-numeric-types */
function* TypeProto_tryParse([S = Value.undefined, radix = Value.undefined]: Arguments, context: FunctionCallContext): ValueEvaluator {
  const { thisValue } = context;
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const t = thisValue.TypeRecord;
  const isInteger = t.Kind === 'primitive' && (t.Name === 'uint' || t.Name === 'int');
  const isBigInt = t.Kind === 'primitive' && t.Name === 'bigint';
  const isFloat = t.Kind === 'primitive' && (t.Name === 'float16' || t.Name === 'float32' || t.Name === 'float64' || t.Name === 'float128');
  // #sec-parsing: "EACH TYPE also has a `tryParse` function with the same
  // parameters, returning a value of the type where `parse` would return one and
  // *null* where `parse` would fail to parse its argument."
  //
  // A decimal has a `parse`, so it has a `tryParse`; this listed the integer and
  // float families and refused the rest, so `decimal64.tryParse('1.5')` threw
  // where `decimal64.parse('1.5')` answered.
  //
  // A range failure answers *null* here, which is what the integer family
  // already does - `uint8.tryParse('300')` is *null* while `uint8.parse('300')`
  // throws - so a decimal follows the convention beside it rather than
  // inventing one. Whether that is right is a question for the clause: it says
  // *null* where `parse` would "fail to parse", and a value the type cannot
  // represent parsed fine and then did not fit, which is the other failure
  // `parse` distinguishes.
  const isDecimal = t.Kind === 'primitive'
    && (t.Name === 'decimal32' || t.Name === 'decimal64' || t.Name === 'decimal128');
  // `bigint` has a `parse`, so it has this beside it: "EACH type also has a
  // `tryParse` function with the same parameters".
  // "EACH type also has a `tryParse` function", so the families that gained a
  // `parse` gain this beside it.
  const isRationalOrComplex = t.Kind === 'primitive' && (t.Name === 'rational' || t.Name === 'complex');
  if (!isInteger && !isFloat && !isDecimal && !isRationalOrComplex && !isBigInt) {
    return Throw.TypeError('tryParse is not defined for $1', thisValue);
  }
  const attempt = EnsureCompletion(yield* TypeProto_parse([S, radix], context));
  if (attempt.Type === 'normal') {
    return attempt.Value;
  }
  // ONLY a *SyntaxError* becomes *null*. #sec-parsing gives `parse` two
  // failures - "a *SyntaxError* when the string is not a literal of the type,
  // and a *RangeError* when it is a literal whose value the type cannot
  // represent" - and gives this one: "*null* where `parse` would FAIL TO PARSE
  // its argument". A value out of range parsed; it then did not fit.
  //
  // Every family answered *null* for both, so `uint8.tryParse('zz')` and
  // `uint8.tryParse('300')` were indistinguishable and a caller wanting to tell
  // them apart had to call `parse` and catch - which is what `tryParse` exists
  // to avoid.
  //
  // The clause is not unanimous about this: a later sentence says a program
  // that does not know its input "writes `tryParse` and handles the *null*",
  // which reads as though nothing throws. The mechanism sentence is the precise
  // one and governs; the other states the pair's purpose.
  if (isSyntaxErrorCompletion(attempt.Value)) {
    return Value.null;
  }
  return attempt;
}


/**
 * proposal-runtime-types (memorylayout.md): the three layout properties every laid
 * out type exposes. Reading one from a type that has no layout, a `string` or a
 * union of value types, is a TypeError rather than a number, which is the point: a
 * program asking for the size of a `string` has made a mistake a returned number
 * would hide.
 */
function layoutOfThis(thisValue: Value, which: 'bitLength' | 'byteLength' | 'alignment') {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  // The REPORTED layout, not the storage one: a reference type has none to
  // report even though a field of it occupies a reference's width.
  const layout = ReportedLayoutOf(thisValue.TypeRecord);
  if (layout === null) {
    return Throw.TypeError('this type has no layout, so it has no $1', Value(which));
  }
  // TYPED, as `a.length`, `a.byteOffset`, `a.byteLength` and a window's `length`
  // already are. These were plain Numbers, so the two halves of the layout
  // surface could not be combined: `a.length * V.byteLength` - the most ordinary
  // layout computation the proposal has - was refused as "a value of the number
  // type and a uint64 are disjoint".
  //
  // This does NOT make `count * V.byteLength` work for a `count` of some other
  // width; the numeric-family rule wants an exact match, so a program counting
  // in `uint8` writes the conversion, as it does everywhere else. What it fixes
  // is one reflective quantity being combinable with another.
  return new TypedNumberValue(layout[which], INDEX_TYPE);
}

/**
 * proposal-runtime-types soa.md: "`elementByteLength` is the PER-ELEMENT SUM OF
 * COLUMN STRIDES", as distinct from `byteLength`, which is the whole laid-out
 * size. The two differ by more than the extent: an element's fields are not
 * adjacent in an SoA, so this is the width one element occupies across the
 * columns and not the stride of anything contiguous.
 *
 * Only an SoA has one, since only an SoA has columns.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-type-layout
 */
function* TypeProto_elementByteLengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const record = thisValue.TypeRecord;
  if (record.Kind !== 'nominal' || record.LibraryName !== 'SoA') {
    return Value.undefined;
  }
  const element = record.Arguments[0];
  if (element === undefined || typeof element === 'number') {
    return Value.undefined;
  }
  const columns = SoAColumnsOf(element);
  if (columns === null) {
    return Throw.TypeError('this type has no layout, so it has no $1', Value('elementByteLength'));
  }
  let total = 0;
  for (const column of columns) {
    total += column.layout.byteLength;
  }
  return Value(total);
}

/** https://sirisian.github.io/ecmascript-types/#sec-type-layout */
function* TypeProto_bitLengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return layoutOfThis(thisValue, 'bitLength');
}

/** https://sirisian.github.io/ecmascript-types/#sec-type-layout */
function* TypeProto_byteLengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return layoutOfThis(thisValue, 'byteLength');
}

/** https://sirisian.github.io/ecmascript-types/#sec-type-layout */
function* TypeProto_alignmentGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return layoutOfThis(thisValue, 'alignment');
}

/**
 * proposal-runtime-types #sec-layout-properties: "A Type Object has a
 * `hasLayout` property, *true* where the type has a layout and *false* where it
 * has none."
 *
 * Asking WHETHER a type has a layout is a different act from asserting that it
 * does, and the three properties beside this one are for the assertion: each
 * throws for a type with no layout, "which is the point: a program that asks for
 * the size of a `string` has made a mistake a returned number would hide".
 *
 * Without this the only way to ask is to read one and catch, which is control
 * flow by exception for a question that is not a mistake - and the cheaper test
 * does not exist either, since `'byteLength' in string` is *true*, the property
 * being present on the prototype and throwing on read. A serializer walking a
 * heterogeneous structure is asking rather than asserting, and the `catch` that
 * stands in for it also swallows a typo in a type name.
 */
function* TypeProto_hasLayoutGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  return Value(ReportedLayoutOf(thisValue.TypeRecord) !== null);
}

/**
 * Whether a value of this type is PLAIN DATA: laid out, with no reference at any
 * depth, so it may be reinterpreted as bytes.
 *
 * `hasLayout` was answering this too, and wrongly. A class holding a nullable
 * `dynamic` class field has a layout - a pointer's, eight bytes - and reading
 * that as permission to view its bytes hands a program the raw bits of a
 * reference. Three guard sites asked `hasLayout` when they meant this, which is
 * why the buffer-view guard ended up refusing every class element rather than
 * exactly the unsafe ones.
 *
 * Like `hasLayout` this ASKS rather than asserts, so it never throws: a type
 * with no layout is simply not plain data.
 */
function* TypeProto_isPlainDataGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  return Value(IsPlainData(thisValue.TypeRecord));
}

/**
 * proposal-runtime-types #sec-memory-layout: the least and greatest value a type
 * admits, answering the question a range check asks and a saturating operation
 * obeys - both of which the engine already computes and neither of which a
 * program could read.
 *
 * The `bounds` metadata case comes first in the specification and is not
 * implemented here, the `bounds` meta type belonging to the ranges extension.
 * What follows is the width case, the floating-point case, and the refusal.
 */
/**
 * proposal-runtime-types #table-type-families: the family a type belongs to, as
 * a String. #table-family-operations already decides what an operator does by
 * this concept; `family` is how a program asks the same question, which it
 * previously could not - a reflective consumer had to keep a list of the float
 * types of its own, and be wrong the day a family gained a width.
 */
export function familyOfRecord(record: TypeRecord): string {
  switch (record.Kind) {
    case 'any': return 'any';
    case 'void': return 'void';
    // `never` is the empty union and carries no kind of its own, so it is
    // reported from the union case below rather than here.
    // An enum is a nominal type carrying its enumerators, and reports as itself
    // rather than as the class family it shares a record kind with.
    case 'nominal': return (record as { EnumMembers?: unknown }).EnumMembers !== undefined ? 'enum' : 'class';
    // A parameterization refines the type it parameterizes rather than
    // replacing it, so it reports the family of its base: `float32.<{ m: 1 }>`
    // is a float. Reporting otherwise would put `family` at odds with
    // `instanceof`, with the operator table, and with `bitLength` beside it.
    case 'parameterized': return familyOfRecord(record.Base as TypeRecord);
    case 'literal': return familyOfRecord(record.Base as TypeRecord);
    default: break;
  }
  if (record.Kind === 'union') {
    return (record.Members as readonly unknown[]).length === 0 ? 'never' : 'union';
  }
  if (record.Kind !== 'primitive') {
    return record.Kind;
  }
  const name = record.Name;
  if (name === 'uint' || name === 'int') {
    return 'integer';
  }
  if (/^float(16|32|64|128)$/.test(name)) {
    return 'float';
  }
  if (/^decimal(32|64|128)$/.test(name)) {
    return 'decimal';
  }
  if (name === 'vector') {
    // `boolean8` is `vector.<boolean1, 8>`, a bit vector and so a vector; only
    // `boolean1` itself is the one-bit integer.
    return 'vector';
  }
  if (name === 'rational' || name === 'complex' || name === 'bigint'
      || name === 'string' || name === 'boolean' || name === 'type') {
    return name;
  }
  return name;
}

function familyOfThis(thisValue: Value) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  return Value(familyOfRecord(thisValue.TypeRecord));
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-layout-properties */
function* TypeProto_familyGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return familyOfThis(thisValue);
}

function boundOfThis(thisValue: Value, which: 'min' | 'max') {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const record = thisValue.TypeRecord;
  if (record.Kind === 'primitive' && (record.Name === 'uint' || record.Name === 'int')) {
    const bits = Number(record.Arguments[0]);
    const unsigned = record.Name === 'uint';
    const low = unsigned ? 0n : -(1n << BigInt(bits - 1));
    const high = unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n;
    const value = which === 'min' ? low : high;
    // A width past 53 bits has values no Number holds exactly, so it answers in
    // BigInt rather than in a Number that would silently round.
    return bits > 53 ? Value(value) : Value(Number(value));
  }
  const floatExtremes: Record<string, number> = {
    float16: 65504,
    float32: 3.4028234663852886e38,
    float64: Number.MAX_VALUE,
  };
  if (record.Kind === 'primitive' && floatExtremes[record.Name] !== undefined) {
    const extreme = floatExtremes[record.Name]!;
    // `min` is the MOST NEGATIVE finite value, not the smallest positive one -
    // the reading `Number.MIN_VALUE` would suggest and the reason these members
    // are not spelled that way.
    return Value(which === 'min' ? -extreme : extreme);
  }
  return Throw.TypeError('this type has no layout, so it has no $1', Value(which));
}

/** The least positive value a binary floating-point format represents. */
function floatOnlyOfThis(thisValue: Value, which: 'minPositive' | 'epsilon') {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const record = thisValue.TypeRecord;
  if (record.Kind !== 'primitive') {
    return Throw.TypeError('this type has no layout, so it has no $1', Value(which));
  }
  const table: Record<string, { minPositive: number, epsilon: number }> = {
    float16: { minPositive: 5.960464477539063e-8, epsilon: 0.0009765625 },
    float32: { minPositive: 1.401298464324817e-45, epsilon: 1.1920928955078125e-7 },
    float64: { minPositive: Number.MIN_VALUE, epsilon: Number.EPSILON },
  };
  const entry = table[record.Name];
  if (entry === undefined) {
    return Throw.TypeError('this type has no layout, so it has no $1', Value(which));
  }
  return Value(entry[which]);
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-layout-properties */
function* TypeProto_minGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return boundOfThis(thisValue, 'min');
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-layout-properties */
function* TypeProto_maxGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return boundOfThis(thisValue, 'max');
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-layout-properties */
function* TypeProto_minPositiveGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return floatOnlyOfThis(thisValue, 'minPositive');
}

/** https://sirisian.github.io/proposal-runtime-types/#sec-layout-properties */
function* TypeProto_epsilonGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return floatOnlyOfThis(thisValue, 'epsilon');
}

/**
 * https://sirisian.github.io/ecmascript-types/#sec-types-and-type-objects
 *
 * `Type.prototype.toString` - the canonical source form of the type.
 *
 * `typeprogramming.md` §3.3 promises this
 * - *"`String(type 'a' | 'b')` is `"'a' | 'b'"`, because builders throwing
 * authored `TypeError`s need to print types"* - and nothing implemented it, so
 * every Type Object stringified as `[object Type]`. A developer had no way to
 * see a type in a console and a builder had nothing to put in a message.
 */
function TypeProto_toString(this: unknown, _args: Arguments, { thisValue }: FunctionCallContext) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', Value('the receiver of Type.prototype.toString'));
  }
  return Value(canonicalTypeText((thisValue as { TypeRecord: TypeRecord }).TypeRecord));
}

/**
 * Gives a class CONSTRUCTOR the type-object surface. It cannot INHERIT it -
 * ECMA-262 fixes its prototype to %Function.prototype% or the superclass - so
 * the members are installed as own properties.
 *
 * Five of thirteen. `toString` is omitted because Function.prototype's returns
 * the class's source text and ECMA-262 fixes that; the numeric bounds have no
 * answer for a class; and `parse`/`tryParse` read a string into a value of the
 * type, which a class has no general answer for.
 *
 * Installed on EVERY class, including one declaring no fields. A subclass
 * constructor's prototype IS its base constructor and statics inherit, so a
 * subclass left unstamped would report the BASE's layout.
 */
export function InstallTypeObjectSurface(realmRec: Realm, target: ObjectValue): void {
  const members: [string, NativeSteps][] = [
    ['byteLength', TypeProto_byteLengthGetter],
    ['bitLength', TypeProto_bitLengthGetter],
    ['alignment', TypeProto_alignmentGetter],
    ['hasLayout', TypeProto_hasLayoutGetter],
    ['isPlainData', TypeProto_isPlainDataGetter],
    ['family', TypeProto_familyGetter],
  ];
  for (const [name, steps] of members) {
    const getter = CreateBuiltinFunction(steps, 0, Value(name), [], realmRec, undefined, Value('get'));
    X(target.DefineOwnProperty(Value(name), Descriptor({
      Getter: getter, Setter: Value.undefined, Enumerable: Value.false, Configurable: Value.true,
    })));
  }
}

export function bootstrapTypePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.hasInstance, TypeProto_hasInstance, 1],
    ['toString', TypeProto_toString, 0],
    ['parse', TypeProto_parse, 1],
    ['tryParse', TypeProto_tryParse, 1],
    ['bitLength', [TypeProto_bitLengthGetter]],
    ['elementByteLength', [TypeProto_elementByteLengthGetter]],
    ['byteLength', [TypeProto_byteLengthGetter]],
    ['alignment', [TypeProto_alignmentGetter]],
    ['hasLayout', [TypeProto_hasLayoutGetter]],
    ['isPlainData', [TypeProto_isPlainDataGetter]],
    ['family', [TypeProto_familyGetter]],
    ['min', [TypeProto_minGetter]],
    ['max', [TypeProto_maxGetter]],
    ['minPositive', [TypeProto_minPositiveGetter]],
    ['epsilon', [TypeProto_epsilonGetter]],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Type');
  realmRec.Intrinsics['%Type.prototype%'] = proto;
}
