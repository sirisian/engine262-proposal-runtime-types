import { Value } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { isRangeObject } from '../intrinsics/Range.mts';
import { NumericRangeAdd } from './range-addition.mts';
import { NumericRangeProduct } from './range-products.mts';
import { surroundingAgent } from '#self';

/** The binary operators interval arithmetic defines over two ranges. */
export type RangeBinaryOperator = '+' | '-' | '*' | '/';

export function isRangeBinaryOperator(op: string): op is RangeBinaryOperator {
  return op === '+' || op === '-' || op === '*' || op === '/';
}

export function* rangeBinaryOperator(lval: Value, op: RangeBinaryOperator, rval: Value): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
  if (!isRangeObject(lval) || !isRangeObject(rval)) {
    // A range and a non-range have no interval arithmetic between them; the
    // scalar case is `scale`, which is a method rather than an operator.
    return Throw.TypeError('interval arithmetic needs two ranges');
  }
  if (op === '+' || op === '-') return yield* NumericRangeAdd(lval, rval, op === '-', realmRec);
  return yield* NumericRangeProduct(lval, rval, op === '/', realmRec);
}
