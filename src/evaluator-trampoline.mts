import type { Evaluator, EvaluatorNextType, EvaluatorYieldType } from './evaluator.mts';

export interface EvaluationCall {
  readonly suspend: 'evaluation-call';
  readonly iterator: Evaluator<unknown>;
}

/** Suspend a recursive abstract operation without retaining a native call chain. */
export function* CallEvaluator<T>(iterator: Evaluator<T>): Evaluator<T> {
  const result = yield { suspend: 'evaluation-call', iterator };
  return result.value as T;
}

type Suspension = Exclude<EvaluatorYieldType, EvaluationCall>;
const continuations = new WeakMap<object, Evaluator<unknown>[]>();

/** All engine evaluator drivers consume internal calls before exposing a suspension. */
export function ResumeEvaluator<T>(iterator: Evaluator<T>, input: EvaluatorNextType): IteratorResult<Suspension, T> {
  let stack = continuations.get(iterator);
  if (!stack) {
    stack = [iterator];
    continuations.set(iterator, stack);
  }
  let throwing = false;
  let exception: unknown;
  while (stack.length) {
    let result: IteratorResult<EvaluatorYieldType, unknown>;
    try {
      result = throwing ? stack[stack.length - 1]!.throw(exception) : stack[stack.length - 1]!.next(input);
      throwing = false;
    } catch (error) {
      stack.pop();
      if (!stack.length) {
        continuations.delete(iterator);
        throw error;
      }
      // Propagate host interruption through every suspended parent's finally.
      exception = error;
      throwing = true;
      continue;
    }
    if (result.done) {
      stack.pop();
      if (!stack.length) {
        continuations.delete(iterator);
        return { done: true, value: result.value as T };
      }
      input = { resume: 'evaluation-call', value: result.value };
    } else if (result.value.suspend === 'evaluation-call') {
      stack.push(result.value.iterator);
      input = { resume: 'debugger', value: undefined };
    } else {
      return { done: false, value: result.value };
    }
  }
  throw new Error('an evaluator continuation has no active iterator');
}
