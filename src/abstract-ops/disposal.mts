import {
  ObjectValue, UndefinedValue, NullValue, Value, wellKnownSymbols,
} from '../value.mts';
import {
  Q, EnsureCompletion, ThrowCompletion,
} from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Call, GetMethod, Throw } from '#self';

/**
 * proposal-runtime-types (explicit resource management): a resource registered by a
 * `using` declaration, holding the value and the dispose method resolved once at
 * registration, as the specification requires, so that replacing the method after
 * the declaration cannot change what runs.
 */
interface DisposableResource {
  readonly ResourceValue: Value;
  readonly DisposeMethod: Value;
}

/** The resources an environment must dispose when it is left, in registration order. */
const disposeCapabilities = new WeakMap<object, DisposableResource[]>();

/**
 * Register a value as a resource of an environment. `null` and `undefined` are
 * permitted and register nothing, which is what lets a program write
 * `using handle = mayBeNothing()`. Anything else must be an object carrying a
 * callable `Symbol.dispose`, and is a TypeError otherwise, since a resource that
 * cannot be disposed is a resource the declaration cannot keep its promise about.
 */
export function* AddDisposableResource(env: object | undefined | null, value: Value): PlainEvaluator {
  if (value instanceof UndefinedValue || value instanceof NullValue) {
    return undefined;
  }
  if (!(value instanceof ObjectValue)) {
    return Throw.TypeError('a using declaration requires an object with a Symbol.dispose method');
  }
  const method = Q(yield* GetMethod(value, wellKnownSymbols.dispose));
  if (method instanceof UndefinedValue) {
    return Throw.TypeError('a using declaration requires an object with a Symbol.dispose method');
  }
  if (env) {
    const list = disposeCapabilities.get(env) ?? [];
    list.push({ ResourceValue: value, DisposeMethod: method });
    disposeCapabilities.set(env, list);
  }
  return undefined;
}

/**
 * Dispose an environment's resources in REVERSE registration order, the order that
 * makes a resource acquired later able to depend on one acquired earlier, and
 * return the completion the block should carry. A completion already abrupt is
 * preserved; where the block completed normally and a dispose call threw, that
 * throw becomes the block's completion. Where several dispose calls throw, the
 * first is reported and the rest are dropped, which is where the specification
 * would instead aggregate them into a SuppressedError; that aggregation is not
 * implemented and is recorded as remaining work.
 */
export function* DisposeResources(env: object | undefined | null, completion: unknown): PlainEvaluator<unknown> {
  if (!env) {
    return completion;
  }
  const list = disposeCapabilities.get(env);
  if (list === undefined || list.length === 0) {
    return completion;
  }
  disposeCapabilities.delete(env);
  let result = completion;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const resource = list[i]!;
    const attempt = EnsureCompletion(yield* Call(resource.DisposeMethod, resource.ResourceValue, []));
    if (attempt instanceof ThrowCompletion) {
      const already = EnsureCompletion(result as never);
      if (!(already instanceof ThrowCompletion)) {
        result = attempt;
      }
    }
  }
  return result;
}

/** Whether an environment has any registered resources, for the fast path. */
export function HasDisposableResources(env: object | undefined | null): boolean {
  return !!env && disposeCapabilities.has(env);
}
