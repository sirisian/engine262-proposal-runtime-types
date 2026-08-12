import { EnsureCompletion, Q } from '../completion.mts';
import { Value, JSStringValue, NumberValue, TypedNumberValue, type Arguments, type FunctionCallContext } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { isTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf, SoAColumnsOf } from '../type-system/layout.mts';
import { IsOfType, fitsNumericType } from '../type-system/runtime.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { Realm, Throw, R, wellKnownSymbols } from '#self';
import { ParseDecimalDigits, CreateDecimalValue } from './Decimal.mts';
import { surroundingAgent } from '#self';

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
function* TypeProto_parse([S = Value.undefined, radix = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const t = thisValue.TypeRecord;
  const isInteger = t.Kind === 'primitive' && (t.Name === 'uint' || t.Name === 'int');
  const isFloat = t.Kind === 'primitive' && (t.Name === 'float16' || t.Name === 'float32' || t.Name === 'float64');
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
    return CreateDecimalValue(digits.significand, digits.exponent, decimalWidth, surroundingAgent.currentRealmRecord);
  }
  if (!isInteger && !isFloat) {
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
  if (isInteger && radix !== Value.undefined) {
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
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  if (!fitsNumericType(value, t.Name, t.Arguments)) {
    return Throw.RangeError('$1 is out of range for the type', S);
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
/** https://sirisian.github.io/ecmascript-types/#sec-parse-for-numeric-types */
function* TypeProto_tryParse([S = Value.undefined, radix = Value.undefined]: Arguments, context: FunctionCallContext): ValueEvaluator {
  const { thisValue } = context;
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const t = thisValue.TypeRecord;
  const isInteger = t.Kind === 'primitive' && (t.Name === 'uint' || t.Name === 'int');
  const isFloat = t.Kind === 'primitive' && (t.Name === 'float16' || t.Name === 'float32' || t.Name === 'float64');
  if (!isInteger && !isFloat) {
    return Throw.TypeError('tryParse is not defined for $1', thisValue);
  }
  const attempt = EnsureCompletion(yield* TypeProto_parse([S, radix], context));
  if (attempt.Type === 'normal') {
    return attempt.Value;
  }
  return Value.null;
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
  const layout = LayoutOf(thisValue.TypeRecord);
  if (layout === null) {
    return Throw.TypeError('this type has no layout, so it has no $1', Value(which));
  }
  return Value(layout[which]);
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

function* TypeProto_minGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return boundOfThis(thisValue, 'min');
}

function* TypeProto_maxGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return boundOfThis(thisValue, 'max');
}

function* TypeProto_minPositiveGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return floatOnlyOfThis(thisValue, 'minPositive');
}

function* TypeProto_epsilonGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return floatOnlyOfThis(thisValue, 'epsilon');
}

export function bootstrapTypePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.hasInstance, TypeProto_hasInstance, 1],
    ['parse', TypeProto_parse, 1],
    ['tryParse', TypeProto_tryParse, 1],
    ['bitLength', [TypeProto_bitLengthGetter]],
    ['elementByteLength', [TypeProto_elementByteLengthGetter]],
    ['byteLength', [TypeProto_byteLengthGetter]],
    ['alignment', [TypeProto_alignmentGetter]],
    ['family', [TypeProto_familyGetter]],
    ['min', [TypeProto_minGetter]],
    ['max', [TypeProto_maxGetter]],
    ['minPositive', [TypeProto_minPositiveGetter]],
    ['epsilon', [TypeProto_epsilonGetter]],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Type');
  realmRec.Intrinsics['%Type.prototype%'] = proto;
}
