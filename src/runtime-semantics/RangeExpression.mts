import { NumberValue, BigIntValue } from '../value.mts';
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
export function* Evaluate_RangeExpression({
  RangeStart, RangeEnd, RangeStartBound, RangeEndBound,
}: ParseNode.RangeExpression): ValueEvaluator {
  // #sec-ranges: "A range is a value type class over an ORDERED element type."
  // bigint is ordered, and its endpoints reach the value model through the same
  // `R` that Number's do, so the ordering operations are polymorphic already.
  // Both endpoints must be the SAME kind: a range mixing them has no element
  // type, and comparing across them is the error a range exists to prevent.
  let start: NumberValue | BigIntValue | undefined;
  if (RangeStart !== null) {
    const value = Q(yield* GetValue(Q(yield* Evaluate(RangeStart))));
    if (!(value instanceof NumberValue) && !(value instanceof BigIntValue)) {
      return Throw.TypeError('a range endpoint must be a number');
    }
    start = value;
  }
  let end: NumberValue | BigIntValue | undefined;
  if (RangeEnd !== null) {
    const value = Q(yield* GetValue(Q(yield* Evaluate(RangeEnd))));
    if (!(value instanceof NumberValue) && !(value instanceof BigIntValue)) {
      return Throw.TypeError('a range endpoint must be a number');
    }
    end = value;
  }
  if (start !== undefined && end !== undefined
      && (start instanceof BigIntValue) !== (end instanceof BigIntValue)) {
    return Throw.TypeError('a range endpoint must be a number');
  }
  // The parser's bound pair passes straight through: the node and the value model
  // carry the same shape-independent endpoint view.
  return CreateRangeObject(start, end, RangeStartBound ?? undefined, RangeEndBound ?? undefined, surroundingAgent.currentRealmRecord);
}
