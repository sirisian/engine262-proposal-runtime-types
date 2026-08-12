import {
  ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { type ValueEvaluator } from '../completion.mts';
import { type Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent, Throw } from '#self';
import {
  CreateBuiltinFunction, Descriptor, OrdinaryObjectCreate, R, ToNumber, X, Q,
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
  const re = R(Q(yield* ToNumber(real))) as number;
  const im = R(Q(yield* ToNumber(imaginary))) as number;
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
