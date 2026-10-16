import { TupleBackingLength, TupleStorageTypeAt, TupleStorageRun, TupleResizePreserves, type TupleStorageShape } from '../type-system/tuple-storage.mts';
import { type ThrowCompletion } from '../completion.mts';
import { SameType } from '../type-system/relations.mts';
import { type ObjectValue } from '../value.mts';
import { Throw, surroundingAgent, ScalarRestLengthAllowed } from '#self';

/** An intrinsic's destination geometry, after its ordinary argument processing.
 * No element reads, conversions, callbacks or writes belong in this plan. */
export type ArrayMutationPlan = {
  length: number,
  moves?: readonly { from: number, to: number, count: number, reverse?: boolean }[],
  uniform?: readonly { start: number, count: number }[],
};

/** Validate backing contracts before an intrinsic begins its element work.
 * Ordinary operations still perform their own checks after intervening effects.
 * Work is bounded by declared positions, not the size of a homogeneous tail. */
export function ValidateArrayMutation(object: ObjectValue, plan: ArrayMutationPlan): ThrowCompletion | undefined {
  if (!surroundingAgent.feature('runtime-types')) return undefined;
  const typed = object as { TypedTuple?: TupleStorageShape, TypedExtent?: number };
  if (typed.TypedExtent !== undefined && plan.length !== typed.TypedExtent) {
    return Throw.TypeError('a fixed-extent array cannot change length');
  }
  if (!ScalarRestLengthAllowed(object, plan.length)) return Throw.TypeError('the mutation would violate a required scalar run count');
  const shape = typed.TypedTuple;
  if (!shape) return undefined;
  const length = TupleBackingLength(object);
  if (!TupleResizePreserves(shape, length, plan.length)) {
    return Throw.TypeError('the mutation would change a surviving tuple position contract');
  }
  const same = (from: number, to: number) => {
    const source = TupleStorageTypeAt(shape, from, length);
    const destination = TupleStorageTypeAt(shape, to, plan.length);
    return source !== undefined && destination !== undefined && SameType(source, destination);
  };
  for (const move of plan.moves ?? []) {
    let { from, to, count } = move;
    while (count > 0) {
      if (!same(from, to)) return Throw.TypeError('a tuple mutation cannot move between differently typed positions');
      const sourceRun = TupleStorageRun(shape, from, length);
      const destinationRun = TupleStorageRun(shape, to, plan.length, move.reverse ? -1 : 1);
      const step = Math.min(count, sourceRun, destinationRun);
      from += step;
      to += move.reverse ? -step : step;
      count -= step;
    }
  }
  for (const range of plan.uniform ?? []) {
    let index = range.start + 1;
    const end = range.start + range.count;
    while (index < end) {
      if (!same(range.start, index)) return Throw.TypeError('the mutation requires the same type at each participating tuple position');
      index += Math.min(end - index, TupleStorageRun(shape, index, plan.length));
    }
  }
  return undefined;
}
