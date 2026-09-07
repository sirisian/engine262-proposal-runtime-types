import {
  BooleanValue,
  JSStringValue,
  NullValue,
  ObjectValue,
  SymbolValue,
  UndefinedValue,
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { UTF16EncodeCodePoint } from '../static-semantics/all.mts';
import { Utf8Decode } from '../abstract-ops/utf8.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  Assert,
  Get,
  GetPrototypeFromConstructor,
  IsIntegralNumber,
  StringCreate,
  SymbolDescriptiveString,
  LengthOfArrayLike,
  ToNumber,
  ToObject,
  ToString,
  ToUint16,
  F, R,
  type ExoticObject,
  Realm,
  Throw,
  type CodePoint,
} from '#self';

export interface StringObject extends ExoticObject {
  readonly StringData: JSStringValue;
  Prototype: ObjectValue | NullValue;
  Extensible: BooleanValue;
}
export function isStringObject(o: Value): o is StringObject {
  return 'StringData' in o;
}
/** https://tc39.es/ecma262/#sec-string-constructor-string-value */
function* StringConstructor([value]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  let s;
  if (value === undefined) {
    s = Value('');
  } else {
    if (NewTarget === Value.undefined && value instanceof SymbolValue) {
      return X(SymbolDescriptiveString(value));
    }
    s = Q(yield* ToString(value));
  }
  if (NewTarget instanceof UndefinedValue) {
    return s;
  }
  return X(StringCreate(s, Q(yield* GetPrototypeFromConstructor(NewTarget, '%String.prototype%'))));
}

/** https://tc39.es/ecma262/#sec-string.fromcharcode */
function* String_fromCharCode(codeUnits: Arguments): ValueEvaluator {
  const length = codeUnits.length;
  const elements = [];
  let nextIndex = 0;
  while (nextIndex < length) {
    const next = codeUnits[nextIndex]!;
    const nextCU = Q(yield* ToUint16(next));
    elements.push(nextCU);
    nextIndex += 1;
  }
  const result = elements.reduce((previous, current) => previous + String.fromCharCode(R(current)), '');
  return Value(result);
}

/**
 * proposal-runtime-types: the string the given UTF-8 bytes encode.
 *
 * A `string` has no layout (#sec-layout-properties), so a string held in a
 * fixed-width record or a wire format is held as bytes, and this is the way
 * back. The argument is anything array-like of byte values, which is what lets a
 * `[N].<uint8>`, a `[].<uint8>` and a `Span.<uint8>` all reach it.
 *
 * STRICT. An ill-formed sequence is refused rather than replaced: a decoder that
 * substitutes U+FFFD turns a corrupt record into a plausible one, and this
 * proposal refuses elsewhere for the same reason it refuses a truncating
 * numeric conversion.
 *
 * Every byte given is decoded, including a zero. Trimming padding is a property
 * of a FORMAT and belongs to whatever overlays the bytes.
 */
function* String_fromUtf8([bytes = Value.undefined]: Arguments): ValueEvaluator {
  const source = Q(ToObject(bytes));
  const length = Q(yield* LengthOfArrayLike(source));
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const element = Q(yield* Get(source, Value(String(i))));
    const byte = R(Q(yield* ToNumber(element)));
    const n = Number(byte);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return Throw.TypeError('$1 is not a byte', element);
    }
    out.push(n);
  }
  const decoded = Utf8Decode(out);
  if (typeof decoded !== 'string') {
    return Throw.TypeError('the bytes are not well-formed UTF-8 ($1)', Value(decoded.failure));
  }
  return Value(decoded);
}

/** https://tc39.es/ecma262/#sec-string.fromcodepoint */
function* String_fromCodePoint(codePoints: Arguments) {
  // 1. Let result be the empty String.
  let result = '';
  // 2. For each element next of codePoints, do
  for (const next of codePoints.values()) {
    // a. Let nextCP be ? ToNumber(next).
    const nextCP = Q(yield* ToNumber(next));
    // b. If IsIntegralNumber(nextCP) is false, throw a RangeError exception.
    if (X(IsIntegralNumber(nextCP)) === Value.false) {
      return Throw.RangeError('Invalid code point $1', next);
    }
    // c. If ℝ(nextCP) < 0 or ℝ(nextCP) > 0x10FFFF, throw a RangeError exception.
    if (R(nextCP) < 0 || R(nextCP) > 0x10FFFF) {
      return Throw.RangeError('Invalid code point $1', nextCP);
    }
    // d. Set result to the string-concatenation of result and UTF16EncodeCodePoint(ℝ(nextCP)).
    result += UTF16EncodeCodePoint(R(nextCP) as CodePoint);
  }
  // 3. Assert: If codePoints is empty, then result is the empty String.
  Assert(!(codePoints.length === 0) || result.length === 0);
  // 4. Return result.
  return Value(result);
}

/** https://tc39.es/ecma262/#sec-string.raw */
function* String_raw([template = Value.undefined, ...substitutions]: Arguments): ValueEvaluator {
  const numberOfSubstitutions = substitutions.length;
  const cooked = Q(ToObject(template));
  const raw = Q(ToObject(Q(yield* Get(cooked, Value('raw')))));
  const literalSegments = Q(yield* LengthOfArrayLike(raw));
  if (literalSegments <= 0) {
    return Value('');
  }
  // Not sure why the spec uses a List, but this is really just a String.
  const stringElements = [];
  let nextIndex = 0;
  while (true) {
    const nextKey = X(ToString(F(nextIndex)));
    const nextSeg = Q(yield* ToString(Q(yield* Get(raw, nextKey))));
    stringElements.push(nextSeg.stringValue());
    if (nextIndex + 1 === literalSegments) {
      return Value(stringElements.join(''));
    }
    let next;
    if (nextIndex < numberOfSubstitutions) {
      next = substitutions[nextIndex];
    } else {
      next = Value('');
    }
    const nextSub = Q(yield* ToString(next!));
    stringElements.push(nextSub.stringValue());
    nextIndex += 1;
  }
}

export function bootstrapString(realmRec: Realm) {
  const stringConstructor = bootstrapConstructor(realmRec, StringConstructor, 'String', 1, realmRec.Intrinsics['%String.prototype%'], [
    ['fromCharCode', String_fromCharCode, 1],
    ['fromUtf8', String_fromUtf8, 1],
    ['fromCodePoint', String_fromCodePoint, 1],
    ['raw', String_raw, 1],
  ]);

  realmRec.Intrinsics['%String%'] = stringConstructor;
}
