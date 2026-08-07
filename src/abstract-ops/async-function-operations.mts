import { currentTypeParameterFrame } from '../type-system/runtime.mts';
import {
  EnsureCompletion, X, ExecutionContext, surroundingAgent, Evaluate, Value, type ParseNode, Assert, Call, PromiseCapabilityRecord, RunSuspendedContext,
  type AsyncBuiltinSteps,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-async-function-objects */

/** https://tc39.es/ecma262/#sec-asyncblockstart */
export function* AsyncBlockStart(promiseCapability: PromiseCapabilityRecord, asyncBody: ParseNode.AsyncBody | ParseNode.ExpressionBody | ParseNode.Module | AsyncBuiltinSteps, asyncContext: ExecutionContext) {
  asyncContext.promiseCapability = promiseCapability;
  // proposal-runtime-types #sec-generics: an async body suspends at each `await`
  // and resumes on a job, by which time the frame that bound its enclosing
  // class's type parameters is long off the stack. The frame is captured here,
  // as GeneratorStart captures it, and RunSuspendedContext pushes it at every
  // resumption - the same pair that carries a generator across a `yield`.
  //
  // Without the capture the body read its parameters only up to the first
  // `await`: `async m() { return W; }` answered, and `async m() { await 0;
  // return W; }` REJECTED with "W is not defined". A rejection rather than a
  // throw is why this went unseen - a caller that only inspected the returned
  // promise saw a promise either way.
  asyncContext.TypeParameterFrame = currentTypeParameterFrame();

  asyncContext.CodeEvaluationState = (function* closure() {
    const acAsyncContext = surroundingAgent.runningExecutionContext;
    let result;
    if (typeof asyncBody === 'function') {
      result = EnsureCompletion(yield* asyncBody());
    } else {
      result = EnsureCompletion(yield* Evaluate(asyncBody));
    }
    // Assert: If we return here, the async function either threw an exception or performed an implicit or explicit return; all awaiting is done.
    surroundingAgent.executionContextStack.pop(acAsyncContext);
    if (result.Type === 'normal') {
      X(Call(promiseCapability.Resolve, Value.undefined, [Value.undefined]));
    } else if (result.Type === 'return') {
      X(Call(promiseCapability.Resolve, Value.undefined, [result.Value]));
    } else {
      Assert(result.Type === 'throw');
      X(Call(promiseCapability.Reject, Value.undefined, [result.Value]));
    }
    return undefined;
  }());
  const result = X(yield* RunSuspendedContext(asyncContext, { resume: 'async-yield', value: undefined }));
  Assert(result === undefined);
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-async-functions-abstract-operations-async-function-start */
export function* AsyncFunctionStart(promiseCapability: PromiseCapabilityRecord, asyncFunctionBody: ParseNode.AsyncBody | ParseNode.ExpressionBody | AsyncBuiltinSteps) {
  const runningContext = surroundingAgent.runningExecutionContext;
  const asyncContext = runningContext.copy();
  X(yield* AsyncBlockStart(promiseCapability, asyncFunctionBody, asyncContext));
}
