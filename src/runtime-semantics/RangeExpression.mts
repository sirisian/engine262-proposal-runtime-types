import { BigIntValue, ObjectValue } from '../value.mts';
import { exactNumericValue } from '../abstract-ops/testing-comparison.mts';
import { LookupClassOperator, RequireType } from '../abstract-ops/runtime-types.mts';
import { type RangeEndpoint } from '../intrinsics/Range.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { CreateRangeObject } from '../intrinsics/Range.mts';
import { contextualTypeFor, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import { isRangeShapeName } from '../type-system/range-bounds-match.mts';
import { GetValue, surroundingAgent, Throw } from '#self';

/**
 * proposal-runtime-types (ranges.md): a range expression evaluates its present
 * endpoints and constructs a Range value. An omitted endpoint (the from, to, and
 * full forms) is left undefined on the value. Real numeric endpoints use their
 * intrinsic exact order, including object-backed float128, decimal and rational
 * values; other ordered endpoints declare operator<.
 */
export function* Evaluate_RangeExpression(node: ParseNode.RangeExpression): ValueEvaluator {
  const { RangeStart, RangeEnd, RangeStartBound, RangeEndBound } = node;
  const context = contextualTypeFor(node);
  const argument = context?.Kind === 'nominal' && isRangeShapeName(context.LibraryName ?? '') ? context.Arguments[0] : undefined;
  const element = typeof argument === 'number' ? undefined : argument;
  // #sec-ranges: "A range is a value type class over an ORDERED element type."
  // bigint is ordered, and its endpoints reach the value model through the same
  // `R` that Number's do, so the ordering operations are polymorphic already.
  // Both endpoints must be the SAME kind: a range mixing them has no element
  // type, and comparing across them is the error a range exists to prevent.
  //
  // A TYPED number is ordered with Number by the same rule `contains` uses -
  // #sec-matchrange admits "a value of a type ORDERED WITH the element type" -
  // so it is an endpoint too. Refusing it while `contains` admitted it was a
  // contradiction a reader met immediately, since `0..<a.length` over a typed
  // array produces exactly that pair.
  //
  // NaN is refused. It is not a value of an ordered type: it is the value for
  // which the ordering is UNDEFINED, so every comparison against it is false and
  // a range holding one reports itself non-empty while containing nothing - a
  // value that claims inhabitants it cannot produce. Refusing it here, at the
  // one place an endpoint enters, is what keeps every ordering operation
  // downstream coherent without any of them testing for it.
  const endpoint = function* endpoint(node: never): PlainEvaluator<RangeEndpoint> {
    let value;
    pushContextualType(element ?? null, node);
    try {
      value = Q(yield* GetValue(Q(yield* Evaluate(node))));
      if (element) value = Q(yield* RequireType(value, element));
    } finally {
      popContextualType();
    }
    const numeric = exactNumericValue(value);
    if (numeric) {
      if (numeric.kind === 'finite' || numeric.kind === 'infinity') return value as RangeEndpoint;
      return Throw.TypeError('a range endpoint must be ordered, and NaN or complex values are not');
    }
    // #sec-ranges: "a value type class over an ORDERED element type", which
    // ranges.md constrains as `RangeBounds<T: Ordered.<T>>`. The check tested
    // the VALUE rather than the constraint, so a type meeting the design's
    // stated requirement exactly was refused as "not a number".
    if (value instanceof ObjectValue && LookupClassOperator(value, '<') !== null) {
      return value as RangeEndpoint;
    }
    return Throw.TypeError('a range endpoint must be ordered: a number, a bigint, or a type declaring operator<');
  };
  let start: RangeEndpoint | undefined;
  if (RangeStart !== null) {
    start = Q(yield* endpoint(RangeStart as never));
  }
  let end: RangeEndpoint | undefined;
  if (RangeEnd !== null) {
    end = Q(yield* endpoint(RangeEnd as never));
  }
  if (start !== undefined && end !== undefined
      && (start instanceof BigIntValue) !== (end instanceof BigIntValue)) {
    return Throw.TypeError('a range endpoint must be ordered: a number, a bigint, or a type declaring operator<');
  }
  // Both endpoints of ONE element type: comparing across two would ask
  // `operator<` a question its declaration does not answer.
  if (start !== undefined && end !== undefined
      && (start instanceof ObjectValue) !== (end instanceof ObjectValue)
      && !(exactNumericValue(start) && exactNumericValue(end))) {
    return Throw.TypeError('a range endpoint must be ordered: a number, a bigint, or a type declaring operator<');
  }
  // The parser's bound pair passes straight through: the node and the value model
  // carry the same shape-independent endpoint view.
  return CreateRangeObject(start, end, RangeStartBound ?? undefined, RangeEndBound ?? undefined, surroundingAgent.currentRealmRecord, element);
}
