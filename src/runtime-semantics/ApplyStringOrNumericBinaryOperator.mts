import { ObjectValue,
  JSStringValue, Value,
  NumberValue,
  BigIntValue,
  SameType,
} from '../value.mts';
import { isTypedArithmetic, typedBinary } from '../type-system/arithmetic.mts';
import {
  isRationalObject, rationalAdd, rationalSub, rationalMul, rationalDiv, rationalPow,
} from '../intrinsics/Rational.mts';
import { Q } from '../completion.mts';
import {
  Assert, Throw, ToNumeric, ToPrimitive, ToString, surroundingAgent, Call, LookupClassOperator, RightOperandDeclaresOperator } from '#self';

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '<<' | '>>' | '>>>' | '&' | '^' | '|';
/** https://tc39.es/ecma262/#sec-applystringornumericbinaryoperator */
export function* ApplyStringOrNumericBinaryOperator(lval: Value, opText: BinaryOperator, rval: Value, literals?: { left: boolean, right: boolean }) {
  // proposal-runtime-types: class operator dispatch. Consulted only when the
  // left operand is an Object, so the untyped fast path is unaffected.
  if (surroundingAgent.feature('runtime-types') && lval instanceof ObjectValue) {
    const opFn = LookupClassOperator(lval, opText);
    if (opFn) {
      // proposal-runtime-types (spec sec-class-operators): a class operator's
      // receiver is the left operand and the declaration's single parameter is
      // the right operand. Dispatch with this = lval and arguments = [rval].
      return Q(yield* Call(opFn as never, lval, [rval]));
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
