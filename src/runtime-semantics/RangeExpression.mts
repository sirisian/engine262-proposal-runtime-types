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
export function* Evaluate_RangeExpression({ RangeStart, RangeEnd, RangeEndBound }: ParseNode.RangeExpression): ValueEvaluator {
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
  // The parser now carries a bound per endpoint. The value model still carries
  // one `inclusive` flag for the end, so the start's bound is dropped here and
  // an open-start range behaves as a closed-start one until the value model
  // takes the pair (see the engine plan's E3, which is where `isEmpty`,
  // `length`, `contains`, and iteration each become bound-aware).
  return CreateRangeObject(start, end, RangeEndBound === 'closed', surroundingAgent.currentRealmRecord);
}
