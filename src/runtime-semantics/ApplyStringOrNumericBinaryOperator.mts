import { SetPendingCalleeContext, markValueParameterBinding, SetMetadataCaptureDomain } from '../type-system/runtime.mts';
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
import { pushTypeParameterFrame, popTypeParameterFrame, TypeNodeToTypeRecord as ResolveTypeNode, RuntimeTypeOf, IsOfType } from '../type-system/runtime.mts';
import { makePrimitive } from '../type-system/records.mts';
import { PrimitiveParameterDefault } from '../type-system/specialization-patterns.mts';
import { MetaTypeForConstraint, MetadataPortion, MetaTypeGoverns, GoverningMetaTypes, MergeOperatorResultMetadata, StampFamilyValue, LookupPrimitiveOperatorLevels, MetadataOperandAdmits, MetadataOperandExact, MergeMetadataOperandRequirements, ConvertMetadataOperand } from '../abstract-ops/runtime-types.mts';
import { SameMetadata, SameType as SameTypeRecord } from '../type-system/relations.mts';
import { MatchComponentList } from '../type-system/component-patterns.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { isTypedArithmetic, typedBinary, AdoptLiteralOperand } from '../type-system/arithmetic.mts';
import {
  isRationalObject, rationalAdd, rationalSub, rationalMul, rationalDiv, rationalPow,
} from '../intrinsics/Rational.mts';
import { Q, type ThrowCompletion } from '../completion.mts';
import { isDecimalObject, decimalAdd, decimalSubtract, decimalMultiply, decimalDivide, decimalRemainder, DecimalFromResult } from '../intrinsics/Decimal.mts';
import { isFloat128Object, Float128ToBinary128, Binary128ToFloat128 } from '../intrinsics/Float128.mts';
import {
  add as float128Add, subtract as float128Subtract, multiply as float128Multiply, divide as float128Divide,
  remainder as float128Remainder, type Binary128,
} from '../intrinsics/Float128Arithmetic.mts';
import { pow as float128Pow } from '../intrinsics/Float128Transcendental.mts';
import {
  Assert, R, Throw, ToNumeric, ToPrimitive, ToString, surroundingAgent, Call, LookupClassOperator, EnterOperatorBody, LeaveOperatorBody, RightOperandDeclaresOperator } from '#self';


/**
 * The inverse of the metadata projection: an ~object~ Type Record whose
 * properties reproduce a metadata value, so that `Base.<D>` with D bound to it
 * rebuilds the same parameterization. Each property is a ~literal~ record,
 * which is the form the projection hands back unchanged.
 */
export function metadataAsObjectRecord(metadata: MetadataRecord, domain?: TypeRecord): TypeRecord {
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
  const record = { Kind: 'object', Properties, IndexSignatures: [] } as unknown as TypeRecord;
  if (domain) SetMetadataCaptureDomain(record, domain);
  return record;
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '<<' | '>>' | '>>>' | '&' | '^' | '|';
/** https://tc39.es/ecma262/#sec-applystringornumericbinaryoperator */
export function* ApplyStringOrNumericBinaryOperator(lval: Value, opText: BinaryOperator, rval: Value, literals?: { left: boolean, right: boolean, leftLetConst?: boolean, rightLetConst?: boolean }, contextualType?: TypeRecord) {
  if (surroundingAgent.feature('runtime-types') && literals
      && (RuntimeTypeOf(lval).Kind === 'parameterized' || RuntimeTypeOf(rval).Kind === 'parameterized')) {
    const adopted = AdoptLiteralOperand(lval, rval, literals);
    if (adopted) {
      lval = adopted.left; rval = adopted.right;
    }
  }
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
          raw = Q(yield* vectorBinaryOperator(WithoutMetadata(lval), opText, WithoutMetadata(dispatched.operand ?? rval)));
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
        raw = Q(yield* primitiveOperation(WithoutMetadata(lval), opText, WithoutMetadata(dispatched.operand ?? rval), literals, contextualType));
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
  // proposal-runtime-types #sec-which-operations-each-family-defines: a float128
  // is a binary float, so it defines add, subtract, multiply, divide, remainder
  // and exponentiate - each computed exactly and rounded once, in
  // Float128Arithmetic. Without this branch every operator fell through to
  // ToNumeric, whose valueOf rounded each operand to a double, and answered a
  // plain Number: double arithmetic that looked like float128 arithmetic.
  if (surroundingAgent.feature('runtime-types') && (isFloat128Object(lval) || isFloat128Object(rval))) {
    if (!isFloat128Object(lval) || !isFloat128Object(rval)) {
      // No implicit conversion: a literal operand is read at float128 by the
      // checker, so what reaches here is a value of another type.
      return Throw.TypeError('a float128 operand requires a float128 on both sides');
    }
    const a = Float128ToBinary128(lval);
    const b = Float128ToBinary128(rval);
    const done = (v: Binary128) => Binary128ToFloat128(v, surroundingAgent.currentRealmRecord);
    switch (opText) {
      case '+': return done(float128Add(a, b));
      case '-': return done(float128Subtract(a, b));
      case '*': return done(float128Multiply(a, b));
      case '/': return done(float128Divide(a, b));
      case '%': return done(float128Remainder(a, b));
      // The exact route where there is one, and exp(y ln x) correctly rounded -
      // the float128 plan's B4 - where there is not.
      case '**': return done(float128Pow(a, b));
      default:
        return Throw.TypeError('this operator is not defined for a float128');
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
    const make = (r: Parameters<typeof DecimalFromResult>[0]) => DecimalFromResult(r, realmRec);
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
  readonly entry: ReturnType<typeof LookupPrimitiveOperatorLevels>[number][number];
  readonly frame: Map<string, TypeRecord> | null;
  parameter: TypeRecord | null;
  returnType: TypeRecord | null;
  readonly spokenFor: object[];
  /** The operand is written without the block's captures: `uint.<16>`, not `uint.<W>`. */
  readonly fixed: boolean;
}

/** Whether a deferred definition's operand annotation names one of its block's captures. */
export function OperandNamesCapture(deferred: {
  readonly parameterTypeNode?: unknown, readonly parameterNames?: readonly string[], readonly componentNames?: readonly string[],
  readonly captureDeclarations?: readonly unknown[],
} | undefined): boolean {
  if (!deferred?.parameterTypeNode) {
    return false;
  }
  const declared = (deferred.captureDeclarations ?? []).map((c) => (c as { BindingIdentifier: { name: string } }).BindingIdentifier.name);
  const names = new Set([...(deferred.parameterNames ?? []), ...(deferred.componentNames ?? []), ...declared]);
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
export function* MostSpecificPrimitiveOperator<T extends { parameter: TypeRecord | null, fixed: boolean }>(candidates: readonly T[], operand: TypeRecord): PlainEvaluator<T | 'ambiguous' | undefined> {
  const winners: T[] = [];
  for (const c of candidates) {
    let wins = true;
    for (const d of candidates) {
      if (c === d) continue;
      if (d.parameter === null) {
        if (c.parameter === null && !c.fixed && d.fixed) wins = false; continue;
      }
      if (c.parameter === null) {
        wins = false; break;
      }
      if (!Q(yield* MetadataOperandAdmits(c.parameter, d.parameter, false))) {
        wins = false; break;
      }
      if (!Q(yield* MetadataOperandAdmits(d.parameter, c.parameter, false))) continue;
      if (SameTypeRecord(c.parameter, d.parameter)) {
        if (!c.fixed && d.fixed) wins = false;
      } else {
        if (!MetadataOperandExact(operand, c.parameter) || MetadataOperandExact(operand, d.parameter)) wins = false;
      }
    }
    if (wins) winners.push(c);
  }
  return candidates.length === 0 ? undefined : winners.length === 1 ? winners[0] : 'ambiguous';
}

/** Metadata uses subtype admission; ordinary literal and structural operands
 * still require the value membership judgment, not just its widened type. */
function* PrimitiveOperandAdmits(value: Value, target: TypeRecord): PlainEvaluator<boolean> {
  if (target.Kind === 'union') {
    for (const member of target.Members) {
      const admits = Q(yield* PrimitiveOperandAdmits(value, member));
      if (admits) return true;
    }
    return false;
  }
  if (target.Kind === 'parameterized' || (target.Kind === 'primitive' && target.Name === 'vector')) {
    return Q(yield* MetadataOperandAdmits(RuntimeTypeOf(value), target));
  }
  return Q(yield* IsOfType(value, target));
}

/** Rebind operand captures and defer result builders until conversion is done. */
function* FinishPrimitiveOperator(prepared: PreparedPrimitiveOperator, operand: Value): PlainEvaluator<boolean> {
  const deferred = prepared.entry.deferred;
  if (prepared.frame && deferred) {
    pushTypeParameterFrame(prepared.frame);
    try {
      const names = deferred.operatorParameterNames ?? [];
      for (let i = 0; i < names.length; i += 1) {
        const domainNode = deferred.operatorParameterConstraints?.[i];
        const domain = domainNode ? Q(yield* ResolveTypeNode(domainNode as never)) : undefined;
        const metaType = domain ? MetaTypeForConstraint(domain) : undefined;
        const carried = RuntimeTypeOf(operand);
        let portion = carried.Kind === 'parameterized' ? carried.Metadata : {} as MetadataRecord;
        if (metaType) portion = MetadataPortion(portion, metaType);
        prepared.frame.set(names[i]!, markValueParameterBinding(metadataAsObjectRecord(portion, domain)));
      }
      if (deferred.parameterTypeNode) {
        prepared.parameter = Q(yield* ResolveTypeNode(deferred.parameterTypeNode as never));
      }
      if (prepared.parameter) {
        const admits = Q(yield* PrimitiveOperandAdmits(operand, prepared.parameter));
        if (!admits) return false;
      }
      if (deferred.returnTypeNode) {
        prepared.returnType = Q(yield* ResolveTypeNode(deferred.returnTypeNode as never));
      }
    } finally {
      popTypeParameterFrame();
    }
  }
  return true;
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
  if (!surroundingAgent.feature('runtime-types') || (lval instanceof ObjectValue && !isComplexObject(lval) && !isRationalObject(lval) && !isDecimalObject(lval) && !isFloat128Object(lval))) {
    return undefined;
  }
  const receiverType = RuntimeTypeOf(lval);
  const operandType = RuntimeTypeOf(rval);
  const plainReceiver = receiverType.Kind === 'primitive'
    && !(receiverType.Name === 'vector' && (receiverType.Arguments[0] as TypeRecord)?.Kind === 'parameterized');
  const protectedPair = plainReceiver && (opText.startsWith('unary ') || SameTypeRecord(receiverType, operandType));
  // Protect both the value and the result's metadata. A bodyless definition
  // returning Meter would otherwise change the type of ordinary plain + plain.
  if (protectedPair) return undefined;
  // The admitting definitions WITHOUT a body, from every level: each
  // contributes its meta type's portion of the result's metadata, whichever
  // definition with a body - or the primitive operation - computes the value.
  const contributions: PreparedPrimitiveOperator[] = [];
  let selected: PreparedPrimitiveOperator | undefined;
  const contributedPortions = new Map<object, MetadataRecord>();
  // Select at the first receiver level with an admitting body. Within a
  // level, specificity and the exact-metadata tie-break decide; declaration
  // order never selects a body. Bodyless contributions may come from any level.
  for (const level of LookupPrimitiveOperatorLevels(lval, opText)) {
    const candidates: PreparedPrimitiveOperator[] = [];
    for (const entry of level) {
      // #sec-primitive-operator-blocks: a PARAMETERIZED block declares its
      // operators "for each parameterization its parameters admit", so the
      // block's parameter is bound from the RECEIVER and the operand and result
      // types are resolved against that binding. `operator +(rhs: float64.<D>):
      // float64.<D>` is then dimension-preserving addition: it admits an
      // operand admitted by the receiver's requirement, converting after
      // selection, and the result carries the declared metadata.
      let deferredParameterType = null;
      const deferredReturnType = null;
      let framePushed = false;
      let deferredSpokenFor: object[] = [];
      let entryFrame: Map<string, TypeRecord> | null = null;
      const componentNames = entry.deferred?.componentNames ?? [];
      const componentList = entry.deferred?.componentList as ParseNode.TypeParameters | undefined;
      let componentMismatch = false;
      let effectiveParameter: TypeRecord | null = null;
      let admits = false;
      try {
        if (entry.deferred) {
          const carried = RuntimeTypeOf(lval);
          {
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
                  // A nested metadata capture - `D` of `float32.<const D:
                  // Dimensions>` - is a value parameter: an expression, and a
                  // builder such as `multiplyDimensions(D, D2)`, reads it as the
                  // metadata object. Component bindings of object kind are only
                  // such portions; lanes and components are numeric types.
                  frame.set(name, value.Kind === 'object' ? markValueParameterBinding(value) : value);
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
            pushTypeParameterFrame(frame);
            framePushed = true;
            entryFrame = frame;
            // The meta type each parameter speaks for, resolved from its
            // constraint, so the parameter binds to THAT meta type's portion.
            const spokenFor: object[] = [];
            for (let pi = 0; pi < entry.deferred.parameterNames.length; pi += 1) {
              const name = entry.deferred.parameterNames[pi]!;
              const constraintNode = entry.deferred.parameterConstraints?.[pi];
              let constraint: TypeRecord | undefined;
              let portion = carried.Kind === 'parameterized' ? carried.Metadata : Object.freeze(Object.create(null)) as MetadataRecord;
              if (constraintNode) {
                constraint = Q(yield* ResolveTypeNode(constraintNode as never));
                const metaType = MetaTypeForConstraint(constraint);
                if (metaType !== undefined) {
                  spokenFor.push(metaType);
                  portion = MetadataPortion(portion, metaType);
                }
              }
              frame.set(name, markValueParameterBinding(metadataAsObjectRecord(portion, constraint)));
            }
            deferredSpokenFor = spokenFor;
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
            if (operatorNames.length > 0) {
              const argCarried = RuntimeTypeOf(rval);
              // The portion of the operand's metadata the parameter's meta type
              // claims, as a block capture binds - `Y: Dim` over a value that also
              // carries bounds binds its Dim portion.
              let argPortion = argCarried.Kind === 'parameterized' ? argCarried.Metadata : Object.freeze(Object.create(null)) as MetadataRecord;
              const argConstraint = entry.deferred.operatorParameterConstraints?.[0];
              let constraint: TypeRecord | undefined;
              if (argConstraint) {
                constraint = Q(yield* ResolveTypeNode(argConstraint as never));
                const metaType = MetaTypeForConstraint(constraint);
                if (metaType !== undefined) {
                  argPortion = MetadataPortion(argPortion, metaType);
                }
              }
              frame.set(operatorNames[0]!, markValueParameterBinding(metadataAsObjectRecord(argPortion, constraint)));
            }
            if (entry.deferred.parameterTypeNode) {
              deferredParameterType = Q(yield* ResolveTypeNode(entry.deferred.parameterTypeNode as never));
            }

          }
        }
        effectiveParameter = deferredParameterType ?? entry.parameterType;
        if (componentMismatch) {
          admits = false;
        } else if (effectiveParameter === null) {
          admits = true;
        } else {
          admits = Q(yield* PrimitiveOperandAdmits(rval, effectiveParameter));
        }
      } finally {
        if (framePushed) popTypeParameterFrame();
      }
      if (!componentMismatch && chosenBodyless(entry)) {
        if (entry.deferred?.returnTypeNode) {
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
    if (!selected) {
      const winner = Q(yield* MostSpecificPrimitiveOperator(candidates, RuntimeTypeOf(rval)));
      if (winner === 'ambiguous') return Throw.TypeError('operator $1 is ambiguous for this operand', opText);
      selected = winner;
    }
  }
  let effectiveOperand = rval;
  if (selected?.parameter) {
    effectiveOperand = Q(yield* ConvertMetadataOperand(rval, selected.parameter));
  }
  if (!selected) {
    // Bodyless contracts may require one conversion, never successive conflicting
    // conversions. Fresh operand captures already match and impose no conversion.
    let target: TypeRecord | undefined;
    for (const c of contributions) {
      if (!c.parameter || MetadataOperandExact(RuntimeTypeOf(rval), c.parameter)) continue;
      if (!Q(yield* MetadataOperandAdmits(RuntimeTypeOf(rval), c.parameter))) continue;
      const combined = target ? MergeMetadataOperandRequirements(target, c.parameter) : c.parameter;
      if (!combined) return Throw.TypeError('bodyless operator $1 has incompatible operand conversion requirements', opText);
      target = combined;
    }
    if (target) {
      effectiveOperand = Q(yield* ConvertMetadataOperand(rval, target));
    }
  }
  const applicable: PreparedPrimitiveOperator[] = [];
  for (const c of contributions) {
    const applies = Q(yield* FinishPrimitiveOperator(c, effectiveOperand));
    if (applies && c.returnType) applicable.push(c);
  }
  if (selected) {
    const chosen = selected;
    const finished = Q(yield* FinishPrimitiveOperator(chosen, effectiveOperand));
    if (!finished) return Throw.TypeError('the selected operator no longer admits its converted operand');
    // The bodyless definitions' portions join the chosen definition's own.
    for (const c of applicable) {
      if (c.returnType?.Kind !== 'parameterized') continue;
      for (const metaType of c.spokenFor) {
        const portion = MetadataPortion(c.returnType.Metadata, metaType);
        const prior = contributedPortions.get(metaType);
        if (prior && !SameMetadata(prior, portion)) return Throw.TypeError('bodyless operator $1 has conflicting result metadata', opText);
        if (!chosen.spokenFor.includes(metaType)) {
          chosen.spokenFor.push(metaType);
          contributedPortions.set(metaType, portion);
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
      raw = Q(yield* Call(chosen.entry.fn as never, WithoutMetadata(lval), [WithoutMetadata(effectiveOperand)]));
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
      deferredReturnType = ResultWithMetadata(deferredReturnType.Base, mergedMetadata);
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
  return applicable.length > 0 ? { contributions: applicable, operand: effectiveOperand } : undefined;
}

/** The bodyless definitions admitting an operand where no definition with a body does. */
export interface BodylessContributions {
  readonly contributions: readonly PreparedPrimitiveOperator[];
  readonly operand?: Value;
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
/**
 * #sec-primitive-operator-blocks: "where no definition with a body matches,
 * the primitive operation runs" - on the VALUES, whose metadata the bodyless
 * definitions supply. The operands are handed to it as their base type, so a
 * `Dimensions` operator over `float32.<{ m: 1 }>` and `float32.<{ m: 2 }>`
 * computes the product rather than refusing the two as different types; the
 * result is stamped with the contributions afterwards.
 */
export function WithoutMetadata(value: Value): Value {
  if (isDecimalObject(value) || isRationalObject(value) || isComplexObject(value) || isFloat128Object(value)) {
    const type = RuntimeTypeOf(value);
    return type.Kind === 'parameterized' ? StampFamilyValue(value, type.Base) as Value : value;
  }
  if (isTypedNumber(value)) {
    const record = (value as TypedNumberValue).TypeRecord as TypeRecord;
    return record.Kind === 'parameterized' ? new TypedNumberValue((value as TypedNumberValue).value, record.Base) : value;
  }
  if ((value as { type?: string }).type === 'Vector') {
    const vector = value as unknown as VectorValue;
    const type = vector.TypeRecord as TypeRecord & { Kind: 'primitive', Arguments: readonly (TypeRecord | number)[] };
    const lane = type.Arguments?.[0] as TypeRecord | undefined;
    if (lane?.Kind !== 'parameterized') {
      return value;
    }
    const lanes = vector.lanes.map((l: Value) => WithoutMetadata(l));
    return new VectorValue(lanes, { ...type, Arguments: [lane.Base, ...type.Arguments.slice(1)] } as unknown as TypeRecord) as unknown as Value;
  }
  return value;
}

/** A vector type, whose metadata is its lane type's. */
function isVectorType(t: TypeRecord | null | undefined): boolean {
  return !!t && t.Kind === 'primitive' && t.Name === 'vector';
}

/** Arithmetic need not stamp a portion that only restates absence. Types stay distinct. */
function ResultWithMetadata(base: TypeRecord, metadata: MetadataRecord): TypeRecord {
  const governing = GoverningMetaTypes(metadata);
  return governing.unclaimed.length > 0 || governing.types.some((metaType) => MetaTypeGoverns(metadata, metaType))
    ? { Kind: 'parameterized', Base: base, Metadata: metadata } as TypeRecord : base;
}

export function StampBodylessContributions(lval: Value, raw: Value, found: BodylessContributions): Value | ThrowCompletion {
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
  const stampedType = ResultWithMetadata(base, merged);
  if (isTypedNumber(raw)) {
    return new TypedNumberValue((raw as TypedNumberValue).value, stampedType);
  }
  return StampFamilyValue(raw, stampedType) ?? raw;
}
