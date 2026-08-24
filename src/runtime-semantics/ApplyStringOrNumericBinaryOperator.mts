import {
  isComplexObject, complexAdd, complexSubtract, complexMultiply, complexDivide, complexPow, CreateComplexValue,
  type ComplexObject,
} from '../intrinsics/Complex.mts';
import { ObjectValue,
  JSStringValue, Value,
  NumberValue,
  BigIntValue,
  SameType,
} from '../value.mts';
import { vectorBinaryOperator } from '../type-system/vector-ops.mts';
import type { MetadataRecord } from '../type-system/records.mts';
import { isRangeBinaryOperator, rangeBinaryOperator } from '../type-system/range-ops.mts';
import { isRangeObject } from '../intrinsics/Range.mts';
import { isTypedNumber, TypedNumberValue } from '../value.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { pushTypeParameterFrame, popTypeParameterFrame, TypeNodeToTypeRecord as ResolveTypeNode } from '../type-system/runtime.mts';
import { MetaTypeForConstraint, MetadataPortion, GoverningMetaTypes, MergeOperatorResultMetadata } from '../abstract-ops/runtime-types.mts';
import { isTypedArithmetic, typedBinary } from '../type-system/arithmetic.mts';
import {
  isRationalObject, rationalAdd, rationalSub, rationalMul, rationalDiv, rationalPow,
} from '../intrinsics/Rational.mts';
import { Q } from '../completion.mts';
import { IsOfType } from '../type-system/runtime.mts';
import {
  isDecimalObject, decimalAdd, decimalSubtract, decimalMultiply, decimalDivide, decimalRemainder,
  CreateDecimalValue,
} from '../intrinsics/Decimal.mts';
import {
  Assert, Throw, ToNumeric, ToPrimitive, ToString, surroundingAgent, Call, LookupClassOperator, LookupPrimitiveOperator, EnterOperatorBody, LeaveOperatorBody, RightOperandDeclaresOperator } from '#self';


/**
 * The inverse of the metadata projection: an ~object~ Type Record whose
 * properties reproduce a metadata value, so that `Base.<D>` with D bound to it
 * rebuilds the same parameterization. Each property is a ~literal~ record,
 * which is the form the projection hands back unchanged.
 */
function metadataAsObjectRecord(metadata: MetadataRecord): TypeRecord {
  const Properties: { key: string, type: TypeRecord, optional: boolean, readonly: boolean }[] = [];
  if (metadata && typeof metadata === 'object') {
    for (const key of Object.keys(metadata as unknown as Record<string, unknown>)) {
      const raw = (metadata as unknown as Record<string, unknown>)[key];
      Properties.push({
        key,
        type: { Kind: 'literal', Value: raw as Value, Base: { Kind: 'primitive', Name: 'number', Arguments: [] } } as unknown as TypeRecord,
        optional: false,
        readonly: false,
      });
    }
  }
  return { Kind: 'object', Properties, IndexSignatures: [] } as unknown as TypeRecord;
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '<<' | '>>' | '>>>' | '&' | '^' | '|';
/** https://tc39.es/ecma262/#sec-applystringornumericbinaryoperator */
export function* ApplyStringOrNumericBinaryOperator(lval: Value, opText: BinaryOperator, rval: Value, literals?: { left: boolean, right: boolean, leftLetConst?: boolean, rightLetConst?: boolean }) {
  (globalThis as { __a?: string[] }).__a?.push(`apply ${opText}`);
  // proposal-runtime-types #sec-vector-types: a vector's values are "the
  // sequences of N values of T", so an operator over two vectors of one shape
  // applies LANE-WISE. This is what the rest of the SIMD surface is for - the
  // design's own dot product is `(a * b).sum()`, so an engine with swizzle and
  // sum and no `*` cannot run the example that motivates sum.
  if (surroundingAgent.feature('runtime-types')
      && (lval.type === 'Vector' || rval.type === 'Vector')) {
    return Q(yield* vectorBinaryOperator(lval, opText, rval));
  }
  // proposal-runtime-types (ranges.md "Types"): interval arithmetic. The bounds
  // of a computed value are the arithmetic of the bounds it was computed from,
  // so an operator over two ranges produces the range of the results. Placed
  // before class operator dispatch because a Range is an ordinary object and
  // would otherwise fall through to it.
  // Both operands must be ranges: interval arithmetic is a statement about two
  // point sets, and a range beside a non-range keeps the base language's
  // behaviour, so `"x" + r` still concatenates rather than becoming an error.
  if (surroundingAgent.feature('runtime-types')
      && isRangeBinaryOperator(opText)
      && isRangeObject(lval) && isRangeObject(rval)) {
    return Q(yield* rangeBinaryOperator(lval, opText, rval));
  }
  // proposal-runtime-types: class operator dispatch. Consulted only when the
  // left operand is an Object, so the untyped fast path is unaffected.
  if (surroundingAgent.feature('runtime-types') && lval instanceof ObjectValue) {
    const opFn = LookupClassOperator(lval, opText);
    if (opFn) {
      // proposal-runtime-types (spec sec-class-operators): a class operator's
      // receiver is the left operand and the declaration's single parameter is
      // the right operand. Dispatch with this = lval and arguments = [rval].
      EnterOperatorBody();
      try {
        return Q(yield* Call(opFn as never, lval, [rval]));
      } finally {
        LeaveOperatorBody();
      }
    }
  }
  // proposal-runtime-types #sec-primitive-operator-blocks: an operator declared
  // by a `primitive` block, whose receiver is the primitive rather than an
  // Object. This is what makes `2 * v` work where `v` declares the operator and
  // the left operand is a bare number: the design closes the scalar-on-the-left
  // case with a block on the number type, and the diagnostic below is what
  // stood in for it (F4). Landing the block REPLACES that diagnostic with
  // dispatch rather than deleting it - a program that declares no block still
  // gets told why its expression did not work.
  if (surroundingAgent.feature('runtime-types') && !(lval instanceof ObjectValue)) {
    const entry = LookupPrimitiveOperator(lval, opText);
    // "at most one definition with a body may match ... where no definition
    // with a body matches, the primitive operation runs". MATCHING is on the
    // right operand against the definition's parameter type, and skipping that
    // test is not a shortcut: a `primitive number { operator *(rhs: V) }` would
    // otherwise capture EVERY multiplication of two numbers in the program and
    // fail on its own parameter.
    if (entry) {
      // #sec-primitive-operator-blocks: a PARAMETERIZED block declares its
      // operators "for each parameterization its parameters admit", so the
      // block's parameter is bound from the RECEIVER and the operand and result
      // types are resolved against that binding. `operator +(rhs: float64.<D>):
      // float64.<D>` is then dimension-preserving addition: it admits an
      // operand of the receiver's own parameterization and nothing else, and
      // the result carries the same metadata.
      let deferredParameterType = null;
      let deferredReturnType = null;
      let framePushed = false;
      let deferredSpokenFor: object[] = [];
      if (entry.deferred && isTypedNumber(lval)) {
        const carried = (lval as TypedNumberValue).TypeRecord as TypeRecord;
        if (carried.Kind === 'parameterized') {
          const frame = new Map<string, TypeRecord>();
          // The meta type each parameter speaks for, resolved from its
          // constraint, so the parameter binds to THAT meta type's portion.
          const spokenFor: object[] = [];
          for (let pi = 0; pi < entry.deferred.parameterNames.length; pi += 1) {
            const name = entry.deferred.parameterNames[pi]!;
            const constraintNode = entry.deferred.parameterConstraints?.[pi];
            let portion = carried.Metadata;
            if (constraintNode) {
              const constraint = Q(yield* ResolveTypeNode(constraintNode as never));
              const metaType = MetaTypeForConstraint(constraint);
              if (metaType !== undefined) {
                spokenFor.push(metaType);
                portion = MetadataPortion(carried.Metadata, metaType) as unknown as MetadataRecord;
              }
            }
            frame.set(name, metadataAsObjectRecord(portion));
          }
          deferredSpokenFor = spokenFor;
          for (const name of [] as string[]) {
            // The parameter stands for the receiver's METADATA, and it is
            // bound as an ~object~ record reproducing it. That form is not a
            // convenience: `float64.<D>` builds a parameterization only where
            // its type argument is an object record, and anything else falls
            // through to the bare base - which is why binding a record of any
            // other kind left `float64.<D>` unparameterized and the result
            // unstamped, silently, with the arithmetic still giving the right
            // number.
            frame.set(name, metadataAsObjectRecord(carried.Metadata));
          }
          // The frame stays pushed for the WHOLE invocation, not only while
          // the types are resolved: the operator's own parameter boundary
          // resolves `float64.<D>` when the body is entered, and popping first
          // leaves that resolution without the binding - which is where
          // "D is not defined" came from, raised inside the body of the very
          // operator that declared D.
          // #sec-primitive-operator-blocks: bind the OPERATOR's own type
          // parameters to the ARGUMENT's metadata, beside the block's binding of
          // the receiver's. One `set` each, into the same frame, which stays
          // pushed for the whole invocation - so `float64.<{ bounds: ... B2 ... }>`
          // in the return type can speak about the operand the caller passed.
          //
          // Only the first is bound: an operator takes one argument, so a second
          // name would have nothing to name.
          const operatorNames = entry.deferred.operatorParameterNames ?? [];
          if (operatorNames.length > 0 && isTypedNumber(rval)
              && (rval.TypeRecord as TypeRecord).Kind === 'parameterized') {
            const argCarried = rval.TypeRecord as TypeRecord & { Kind: 'parameterized' };
            frame.set(operatorNames[0]!, metadataAsObjectRecord(argCarried.Metadata));
          }
          pushTypeParameterFrame(frame);
          framePushed = true;
          if (entry.deferred.parameterTypeNode) {
            deferredParameterType = Q(yield* ResolveTypeNode(entry.deferred.parameterTypeNode as never));
          }
          if (entry.deferred.returnTypeNode) {
            deferredReturnType = Q(yield* ResolveTypeNode(entry.deferred.returnTypeNode as never));
          }
        }
      }
      const effectiveParameter = deferredParameterType ?? entry.parameterType;
      const admits = effectiveParameter === null
        ? true
        : Q(yield* IsOfType(rval, effectiveParameter));
      if (!admits && framePushed) {
        popTypeParameterFrame();
        framePushed = false;
      }
      if (admits) {
        EnterOperatorBody();
        let raw;
        try {
          raw = Q(yield* Call(entry.fn as never, lval, [rval]));
        } finally {
          LeaveOperatorBody();
          if (framePushed) {
            popTypeParameterFrame();
            framePushed = false;
          }
        }
        // "The metadata of a result comes from the return type annotations
        // alone." The body computed a raw value; the return type says what it
        // carries, which for a dimension-preserving operator is the receiver's
        // own parameterization.
        if (deferredReturnType !== null && deferredReturnType.Kind === 'parameterized') {
          // "The portions the matching return types evaluate to are merged into
          // one flat metadata object, each meta type contributing its `default`
          // where no matching definition mentions it."
          const governing = GoverningMetaTypes((lval as TypedNumberValue).TypeRecord && ((lval as TypedNumberValue).TypeRecord as TypeRecord).Kind === 'parameterized'
            ? ((lval as TypedNumberValue).TypeRecord as TypeRecord & { Kind: 'parameterized' }).Metadata
            : deferredReturnType.Metadata).types;
          const mergedMetadata = MergeOperatorResultMetadata(
            deferredSpokenFor.map((metaType) => ({ metaType, portion: MetadataPortion(deferredReturnType!.Metadata, metaType) })),
            governing,
          );
          deferredReturnType = { Kind: 'parameterized', Base: deferredReturnType.Base, Metadata: mergedMetadata } as unknown as TypeRecord;
          if (isTypedNumber(raw)) {
            return new TypedNumberValue((raw as TypedNumberValue).value, deferredReturnType);
          }
          if (raw instanceof NumberValue) {
            return new TypedNumberValue(Number((raw as unknown as { value: number }).value), deferredReturnType);
          }
        }
        return raw;
      }
    }
  }
  // proposal-runtime-types (operatoroverloading.md): the mirror image, where the
  // operator is declared by the RIGHT operand. Dispatch keys on the left, so this
  // would otherwise coerce and produce a value the program did not ask for.
  if (RightOperandDeclaresOperator(lval, rval, opText)) {
    return Throw.TypeError('operator $1 is declared by the right operand, but operator dispatch keys on the left operand', opText);
  }
  // proposal-runtime-types R3: typed-number arithmetic. When either operand is
  // a numeric value type and neither is a string, compute and wrap into the
  // target type. A '+' with a string operand still concatenates (handled
  // below), so this runs only for the numeric case.
  if (surroundingAgent.feature('runtime-types')
      && isTypedArithmetic(lval, rval)
      && !(lval instanceof JSStringValue)
      && !(rval instanceof JSStringValue)) {
    return typedBinary(opText as never, lval, rval, literals);
  }
  // proposal-runtime-types (rational.md): exact rational arithmetic. When both
  // operands are rationals, +, -, *, /, and ** are exact and canonical; a zero
  // divisor or a zero base to a negative power is a RangeError, and an operator
  // with no rational meaning is a TypeError.
  // proposal-runtime-types (PLAN-decimal.md stage C): the decimal operator set,
  // with IEEE 754-2008 clause 5.1's PREFERRED EXPONENT deciding which cohort
  // member results. `1.5 + 1.50` is `3.00`, not `3.0`, because addition's
  // preferred exponent is min(Q(x), Q(y)) - the rule is the standard's, and
  // taking it from there is what stops a result's significance being invented
  // per operation.
  // proposal-runtime-types #sec-which-operations-each-family-defines: the
  // complex family defines unaryMinus, exponentiate, multiply, divide, add,
  // subtract, equal, sameValue, sameValueZero and toString, and denies it
  // lessThan "since the complex numbers are not ordered", remainder, and the
  // bitwise and shift operations. The `default` below is that denial, and the
  // guard's `||` is what refuses a MIXED pair - without either, `complex(1,0) +
  // complex(2,0)` reached the string path and CONCATENATED, and every other
  // operator answered NaN.
  //
  // What the defined ones compute is C99 Annex G's, since #sec-extension-hooks
  // assigns the operators outward and Annex G is the recognized specification
  // of complex arithmetic over IEEE 754 components.
  if (surroundingAgent.feature('runtime-types') && (isComplexObject(lval) || isComplexObject(rval))) {
    // complex.md: "A real literal propagates onto the real axis, so `z + 3` and
    // `z * 2` read naturally - `2` becomes `complex(2, 0)` and the multiply
    // scales both parts - but a real VALUE does not convert on its own, so
    // `z + x` for a `complex` `z` and a `number` `x` is a TypeError."
    //
    // So the refusal is about values, not literals: a literal takes the type of
    // the position it is written in (#sec-literal-propagation), and beside a
    // complex operand that position is complex. `literals` records which side
    // the parser saw as one, the same information the numeric types use to
    // decide that `a + 1` is not a mixed-type addition.
    const liftLiteral = (other: Value, beside: ComplexObject): ComplexObject | undefined => {
      if (other instanceof NumberValue) {
        return CreateComplexValue(other.numberValue(), 0, beside.ComplexComponent, surroundingAgent.currentRealmRecord);
      }
      if (isTypedNumber(other)) {
        return CreateComplexValue(other.numberValue(), 0, beside.ComplexComponent, surroundingAgent.currentRealmRecord);
      }
      return undefined;
    };
    let left: ComplexObject;
    let right: ComplexObject;
    if (isComplexObject(lval) && isComplexObject(rval)) {
      left = lval;
      right = rval;
    } else if (isComplexObject(lval) && literals?.right) {
      const lifted = liftLiteral(rval, lval);
      if (lifted === undefined) {
        return Throw.TypeError('a complex operand requires a complex on both sides');
      }
      left = lval;
      right = lifted;
    } else if (isComplexObject(rval) && literals?.left) {
      const lifted = liftLiteral(lval, rval);
      if (lifted === undefined) {
        return Throw.TypeError('a complex operand requires a complex on both sides');
      }
      left = lifted;
      right = rval;
    } else {
      // A real VALUE would have to be converted, and the conversion into the
      // family is explicit by #sec-complex-numbers.
      return Throw.TypeError('a complex operand requires a complex on both sides');
    }
    const realmRec = surroundingAgent.currentRealmRecord;
    switch (opText) {
      case '+':
        return complexAdd(left, right, realmRec);
      case '-':
        return complexSubtract(left, right, realmRec);
      case '*':
        return complexMultiply(left, right, realmRec);
      case '/':
        return complexDivide(left, right, realmRec);
      case '**':
        return complexPow(left, right, realmRec);
      default:
        return Throw.TypeError('this operator is not defined for a complex');
    }
  }
  if (surroundingAgent.feature('runtime-types') && (isDecimalObject(lval) || isDecimalObject(rval))) {
    if (!isDecimalObject(lval) || !isDecimalObject(rval)) {
      // A decimal mixes with nothing implicitly: the other operand would have to
      // be converted, and `float64` -> decimal is the conversion the spec flags
      // as hard. Refusing is the same answer stage A gave to `decimal128(0.1)`.
      return Throw.TypeError('a decimal operand requires a decimal on both sides');
    }
    const realmRec = surroundingAgent.currentRealmRecord;
    const make = (r: { parts: { significand: bigint, exponent: number }, width: 32 | 64 | 128 }) => CreateDecimalValue(r.parts.significand, r.parts.exponent, r.width, realmRec);
    switch (opText) {
      case '+':
        return make(decimalAdd(lval, rval));
      case '-':
        return make(decimalSubtract(lval, rval));
      case '*':
        return make(decimalMultiply(lval, rval));
      case '/': {
        const q = decimalDivide(lval, rval);
        if (q === 'divide-by-zero') {
          return Throw.RangeError('division of a decimal by zero');
        }
        return make(q);
      }
      case '%': {
        const r = decimalRemainder(lval, rval);
        if (r === 'divide-by-zero') {
          return Throw.RangeError('remainder of a decimal by zero');
        }
        return make(r);
      }
      default:
        return Throw.TypeError('this operator is not defined for a decimal');
    }
  }
  if (surroundingAgent.feature('runtime-types') && isRationalObject(lval) && isRationalObject(rval)) {
    const realmRec = surroundingAgent.currentRealmRecord;
    switch (opText) {
      case '+':
        return rationalAdd(lval, rval, realmRec);
      case '-':
        return rationalSub(lval, rval, realmRec);
      case '*':
        return rationalMul(lval, rval, realmRec);
      case '/': {
        const q = rationalDiv(lval, rval, realmRec);
        if ('zero' in q) {
          return Throw.RangeError('division of a rational by zero');
        }
        return q;
      }
      case '**': {
        if (rval.RationalDenominator !== 1n) {
          return Throw.TypeError('a rational exponent must be an integer');
        }
        const p = rationalPow(lval, rval.RationalNumerator, realmRec);
        if ('zero' in p) {
          return Throw.RangeError('a zero rational to a negative power');
        }
        return p;
      }
      default:
        return Throw.TypeError('this operator is not defined for a rational');
    }
  }
  // 1. If opText is +, then
  if (opText === '+') {
    // a. Let lprim be ? ToPrimitive(lval).
    const lprim = Q(yield* ToPrimitive(lval));
    // b. Let rprim be ? ToPrimitive(rval).
    const rprim = Q(yield* ToPrimitive(rval));
    // c. If Type(lprim) is String or Type(rprim) is String, then
    if (lprim instanceof JSStringValue || rprim instanceof JSStringValue) {
      // i. Let lstr be ? ToString(lprim).
      const lstr = Q(yield* ToString(lprim));
      // ii. Let rstr be ? ToString(rprim).
      const rstr = Q(yield* ToString(rprim));
      // iii. Return the string-concatenation of lstr and rstr.
      return Value(lstr.stringValue() + rstr.stringValue());
    }
    // d. Set lval to lprim.
    lval = lprim;
    // e. Set rval to rprim.
    rval = rprim;
  }
  // 2. NOTE: At this point, it must be a numeric operation.
  // 3. Let lnum be ? ToNumeric(lval).
  const lnum = Q(yield* ToNumeric(lval));
  // 4. Let rnum be ? ToNumeric(rval).
  const rnum = Q(yield* ToNumeric(rval));
  // 5. If SameType(lNum, rNum) is false, throw a TypeError exception.
  if (!SameType(lnum, rnum)) {
    return Throw.TypeError('Cannot mix BigInt and other types in $1 operation', opText);
  }
  if (lnum instanceof BigIntValue) {
    const operations = {
      '**': BigIntValue.exponentiate,
      '*': BigIntValue.multiply,
      '/': BigIntValue.divide,
      '%': BigIntValue.remainder,
      '+': BigIntValue.add,
      '-': BigIntValue.subtract,
      '<<': BigIntValue.leftShift,
      '>>': BigIntValue.signedRightShift,
      '>>>': BigIntValue.unsignedRightShift,
      '&': BigIntValue.bitwiseAND,
      '^': BigIntValue.bitwiseXOR,
      '|': BigIntValue.bitwiseOR,
    };
    return Q(operations[opText](lnum, rnum as BigIntValue));
  } else {
    Assert(lnum instanceof NumberValue);
    const operations = {
      '**': NumberValue.exponentiate,
      '*': NumberValue.multiply,
      '/': NumberValue.divide,
      '%': NumberValue.remainder,
      '+': NumberValue.add,
      '-': NumberValue.subtract,
      '<<': NumberValue.leftShift,
      '>>': NumberValue.signedRightShift,
      '>>>': NumberValue.unsignedRightShift,
      '&': NumberValue.bitwiseAND,
      '^': NumberValue.bitwiseXOR,
      '|': NumberValue.bitwiseOR,
    };
    return Q(operations[opText](lnum, rnum as NumberValue));
  }
}
