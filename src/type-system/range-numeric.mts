import { Value, NumberValue, BigIntValue, TypedBigInt, TypedNumberValue, isTypedNumber } from '../value.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { R } from '../abstract-ops/spec-types.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { RequireType, StampFamilyValue } from '../abstract-ops/runtime-types.mts';
import { exactNumericValue, exactNumericEquals } from '../abstract-ops/testing-comparison.mts';
import { type RangeEndpoint, type RangeObject } from '../intrinsics/Range.mts';
import { CreateRationalValue } from '../intrinsics/Rational.mts';
import { CreateFloat128Value, isFloat128Object } from '../intrinsics/Float128.mts';
import { CreateDecimalValue, CreateDecimalSpecial, DecimalPrecision, DecimalExponentRange, ReduceDecimal, isDecimalObject } from '../intrinsics/Decimal.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { fitsNumericType, RuntimeTypeOf } from './runtime.mts';
import { wrapToType } from './arithmetic.mts';
import { SameType } from './relations.mts';

type NumericBase = Extract<TypeRecord, { Kind: 'primitive' }>;
export type Fraction = { n: bigint; d: bigint };

export function numericBase(type: TypeRecord | undefined): NumericBase | undefined {
  if (type?.Kind === 'parameterized') return numericBase(type.Base);
  return type?.Kind === 'primitive' && ['number', 'bigint', 'int', 'uint', 'float16', 'float32', 'float64', 'float128', 'decimal32', 'decimal64', 'decimal128', 'rational'].includes(type.Name) ? type : undefined;
}

/** One common concrete coordinate domain, independent of the endpoints selected
 * by the operator. An erased any contributes its actual endpoint types; a full
 * any contributes no carrier. Unions never pick a member by value or position.
 */
export function* NumericRangeDomain(a: RangeObject, b: RangeObject): PlainEvaluator<TypeRecord> {
  let carrier: TypeRecord | undefined;
  for (const range of [a, b]) {
    const domain = (RuntimeTypeOf(range) as Extract<TypeRecord, { Kind: 'nominal' }>).Arguments[0] as TypeRecord;
    if (domain.Kind !== 'any' && !numericBase(domain)) return Throw.TypeError('interval arithmetic requires one concrete numeric endpoint domain');
    const types: TypeRecord[] = domain.Kind === 'any' ? [] : [domain];
    for (const endpoint of [range.RangeStart, range.RangeEnd]) {
      if (endpoint === undefined) continue;
      const value = exactNumericValue(endpoint);
      const type = RuntimeTypeOf(endpoint);
      if (!numericBase(type) || !value || (value.kind !== 'finite' && value.kind !== 'infinity')) return Throw.TypeError('interval arithmetic requires ordered numeric endpoints');
      types.push(type);
    }
    for (const type of types) {
      if (carrier && !SameType(carrier, type)) return Throw.TypeError('interval arithmetic requires matching numeric endpoint types');
      carrier = type;
    }
  }
  return carrier ?? { Kind: 'any' };
}

export function numericDomain(type: TypeRecord): boolean {
  return type.Kind === 'any' || !!numericBase(type) || (type.Kind === 'union' && type.Members.length > 0 && type.Members.every(numericDomain));
}

export function negativeZero(value: Value): boolean {
  // Mathematical-value extraction loses the stored sign of zero.
  if (value instanceof NumberValue) return Object.is(value.numberValue(), -0); // eslint-disable-line @engine262/mathematical-value
  if (isTypedNumber(value)) return Object.is(value.value, -0);
  return isFloat128Object(value) && value.Float128Class === 'finite' && value.Float128Significand === 0n && value.Float128Sign < 0;
}

/** Directed rounding of a fraction to a radix/precision format. No host float
 * is an intermediate, including for subnormals and binary128 endpoints.
 */
function roundEdge(x: Fraction, upper: boolean, radix: 2 | 10, precision: number, emin: number, emax: number): { coefficient: bigint; exponent: number; rounded: boolean } | undefined {
  if (x.n === 0n) return { coefficient: 0n, exponent: 0, rounded: false };
  const negative = x.n < 0n;
  const n = negative ? -x.n : x.n;
  const power = (e: number) => BigInt(radix) ** BigInt(e);
  const atLeast = (e: number) => e >= 0 ? n >= x.d * power(e) : n * power(-e) >= x.d;
  let e = n.toString(radix).length - x.d.toString(radix).length;
  while (!atLeast(e)) e -= 1;
  while (atLeast(e + 1)) e += 1;
  if (e > emax || (radix === 10 && e < emin)) return undefined;
  const maxCoefficient = power(precision) - 1n;
  const maxExponent = emax - precision + 1;
  if (maxExponent >= 0 ? n > x.d * maxCoefficient * power(maxExponent) : n * power(-maxExponent) > x.d * maxCoefficient) return undefined;
  const exponent = Math.max(e, emin) - precision + 1;
  const numerator = exponent < 0 ? n * power(-exponent) : n;
  const denominator = exponent > 0 ? x.d * power(exponent) : x.d;
  const rounded = numerator % denominator !== 0n;
  let coefficient = numerator / denominator;
  if (rounded && upper !== negative) coefficient += 1n;
  return { coefficient: negative ? -coefficient : coefficient, exponent, rounded };
}

/** Admit and carry the promised type, without rescaling, requantizing,
 * changing zero sign, or choosing a different decimal cohort for a computed edge.
 */
export function* AdmitNumericRangeEndpoint(value: RangeEndpoint, domain: TypeRecord): PlainEvaluator<RangeEndpoint> {
  if (domain.Kind !== 'parameterized') return value;
  const result = Q(yield* RequireType(value, domain)) as RangeEndpoint;
  const before = exactNumericValue(value);
  const after = exactNumericValue(result);
  if (!before || !after || !exactNumericEquals(before, after) || negativeZero(value) !== negativeZero(result)
      || (isDecimalObject(value) && (!isDecimalObject(result) || value.DecimalSignificand !== result.DecimalSignificand || value.DecimalExponent !== result.DecimalExponent))) {
    return Throw.RangeError('range endpoint admission must preserve its computed representation');
  }
  // Membership can admit a bare numeric value by validate without stamping
  // it. A manufactured endpoint must carry its agreed domain so a subsequent
  // boundary or arithmetic operation can recognize that completed admission.
  if (SameType(RuntimeTypeOf(result), domain)) return result;
  if (isTypedNumber(result)) return new TypedNumberValue(result.value, domain);
  if (result instanceof BigIntValue) return TypedBigInt(R(result), domain);
  // Preserve the stored sign of zero rather than reading a mathematical value.
  if (result instanceof NumberValue) return new TypedNumberValue(result.numberValue(), domain); // eslint-disable-line @engine262/mathematical-value
  return (Q(StampFamilyValue(result, domain)) ?? result) as RangeEndpoint;
}

export function* numericRangeValue(domain: TypeRecord, product: Fraction, upper: boolean, negative: boolean, realm: Realm, original?: RangeEndpoint, reflection = false): PlainEvaluator<{ value: RangeEndpoint; rounded: boolean }> {
  const base = numericBase(domain)!;
  let value: RangeEndpoint;
  let rounded = false;
  if (base.Name === 'bigint' || base.Name === 'int' || base.Name === 'uint') {
    if (product.n % product.d !== 0n) return Throw.RangeError('range arithmetic requires an integral integer endpoint');
    const integer = product.n / product.d;
    if (base.Name === 'bigint') value = Value(integer);
    else {
      if (!fitsNumericType(integer, base.Name, base.Arguments)) return Throw.RangeError('a computed range endpoint is outside its numeric type');
      value = new TypedNumberValue(wrapToType(integer, base), base);
    }
  } else if (base.Name === 'rational') {
    value = Q(CreateRationalValue(product.n, product.d, realm, base));
  } else if (base.Name.startsWith('decimal')) {
    const width = Number(base.Name.slice(7)) as 32 | 64 | 128;
    const limits = DecimalExponentRange(width);
    const result = roundEdge(product, upper, 10, DecimalPrecision(width), limits.min, limits.max);
    if (!result) return Throw.RangeError('a computed range endpoint is outside its decimal type');
    const parts = reflection && original && isDecimalObject(original)
      ? { significand: -original.DecimalSignificand, exponent: original.DecimalExponent }
      : ReduceDecimal(result.coefficient, result.exponent);
    value = CreateDecimalValue(parts.significand, parts.exponent, width, realm, base);
    rounded = result.rounded;
  } else {
    const width = base.Name === 'number' ? 64 : Number(base.Name.slice(5));
    const [precision, emin, emax] = width === 16 ? [11, -14, 15] : width === 32 ? [24, -126, 127] : width === 128 ? [113, -16382, 16383] : [53, -1022, 1023];
    const result = roundEdge(product, upper, 2, precision, emin, emax);
    if (!result) return Throw.RangeError('a computed range endpoint is outside its floating type');
    if (width === 128) value = CreateFloat128Value(result.coefficient, result.exponent, realm, 'finite', negative ? -1 : 1);
    else {
      const numeric = result.coefficient === 0n && negative ? -0 : Number(result.coefficient) * 2 ** result.exponent;
      value = base.Name === 'number' ? Value(numeric) : new TypedNumberValue(numeric, base);
    }
    rounded = result.rounded;
  }
  return { value: Q(yield* AdmitNumericRangeEndpoint(value, domain)), rounded };
}

/** Existing infinity, with checked admission; finite overflow never enters here. */
export function* numericRangeInfinity(domain: TypeRecord, sign: -1 | 1, realm: Realm): PlainEvaluator<RangeEndpoint> {
  const base = numericBase(domain)!;
  const endpoint = base.Name === 'float128' ? CreateFloat128Value(0n, 0, realm, 'infinity', sign)
    : base.Name.startsWith('decimal') ? CreateDecimalSpecial(sign < 0 ? '-Infinity' : 'Infinity', Number(base.Name.slice(7)) as 32 | 64 | 128, realm, base)
      : base.Name === 'number' ? Value(sign * Infinity) : new TypedNumberValue(sign * Infinity, base);
  return Q(yield* AdmitNumericRangeEndpoint(endpoint, domain));
}
