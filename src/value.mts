import { type GCMarker } from './host-defined/engine.mts';
import { LayoutOf } from './type-system/layout.mts';
import { PlacementBackingOf, ReadPlacedField, WritePlacedField } from './abstract-ops/placement.mts';
import { SoAStorageOf, SoAGather, SoAScatter, SoAElementBackingOf, ReadSoAField, WriteSoAField } from './intrinsics/SoA.mts';
import { ArrayViewBackingOf, ArrayViewLength, ReadArrayViewElement, WriteArrayViewElement } from './abstract-ops/array-view.mts';
import type { TypeRecord } from './type-system/records.mts';
import {
  Q, X, type ValueEvaluator, type PlainCompletion,
} from './completion.mts';
import { OutOfRange, callable } from './utils/language.mts';
import { PropertyKeyMap } from './utils/container.mts';
import type { PrivateElementRecord } from './runtime-semantics/MethodDefinitionEvaluation.mts';
import type { PlainEvaluator } from './evaluator.mts';
import {
  OrdinaryDefineOwnProperty,
  OrdinaryDelete,
  OrdinaryGet,
  OrdinaryGetOwnProperty,
  OrdinaryGetPrototypeOf,
  OrdinaryHasProperty,
  OrdinaryIsExtensible,
  OrdinaryOwnPropertyKeys,
  OrdinaryPreventExtensions,
  OrdinarySet,
  OrdinarySetPrototypeOf,
  ToInt32,
  ToUint32,
  Z,
  F, R, type OrdinaryObject, type FunctionObject,
  type BuiltinFunctionObject,
  type ECMAScriptFunctionObject,
  type DefaultConstructorBuiltinFunction, EnvironmentRecord,
  Throw,
  RequireType,
  isArrayIndex,
  surroundingAgent,
} from '#self';

/** #sec-array-defaults-and-stores: the type a typed array's `length` reads at. */
const ARRAY_LENGTH_TYPE = Object.freeze({ Kind: 'primitive', Name: 'uint', Arguments: [32] }) as unknown as never;

let createStringValue: (value: string) => JSStringValue; // set by static block in StringValue for privileged access to constructor
// proposal-runtime-types (Capability B): privileged factory for a String value carrying an inferred Type Record, set by the StringValue static block.
let createTypedStringValue: (value: string, typeRecord: unknown) => JSStringValue;
let createNumberValue: (value: number) => NumberValue; // set by static block in NumberValue for privileged access to constructor
let createBigIntValue: (value: bigint) => BigIntValue; // set by static block in BigIntValue for privileged access to constructor

abstract class BaseValue {
  static declare readonly null: NullValue; // defined in static block of NullValue

  static declare readonly undefined: UndefinedValue; // defined in static block of UndefinedValue

  static declare readonly true: BooleanValue<true>; // defined in static block of BooleanValue

  static declare readonly false: BooleanValue<false>; // defined in static block of BooleanValue

  abstract type: Value['type']; // ensures new `Value` subtypes must be added to `Value` union

  declare static [Symbol.hasInstance]: (value: unknown) => value is Value; // no need to actually declare it.
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type Value =
  | UndefinedValue
  | NullValue
  | BooleanValue
  | JSStringValue
  | SymbolValue
  | NumberValue
  // proposal-runtime-types
  | TypedNumberValue
  // proposal-runtime-types #sec-vector-types: a vector is a value type, a
  // sibling of TypedNumberValue carrying N lanes rather than one.
  | VectorValue
  | ReferenceValue
  | BigIntValue
  | ObjectValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export const Value = (() => {
  // NOTE: Using IIFE so that the class does not conflict with the type of the same name
  @callable((_target, _thisArg, [value]) => {
    if (value === null) {
      return Value.null;
    } else if (value === undefined) {
      return Value.undefined;
    } else if (value === true) {
      return Value.true;
    } else if (value === false) {
      return Value.false;
    }
    switch (typeof value) {
      case 'string':
        return createStringValue(value);
      case 'number':
        return createNumberValue(value);
      case 'bigint':
        return createBigIntValue(value);
      default:
        throw OutOfRange.nonExhaustive(value);
    }
  })
  abstract class Value extends BaseValue {
  }
  return Value;
})() as typeof BaseValue & {
  <T extends null | undefined | boolean | string | number | bigint>(value: T):
    T extends null ? NullValue :
    T extends undefined ? UndefinedValue :
    T extends boolean ? BooleanValue<T> :
    T extends string ? JSStringValue :
    T extends number ? NumberValue :
    T extends bigint ? BigIntValue :
    never;
};

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type PropertyKeyValue =
  | JSStringValue
  | SymbolValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type PrimitiveValue =
  | UndefinedValue
  | NullValue
  | BooleanValue
  | JSStringValue
  | SymbolValue
  | NumberValue
  // proposal-runtime-types: a numeric value type is a primitive value, a
  // sibling of NumberValue; a reference value is a non-object leaf that decays
  // to its referent wherever a primitive is consumed.
  | TypedNumberValue
  // proposal-runtime-types #sec-vector-types: a vector is a value type, a
  // sibling of TypedNumberValue carrying N lanes rather than one.
  | VectorValue
  | ReferenceValue
  | BigIntValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export const PrimitiveValue = (() => {
  type PrimValue = PrimitiveValue;
  return (() => {
    // NOTE: Using nested IIFE so that the class does not conflict with the type of the same name
    // NOTE: Only using IIFE because TypeScript errors when `abstract` is used on class expressions
    abstract class PrimitiveValue extends Value {
      declare static [Symbol.hasInstance]: (value: unknown) => value is PrimValue;
    }
    return PrimitiveValue;
  })();
})();

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-undefined-type */
export class UndefinedValue extends PrimitiveValue {
  declare readonly type: 'Undefined'; // defined on prototype by static block

  declare readonly value: undefined; // defined on prototype by static block

  private constructor() { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super();
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Undefined' });
    Object.defineProperty(this.prototype, 'value', { value: undefined });
    Object.defineProperty(Value, 'undefined', { value: new this() });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is UndefinedValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-null-type */
export class NullValue extends PrimitiveValue {
  declare readonly type: 'Null'; // defined on prototype by static block

  declare readonly value: null; // defined on prototype by static block

  private constructor() { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super();
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Null' });
    Object.defineProperty(this.prototype, 'value', { value: null });
    Object.defineProperty(Value, 'null', { value: new this() });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is NullValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-boolean-type */
export class BooleanValue<T extends boolean = boolean> extends PrimitiveValue {
  declare readonly type: 'Boolean'; // defined on prototype by static block

  readonly value: T;

  private constructor(value: T) {
    super();
    this.value = value;
  }

  booleanValue() {
    return this.value;
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Boolean { ${this.value} }`;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Boolean' });
    Object.defineProperty(Value, 'true', { value: new this(true) });
    Object.defineProperty(Value, 'false', { value: new this(false) });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is BooleanValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-string-type */
export class JSStringValue extends PrimitiveValue {
  declare readonly type: 'String'; // defined on prototype by static block

  readonly value: string;

  // proposal-runtime-types (Capability B): protected (was private) so the
  // transparent TypedStringValue subclass can extend it. External construction is
  // still blocked; strings are created through the Value factory / createStringValue.
  protected constructor(value: string) {
    super();
    this.value = value;
  }

  stringValue() {
    return this.value;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'String' });
    createStringValue = (value) => new this(value);
    createTypedStringValue = (value, typeRecord) => {
      const s = new this(value) as TypedStringValue;
      Object.defineProperty(s, 'TypeRecord', { value: typeRecord, enumerable: false });
      Object.setPrototypeOf(s, TypedStringValue.prototype);
      return s;
    };
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is JSStringValue;
}

/**
 * proposal-runtime-types (Capability B): a String value that additionally carries
 * the interned literal/refined Type Record inferred for it (for example the
 * literal type `'a-b-c'` a generic call's return-type transform produces). It is a
 * transparent subclass of JSStringValue, so it satisfies every `instanceof
 * JSStringValue` check and behaves as its underlying string in all operations;
 * only RuntimeTypeOf reads the carried TypeRecord in preference to the widened
 * `string`. Constructed only at typed boundaries (a literal-typed conversion or a
 * generic call's inferred return type) via createTypedStringValue.
 */
export class TypedStringValue extends JSStringValue {
  declare readonly type: 'String';

  declare readonly TypeRecord: unknown;

  declare static [Symbol.hasInstance]: (value: unknown) => value is TypedStringValue;
}

/**
 * proposal-runtime-types (Capability B): construct a String value carrying the
 * given interned literal/refined Type Record. Used at typed boundaries only.
 */
export function TypedString(value: string, typeRecord: unknown): JSStringValue {
  return createTypedStringValue(value, typeRecord);
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-symbol-type */
export class SymbolValue extends PrimitiveValue {
  declare readonly type: 'Symbol'; // defined on prototype by static block

  readonly Description: JSStringValue | UndefinedValue;

  constructor(Description: JSStringValue | UndefinedValue) {
    super();
    this.Description = Description;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Symbol' });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is SymbolValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-symbol-type */
export const wellKnownSymbols = {
  asyncIterator: new SymbolValue(Value('Symbol.asyncIterator')),
  /**
   * proposal-runtime-types (pattern matching, `sec-composite-custommatcher`).
   * The pattern-matching proposal's protocol symbol, needed here so that
   * `Composite[%Symbol.customMatcher%]` can exist - without it the bare pattern
   * `when Composite:` would compare the subject against the FUNCTION by
   * SameValue, "a test nothing sensible ever passes".
   */
  customMatcher: new SymbolValue(Value('Symbol.customMatcher')),
  dispose: new SymbolValue(Value('Symbol.dispose')),
  hasInstance: new SymbolValue(Value('Symbol.hasInstance')),
  isConcatSpreadable: new SymbolValue(Value('Symbol.isConcatSpreadable')),
  iterator: new SymbolValue(Value('Symbol.iterator')),
  match: new SymbolValue(Value('Symbol.match')),
  matchAll: new SymbolValue(Value('Symbol.matchAll')),
  replace: new SymbolValue(Value('Symbol.replace')),
  search: new SymbolValue(Value('Symbol.search')),
  species: new SymbolValue(Value('Symbol.species')),
  split: new SymbolValue(Value('Symbol.split')),
  toPrimitive: new SymbolValue(Value('Symbol.toPrimitive')),
  toStringTag: new SymbolValue(Value('Symbol.toStringTag')),
  unscopables: new SymbolValue(Value('Symbol.unscopables')),
} as const;
Object.setPrototypeOf(wellKnownSymbols, null);
Object.freeze(wellKnownSymbols);

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-number-type */
export class NumberValue extends PrimitiveValue {
  declare readonly type: 'Number'; // defined on prototype by static block

  readonly value: number;

  private constructor(value: number) {
    super();
    this.value = value;
  }

  numberValue() {
    return this.value;
  }

  isNaN() {
    return Number.isNaN(this.value);
  }

  isInfinity() {
    return !Number.isFinite(this.value) && !this.isNaN();
  }

  isFinite() {
    return Number.isFinite(this.value);
  }

  isIntegralNumber() {
    return Number.isInteger(this.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-unaryMinus */
  static unaryMinus(x: NumberValue) {
    if (x.isNaN()) {
      return F(NaN);
    }
    return F(-x.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseNOT */
  static bitwiseNOT(x: NumberValue) {
    // 1. Let oldValue be ! ToInt32(x).
    const oldValue = X(ToInt32(x));
    // 2. Return the result of applying bitwise complement to oldValue. The result is a signed 32-bit integer.
    return F(~R(oldValue));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-exponentiate */
  static exponentiate(base: NumberValue, exponent: NumberValue) {
    return F(base.value ** exponent.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-multiply */
  static multiply(x: NumberValue, y: NumberValue) {
    return F(x.value * y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-divide */
  static divide(x: NumberValue, y: NumberValue) {
    return F(x.value / y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-remainder */
  static remainder(n: NumberValue, d: NumberValue) {
    return F(n.value % d.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-add */
  static add(x: NumberValue, y: NumberValue) {
    return F(x.value + y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-subtract */
  static subtract(x: NumberValue, y: NumberValue) {
    return F(x.value - y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-leftShift */
  static leftShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of left shifting lnum by shiftCount bits. The result is a signed 32-bit integer.
    return F(R(lnum) << shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-signedRightShift */
  static signedRightShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of performing a sign-extending right shift of lnum by shiftCount bits.
    //    The most significant bit is propagated. The result is a signed 32-bit integer.
    return F(R(lnum) >> shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-unsignedRightShift */
  static unsignedRightShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of performing a zero-filling right shift of lnum by shiftCount bits.
    //    Vacated bits are filled with zero. The result is an unsigned 32-bit integer.
    return F(R(lnum) >>> shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-lessThan */
  static lessThan(x: NumberValue, y: NumberValue) {
    if (x.isNaN()) {
      return Value.undefined;
    }
    if (y.isNaN()) {
      return Value.undefined;
    }
    // If nx and ny are the same Number value, return false.
    // If nx is +0 and ny is -0, return false.
    // If nx is -0 and ny is +0, return false.
    if (R(x) === R(y)) {
      return Value.false;
    }
    if (R(x) === +Infinity) {
      return Value.false;
    }
    if (R(y) === +Infinity) {
      return Value.true;
    }
    if (R(y) === -Infinity) {
      return Value.false;
    }
    if (R(x) === -Infinity) {
      return Value.true;
    }
    return R(x) < R(y) ? Value.true : Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-equal */
  static equal(x: NumberValue, y: NumberValue) {
    if (x.isNaN()) {
      return Value.false;
    }
    if (y.isNaN()) {
      return Value.false;
    }
    const xVal = R(x);
    const yVal = R(y);
    if (xVal === yVal) {
      return Value.true;
    }
    if (Object.is(xVal, 0) && Object.is(yVal, -0)) {
      return Value.true;
    }
    if (Object.is(xVal, -0) && Object.is(yVal, 0)) {
      return Value.true;
    }
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-sameValue */
  static sameValue(x: NumberValue, y: NumberValue) {
    if (x.isNaN() && y.isNaN()) {
      return Value.true;
    }
    const xVal = x.value;
    const yVal = y.value;
    if (Object.is(xVal, 0) && Object.is(yVal, -0)) {
      return Value.false;
    }
    if (Object.is(xVal, -0) && Object.is(yVal, 0)) {
      return Value.false;
    }
    if (xVal === yVal) {
      return Value.true;
    }
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-sameValueZero */
  static sameValueZero(x: NumberValue, y: NumberValue) {
    if (x.isNaN() && y.isNaN()) return Value.true;
    if (Object.is(x.value, 0) && Object.is(y.value, -0)) return Value.true;
    if (Object.is(x.value, -0) && Object.is(y.value, 0)) return Value.true;
    if (x.value === y.value) return Value.true;
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseAND */
  static bitwiseAND(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(&, x, y).
    return NumberBitwiseOp('&', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseXOR */
  static bitwiseXOR(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(^, x, y).
    return NumberBitwiseOp('^', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseOR */
  static bitwiseOR(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(|, x, y).
    return NumberBitwiseOp('|', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-tostring */
  static override toString(x: NumberValue, radix: number): JSStringValue {
    if (x.isNaN()) return Value('NaN');
    if (Object.is(x.value, -0) || Object.is(x.value, 0)) return Value('0');
    if (x.value < 0) return Value(`-${NumberValue.toString(F(-x.value), radix).stringValue()}`);
    if (x.isInfinity()) return Value('Infinity');
    return Value(`${x.value.toString(radix)}`);
  }

  static readonly unit = new NumberValue(1);

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Number' });
    createNumberValue = (value) => new NumberValue(value);
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is NumberValue;
}

/**
 * proposal-runtime-types R6 (Option A) #sec-value-types: a numeric value type's
 * value. It is a sibling of NumberValue under PrimitiveValue, not a subclass, so
 * a typed number is not an instanceof NumberValue. Membership is decided by the
 * carried Type Record, a plain Number is not a member of any numeric value type,
 * and every numeric-reading site unwraps a typed number explicitly.
 */
/**
 * proposal-runtime-types #sec-vector-types: a vector value.
 *
 * "For a value type T that is an integer, binary floating-point, or vector
 * type, and a positive integer N, `vector.<T, N>` is a value type whose values
 * are the sequences of N values of T." So a vector carries its lanes and the
 * Type Record that says what they are - the same shape TypedNumberValue takes
 * for one lane, which is the model this follows.
 */
export class VectorValue extends PrimitiveValue {
  declare readonly type: 'Vector'; // defined on prototype by the static block

  readonly lanes: readonly Value[];

  readonly TypeRecord: unknown;

  constructor(lanes: readonly Value[], typeRecord: unknown) {
    super();
    this.lanes = lanes;
    this.TypeRecord = typeRecord;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Vector' });
  }
}

export class TypedNumberValue extends PrimitiveValue {
  declare readonly type: 'TypedNumber'; // defined on prototype by static block

  readonly value: number;

  readonly TypeRecord: unknown;

  // proposal-runtime-types R6: unlike the other value classes (which use a
  // private constructor plus a module-level factory for nominal typing), this
  // constructor is public. The class is already nominally distinct via its
  // distinct type tag and TypeRecord field, and public construction keeps the
  // feature-gated call sites (arithmetic, conversion, update) simple.
  constructor(value: number, typeRecord: unknown) {
    super();
    this.value = value;
    this.TypeRecord = typeRecord;
  }

  numberValue() {
    return this.value;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'TypedNumber' });
  }
}

/** https://tc39.es/ecma262/#sec-numberbitwiseop */
function NumberBitwiseOp(op: '&' | '|' | '^', x: NumberValue, y: NumberValue) {
  // 1. Let lnum be ! ToInt32(x).
  const lnum = X(ToInt32(x));
  // 2. Let rnum be ! ToUint32(y).
  const rnum = X(ToUint32(y));
  // 3. Return the result of applying the bitwise operator op to lnum and rnum. The result is a signed 32-bit integer.
  switch (op) {
    case '&':
      return F(R(lnum) & R(rnum));
    case '|':
      return F(R(lnum) | R(rnum));
    case '^':
      return F(R(lnum) ^ R(rnum));
    default:
      throw OutOfRange.exhaustive(op);
  }
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-bigint-type */
export class BigIntValue extends PrimitiveValue {
  declare readonly type: 'BigInt'; // defined on prototype by static block

  readonly value: bigint;

  private constructor(value: bigint) {
    super();
    this.value = value;
  }

  bigintValue() {
    return this.value;
  }

  isNaN() {
    return false;
  }

  isFinite() {
    return true;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-unaryMinus */
  static unaryMinus(x: BigIntValue) {
    if (R(x) === 0n) {
      return Z(0n);
    }
    return Z(-R(x));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseNOT */
  static bitwiseNOT(x: BigIntValue) {
    return Z(-R(x) - 1n);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-exponentiate */
  static exponentiate(base: BigIntValue, exponent: BigIntValue) {
    // 1. If exponent < 0n, throw a RangeError exception.
    if (R(exponent) < 0n) {
      return Throw.RangeError('Exponent of bigint must be positive');
    }
    // 2. If base is 0n and exponent is 0n, return 1n.
    if (R(base) === 0n && R(exponent) === 0n) {
      return Z(1n);
    }
    // 3. Return the BigInt value that represents the mathematical value of base raised to the power exponent.
    return Z(R(base) ** R(exponent));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-multiply */
  static multiply(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) * R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-divide */
  static divide(x: BigIntValue, y: BigIntValue) {
    // 1. If y is 0n, throw a RangeError exception.
    if (R(y) === 0n) {
      return Throw.RangeError('Cannot divide by zero');
    }
    // 2. Let quotient be the mathematical value of x divided by y.
    const quotient = R(x) / R(y);
    // 3. Return the BigInt value that represents quotient rounded towards 0 to the next integral value.
    return Z(quotient);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-remainder */
  static remainder(n: BigIntValue, d: BigIntValue) {
    // 1. If d is 0n, throw a RangeError exception.
    if (R(d) === 0n) {
      return Throw.RangeError('Cannot divide by zero');
    }
    // 2. If n is 0n, return 0n.
    if (R(n) === 0n) {
      return Z(0n);
    }
    // 3. Let r be the BigInt defined by the mathematical relation r = n - (d × q)
    //   where q is a BigInt that is negative only if n/d is negative and positive
    //   only if n/d is positive, and whose magnitude is as large as possible without
    //   exceeding the magnitude of the true mathematical quotient of n and d.
    const r = Z(R(n) % R(d));
    // 4. Return r.
    return r;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-add */
  static add(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) + R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-subtract */
  static subtract(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) - R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-leftShift */
  static leftShift(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) << R(y)); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-signedRightShift */
  static signedRightShift(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigInt::leftShift(x, -y).
    return BigIntValue.leftShift(x, Z(-R(y)));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-unsignedRightShift */
  static unsignedRightShift(_x: BigIntValue, _y: BigIntValue) {
    return Throw.TypeError('BigInt has no unsigned right shift, use >> instead');
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-lessThan */
  static lessThan(x: BigIntValue, y: BigIntValue) {
    return R(x) < R(y) ? Value.true : Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-equal */
  static equal(x: BigIntValue, y: BigIntValue) {
    // Return true if x and y have the same mathematical integer value and false otherwise.
    return R(x) === R(y) ? Value.true : Value.false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-sameValue */
  static sameValue(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigInt::equal(x, y).
    return BigIntValue.equal(x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-sameValueZero */
  static sameValueZero(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigInt::equal(x, y).
    return BigIntValue.equal(x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseAND */
  static bitwiseAND(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(&, x, y).
    return BigIntBitwiseOp('&', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseXOR */
  static bitwiseXOR(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(^, x, y).
    return BigIntBitwiseOp('^', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseOR */
  static bitwiseOR(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(|, x, y);
    return BigIntBitwiseOp('|', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-tostring */
  static override toString(x: BigIntValue, radix: number): JSStringValue {
    // 1. If x is less than zero, return the string-concatenation of the String "-" and ! BigInt::toString(-x).
    if (R(x) < 0n) {
      const str = X(BigIntValue.toString(Z(-R(x)), radix)).stringValue();
      return Value(`-${str}`);
    }
    // 2. Return the String value consisting of the code units of the digits of the decimal representation of x.
    return Value(`${R(x).toString(radix)}`);
  }

  static readonly unit = new BigIntValue(1n);

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'BigInt' });
    createBigIntValue = (value) => new BigIntValue(value);
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is BigIntValue;
}

/** https://tc39.es/ecma262/#sec-bigintbitwiseop */
function BigIntBitwiseOp(op: '&' | '|' | '^', x: BigIntValue, y: BigIntValue) {
  // TODO: figure out why this doesn't work, probably the modulo.
  /*
  // 1. Assert: op is "&", "|", or "^".
  Assert(['&', '|', '^'].includes(op));
  // 2. Let result be 0n.
  let result = 0n;
  // 3. Let shift be 0.
  let shift = 0n;
  // 4. Repeat, until (x = 0 or x = -1) and (y = 0 or y = -1),
  while (!((x === 0n || x === -1n) && (y === 0n || y === -1n))) {
    // a. Let xDigit be x modulo 2.
    const xDigit = x % 2n;
    // b. Let yDigit be y modulo 2.
    const yDigit = y % 2n;
    // c. If op is "&", set result to result + 2^shift × BinaryAnd(xDigit, yDigit).
    if (op === '&') {
      result += (2n ** shift) * BinaryAnd(xDigit, yDigit);
    } else if (op === '|') {
      // d. Else if op is "|", set result to result + 2shift × BinaryOr(xDigit, yDigit).
      result += (2n ** shift) * BinaryXor(xDigit, yDigit);
    } else {
      // i. Assert: op is "^".
      Assert(op === '^');
      // ii. Set result to result + 2^shift × BinaryXor(xDigit, yDigit).
      result += (2n ** shift) * BinaryXor(xDigit, yDigit);
    }
    // f. Set shift to shift + 1.
    shift += 1n;
    // g. Set x to (x - xDigit) / 2.
    x = (x - xDigit) / 2n;
    // h. Set y to (y - yDigit) / 2.
    y = (y - yDigit) / 2n;
  }
  let tmp;
  // 5. If op is "&", let tmp be BinaryAnd(x modulo 2, y modulo 2).
  if (op === '&') {
    tmp = BinaryAnd(x % 2n, y % 2n);
  } else if (op === '|') {
    // 6. Else if op is "|", let tmp be BinaryOr(x modulo 2, y modulo 2).
    tmp = BinaryOr(x % 2n, y % 2n);
  } else {
    // a. Assert: op is "^".
    Assert(op === '^');
    // b. Let tmp be BinaryXor(x modulo 2, y modulo 2).
    tmp = BinaryXor(x % 2n, y % 2n);
  }
  // 8. If tmp ≠ 0, then
  if (tmp !== 0n) {
    // a. Set result to result - 2^shift. NOTE: This extends the sign.
    result -= 2n ** shift;
  }
  // 9. Return result.
  return Z(result);
 */
  switch (op) {
    case '&':
      return Z(R(x) & R(y));
    case '|':
      return Z(R(x) | R(y));
    case '^':
      return Z(R(x) ^ R(y));
    default:
      throw OutOfRange.exhaustive(op);
  }
}

export interface ObjectInternalMethods<Self> {
  GetPrototypeOf(this: Self): ValueEvaluator<ObjectValue | NullValue>;
  SetPrototypeOf(this: Self, V: ObjectValue | NullValue): ValueEvaluator<BooleanValue>;
  IsExtensible(this: Self): ValueEvaluator<BooleanValue>;
  PreventExtensions(this: Self): ValueEvaluator<BooleanValue>;
  GetOwnProperty(this: Self, P: PropertyKeyValue): PlainEvaluator<Descriptor | UndefinedValue>;
  DefineOwnProperty(this: Self, P: PropertyKeyValue, Desc: Descriptor): ValueEvaluator<BooleanValue>;
  HasProperty(this: Self, P: PropertyKeyValue): ValueEvaluator<BooleanValue>;
  Get(this: Self, P: PropertyKeyValue, Receiver: Value): ValueEvaluator;
  Set(this: Self, P: PropertyKeyValue, V: Value, Receiver: Value): ValueEvaluator<BooleanValue>;
  Delete(this: Self, P: PropertyKeyValue): ValueEvaluator<BooleanValue>;
  OwnPropertyKeys(this: Self): PlainEvaluator<PropertyKeyValue[]>;
  Call?(this: Self, thisArg: Value, args: Arguments): ValueEvaluator;
  Construct?(this: Self, args: Arguments, newTarget: FunctionObject | UndefinedValue): ValueEvaluator<ObjectValue>;
}

type ObjectSlotReturn = {
  [key in keyof ObjectInternalMethods<ObjectValue>]: ReturnType<NonNullable<ObjectInternalMethods<ObjectValue>[key]>>
};
/** https://tc39.es/ecma262/#sec-object-type */
export class ObjectValue extends Value implements ObjectInternalMethods<ObjectValue> {
  declare readonly type: 'Object'; // defined on prototype by static block

  readonly properties: PropertyKeyMap<Descriptor>;

  readonly internalSlotsList: readonly string[];

  readonly PrivateElements: PrivateElementRecord[];

  // https://tc39.es/proposal-pattern-matching/#sec-object-internal-methods-and-internal-slots
  readonly ConstructedBy: (ECMAScriptFunctionObject | DefaultConstructorBuiltinFunction)[];

  constructor(internalSlotsList: readonly string[]) {
    super();

    this.PrivateElements = [];
    this.ConstructedBy = [];
    this.properties = new PropertyKeyMap();
    this.internalSlotsList = internalSlotsList;
    surroundingAgent.debugger_markObjectCreated(this);
  }

  // UNSAFE casts below. Methods below are expected to be rewritten when the object is not an OrdinaryObject. (an example is ArgumentExoticObject)
  // If those methods aren't rewritten, it is an error.
  // eslint-disable-next-line require-yield
  * GetPrototypeOf(): ObjectSlotReturn['GetPrototypeOf'] {
    return OrdinaryGetPrototypeOf(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * SetPrototypeOf(V: ObjectValue | NullValue): ObjectSlotReturn['SetPrototypeOf'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return OrdinarySetPrototypeOf(this as unknown as OrdinaryObject, V);
  }

  // eslint-disable-next-line require-yield
  * IsExtensible(): ObjectSlotReturn['IsExtensible'] {
    return OrdinaryIsExtensible(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * PreventExtensions(): ObjectSlotReturn['PreventExtensions'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return OrdinaryPreventExtensions(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * GetOwnProperty(P: PropertyKeyValue): ObjectSlotReturn['GetOwnProperty'] {
    return OrdinaryGetOwnProperty(this as unknown as OrdinaryObject, P);
  }

  * DefineOwnProperty(P: PropertyKeyValue, Desc: Descriptor): ObjectSlotReturn['DefineOwnProperty'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return yield* OrdinaryDefineOwnProperty(this as unknown as OrdinaryObject, P, Desc);
  }

  * HasProperty(P: PropertyKeyValue): ObjectSlotReturn['HasProperty'] {
    return yield* OrdinaryHasProperty(this as unknown as OrdinaryObject, P);
  }

  * Get(P: PropertyKeyValue, Receiver: Value): ObjectSlotReturn['Get'] {
    const result = Q(yield* OrdinaryGet(this as unknown as OrdinaryObject, P, Receiver));
    // proposal-runtime-types (spec sec-array-defaults-and-stores): "`length` is
    // a `uint32`" - for a TYPED array, whose element type this object carries.
    // The STORED length stays a plain Number, because the array exotic object's
    // own [[DefineOwnProperty]] asserts that it is one and ArraySetLength
    // computes with it; what the clause constrains is the value a read yields,
    // so the typing is applied at the read (F54).
    if (surroundingAgent.feature('runtime-types')
        && (this as { TypedElement?: unknown }).TypedElement !== undefined
        && P instanceof JSStringValue && P.stringValue() === 'length'
        && result instanceof NumberValue) {
      return new TypedNumberValue(R(result) as number, ARRAY_LENGTH_TYPE);
    }
    // proposal-runtime-types (README, "Views"): an element read through an array
    // view is a decode at the view's offset plus index times stride, and
    // `length` derives from the buffer for a length-tracking view.
    if (surroundingAgent.feature('runtime-types') && P instanceof JSStringValue) {
      const viewBacking = ArrayViewBackingOf(this as unknown as object);
      if (viewBacking !== undefined) {
        if (P.stringValue() === 'length') {
          return Value(ArrayViewLength(viewBacking));
        }
        const index = Number(P.stringValue());
        if (String(index) === P.stringValue()) {
          return Q(yield* ReadArrayViewElement(viewBacking, index));
        }
      }
    }
    // proposal-runtime-types soa.md: a field read through a `ref` into an SoA is
    // "an indexed load from a column whose base offset is known at compile
    // time". The reference names a column set and an index, so the read is
    // computed rather than looked up - and it is deliberately NOT what `s[i]`
    // gives, which is a copy.
    if (surroundingAgent.feature('runtime-types') && P instanceof JSStringValue) {
      const elementBacking = SoAElementBackingOf(this as unknown as object);
      if (elementBacking !== undefined) {
        return Q(yield* ReadSoAField(elementBacking, P.stringValue()));
      }
    }
    // proposal-runtime-types soa.md: `s[i]` GATHERS an element from the columns.
    // An SoA is an ordinary object with column storage rather than an exotic,
    // so the index is intercepted here for the same reason a placed field is:
    // the storage is not a property table and a read has to be computed.
    if (surroundingAgent.feature('runtime-types') && P instanceof JSStringValue) {
      const soa = SoAStorageOf(this as unknown as object);
      if (soa !== undefined) {
        const index = Number(P.stringValue());
        if (String(index) === P.stringValue()) {
          return Q(yield* SoAGather(soa, index));
        }
      }
    }
    // proposal-runtime-types, the placement forms: a placed instance's fields
    // ARE the buffer's bytes, so a read is a decode at the field's laid-out
    // position rather than a property lookup. Without this the constructor's
    // values would be written into the buffer once and read back from stale
    // properties, and the two would diverge the moment anything else wrote to
    // the buffer - which is precisely what a placement is for.
    if (surroundingAgent.feature('runtime-types') && P instanceof JSStringValue) {
      const backing = PlacementBackingOf(this as unknown as object);
      if (backing !== undefined) {
        const declared = (this as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> })
          .TypedProperties?.get(P.stringValue());
        if (declared) {
          return Q(yield* ReadPlacedField(backing, P.stringValue(), declared.TypeRecord));
        }
      }
    }
    // proposal-runtime-types #sec-layout-properties, the table's dynamic-array
    // row: "No as a type. An instance has a `byteLength`, its length times its
    // element's." So this is a property of the INSTANCE, where the length is
    // known, rather than of the type, which has no extent - which is why it is
    // read here and not from a Type Object's own properties.
    if (surroundingAgent.feature('runtime-types')
        && P instanceof JSStringValue && P.stringValue() === 'byteLength'
        && result === Value.undefined) {
      const element = (this as { TypedElement?: TypeRecord }).TypedElement;
      if (element !== undefined) {
        const elementLayout = LayoutOf(element);
        if (elementLayout) {
          const lengthValue = Q(yield* OrdinaryGet(this as unknown as OrdinaryObject, Value('length'), Receiver));
          const length = lengthValue instanceof NumberValue ? R(lengthValue) as number : 0;
          return Value(length * elementLayout.byteLength);
        }
      }
    }
    return result;
  }

  * Set(P: PropertyKeyValue, V: Value, Receiver: Value): ObjectSlotReturn['Set'] {
    // TODO:
    Q(surroundingAgent.debugger_tryTouchDuringPreview(Receiver as ObjectValue));
    // proposal-runtime-types (spec sec-typed-classes): a write to a `readonly`
    // field is a TypeError unless the function running is the constructor that
    // declares it. The field's declaring constructor is recorded on the instance
    // when the field is initialized; a write from a method the constructor calls,
    // a subclass, a reference, or reflection finds a different running function
    // and is rejected. The check is skipped for the vast majority of objects,
    // which carry no readonly fields.
    if (surroundingAgent.feature('runtime-types')) {
      const readonlyFields = (Receiver as { ReadonlyFields?: Map<unknown, unknown> }).ReadonlyFields;
      if (readonlyFields !== undefined) {
        const fieldKey = P instanceof JSStringValue ? P.stringValue() : P;
        const declaringConstructor = readonlyFields.get(fieldKey);
        if (declaringConstructor !== undefined
            && surroundingAgent.executionContextStack.at(-1)?.Function !== declaringConstructor) {
          return Throw.TypeError('$1 is a readonly field and can only be assigned in the declaring class constructor', P);
        }
      }
      // proposal-runtime-types (spec sec-object-types-semantics): a write to a
      // typed own property is checked against its declared type, the same
      // RequireType a typed field's write performs. The declared type was recorded
      // on the object when the property was defined; objects with no typed own
      // property (the vast majority) skip this.
      // An element store on an array carrying an element type: the same
      // boundary and the same operation as a typed property, keyed on the
      // array rather than on a property name.
      const elementType = (Receiver as { TypedElement?: unknown }).TypedElement;
      if (elementType !== undefined && isArrayIndex(P)) {
        V = Q(yield* RequireType(V, elementType as never));
        // proposal-runtime-types #sec-reference-liveness: a store past the
        // current capacity grows the backing allocation, and growth relocates
        // it. The generation is bumped so that a borrow taken before the growth
        // is invalidated at its next use, which is what a packed backing store
        // requires and what a program must not be able to depend on the absence
        // of.
        const typed = Receiver as { TypedCapacity?: number, TypedGeneration?: number, TypedExtent?: number };
        const index = Number((P as JSStringValue).stringValue());
        // proposal-runtime-types #sec-array-and-tuple-types: a FIXED extent is
        // part of the type and does not move. A store past the end would grow
        // the array, and the extent is a compile-time constant that the layout
        // rules and the array views both compute from - `byteElementLength`
        // defaults from it and a view's size check is stated in terms of it -
        // so an extent a store could change is not a constant at all.
        if (typed.TypedExtent !== undefined && index >= typed.TypedExtent) {
          return Throw.TypeError('a fixed-extent array cannot be grown');
        }
        const capacity = typed.TypedCapacity ?? 0;
        if (index >= capacity) {
          typed.TypedCapacity = Math.max(index + 1, capacity * 2, 4);
          typed.TypedGeneration = (typed.TypedGeneration ?? 0) + 1;
        }
      }
      const viewBacking = ArrayViewBackingOf(Receiver as unknown as object);
      if (viewBacking !== undefined && P instanceof JSStringValue) {
        const index = Number(P.stringValue());
        if (String(index) === P.stringValue()) {
          Q(yield* WriteArrayViewElement(viewBacking, index, V));
          return Value.true;
        }
      }
      const elementBacking = SoAElementBackingOf(Receiver as unknown as object);
      if (elementBacking !== undefined && P instanceof JSStringValue) {
        // A field write through a reference is one indexed store into that
        // field's column, and the store check runs first as it does anywhere.
        Q(yield* WriteSoAField(elementBacking, P.stringValue(), V));
        return Value.true;
      }
      const soaStorage = SoAStorageOf(Receiver as unknown as object);
      if (soaStorage !== undefined && P instanceof JSStringValue) {
        const index = Number(P.stringValue());
        if (String(index) === P.stringValue()) {
          // "particles[0] = spawned; // Scatters the fields into the columns."
          Q(yield* SoAScatter(soaStorage, index, V));
          return Value.true;
        }
      }
      const placedBacking = PlacementBackingOf(Receiver as unknown as object);
      if (placedBacking !== undefined && P instanceof JSStringValue) {
        const declared = (Receiver as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> })
          .TypedProperties?.get(P.stringValue());
        if (declared) {
          // The store check runs first, exactly as it does for a property-backed
          // field, and the converted value is what reaches the bytes.
          const converted = Q(yield* RequireType(V, declared.TypeRecord));
          Q(yield* WritePlacedField(placedBacking, P.stringValue(), declared.TypeRecord, converted));
          return Value.true;
        }
      }
      const typedProperties = (Receiver as { TypedProperties?: Map<unknown, { TypeRecord: unknown }> }).TypedProperties;
      if (typedProperties !== undefined) {
        const propKey = P instanceof JSStringValue ? P.stringValue() : P;
        const typeObject = typedProperties.get(propKey);
        if (typeObject !== undefined) {
          // The store boundary of #table-check-sites, and it uses what
          // RequireType returns: `o.x = 7` on a uint8 property stores that
          // property's uint8 value, not the plain Number (F51).
          V = Q(yield* RequireType(V, typeObject.TypeRecord as never));
        }
      }
    }
    return yield* OrdinarySet(this as unknown as OrdinaryObject, P, V, Receiver);
  }

  * Delete(P: PropertyKeyValue): ObjectSlotReturn['Delete'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    // proposal-runtime-types (spec sec-object-types-semantics): a typed own
    // property cannot be deleted, since a layout with a hole is not the layout the
    // type described. Deleting one is a TypeError.
    if (surroundingAgent.feature('runtime-types')) {
      const typedProperties = (this as { TypedProperties?: Map<unknown, unknown> }).TypedProperties;
      if (typedProperties !== undefined) {
        const propKey = P instanceof JSStringValue ? P.stringValue() : P;
        if (typedProperties.has(propKey)) {
          return Throw.TypeError('$1 is a typed property and cannot be deleted', P);
        }
      }
    }
    return yield* OrdinaryDelete(this as unknown as OrdinaryObject, P);
  }

  // eslint-disable-next-line require-yield
  * OwnPropertyKeys(): ObjectSlotReturn['OwnPropertyKeys'] {
    return OrdinaryOwnPropertyKeys(this as unknown as OrdinaryObject);
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.properties);
    this.internalSlotsList.forEach((s) => {
      // @ts-ignore
      m(this[s]);
      if (s === 'HostCapturedValues' && s in this && Array.isArray(this[s])) {
        this[s].forEach(m);
      }
    });

    this.PrivateElements.forEach((pr) => {
      m(pr);
    });
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Object' });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is ObjectValue;
}

/** https://tc39.es/ecma262/#sec-private-names */
export class PrivateName {
  // NOTE: The following declaration distinguishes `PrivateName` from `SymbolValue` so that type guards can properly
  //       remove it from unions with `SymbolValue` due to structural overlap.
  declare private _: never;

  readonly Description: JSStringValue;

  constructor(description: JSStringValue) {
    this.Description = description;
  }
}

export class ReferenceRecord {
  readonly Base: 'unresolvable' | Value | EnvironmentRecord;

  ReferencedName: Value | PrivateName;

  readonly Strict: BooleanValue;

  readonly ThisValue: Value | undefined;

  // proposal-runtime-types (spec sec-class-operators): set when this reference is
  // a computed index access `m[i]` whose base is a typed-class instance with a
  // declared index operator, so GetValue/PutValue dispatch to that operator in
  // place of the ordinary property [[Get]]/[[Set]]. The value is the index
  // operator function.
  readonly IndexOperator?: Value;

  // proposal-runtime-types #sec-class-operators: the indices a computed access
  // supplied, where an index accessor applies. `m[x, y]` reaches a two-index
  // accessor with both, and the single-index case carries a list of one.
  readonly IndexArguments?: readonly Value[];
  readonly IndexSetOperator?: Value;

  // proposal-runtime-types #sec-soa-references: set when this reference denotes
  // an element of an `SoA` - a COLUMN SET AND AN INDEX rather than a property
  // slot, since the element's fields live in separate column allocations and
  // there is no single address to point at. The value is the element view built
  // where the borrow was taken; it carries the capacity pinned at that moment,
  // which is what lets a later use detect that the storage has moved
  // (#sec-reference-liveness). Marking the Reference Record is what lets ONE
  // borrow representation serve every form: a `ref` argument, a `ref` return,
  // and a `ref` binding all carry this and all reach the same reads and writes.
  readonly SoAElement?: ObjectValue;

  // proposal-runtime-types #sec-reference-liveness: set when this reference
  // borrows an element of a growable `[].<T>`, which has a backing allocation
  // that GROWTH RELOCATES. The generation the borrow was taken at is compared
  // at every use; a growth past the capacity bumps it and so invalidates every
  // borrow taken before it, exactly as growth of an `SoA` does.
  readonly ArrayBorrow?: { readonly Source: ObjectValue, readonly TakenAt: number };

  constructor({
    Base,
    ReferencedName,
    Strict,
    ThisValue,
    IndexOperator,
    IndexArguments,
    IndexSetOperator,
    SoAElement,
    ArrayBorrow,
  }: Pick<ReferenceRecord, 'Base' | 'ReferencedName' | 'Strict' | 'ThisValue' | 'IndexOperator' | 'IndexArguments' | 'IndexSetOperator' | 'SoAElement' | 'ArrayBorrow'>) {
    this.Base = Base;
    this.ReferencedName = ReferencedName;
    this.Strict = Strict;
    this.ThisValue = ThisValue;
    this.IndexOperator = IndexOperator;
    this.IndexArguments = IndexArguments;
    this.IndexSetOperator = IndexSetOperator;
    this.SoAElement = SoAElement;
    this.ArrayBorrow = ArrayBorrow;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Base);
    m(this.ReferencedName);
    m(this.ThisValue);
  }
}

// proposal-runtime-types (references extension): a reference value is a borrow, a
// first-class handle to a storage location (a variable, an object property, or an
// array element) that reads and writes through to the original. It has no
// observable identity: every read of a ref binding dereferences to the referent,
// and a reference value decays to the referent's value at any boundary that
// consumes a value, so typeof, ===, and instanceof only ever see the referent. It
// is produced by the `ref` argument and `ref` return forms and consumed by a `ref`
// parameter, a `ref` lexical binding, or decay.
export class ReferenceValue extends PrimitiveValue {
  declare readonly type: 'Reference';

  declare static [Symbol.hasInstance]: (value: unknown) => value is ReferenceValue;

  readonly Location: ReferenceRecord;

  constructor(location: ReferenceRecord) {
    super();
    this.Location = location;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    this.Location.mark(m);
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Reference' });
  }
}

export type DescriptorInit = Pick<Descriptor, 'Configurable' | 'Enumerable' | 'Getter' | 'Setter' | 'Value' | 'Writable' | 'Type'>;
// @ts-expect-error
export function Descriptor(O: DescriptorInit): Descriptor // @ts-expect-error
export @callable() class Descriptor {
  readonly Value?: Value;

  readonly Getter?: FunctionObject | UndefinedValue;

  readonly Setter?: FunctionObject | UndefinedValue;

  readonly Writable?: BooleanValue;

  readonly Enumerable?: BooleanValue;

  readonly Configurable?: BooleanValue;

  // proposal-runtime-types (spec sec-object-types-semantics): the declared type of
  // a typed own property, from a `type` key in the descriptor. A data property with
  // a declared type checks each write against it and cannot be deleted.
  readonly Type?: object;

  constructor(O: Pick<Descriptor, 'Configurable' | 'Enumerable' | 'Getter' | 'Setter' | 'Value' | 'Writable' | 'Type'>) {
    this.Value = O.Value;
    this.Getter = O.Getter;
    this.Setter = O.Setter;
    this.Writable = O.Writable;
    this.Enumerable = O.Enumerable;
    this.Configurable = O.Configurable;
    this.Type = O.Type;
  }

  everyFieldIsAbsent() {
    return this.Value === undefined
      && this.Getter === undefined
      && this.Setter === undefined
      && this.Writable === undefined
      && this.Enumerable === undefined
      && this.Configurable === undefined
      && this.Type === undefined;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Value);
    m(this.Getter);
    m(this.Setter);
  }
}

export class DataBlock extends Uint8Array {}

/** https://tc39.es/ecma262/#sec-sametype */
export function SameType(x: Value, y: Value) {
  switch (true) {
    case x === Value.undefined && y === Value.undefined:
    case x === Value.null && y === Value.null:
    case x instanceof BooleanValue && y instanceof BooleanValue:
    case x instanceof NumberValue && y instanceof NumberValue:
    // proposal-runtime-types R6 (Option A): a typed number is same-type only
    // with another typed number, never with a plain Number. The per-Type-Record
    // refinement (a uint8 versus a uint16) lives in the type-system SameType;
    // at the value level a TypedNumberValue is its own Type in the language
    // sense, distinct from the Number type.
    case x instanceof TypedNumberValue && y instanceof TypedNumberValue:
    case x instanceof BigIntValue && y instanceof BigIntValue:
    case x instanceof SymbolValue && y instanceof SymbolValue:
    case x instanceof JSStringValue && y instanceof JSStringValue:
    case x instanceof ObjectValue && y instanceof ObjectValue:
      return true;
    default:
      return false;
  }
}

/**
 * proposal-runtime-types R6 (Option A): the type guard for a typed number. Its
 * own instanceof does not narrow (the value hierarchy shares a static
 * hasInstance), so call sites use this to narrow a Value to TypedNumberValue.
 */
export function isTypedNumber(v: Value): v is TypedNumberValue {
  return v instanceof TypedNumberValue;
}

/**
 * proposal-runtime-types R6 (Option A): the single, named way to read a typed
 * number as its underlying plain Number. Every numeric-reading site (JSON, Date,
 * Math, the Number intrinsics, ToNumber, ToString, and so on) that must treat a
 * typed number as its value routes through here, so the "unwrap" logic exists in
 * exactly one place. A plain Number passes through unchanged, so callers may
 * apply it unconditionally where a Number is expected.
 */
export function unwrapToNumber(v: NumberValue | TypedNumberValue): NumberValue {
  return isTypedNumber(v) ? createNumberValue(v.numberValue()) : v; // eslint-disable-line @engine262/mathematical-value -- R asserts instanceof NumberValue, which a typed number is not
}

type SafeAccessMethods = 'map' | 'values' | 'entries' | 'filter' | 'forEach' | 'find';
// function* myFunction([callback]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator
//                       ^^^^^^^^
// if user calls myFunction with no arguments, callback would be undefined, not Value.undefined
// the correct way is to type it as:
// function* myFunction([callback = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator
//
// this type is to prevent such mistakes
export type Arguments =
  Omit<readonly (Value | undefined)[], SafeAccessMethods> &
  Pick<readonly Value[], SafeAccessMethods>;
export interface FunctionCallContext {
  readonly thisValue: Value;
  readonly NewTarget: FunctionObject | UndefinedValue;
}
export interface NativeSteps {
  (this: BuiltinFunctionObject, args: Arguments, context: FunctionCallContext): PlainEvaluator<Value | void> | PlainCompletion<Value | void>;
  section?: string;
  isConstructor?: boolean;
}
export interface CanBeNativeSteps {
  (...args: (Value | undefined)[]): PlainEvaluator<Value | void> | PlainCompletion<Value | void>;
}
