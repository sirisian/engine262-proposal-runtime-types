import { Value, NumberValue, TypedNumberValue, isTypedNumber } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { RequireType } from '../abstract-ops/runtime-types.mts';
import { exactNumericValue, exactNumericEquals } from '../abstract-ops/testing-comparison.mts';
import { CreateRangeObject, type RangeObject, type RangeEndpoint, type RangeBound } from '../intrinsics/Range.mts';
import { CreateRationalValue } from '../intrinsics/Rational.mts';
import { CreateFloat128Value, isFloat128Object } from '../intrinsics/Float128.mts';
import { CreateDecimalValue, CreateDecimalSpecial, DecimalPrecision, DecimalExponentRange, ReduceDecimal, isDecimalObject } from '../intrinsics/Decimal.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { RuntimeTypeOf, fitsNumericType } from './runtime.mts';
import { wrapToType } from './arithmetic.mts';
import { RangeIsEmpty } from './range-selection.mts';

type NumericBase = Extract<TypeRecord, { Kind: 'primitive' }>;
type Fraction = { n: bigint; d: bigint };
type Edge = { value: RangeEndpoint | undefined; bound: RangeBound | undefined };
const numberType: NumericBase = { Kind: 'primitive', Name: 'number', Arguments: [] };

function numericBase(type: TypeRecord | undefined): NumericBase | undefined {
  if (type?.Kind === 'parameterized') return numericBase(type.Base);
  return type?.Kind === 'primitive' && ['number', 'bigint', 'int', 'uint', 'float16', 'float32', 'float64', 'float128', 'decimal32', 'decimal64', 'decimal128', 'rational'].includes(type.Name) ? type : undefined;
}

function numericDomain(type: TypeRecord): boolean {
  return type.Kind === 'any' || !!numericBase(type) || (type.Kind === 'union' && type.Members.length > 0 && type.Members.every(numericDomain));
}

function negativeZero(value: Value): boolean {
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

/** Admission may attach the promised type, but cannot rescale, requantize,
 * change zero sign, or choose a different decimal cohort for a computed edge.
 */
function* admit(value: RangeEndpoint, domain: TypeRecord): PlainEvaluator<RangeEndpoint> {
  if (domain.Kind !== 'parameterized') return value;
  const result = Q(yield* RequireType(value, domain)) as RangeEndpoint;
  const before = exactNumericValue(value);
  const after = exactNumericValue(result);
  if (!before || !after || !exactNumericEquals(before, after) || negativeZero(value) !== negativeZero(result)
      || (isDecimalObject(value) && (!isDecimalObject(result) || value.DecimalSignificand !== result.DecimalSignificand || value.DecimalExponent !== result.DecimalExponent))) {
    return Throw.RangeError('range endpoint admission must preserve its computed representation');
  }
  return result;
}

function* scaledValue(domain: TypeRecord, product: Fraction, upper: boolean, negative: boolean, realm: Realm, original?: RangeEndpoint, reflection = false): PlainEvaluator<{ value: RangeEndpoint; rounded: boolean }> {
  const base = numericBase(domain)!;
  let value: RangeEndpoint;
  let rounded = false;
  if (base.Name === 'bigint' || base.Name === 'int' || base.Name === 'uint') {
    if (product.n % product.d !== 0n) return Throw.RangeError('range scaling requires an integral integer endpoint');
    const integer = product.n / product.d;
    if (base.Name === 'bigint') value = Value(integer);
    else {
      if (!fitsNumericType(integer, base.Name, base.Arguments)) return Throw.RangeError('a scaled range endpoint is outside its numeric type');
      value = new TypedNumberValue(wrapToType(integer, base), base);
    }
  } else if (base.Name === 'rational') {
    value = Q(CreateRationalValue(product.n, product.d, realm, base));
  } else if (base.Name.startsWith('decimal')) {
    const width = Number(base.Name.slice(7)) as 32 | 64 | 128;
    const limits = DecimalExponentRange(width);
    const result = roundEdge(product, upper, 10, DecimalPrecision(width), limits.min, limits.max);
    if (!result) return Throw.RangeError('a scaled range endpoint is outside its decimal type');
    const parts = reflection && original && isDecimalObject(original)
      ? { significand: -original.DecimalSignificand, exponent: original.DecimalExponent }
      : ReduceDecimal(result.coefficient, result.exponent);
    value = CreateDecimalValue(parts.significand, parts.exponent, width, realm, base);
    rounded = result.rounded;
  } else {
    const width = base.Name === 'number' ? 64 : Number(base.Name.slice(5));
    const [precision, emin, emax] = width === 16 ? [11, -14, 15] : width === 32 ? [24, -126, 127] : width === 128 ? [113, -16382, 16383] : [53, -1022, 1023];
    const result = roundEdge(product, upper, 2, precision, emin, emax);
    if (!result) return Throw.RangeError('a scaled range endpoint is outside its floating type');
    if (width === 128) value = CreateFloat128Value(result.coefficient, result.exponent, realm, 'finite', negative ? -1 : 1);
    else {
      const numeric = result.coefficient === 0n && negative ? -0 : Number(result.coefficient) * 2 ** result.exponent;
      value = base.Name === 'number' ? Value(numeric) : new TypedNumberValue(numeric, base);
    }
    rounded = result.rounded;
  }
  return { value: Q(yield* admit(value, domain)), rounded };
}

function* scaleEdge(value: RangeEndpoint | undefined, bound: RangeBound | undefined, factor: Fraction, upper: boolean, realm: Realm): PlainEvaluator<Edge> {
  if (value === undefined) return { value, bound };
  const domain = RuntimeTypeOf(value);
  const base = numericBase(domain)!;
  const x = exactNumericValue(value)!;
  if (x.kind === 'infinity') {
    const sign = x.sign * (factor.n < 0n ? -1 : 1);
    const endpoint = base.Name === 'float128' ? CreateFloat128Value(0n, 0, realm, 'infinity', sign < 0 ? -1 : 1)
      : base.Name.startsWith('decimal') ? CreateDecimalSpecial(sign < 0 ? '-Infinity' : 'Infinity', Number(base.Name.slice(7)) as 32 | 64 | 128, realm, base)
        : base.Name === 'number' ? Value(sign * Infinity) : new TypedNumberValue(sign * Infinity, base);
    return { value: Q(yield* admit(endpoint, domain)), bound };
  }
  if (x.kind !== 'finite') return Throw.TypeError('range scaling requires ordered numeric endpoints');
  const product = { n: x.n * factor.n, d: x.d * factor.d };
  const negative = (x.n < 0n || negativeZero(value)) !== (factor.n < 0n);
  const scaled = Q(yield* scaledValue(domain, product, upper, negative, realm, value, factor.n === -factor.d));
  return { value: scaled.value, bound: scaled.rounded ? 'closed' : bound };
}

/** sec-numeric-range-scaling: validate, compute/admit in source order, publish. */
export function* NumericRangeScale(range: RangeObject, factor: Value, realm: Realm): ValueEvaluator {
  const domain = (RuntimeTypeOf(range) as Extract<TypeRecord, { Kind: 'nominal' }>).Arguments[0] as TypeRecord;
  if (!numericDomain(domain)) return Throw.TypeError('range scaling requires a numeric endpoint domain');
  for (const endpoint of [range.RangeStart, range.RangeEnd]) {
    if (endpoint === undefined) continue;
    const x = exactNumericValue(endpoint);
    if (!numericBase(RuntimeTypeOf(endpoint)) || !x || (x.kind !== 'finite' && x.kind !== 'infinity')) return Throw.TypeError('range scaling requires ordered numeric endpoints');
  }
  const f = exactNumericValue(factor);
  if (!f || f.kind !== 'finite') return Throw.TypeError('a range scale factor must be a finite real numeric value');
  const copy = () => CreateRangeObject(range.RangeStart, range.RangeEnd, range.RangeStartBound, range.RangeEndBound, realm, domain);
  if (Q(yield* RangeIsEmpty(range)) || f.n === f.d) return copy();
  if (f.n === 0n) {
    const zeroDomain = numericBase(domain) ? domain : range.RangeStart !== undefined ? RuntimeTypeOf(range.RangeStart)
      : range.RangeEnd !== undefined ? RuntimeTypeOf(range.RangeEnd) : domain.Kind === 'any' ? numberType : undefined;
    if (!zeroDomain) return Throw.TypeError('zero scaling requires a determined numeric endpoint type');
    const zero = Q(yield* scaledValue(zeroDomain, { n: 0n, d: 1n }, false, false, realm));
    return CreateRangeObject(zero.value, zero.value, 'closed', 'closed', realm, domain);
  }
  const reverse = f.n < 0n;
  const start = Q(yield* scaleEdge(range.RangeStart, range.RangeStartBound, f, reverse, realm));
  const end = Q(yield* scaleEdge(range.RangeEnd, range.RangeEndBound, f, !reverse, realm));
  return reverse
    ? CreateRangeObject(end.value, start.value, end.bound, start.bound, realm, domain)
    : CreateRangeObject(start.value, end.value, start.bound, end.bound, realm, domain);
}
