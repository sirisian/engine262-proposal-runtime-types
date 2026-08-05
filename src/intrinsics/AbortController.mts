import {
  CreateBuiltinFunction,
  Descriptor,
  DefinePropertyOrThrow,
  ObjectValue,
  OrdinaryObjectCreate,
  Throw,
  surroundingAgent,
  Value,
  X,
  type Arguments,
  type FunctionCallContext,
  type ValueEvaluator,
} from '#self';
import type { Realm } from '../execution-context/Realm.mts';
import { assignProps, bootstrapConstructor } from './bootstrap.mts';

/**
 * proposal-runtime-types #sec-thread-cancellation: "The `signal` option is an
 * AbortSignal, the mechanism the platform already has."
 *
 * AbortSignal and AbortController are WHATWG, not ECMA-262, so the specification
 * refers to them rather than defining them. An engine that hosts the threading
 * extension has to get them from somewhere all the same, and this is the minimum
 * that lets the cancellation rules be exercised: aborted state, a reason, and the
 * ability to wake something waiting. It is deliberately NOT the full DOM object -
 * there is no EventTarget here, no `addEventListener`, no `throwIfAborted`, no
 * `AbortSignal.timeout`. Where a real host supplies the real object, this one
 * steps aside, since everything the extension consults is the brand and the two
 * slots below.
 */
export interface AbortSignalObject extends ObjectValue {
  AbortSignalAborted: boolean;
  AbortSignalReason: Value;
  /**
   * Callbacks the ENGINE registers to be woken by an abort - a parked wait, in
   * the terms of the clause. Distinct from a script's 'abort' listeners, which a
   * real host owns and this object does not have.
   */
  AbortSignalWakers: Set<() => void>;
}

export function isAbortSignal(value: Value): value is AbortSignalObject {
  return value instanceof ObjectValue && 'AbortSignalAborted' in value;
}

export function IsAborted(signal: AbortSignalObject): boolean {
  return signal.AbortSignalAborted;
}

export function AbortReasonOf(signal: AbortSignalObject): Value {
  return signal.AbortSignalReason;
}

/**
 * Register a callback to run when `signal` aborts. Returns a function that
 * unregisters it, so a wait that completes normally leaves nothing behind.
 *
 * This is what makes the clause's "a wait that is already parked when the abort
 * happens is woken by it" implementable. A cancellation that could only be
 * observed on ENTRY to a wait would leave a parked thread uncancellable, which is
 * most of what cancellation is for.
 */
export function OnAbort(signal: AbortSignalObject, waker: () => void): () => void {
  if (signal.AbortSignalAborted) {
    waker();
    return () => {};
  }
  signal.AbortSignalWakers.add(waker);
  return () => signal.AbortSignalWakers.delete(waker);
}

function CreateAbortSignal(realmRec: Realm): AbortSignalObject {
  const signal = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []) as AbortSignalObject;
  signal.AbortSignalAborted = false;
  signal.AbortSignalReason = Value.undefined;
  signal.AbortSignalWakers = new Set();
  assignProps(realmRec, signal, [
    ['aborted', [function* aborted(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
      if (!isAbortSignal(thisValue)) {
        return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('AbortSignal'));
      }
      return thisValue.AbortSignalAborted ? Value.true : Value.false;
    } as never]],
    ['reason', [function* reason(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
      if (!isAbortSignal(thisValue)) {
        return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('AbortSignal'));
      }
      return thisValue.AbortSignalReason;
    } as never]],
  ]);
  return signal;
}

/**
 * Abort a signal. The reason is what every cancellation checkpoint of
 * #sec-thread-cancellation throws, so a program that supplies one sees it come
 * out of whatever the thread was doing.
 */
export function AbortSignalAbort(signal: AbortSignalObject, reason: Value): void {
  if (signal.AbortSignalAborted) {
    return;
  }
  signal.AbortSignalAborted = true;
  signal.AbortSignalReason = reason;
  const wakers = [...signal.AbortSignalWakers];
  signal.AbortSignalWakers.clear();
  for (const waker of wakers) {
    waker();
  }
}

function* AbortControllerConstructor(_args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('ConstructorRequiresNew', Value('AbortController'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  const controller = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%'], []);
  const signal = CreateAbortSignal(realm);
  X(DefinePropertyOrThrow(controller, Value('signal'), Descriptor({
    Value: signal,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.true,
  })));
  const abort = CreateBuiltinFunction(function* abortMethod(args: Arguments): ValueEvaluator {
    const reason = args[0] ?? Value.undefined;
    AbortSignalAbort(signal, reason);
    return Value.undefined;
  } as never, 0, Value('abort'), [], realm);
  X(DefinePropertyOrThrow(controller, Value('abort'), Descriptor({
    Value: abort,
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.true,
  })));
  return controller;
}

export function bootstrapAbortController(realmRec: Realm) {
  const proto = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  const controller = bootstrapConstructor(realmRec, AbortControllerConstructor as never, 'AbortController', 0, proto, []);
  realmRec.Intrinsics['%AbortController%'] = controller;
}
