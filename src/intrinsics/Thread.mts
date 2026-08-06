import {
  Call,
  OrdinaryObjectCreate,
  Q,
  ToNumber,
  Value,
  type Arguments,
  type ValueEvaluator,
} from '#self';
import type { Realm } from '../execution-context/Realm.mts';
import { assignProps } from './bootstrap.mts';
import {
  EnsureCompletion, AbruptCompletion, type ThrowCompletion, type ValueCompletion,
} from '../completion.mts';

/**
 * proposal-runtime-types #sec-threading-parallel-iteration.
 *
 * The two range operations of the `Thread` namespace.
 *
 * WHAT IS SIMULATED. This implementation runs every slice on the calling agent,
 * in ascending slice order. That is not a shortcut: #sec-thread.parallelfor makes
 * it normative that "executing every slice on the calling agent, in ascending
 * slice order, is a conforming implementation", precisely so that a host with no
 * threads to give still runs the program and gets the same answer. What the tests
 * below check is therefore the whole of the observable contract - the partition,
 * the combining order, the error policy - and none of it is weakened by the
 * absence of parallelism, since the clause promises the same answer either way.
 */

/**
 * #sec-thread-partition: the range is cut into disjoint contiguous slices,
 * numbered from zero in ascending order of the elements they contain, and how
 * many and where the cuts fall is implementation-defined AS A FUNCTION OF begin
 * AND end ALONE.
 *
 * This partition takes a fixed target slice count and divides the range as evenly
 * as it can, so the cuts move with the range and with nothing else. It reads no
 * host state on purpose: reading the core count here is exactly the mistake the
 * clause forbids, and it would be invisible until a program produced two
 * different sums on two machines.
 */
function partition(begin: number, end: number): { from: number, to: number }[] {
  const length = end - begin;
  if (length <= 0) {
    return [];
  }
  const targetSlices = 8;
  const sliceCount = Math.min(targetSlices, length);
  const base = Math.floor(length / sliceCount);
  const remainder = length % sliceCount;
  const slices: { from: number, to: number }[] = [];
  let cursor = begin;
  for (let i = 0; i < sliceCount; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    slices.push({ from: cursor, to: cursor + size });
    cursor += size;
  }
  return slices;
}

/**
 * #sec-thread.parallelfor. The calling agent participates - here it executes
 * every slice - so the call never parks on a WaiterList and is permitted on an
 * agent whose [[CanBlock]] is false.
 */
function* Thread_parallelFor(args: Arguments): ValueEvaluator {
  const begin = Number(Q(yield* ToNumber(args[0] ?? Value.undefined)).numberValue());
  const end = Number(Q(yield* ToNumber(args[1] ?? Value.undefined)).numberValue());
  const body = args[2] ?? Value.undefined;
  const slices = partition(begin, end);
  // #sec-thread-parallel-errors: a failure in slice k cancels the slices above k
  // and lets those below finish, and the completion reported is the
  // lowest-numbered failure - which is the completion a SEQUENTIAL execution
  // would have produced, since it reaches the lowest failing index first.
  let failure: { slice: number, completion: ThrowCompletion } | undefined;
  for (let i = 0; i < slices.length; i += 1) {
    if (failure !== undefined) {
      // Slices above the failing one are cancelled.
      break;
    }
    const { from, to } = slices[i];
    for (let n = from; n < to; n += 1) {
      const result = EnsureCompletion(yield* Call(body, Value.undefined, [Value(n)]));
      if (result instanceof AbruptCompletion) {
        failure = { slice: i, completion: result as ThrowCompletion };
        break;
      }
    }
  }
  if (failure !== undefined) {
    return failure.completion;
  }
  return Value.undefined;
}

/**
 * #sec-thread.parallelreduce. Each slice folds perElement over its own elements
 * from initial, producing one partial; the partials are combined in ASCENDING
 * SLICE ORDER, left to right.
 *
 * That order plus a partition fixed by the range is the whole of the determinism
 * guarantee, and it holds although combine need not be associative - which is the
 * point, floating-point addition not being associative and being the case the
 * operation exists for.
 */
function* Thread_parallelReduce(args: Arguments): ValueEvaluator {
  const begin = Number(Q(yield* ToNumber(args[0] ?? Value.undefined)).numberValue());
  const end = Number(Q(yield* ToNumber(args[1] ?? Value.undefined)).numberValue());
  const initial = args[2] ?? Value.undefined;
  const perElement = args[3] ?? Value.undefined;
  const combine = args[4] ?? Value.undefined;
  const slices = partition(begin, end);
  const partials: Value[] = [];
  let failure: { slice: number, completion: ThrowCompletion } | undefined;
  for (let i = 0; i < slices.length; i += 1) {
    if (failure !== undefined) {
      break;
    }
    const { from, to } = slices[i];
    let accumulator: Value = initial;
    for (let n = from; n < to; n += 1) {
      const result = EnsureCompletion(yield* Call(perElement, Value.undefined, [accumulator, Value(n)]));
      if (result instanceof AbruptCompletion) {
        failure = { slice: i, completion: result as ThrowCompletion };
        break;
      }
      accumulator = result.Value;
    }
    if (failure === undefined) {
      partials.push(accumulator);
    }
  }
  if (failure !== undefined) {
    return failure.completion;
  }
  if (partials.length === 0) {
    return initial;
  }
  let total = partials[0];
  for (let i = 1; i < partials.length; i += 1) {
    // A combine that completes abruptly is attributed to the LATER of the two
    // slices it was combining, which for a left-to-right fold is simply where it
    // threw - so there is nothing to reorder.
    const result: ValueCompletion = EnsureCompletion(yield* Call(combine, Value.undefined, [total, partials[i]]));
    if (result instanceof AbruptCompletion) {
      return result;
    }
    total = result.Value;
  }
  return total;
}

export function bootstrapThread(realmRec: Realm) {
  const thread = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, thread, [
    ['parallelFor', Thread_parallelFor as never, 3],
    ['parallelReduce', Thread_parallelReduce as never, 5],
  ]);
  realmRec.Intrinsics['%Thread%'] = thread;
}
