import { Value, type Arguments } from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import { numericPredicate } from '../type-system/predicates.mts';
import {
  ToNumber,
  CreateBuiltinFunction,
  Realm,
  surroundingAgent,
} from '#self';

/** https://tc39.es/ecma262/#sec-isfinite-number */
function* IsFinite([number = Value.undefined]: Arguments): ValueEvaluator {
  // proposal-runtime-types (spec, the numeric predicates): a sized integer, a
  // bigint, and a rational are finite at the type; a float asks its value.
  if (surroundingAgent.feature('runtime-types')) {
    const answer = numericPredicate(number, 'isFinite');
    if (answer !== undefined) {
      return answer ? Value.true : Value.false;
    }
  }
  // 1. Let num be ? ToNumber(number).
  const num = Q(yield* ToNumber(number));
  // 2. If num is NaN, +∞, or -∞, return false.
  if (num.isNaN() || num.isInfinity()) {
    return Value.false;
  }
  // 3. Otherwise, return true.
  return Value.true;
}

export function bootstrapIsFinite(realmRec: Realm) {
  realmRec.Intrinsics['%isFinite%'] = CreateBuiltinFunction(IsFinite, 1, Value('isFinite'), [], realmRec);
}
