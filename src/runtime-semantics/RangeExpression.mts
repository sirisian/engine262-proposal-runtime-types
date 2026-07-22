import { NumberValue } from '../value.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { CreateRangeObject } from '../intrinsics/Range.mts';
import { GetValue, surroundingAgent, Throw } from '#self';

/**
 * proposal-runtime-types (ranges.md): a range expression evaluates its present
 * endpoints and constructs a Range value. An omitted endpoint (the from, to, and
 * full forms) is left undefined on the value. The endpoints are numbers in this
 * core; the design's ordering-based generalization to the other ordered types is
 * part of the extension's deferred remainder.
 */
export function* Evaluate_RangeExpression({ RangeStart, RangeEnd, Inclusive }: ParseNode.RangeExpression): ValueEvaluator {
  let start: NumberValue | undefined;
  if (RangeStart !== null) {
    const value = Q(yield* GetValue(Q(yield* Evaluate(RangeStart))));
    if (!(value instanceof NumberValue)) {
      return Throw.TypeError('a range endpoint must be a number');
    }
    start = value;
  }
  let end: NumberValue | undefined;
  if (RangeEnd !== null) {
    const value = Q(yield* GetValue(Q(yield* Evaluate(RangeEnd))));
    if (!(value instanceof NumberValue)) {
      return Throw.TypeError('a range endpoint must be a number');
    }
    end = value;
  }
  return CreateRangeObject(start, end, Inclusive, surroundingAgent.currentRealmRecord);
}
