import { Q } from '../completion.mts';
import { Value, JSStringValue, NumberValue, TypedNumberValue, type Arguments, type FunctionCallContext } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { isTypeObject } from '../type-system/intern.mts';
import { LayoutOf } from '../type-system/layout.mts';
import { IsOfType, fitsNumericType } from '../type-system/runtime.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { Realm, Throw, R, wellKnownSymbols } from '#self';

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
  let value: number;
  if (isInteger) {
    value = parseIntegerLiteral(cleaned, base);
  } else {
    value = parseFloatLiteral(cleaned);
  }
  if (Number.isNaN(value)) {
    return Throw.SyntaxError('$1 is not a valid literal', S);
  }
  if (!fitsNumericType(value, t.Name, t.Arguments)) {
    return Throw.RangeError('$1 is out of range for the type', S);
  }
  return new TypedNumberValue(value, t);
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

export function bootstrapTypePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.hasInstance, TypeProto_hasInstance, 1],
    ['parse', TypeProto_parse, 1],
    ['bitLength', [TypeProto_bitLengthGetter]],
    ['byteLength', [TypeProto_byteLengthGetter]],
    ['alignment', [TypeProto_alignmentGetter]],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Type');
  realmRec.Intrinsics['%Type.prototype%'] = proto;
}
