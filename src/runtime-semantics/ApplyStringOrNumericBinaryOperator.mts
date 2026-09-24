import { SetPendingCalleeContext } from '../type-system/runtime.mts';
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
import { isTypedNumber, TypedNumberValue, VectorValue } from '../value.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { pushTypeParameterFrame, popTypeParameterFrame, TypeNodeToTypeRecord as ResolveTypeNode, RuntimeTypeOf } from '../type-system/runtime.mts';
import { makePrimitive } from '../type-system/records.mts';
import { PrimitiveParameterDefault } from '../type-system/specialization-patterns.mts';
import { MetaTypeForConstraint, MetadataPortion, GoverningMetaTypes, MergeOperatorResultMetadata, StampFamilyValue, LookupPrimitiveOperatorLevels } from '../abstract-ops/runtime-types.mts';
import { IsSubtype } from '../type-system/relations.mts';
import { MatchComponentList } from '../type-system/component-patterns.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { isTypedArithmetic, typedBinary } from '../type-system/arithmetic.mts';
import {
  isRationalObject, rationalAdd, rationalSub, rationalMul, rationalDiv, rationalPow,
} from '../intrinsics/Rational.mts';
import { Q } from '../completion.mts';
import { IsOfType } from '../type-system/runtime.mts';
import {
  isDecimalObject, decimalAdd, decimalSubtract, decimalMultiply, decimalDivide, decimalRemainder,
  DecimalPartsInRange,
  CreateDecimalValue,
} from '../intrinsics/Decimal.mts';
import {
  Assert, R, Throw, ToNumeric, ToPrimitive, ToString, surroundingAgent, Call, LookupClassOperator, EnterOperatorBody, LeaveOperatorBody, RightOperandDeclaresOperator } from '#self';


/**
 * The inverse of the metadata projection: an ~object~ Type Record whose
 * properties reproduce a metadata value, so that `Base.<D>` with D bound to it
 * rebuilds the same parameterization. Each property is a ~literal~ record,
 * which is the form the projection hands back unchanged.
 */
export function metadataAsObjectRecord(metadata: MetadataRecord): TypeRecord {
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
export function* ApplyStringOrNumericBinaryOperator(lval: Value, opText: BinaryOperator, rval: Value, literals?: { left: boolean, right: boolean, leftLetConst?: boolean, rightLetConst?: boolean }, contextualType?: TypeRecord) {
  (globalThis as { __a?: string[] }).__a?.push(`apply ${opText}`);
  // proposal-runtime-types #sec-vector-types: a vector's values are "the
  // sequences of N values of T", so an operator over two vectors of one shape
  // applies LANE-WISE. This is what the rest of the SIMD surface is for - the
  // design's own dot product is `(a * b).sum()`, so an engine with swizzle and
  // sum and no `*` cannot run the example that motivates sum.
  if (surroundingAgent.feature('runtime-types')
      && (lval.type === 'Vector' || rval.type === 'Vector')) {
    // #sec-primitive-operator-blocks: a block over `vector` speaks for a vector
    // receiver before the lane-wise operation, as a block does for any other
    // primitive; it was never consulted, so the design's dimensioned-vector
    // block had nothing to apply to.
    if (lval.type === 'Vector') {
      const dispatched = Q(yield* DispatchPrimitiveBlockOperator(lval, opText, rval));
      if (isBodylessContributions(dispatched)) {
        EnterOperatorBody();
        let raw;
        try {
          raw = Q(yield* vectorBinaryOperator(lval, opText, rval));
        } finally {
          LeaveOperatorBody();
        }
        return StampBodylessContributions(lval, raw as Value, dispatched);
      }
      if (dispatched !== undefined) {
        return dispatched;
      }
    }
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
      SetPendingCalleeContext(contextualType);
      try {
        return Q(yield* Call(opFn as never, lval, [rval]));
      } finally {
        SetPendingCalleeContext(undefined);
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
  {
    const dispatched = Q(yield* DispatchPrimitiveBlockOperator(lval, opText, rval));
    if (isBodylessContributions(dispatched)) {
      // No definition with a body: the primitive operation computes the value,
      // with block lookups suspended as within an operator body, and the
      // bodyless definitions supply its metadata.
      EnterOperatorBody();
      let raw;
      try {
        // Typed explicitly: the recursive reference would make this function's
        // inferred return type circular.
        const primitiveOperation = ApplyStringOrNumericBinaryOperator as unknown as (
          l: Value, o: BinaryOperator, r: Value, lit?: typeof literals, c?: TypeRecord,
        ) => PlainEvaluator<Value>;
        raw = Q(yield* primitiveOperation(lval, opText, rval, literals, contextualType));
      } finally {
        LeaveOperatorBody();
      }
      return StampBodylessContributions(lval, raw as Value, dispatched);
    }
    if (dispatched !== undefined) {
      return dispatched;
    }
  }
  if (RightOperandDeclaresOperator(lval, rval, opText)) {
    return Throw.TypeError('operator $1 is declared by the right operand, but operator dispatch keys on the left operand', opText);
  }
  // A rational power accepts an integer exponent, independently of the
  // rational base's representation. Do this before same-type numeric mixing.
  if (surroundingAgent.feature('runtime-types') && opText === '**' && isRationalObject(lval)
    && (rval instanceof NumberValue || rval instanceof BigIntValue || isTypedNumber(rval))) {
    if (isTypedNumber(rval)) {
      const type = rval.TypeRecord as TypeRecord;
      if (type.Kind !== 'primitive' || !['int', 'uint'].includes(type.Name)) {
        return Throw.TypeError('a rational exponent must be an integer');
      }
    }
    const exponent = isTypedNumber(rval) ? rval.value : R(rval);
    if (typeof exponent === 'number' && !Number.isInteger(exponent)) {
      return Throw.TypeError('a rational exponent must be an integer');
    }
    const result = rationalPow(lval, BigInt(exponent), surroundingAgent.currentRealmRecord);
    return 'zero' in result ? Throw.RangeError('a zero rational to a negative power') : result;
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
  // proposal-runtime-types: the decimal operator set,
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
      // as hard. Refusing is the same answer given to `decimal128(0.1)`.
      return Throw.TypeError('a decimal operand requires a decimal on both sides');
    }
    const realmRec = surroundingAgent.currentRealmRecord;
    // A result outside the width's exponent range is a *RangeError*, which is
    // how a decimal differs from a float: #sec-numeric-types says "a float
    // already saturates, to an infinity, and a decimal already raises a
    // *RangeError*, since a decimal's range is a property of the type rather
    // than of the format".
    //
    // It did not. `decimal32('9e90') * decimal32('9e90')` answered 8.1e181, a
    // value no `decimal32` holds, and `decimal32('9e96') + decimal32('9e96')`
    // answered 1.8e97 the same way - silently, and typed `decimal32`. Every
    // operator builds its result here, so the check belongs here rather than in
    // each arm.
    const make = (r: { parts: { significand: bigint, exponent: number }, width: 32 | 64 | 128 }) => {
      if (!DecimalPartsInRange(r.parts, r.width)) {
        return Throw.RangeError('a decimal result is outside the range of $1', Value(`decimal${r.width}`));
      }
      return CreateDecimalValue(r.parts.significand, r.parts.exponent, r.width, realmRec);
    };
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

interface PreparedPrimitiveOperator {
  readonly entry: { readonly fn: unknown };
  readonly frame: Map<string, TypeRecord> | null;
  readonly parameter: TypeRecord | null;
  readonly returnType: TypeRecord | null;
  readonly spokenFor: object[];
  /** The operand is written without the block's captures: `uint.<16>`, not `uint.<W>`. */
  readonly fixed: boolean;
}

/** Whether a deferred definition's operand annotation names one of its block's captures. */
function OperandNamesCapture(deferred: { readonly parameterTypeNode?: unknown, readonly parameterNames?: readonly string[], readonly componentNames?: readonly string[] } | undefined): boolean {
  if (!deferred?.parameterTypeNode) {
    return false;
  }
  const names = new Set([...(deferred.parameterNames ?? []), ...(deferred.componentNames ?? [])]);
  const scan = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.some(scan);
    }
    const n = value as { type?: string, name?: string };
    if (n.type === 'IdentifierReference' && typeof n.name === 'string' && names.has(n.name)) {
      return true;
    }
    return Object.entries(n).some(([k, x]) => k !== 'parent' && k !== 'location' && scan(x));
  };
  return scan(deferred.parameterTypeNode);
}

/**
 * The admitting definition whose operand type is a subtype of every other's,
 * *undefined* where none admits, or ~ambiguous~. A definition with no operand
 * type admits everything and is the least specific.
 */
function MostSpecificPrimitiveOperator(candidates: readonly PreparedPrimitiveOperator[]): PreparedPrimitiveOperator | 'ambiguous' | undefined {
  if (candidates.length <= 1) {
    return candidates[0];
  }
  // Equal operand types at this receiver - `uint.<W>` with W bound to 16
  // beside `uint.<16>` - are ordered as patterns are: a fixed operand is more
  // specific than one naming a capture (plan section 6.1).
  const atLeastAsSpecific = (c: PreparedPrimitiveOperator, d: PreparedPrimitiveOperator) => {
    if (d.parameter === null) {
      return c.parameter !== null || c.fixed || !d.fixed;
    }
    if (c.parameter === null || !IsSubtype(c.parameter, d.parameter, [])) {
      return false;
    }
    return !IsSubtype(d.parameter, c.parameter, []) || c.fixed || !d.fixed;
  };
  const winners = candidates.filter((c) => candidates.every((d) => d === c || atLeastAsSpecific(c, d)));
  return winners.length === 1 ? winners[0] : 'ambiguous';
}


/**
 * #sec-primitive-operator-blocks: the definition a primitive block gives the
 * binary operator _opText_ for the receiver _lval_ and the operand _rval_,
 * invoked, or *undefined* where no block's definition admits the pair. Shared
 * by the arithmetic, relational, and equality operators, which dispatch alike:
 * the receiver's exact block before its family's, and within a level the most
 * specific admitting operand, an ambiguity being a *TypeError*.
 */
export function* DispatchPrimitiveBlockOperator(lval: Value, opText: string, rval: Value): PlainEvaluator<Value | BodylessContributions | undefined> {
  if (!surroundingAgent.feature('runtime-types') || (lval instanceof ObjectValue && !isComplexObject(lval) && !isRationalObject(lval))) {
    return undefined;
  }
  // The admitting definitions WITHOUT a body, from every level: each
  // contributes its meta type's portion of the result's metadata, whichever
  // definition with a body - or the primitive operation - computes the value.
  const contributions: PreparedPrimitiveOperator[] = [];
  const contributedPortions = new Map<object, MetadataRecord>();
    // "at most one definition with a body may match ... where no definition
    // with a body matches, the primitive operation runs". MATCHING is on the
    // right operand against the definition's parameter type, and skipping that
    // test is not a shortcut: a `primitive number { operator *(rhs: V) }` would
    // otherwise capture EVERY multiplication of two numbers in the program and
    // fail on its own parameter. The definitions are tried in declaration
    // order; the checker refuses a second definition for one pair of types, so
    // where parameter types are known at most one admits the operand.
    // #sec-primitive-operator-blocks: within the most specific block level
    // with an admitting definition, the definition whose operand type is the
    // most specific is chosen, whatever the declaration order - the rule the
    // language's function overloads already follow - and admitting
    // definitions none of which is more specific than the rest are an
    // ambiguity, as an ambiguous call is. Every definition of a level is
    // therefore prepared before any is invoked.
    for (const level of LookupPrimitiveOperatorLevels(lval, opText)) {
    const candidates: PreparedPrimitiveOperator[] = [];
    for (const entry of level) {
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
      let entryFrame: Map<string, TypeRecord> | null = null;
      const componentNames = entry.deferred?.componentNames ?? [];
      const componentList = entry.deferred?.componentList as ParseNode.TypeParameters | undefined;
      let componentMismatch = false;
      if (entry.deferred && (isTypedNumber(lval) || isComplexObject(lval) || isRationalObject(lval) || componentNames.length > 0 || componentList)) {
        const carried = RuntimeTypeOf(lval);
        if (carried.Kind === 'parameterized' || componentNames.length > 0 || componentList) {
          const frame = new Map<string, TypeRecord>();
          // A component list with a nested pattern is matched against the
          // receiver's own arguments by the specialization matcher: the
          // lanes' type and count of a vector. A receiver it does not match
          // is one the definition does not speak for.
          if (componentList) {
            const receiverBase = carried.Kind === 'parameterized' ? carried.Base : carried;
            const matched = receiverBase.Kind === 'primitive'
              ? MatchComponentList(componentList, entry.deferred.componentPrimitive!, receiverBase.Arguments ?? [], (n) => entry.deferred!.componentResolved?.get(n) ?? null)
              : null;
            if (matched) {
              for (const [name, value] of matched) {
                frame.set(name, value);
              }
            } else {
              componentMismatch = true;
            }
          }
          // #sec-primitive-operator-blocks: a COMPONENT capture is bound from
          // the receiver's own argument at its position - `complex128`'s
          // `float64`, `uint16`'s `16` - and a width is bound as the literal a
          // written value argument resolves to. A position the record leaves
          // out holds the primitive's default.
          const base = carried.Kind === 'parameterized' ? carried.Base : carried;
          componentNames.forEach((name, i) => {
            const index = entry.deferred!.componentIndices?.[i] ?? i;
            const argument = base.Kind === 'primitive' ? (base.Arguments ?? [])[index] ?? PrimitiveParameterDefault(base.Name, index) : undefined;
            if (argument !== undefined) {
              frame.set(name, typeof argument === 'number'
                ? { Kind: 'literal', Value: Value(argument), Base: makePrimitive('number') } as unknown as TypeRecord
                : argument as TypeRecord);
            }
          });
          // The meta type each parameter speaks for, resolved from its
          // constraint, so the parameter binds to THAT meta type's portion.
          const spokenFor: object[] = [];
          for (let pi = 0; pi < entry.deferred.parameterNames.length && carried.Kind === 'parameterized'; pi += 1) {
            const name = entry.deferred.parameterNames[pi]!;
            const constraintNode = entry.deferred.parameterConstraints?.[pi];
            let portion = carried.Metadata;
            if (constraintNode) {
              const constraint = Q(yield* ResolveTypeNode(constraintNode as never));
              const metaType = MetaTypeForConstraint(constraint);
              if (metaType !== undefined) {
                spokenFor.push(metaType);
                portion = MetadataPortion(carried.Metadata, metaType);
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
            frame.set(name, metadataAsObjectRecord((carried as TypeRecord & { Kind: 'parameterized' }).Metadata));
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
          entryFrame = frame;
          if (entry.deferred.parameterTypeNode) {
            deferredParameterType = Q(yield* ResolveTypeNode(entry.deferred.parameterTypeNode as never));
          }
          if (entry.deferred.returnTypeNode) {
            deferredReturnType = Q(yield* ResolveTypeNode(entry.deferred.returnTypeNode as never));
          }
        }
      }
      const effectiveParameter = deferredParameterType ?? entry.parameterType;
      let admits: boolean;
      if (componentMismatch) {
        admits = false;
      } else if (effectiveParameter === null) {
        admits = true;
      } else {
        admits = Q(yield* IsOfType(rval, effectiveParameter));
      }
      if (framePushed) {
        popTypeParameterFrame();
        framePushed = false;
      }
      if (admits && chosenBodyless(entry)) {
        if (deferredReturnType?.Kind === 'parameterized' || isVectorType(deferredReturnType)) {
          contributions.push({
            entry, frame: entryFrame, parameter: effectiveParameter, returnType: deferredReturnType, spokenFor: deferredSpokenFor, fixed: true,
          });
        }
      } else if (admits) {
        candidates.push({
          entry,
          frame: entryFrame,
          parameter: effectiveParameter,
          returnType: deferredReturnType,
          spokenFor: deferredSpokenFor,
          fixed: !OperandNamesCapture(entry.deferred),
        });
      }
    }
    const chosen = MostSpecificPrimitiveOperator(candidates);
    if (chosen === 'ambiguous') {
      return Throw.TypeError('$1', `operator ${opText} is ambiguous for this operand: two definitions of one primitive block level admit it, and neither operand type is more specific than the other`);
    }
    if (chosen === undefined) {
      continue;
    }
    // The bodyless definitions' portions join the chosen definition's own.
    for (const c of contributions) {
      for (const metaType of c.spokenFor) {
        if (!chosen.spokenFor.includes(metaType)) {
          chosen.spokenFor.push(metaType);
          contributedPortions.set(metaType, MetadataPortion((c.returnType as TypeRecord & { Kind: 'parameterized' }).Metadata, metaType));
        }
      }
    }
    let deferredReturnType = chosen.returnType;
    const deferredSpokenFor = chosen.spokenFor;
    // The frame stays pushed for the WHOLE invocation: the operator's own
    // parameter boundary resolves the block's names when the body is entered.
    if (chosen.frame) {
      pushTypeParameterFrame(chosen.frame);
    }
    EnterOperatorBody();
    let raw;
    try {
      raw = Q(yield* Call(chosen.entry.fn as never, lval, [rval]));
    } finally {
      LeaveOperatorBody();
      if (chosen.frame) {
        popTypeParameterFrame();
      }
    }
    if (deferredReturnType !== null && deferredReturnType.Kind === 'parameterized') {
      const receiverType = RuntimeTypeOf(lval);
      const governing = GoverningMetaTypes(receiverType.Kind === 'parameterized'
        ? receiverType.Metadata
        : deferredReturnType.Metadata).types;
      const returnMetadata = deferredReturnType.Metadata;
      const mergedMetadata = MergeOperatorResultMetadata(
        deferredSpokenFor.map((metaType) => ({ metaType, portion: contributedPortions.get(metaType) ?? MetadataPortion(returnMetadata, metaType) })),
        governing,
      );
      deferredReturnType = { Kind: 'parameterized', Base: deferredReturnType.Base, Metadata: mergedMetadata } as unknown as TypeRecord;
      if (isTypedNumber(raw)) {
        return new TypedNumberValue((raw as TypedNumberValue).value, deferredReturnType);
      }
      const stamped = StampFamilyValue(raw, deferredReturnType);
      if (stamped !== undefined) {
        return stamped;
      }
      if (raw instanceof NumberValue) {
        return new TypedNumberValue(Number((raw as unknown as { value: number }).value), deferredReturnType);
      }
    }
    return raw;
    }
  return contributions.length > 0 ? { contributions } : undefined;
}

/** The bodyless definitions admitting an operand where no definition with a body does. */
export interface BodylessContributions {
  readonly contributions: readonly PreparedPrimitiveOperator[];
}

export function isBodylessContributions(value: unknown): value is BodylessContributions {
  return typeof value === 'object' && value !== null && !(value instanceof Value) && 'contributions' in value;
}

/** A registered definition without a body has no function to call. */
function chosenBodyless(entry: { readonly fn: unknown }): boolean {
  return entry.fn === Value.undefined;
}

/**
 * #sec-primitive-operator-blocks: the primitive operation's result _raw_
 * carrying the metadata the matching bodyless definitions contribute - each
 * meta type's portion from its definition's return type, and the default of
 * every other governing meta type.
 */
/** A vector type, whose metadata is its lane type's. */
function isVectorType(t: TypeRecord | null | undefined): boolean {
  return !!t && t.Kind === 'primitive' && t.Name === 'vector';
}

export function StampBodylessContributions(lval: Value, raw: Value, found: BodylessContributions): Value {
  // A vector's metadata is its LANES': the contributing definition's return
  // type is the result's type, with each lane carrying its lane type. One
  // contribution decides it; the per-meta-type merge of a scalar's portions
  // has no counterpart until a lane is governed by several meta types.
  if ((raw as { type?: string }).type === 'Vector') {
    const vector = raw as unknown as VectorValue;
    const vectorReturns = found.contributions.map((c) => c.returnType).filter(isVectorType) as (TypeRecord & { Kind: 'primitive' })[];
    if (vectorReturns.length !== 1) {
      return raw;
    }
    const resultType = vectorReturns[0];
    const laneType = resultType.Arguments[0] as TypeRecord;
    const lanes = vector.lanes.map((lane: Value) => (isTypedNumber(lane) ? new TypedNumberValue((lane as TypedNumberValue).value, laneType) : lane));
    return new VectorValue(lanes, resultType) as unknown as Value;
  }
  const portions = found.contributions.flatMap((c) => c.spokenFor.map((metaType) => ({
    metaType, portion: MetadataPortion((c.returnType as TypeRecord & { Kind: 'parameterized' }).Metadata, metaType),
  })));
  if (portions.length === 0) {
    return raw;
  }
  const receiverType = RuntimeTypeOf(lval);
  const first = found.contributions[0].returnType as TypeRecord & { Kind: 'parameterized' };
  const governing = GoverningMetaTypes(receiverType.Kind === 'parameterized' ? receiverType.Metadata : first.Metadata).types;
  const merged = MergeOperatorResultMetadata(portions, governing);
  const rawType = RuntimeTypeOf(raw);
  const base = rawType.Kind === 'parameterized' ? rawType.Base : rawType;
  const stampedType = { Kind: 'parameterized', Base: base, Metadata: merged } as unknown as TypeRecord;
  if (isTypedNumber(raw)) {
    return new TypedNumberValue((raw as TypedNumberValue).value, stampedType);
  }
  return StampFamilyValue(raw, stampedType) ?? raw;
}

