import {
  NumberValue, ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  CreateBuiltinFunction, Descriptor, OrdinaryObjectCreate, ToNumber, X, Q,
  type OrdinaryObject,
  Realm,
} from '#self';

/**
 * proposal-runtime-types #sec-complex-types and #sec-complex-numbers.
 *
 * "For a value type _T_ that is `number` or one of the binary floating-point
 * types, `complex.<T>` is a value type whose values are the ordered pairs of a
 * real part and an imaginary part, each a value of _T_." The width-named
 * shorthands "count total bits rather than component bits, following the
 * convention of NumPy and Go, so `complex64` is a pair of `float32`", and "the
 * bare name `complex` is `complex.<number>`" - which is why `complex` and
 * `complex128` are DISTINCT types, exactly as `number` and `float64` are.
 *
 * The components are carried as Numbers here, as a `number`-component complex
 * requires and as a float-component one permits: a float32 component is a
 * Number rounded to the width, which is what `#sec-binary-floating-point-types`
 * already means by a value of that type.
 *
 * WHAT THIS FILE DOES NOT DO. #sec-extension-hooks is "a map of the obligations
 * this specification has incurred outward, not a specification of the extensions
 * themselves", and its complex row splits this work in two: "The operators and
 * `Math` overloads of the complex types" belong to an extension the document
 * does not contain, while "the type of an imaginary literal and the conversions
 * are delivered by #sec-complex-numbers". So the type, the literal, equality and
 * the conversions are here; the arithmetic is not, and the family tables of
 * #sec-which-operations-each-family-defines are the constraint it must satisfy
 * when it arrives - defined are unaryMinus, exponentiate, multiply, divide, add,
 * subtract, equal, sameValue, sameValueZero and toString, and absent are
 * lessThan "since the complex numbers are not ordered", remainder, and the
 * bitwise and shift operations.
 */
export interface ComplexObject extends OrdinaryObject {
  ComplexReal: number;
  ComplexImaginary: number;
  /** The Type Record of the component type, so the pair knows its own width. */
  ComplexComponent: unknown;
}

export function isComplexObject(value: Value): value is ComplexObject {
  return value instanceof ObjectValue && 'ComplexReal' in value;
}

export function CreateComplexValue(real: number, imaginary: number, component: unknown, realmRec: Realm): ComplexObject {
  const proto = realmRec.Intrinsics['%complex.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['ComplexReal', 'ComplexImaginary', 'ComplexComponent']) as Mutable<ComplexObject>;
  obj.ComplexReal = real;
  obj.ComplexImaginary = imaginary;
  obj.ComplexComponent = component;
  return obj;
}

/**
 * Equality over the pair. The family table gives a complex type `equal`,
 * `sameValue` and `sameValueZero` and denies it `lessThan`, "since the complex
 * numbers are not ordered", so this is the only comparison there is.
 */
export function complexEquals(a: ComplexObject, b: ComplexObject): boolean {
  return a.ComplexReal === b.ComplexReal && a.ComplexImaginary === b.ComplexImaginary;
}

/** The componentwise reading #sec-numeric-library gives for the predicates. */
/**
 * SameValue over the pair, which distinguishes what `===` does not: the two
 * zeroes of each component, and a NaN component from itself. `Object.is` asks
 * this, and every other numeric type answers the same way.
 */
export function complexSameValue(a: ComplexObject, b: ComplexObject): boolean {
  return Object.is(a.ComplexReal, b.ComplexReal)
    && Object.is(a.ComplexImaginary, b.ComplexImaginary);
}

export function complexIsNaN(z: ComplexObject): boolean {
  return Number.isNaN(z.ComplexReal) || Number.isNaN(z.ComplexImaginary);
}

export function complexIsFinite(z: ComplexObject): boolean {
  return Number.isFinite(z.ComplexReal) && Number.isFinite(z.ComplexImaginary);
}

/**
 * The text of a complex value. `toString` is in the family's table, and the
 * shape follows the literal syntax so a value reads back as one writes it:
 * `complex(0, 4)` prints as `4i`, and a pair with both parts prints as `3+4i`.
 */
export function complexToString(z: ComplexObject): string {
  const { ComplexReal: re, ComplexImaginary: im } = z;
  if (re === 0 && !Object.is(re, -0)) {
    return `${im}i`;
  }
  return `${re}${im < 0 || Object.is(im, -0) ? '' : '+'}${im}i`;
}

/**
 * The arithmetic of the complex family.
 *
 * #sec-which-operations-each-family-defines gives the family unaryMinus,
 * exponentiate, multiply, divide, add, subtract, equal, sameValue,
 * sameValueZero and toString, and denies it lessThan "since the complex numbers
 * are not ordered", remainder, and the bitwise and shift operations. What the
 * defined ones COMPUTE is not written there - #sec-extension-hooks assigns the
 * operators to an extension this document does not contain - so the semantics
 * here are C99 Annex G's, which is the recognized specification of complex
 * arithmetic over IEEE 754 components and what an engine backed by C's
 * `_Complex` or a Fortran runtime already implements. Agreeing with it is what
 * makes this engine agree with those.
 *
 * Each result is rounded through the COMPONENT TYPE rather than left as a
 * double, because the operator table says a binary operator yields "the operand
 * type": a `complex64` product is a pair of float32s, not a pair of doubles
 * wearing the name.
 */
function roundToComponent(x: number, component: unknown): number {
  const name = (component as { Kind?: string, Name?: string } | undefined);
  if (name?.Kind !== 'primitive') {
    return x;
  }
  if (name.Name === 'float32') {
    return Math.fround(x);
  }
  if (name.Name === 'float16') {
    // The host may not provide Float16Array, so the rounding is the format's:
    // 11 bits of significand, ties to even.
    return roundToBinary16(x);
  }
  return x;
}

function roundToBinary16(x: number): number {
  if (!Number.isFinite(x) || x === 0) {
    return x;
  }
  const sign = x < 0 ? -1 : 1;
  const magnitude = Math.abs(x);
  if (magnitude >= 65520) {
    return sign * Infinity;
  }
  if (magnitude < 2 ** -14) {
    const step = 2 ** -24;
    return sign * Math.round(magnitude / step) * step;
  }
  const exponent = Math.floor(Math.log2(magnitude));
  const step = 2 ** (exponent - 10);
  const rounded = Math.round(magnitude / step) * step;
  return rounded > 65504 ? sign * Infinity : sign * rounded;
}

function componentOf(x: ComplexObject, y: ComplexObject): unknown {
  return x.ComplexComponent ?? y.ComplexComponent;
}

export function complexAdd(x: ComplexObject, y: ComplexObject, realmRec: Realm): ComplexObject {
  const c = componentOf(x, y);
  return CreateComplexValue(
    roundToComponent(x.ComplexReal + y.ComplexReal, c),
    roundToComponent(x.ComplexImaginary + y.ComplexImaginary, c),
    c,
    realmRec,
  );
}

export function complexSubtract(x: ComplexObject, y: ComplexObject, realmRec: Realm): ComplexObject {
  const c = componentOf(x, y);
  return CreateComplexValue(
    roundToComponent(x.ComplexReal - y.ComplexReal, c),
    roundToComponent(x.ComplexImaginary - y.ComplexImaginary, c),
    c,
    realmRec,
  );
}

export function complexNegate(x: ComplexObject, realmRec: Realm): ComplexObject {
  // Both components negate, INCLUDING the zeroes: -complex(0, 0) is
  // complex(-0, -0), which Object.is on the components can see.
  return CreateComplexValue(-x.ComplexReal, -x.ComplexImaginary, x.ComplexComponent, realmRec);
}

export function complexMultiply(x: ComplexObject, y: ComplexObject, realmRec: Realm): ComplexObject {
  const c = componentOf(x, y);
  const { ComplexReal: a, ComplexImaginary: b } = x;
  const { ComplexReal: d, ComplexImaginary: e } = y;
  return CreateComplexValue(
    roundToComponent(a * d - b * e, c),
    roundToComponent(a * e + b * d, c),
    c,
    realmRec,
  );
}

/**
 * Division by SMITH'S ALGORITHM rather than by the conjugate formula.
 *
 * The naive form computes `br*br + bi*bi`, which overflows whenever the
 * components' squares exceed the range even where the quotient is perfectly
 * finite: `(1e200+1e200i) / (3e200+4e200i)` gives a NaN that way, and
 * 0.28 - 0.04i this way. Annex G assumes the scaled form, and every
 * implementation that agrees with it uses one.
 */
export function complexDivide(x: ComplexObject, y: ComplexObject, realmRec: Realm): ComplexObject {
  const c = componentOf(x, y);
  const { ComplexReal: a, ComplexImaginary: b } = x;
  const { ComplexReal: d, ComplexImaginary: e } = y;
  let re;
  let im;
  if (Math.abs(d) >= Math.abs(e)) {
    const r = e / d;
    const denominator = d + e * r;
    re = (a + b * r) / denominator;
    im = (b - a * r) / denominator;
  } else {
    const r = d / e;
    const denominator = d * r + e;
    re = (a * r + b) / denominator;
    im = (b * r - a) / denominator;
  }
  return CreateComplexValue(roundToComponent(re, c), roundToComponent(im, c), c, realmRec);
}

/** Exponentiation through the polar form, which is what the extension names. */
export function complexPow(x: ComplexObject, y: ComplexObject, realmRec: Realm): ComplexObject {
  const c = componentOf(x, y);
  const modulus = Math.hypot(x.ComplexReal, x.ComplexImaginary);
  if (modulus === 0) {
    // 0 to any positive power is 0; the degenerate cases follow Annex G in
    // producing a NaN rather than a value invented here.
    const zeroPower = y.ComplexReal > 0 && y.ComplexImaginary === 0;
    return CreateComplexValue(zeroPower ? 0 : NaN, zeroPower ? 0 : NaN, c, realmRec);
  }
  const argument = Math.atan2(x.ComplexImaginary, x.ComplexReal);
  const logModulus = Math.log(modulus);
  const scale = Math.exp(y.ComplexReal * logModulus - y.ComplexImaginary * argument);
  const angle = y.ComplexImaginary * logModulus + y.ComplexReal * argument;
  return CreateComplexValue(
    roundToComponent(scale * Math.cos(angle), c),
    roundToComponent(scale * Math.sin(angle), c),
    c,
    realmRec,
  );
}

/** The real magnitude, a value of _T_ - hypot rather than sqrt of the squares. */
export function complexAbs(x: ComplexObject): number {
  return Math.hypot(x.ComplexReal, x.ComplexImaginary);
}

/** The conjugate: the imaginary part negated. */
export function complexConjugate(x: ComplexObject, realmRec: Realm): ComplexObject {
  return CreateComplexValue(x.ComplexReal, -x.ComplexImaginary, x.ComplexComponent, realmRec);
}

/** The argument, or phase: atan2 of the components, a value of _T_. */
export function complexArgument(x: ComplexObject): number {
  return Math.atan2(x.ComplexImaginary, x.ComplexReal);
}

/**
 * proposal-runtime-types complex.md: "The transcendental `Math` functions are
 * overloaded for `complex` and return a `complex`, so the same name does the
 * real thing on a real and the complex thing on a complex."
 *
 * The principal square root, by the half-angle form rather than
 * `exp(log(z)/2)`: the direct formula is exact where a component is zero, so
 * `Math.sqrt(complex(-1, 0))` is `0 + 1i` and not `6.1e-17 + 1i`.
 */
export function complexSqrt(x: ComplexObject, realmRec: Realm): ComplexObject {
  const re = x.ComplexReal;
  const im = x.ComplexImaginary;
  if (im === 0) {
    // On the real axis the answer is exact in one component or the other.
    if (re >= 0 || Object.is(re, -0)) {
      return CreateComplexValue(Math.sqrt(re), 0, x.ComplexComponent, realmRec);
    }
    return CreateComplexValue(0, Math.sqrt(-re), x.ComplexComponent, realmRec);
  }
  const modulus = Math.hypot(re, im);
  const realPart = Math.sqrt((modulus + re) / 2);
  const imaginaryPart = Math.sign(im) * Math.sqrt((modulus - re) / 2);
  return CreateComplexValue(realPart, imaginaryPart, x.ComplexComponent, realmRec);
}

/** `e**z`, which is `e**re` scaled onto the unit circle at angle `im`. */
export function complexExp(x: ComplexObject, realmRec: Realm): ComplexObject {
  const scale = Math.exp(x.ComplexReal);
  return CreateComplexValue(scale * Math.cos(x.ComplexImaginary), scale * Math.sin(x.ComplexImaginary), x.ComplexComponent, realmRec);
}

/** The principal logarithm: `log|z|` with the argument as the imaginary part. */
export function complexLog(x: ComplexObject, realmRec: Realm): ComplexObject {
  return CreateComplexValue(Math.log(complexAbs(x)), complexArgument(x), x.ComplexComponent, realmRec);
}

export function complexSin(x: ComplexObject, realmRec: Realm): ComplexObject {
  const re = x.ComplexReal;
  const im = x.ComplexImaginary;
  return CreateComplexValue(Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im), x.ComplexComponent, realmRec);
}

export function complexCos(x: ComplexObject, realmRec: Realm): ComplexObject {
  const re = x.ComplexReal;
  const im = x.ComplexImaginary;
  return CreateComplexValue(Math.cos(re) * Math.cosh(im), -Math.sin(re) * Math.sinh(im), x.ComplexComponent, realmRec);
}

/** `sin z / cos z`, formed through the two above so the identity holds. */
export function complexTan(x: ComplexObject, realmRec: Realm): ComplexObject {
  return complexDivide(complexSin(x, realmRec), complexCos(x, realmRec), realmRec);
}

function* ComplexProto_real(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isComplexObject(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('complex'));
  }
  return Value(thisValue.ComplexReal);
}

function* ComplexProto_imaginary(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isComplexObject(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('complex'));
  }
  return Value(thisValue.ComplexImaginary);
}

function* ComplexProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isComplexObject(thisValue)) {
    return Throw.TypeError('$1 is not a $2', thisValue, Value('complex'));
  }
  return Value(complexToString(thisValue));
}

/** `complex(re, im)`, the constructor the clause writes its own example with. */
function* ComplexConstructor([real = Value(0), imaginary = Value(0)]: Arguments): ValueEvaluator {
  // numberValue() rather than R(): R answers the MATHEMATICAL value, in which
  // negative zero does not exist - it maps -0 to 0 deliberately. A component of
  // an IEEE format has both zeroes, and SameValue reports the difference, so
  // reading through R made `Object.is(complex(0,0), complex(-0,0))` true. The
  // same reading cost float128 its signed zero.
  const re = (Q(yield* ToNumber(real)) as NumberValue).numberValue();
  const im = (Q(yield* ToNumber(imaginary)) as NumberValue).numberValue();
  return CreateComplexValue(re, im, undefined, surroundingAgent.currentRealmRecord);
}

export function bootstrapComplexPrototype(realmRec: Realm): void {
  const proto = bootstrapPrototype(realmRec, [
    ['real', [ComplexProto_real]],
    ['imaginary', [ComplexProto_imaginary]],
    ['toString', ComplexProto_toString, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'complex');
  realmRec.Intrinsics['%complex.prototype%'] = proto;
}

export function bootstrapComplex(realmRec: Realm): void {
  const proto = realmRec.Intrinsics['%complex.prototype%'];
  const cons = CreateBuiltinFunction(ComplexConstructor, 2, Value('complex'), [], realmRec);
  X(cons.DefineOwnProperty(Value('prototype'), Descriptor({
    Value: proto,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  realmRec.Intrinsics['%complex%'] = cons;
}
