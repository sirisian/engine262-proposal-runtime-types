import { DefaultValueOf } from '../type-system/runtime.mts';
import { RequireType } from '../abstract-ops/runtime-types.mts';
import { displayType } from '../type-system/records.mts';
import type { TypeRecord } from '../type-system/records.mts';
import {
  Assert,
  Call,
  CreateBuiltinFunction,
  HostEnqueuePromiseJob,
  NewPromiseCapability,
  ObjectValue,
  OrdinaryObjectCreate,
  Q,
  Throw,
  Value,
  X,
  surroundingAgent,
  wellKnownSymbols,
  type Agent,
  type Arguments,
  type FunctionCallContext,
  type PlainEvaluator,
  type PromiseCapabilityRecord,
  type ValueEvaluator,
} from '#self';
import type { Realm } from '../execution-context/Realm.mts';
import { assignProps, bootstrapConstructor } from './bootstrap.mts';
import { EnsureCompletion, AbruptCompletion } from '../completion.mts';
import { OnAbort, type AbortSignalObject } from './AbortController.mts';

/**
 * proposal-runtime-types #sec-threading-synchronization.
 *
 * Atomics covers a single location. These three objects cover what it cannot: a
 * multi-field update, a shared collection, a handoff between threads.
 *
 * WHAT IS SIMULATED. An agent of the simulated cluster does not block - a job
 * runs to completion before the driver runs anything else - so the BLOCKING forms
 * cannot be honoured here and throw, as Atomics.wait does. The async forms are
 * what this engine can run, and they are what a thread whose embedder forbids
 * blocking has to use anyway. Recorded in the test file as a divergence of the
 * simulation rather than of the clause.
 */

interface LockObject extends ObjectValue {
  LockOwner: Agent | undefined;
  LockWaiters: LockWaiter[];
}

interface LockWaiter {
  readonly agent: Agent;
  readonly realm: Realm;
  readonly capability: PromiseCapabilityRecord;
  settled: boolean;
}

interface ConditionObject extends ObjectValue {
  ConditionWaiters: ConditionWaiter[];
}

interface ConditionWaiter {
  readonly agent: Agent;
  readonly realm: Realm;
  readonly capability: PromiseCapabilityRecord;
  readonly lock: LockObject;
  settled: boolean;
  cancelAbort?: () => void;
}

function isLock(value: Value): value is LockObject {
  return value instanceof ObjectValue && 'LockOwner' in value;
}

function isCondition(value: Value): value is ConditionObject {
  return value instanceof ObjectValue && 'ConditionWaiters' in value;
}

/**
 * #sec-threading-synchronization: the blocking forms throw where [[CanBlock]] is
 * false, "rather than quietly becoming their async counterparts: an operation
 * returning T on one thread and Promise.<T> on another would have a return type
 * that depends on which thread is running it".
 *
 * Here they throw unconditionally, the simulation having no blocking to offer.
 */
function refuseBlocking(name: string) {
  return Throw.TypeError('$1 is not assignable to $2', Value(name), Value('an agent that can block; use the async form'));
}

// -- Lock ----------------------------------------------------------------------

function* LockConstructor(_args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('$1 requires new', Value('Lock'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  const lock = OrdinaryObjectCreate(realm.Intrinsics['%Lock.prototype%'], ['LockOwner', 'LockWaiters']) as unknown as LockObject;
  lock.LockOwner = undefined;
  lock.LockWaiters = [];
  return lock;
}

/**
 * #sec-lock-objects: "it is a TypeError exception for an agent to acquire a Lock
 * it already owns through hold or acquire". Those forms block, so the agent that
 * would have to release is the agent now parked - a certain deadlock, and the
 * owner is known because Condition.wait must check it anyway.
 */
function selfAcquireCheck(lock: LockObject) {
  if (lock.LockOwner === surroundingAgent) {
    return Throw.TypeError('$1 is not assignable to $2', Value('this Lock'), Value('a Lock the calling agent does not already own'));
  }
  return undefined;
}

function* Lock_hold(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isLock(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Lock'));
  }
  const refused = selfAcquireCheck(thisValue);
  if (refused !== undefined) {
    return refused;
  }
  if (thisValue.LockOwner !== undefined) {
    return refuseBlocking('Lock.prototype.hold');
  }
  const callback = args[0] ?? Value.undefined;
  thisValue.LockOwner = surroundingAgent;
  // "If callback returns an abrupt completion, the Lock is released and the
  // completion propagates, so the release has the force of a finally."
  const result = EnsureCompletion(yield* Call(callback, Value.undefined, []));
  thisValue.LockOwner = undefined;
  grantNextWaiter(thisValue);
  if (result instanceof AbruptCompletion) {
    return result;
  }
  // "returns what callback returned"
  return result.Value;
}

function* Lock_acquire(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isLock(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Lock'));
  }
  const refused = selfAcquireCheck(thisValue);
  if (refused !== undefined) {
    return refused;
  }
  if (thisValue.LockOwner !== undefined) {
    return refuseBlocking('Lock.prototype.acquire');
  }
  thisValue.LockOwner = surroundingAgent;
  return CreateLockGuard(thisValue);
}

/**
 * #sec-lock.prototype.acquire: a lock guard, "an object with a [Symbol.dispose]
 * method that releases it", so `using guard = lock.acquire()` holds the Lock for
 * the enclosing block. Disposing twice is a TypeError, as releasing twice is.
 */
function CreateLockGuard(lock: LockObject): ObjectValue {
  const realm = surroundingAgent.currentRealmRecord;
  const guard = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%'], []);
  let disposed = false;
  const dispose = CreateBuiltinFunction(function* disposeGuard(): ValueEvaluator {
    if (disposed) {
      return Throw.TypeError('$1 is not assignable to $2', Value('this lock guard'), Value('an undisposed lock guard'));
    }
    disposed = true;
    lock.LockOwner = undefined;
    grantNextWaiter(lock);
    return Value.undefined;
  } as never, 0, Value('[Symbol.dispose]'), [], realm);
  X(guard.DefineOwnProperty(wellKnownSymbols.dispose, {
    Value: dispose,
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.true,
  } as never));
  return guard;
}

function* Lock_asyncHold(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isLock(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Lock'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  const capability = X(NewPromiseCapability(realm.Intrinsics['%Promise%']));
  const waiter: LockWaiter = {
    agent: surroundingAgent, realm, capability, settled: false,
  };
  // "asyncHold while holding is not a deadlock and is permitted. The acquisition
  // queues, and the holder may release from a later job before anything awaits
  // the pending promise."
  if (thisValue.LockOwner === undefined) {
    thisValue.LockOwner = surroundingAgent;
    grantTo(thisValue, waiter);
  } else {
    thisValue.LockWaiters.push(waiter);
  }
  return capability.Promise;
}

/** Fulfil a waiter with the release function for the Lock it now holds. */
function grantTo(lock: LockObject, waiter: LockWaiter): void {
  waiter.settled = true;
  const release = CreateBuiltinFunction(function* releaseFn(): ValueEvaluator {
    // "The release function may be called once, by the agent that received it. A
    // second call, or a call from another agent, is a TypeError exception.
    // Tolerating a stale release would unlock a critical section that by then
    // belongs to somebody else."
    if (released) {
      return Throw.TypeError('$1 is not assignable to $2', Value('this release function'), Value('an uncalled release function'));
    }
    if (surroundingAgent !== waiter.agent) {
      return Throw.TypeError('$1 is not assignable to $2', Value('this release function'), Value('the agent that received it'));
    }
    released = true;
    lock.LockOwner = undefined;
    grantNextWaiter(lock);
    return Value.undefined;
  } as never, 0, Value('release'), [], waiter.realm);
  let released = false;
  settleOn(waiter.agent, waiter.realm, waiter.capability.Resolve, release);
}

function grantNextWaiter(lock: LockObject): void {
  // Which waiter obtains a released Lock is implementation-defined; this takes
  // them in arrival order, which the clause neither requires nor forbids.
  const next = lock.LockWaiters.shift();
  if (next === undefined || next.settled) {
    return;
  }
  lock.LockOwner = next.agent;
  grantTo(lock, next);
}

/** Settle a capability on ITS OWN agent's queue, where its reactions live. */
function settleOn(agent: Agent, realm: Realm, settle: Value, value: Value): void {
  HostEnqueuePromiseJob(function* settleJob(): PlainEvaluator {
    X(Call(settle, Value.undefined, [value]));
  }, realm, agent);
}

// -- Condition -----------------------------------------------------------------

function* ConditionConstructor(_args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('$1 requires new', Value('Condition'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  const condition = OrdinaryObjectCreate(realm.Intrinsics['%Condition.prototype%'], ['ConditionWaiters']) as unknown as ConditionObject;
  condition.ConditionWaiters = [];
  return condition;
}

function* Condition_wait(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const checked = validateConditionCall(thisValue, args[0] ?? Value.undefined);
  if (checked === undefined) {
    return refuseBlocking('Condition.prototype.wait');
  }
  return checked;
}

/** Returns undefined when the call is well-formed, or the completion that refuses it. */
function validateConditionCall(thisValue: Value, lockValue: Value) {
  if (!isCondition(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Condition'));
  }
  if (!isLock(lockValue)) {
    return Throw.TypeError('$1 is not assignable to $2', lockValue, Value('a Lock'));
  }
  // "It is a TypeError exception if lock is not a Lock owned by the surrounding
  // agent."
  if (lockValue.LockOwner !== surroundingAgent) {
    return Throw.TypeError('$1 is not assignable to $2', lockValue, Value('a Lock held by the calling agent'));
  }
  return undefined;
}

function* Condition_asyncWait(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const lockValue = args[0] ?? Value.undefined;
  if (!isCondition(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Condition'));
  }
  if (!isLock(lockValue)) {
    return Throw.TypeError('$1 is not assignable to $2', lockValue, Value('a Lock'));
  }
  if (lockValue.LockOwner !== surroundingAgent) {
    return Throw.TypeError('$1 is not assignable to $2', lockValue, Value('a Lock held by the calling agent'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  const capability = X(NewPromiseCapability(realm.Intrinsics['%Promise%']));
  const waiter: ConditionWaiter = {
    agent: surroundingAgent, realm, capability, lock: lockValue, settled: false,
  };
  // Release and park in one step, so no notification is missed between them.
  lockValue.LockOwner = undefined;
  grantNextWaiter(lockValue);
  thisValue.ConditionWaiters.push(waiter);

  // #sec-condition-cancellation: an abort wakes a parked waiter, "and the wait
  // then completes abruptly with the signal's abort reason - AFTER reacquiring
  // the Lock, so that the unwinding runs with the invariant the waiter was
  // holding".
  const signal = surroundingAgent.threadAbortSignal;
  if (signal !== undefined) {
    waiter.cancelAbort = OnAbort(signal as unknown as AbortSignalObject, () => {
      if (waiter.settled) {
        return;
      }
      waiter.settled = true;
      waiter.agent.threadAbortDelivered = true;
      waiter.agent.threadPendingWaits = Math.max(0, (waiter.agent.threadPendingWaits ?? 1) - 1);
      waiter.lock.LockOwner = waiter.agent;
      settleOn(waiter.agent, waiter.realm, waiter.capability.Reject, signal.AbortSignalReason);
    });
  }
  surroundingAgent.threadPendingWaits = (surroundingAgent.threadPendingWaits ?? 0) + 1;
  return capability.Promise;
}

function wakeConditionWaiter(waiter: ConditionWaiter): void {
  waiter.settled = true;
  waiter.cancelAbort?.();
  waiter.agent.threadPendingWaits = Math.max(0, (waiter.agent.threadPendingWaits ?? 1) - 1);
  // Reacquire before fulfilling, so "the code after the await holds the Lock
  // exactly as the code after wait does".
  waiter.lock.LockOwner = waiter.agent;
  settleOn(waiter.agent, waiter.realm, waiter.capability.Resolve, Value.undefined);
}

function* Condition_notify(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isCondition(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Condition'));
  }
  const waiter = thisValue.ConditionWaiters.shift();
  if (waiter !== undefined && !waiter.settled) {
    wakeConditionWaiter(waiter);
    return Value(1);
  }
  return Value(0);
}

function* Condition_notifyAll(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (!isCondition(thisValue)) {
    return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a Condition'));
  }
  const waiters = thisValue.ConditionWaiters.splice(0);
  let woken = 0;
  for (const waiter of waiters) {
    if (!waiter.settled) {
      wakeConditionWaiter(waiter);
      woken += 1;
    }
  }
  return Value(woken);
}

// -- ThreadLocal ---------------------------------------------------------------

interface ThreadLocalObject extends ObjectValue {
  ThreadLocalStorage: WeakMap<Agent, Value>;
  ThreadLocalDefault: Value;
  /**
   * proposal-runtime-types #sec-threadlocal-objects: the _T_ of
   * `ThreadLocal.<`_T_`>`, kept so a write can be checked against it and an
   * unwritten read can answer DefaultValueOf(_T_). Absent for the untyped
   * `new ThreadLocal()` form, which has no _T_ to keep.
   */
  ThreadLocalType?: TypeRecord;
  /**
   * Whether [[ThreadLocalDefault]] is a value the TYPE gave, as against the
   * absence of one. `undefined` is a legitimate stored value and also what a
   * type with no default leaves behind, so the two cases cannot be told apart
   * by the default alone - and they answer an unwritten read differently.
   */
  ThreadLocalHasDefault?: boolean;
}

function isThreadLocal(value: Value): value is ThreadLocalObject {
  return value instanceof ObjectValue && 'ThreadLocalStorage' in value;
}

/** The type arguments a construction supplied, set by the NewExpression intercept. */
let pendingThreadLocalTypeArguments: readonly TypeRecord[] | undefined;

export function SetPendingThreadLocalTypeArguments(args: readonly TypeRecord[] | undefined): void {
  pendingThreadLocalTypeArguments = args;
}

function* ThreadLocalConstructor(args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('$1 requires new', Value('ThreadLocal'));
  }
  const realm = surroundingAgent.currentRealmRecord;
  // Taken and CLEARED first, as SoA's constructor does with its own: the channel
  // is module-level, so a construction that threw between the intercept setting
  // it and this reading it would otherwise leave a stale type for the next one.
  const typeArgs = pendingThreadLocalTypeArguments;
  pendingThreadLocalTypeArguments = undefined;
  const tl = OrdinaryObjectCreate(realm.Intrinsics['%ThreadLocal.prototype%'], ['ThreadLocalStorage', 'ThreadLocalDefault', 'ThreadLocalType']) as unknown as ThreadLocalObject;
  tl.ThreadLocalStorage = new WeakMap();
  tl.ThreadLocalType = typeArgs?.[0];
  // #sec-threadlocal-objects: "An agent that has not written the storage reads
  // DefaultValueOf(_T_)." An explicit initial value still wins where one is
  // given, which is what the untyped `new ThreadLocal(7)` form has always meant
  // and what the clause leaves alone.
  if (args[0] !== undefined) {
    tl.ThreadLocalDefault = args[0];
  } else if (tl.ThreadLocalType !== undefined) {
    const fromType = Q(yield* DefaultValueOf(tl.ThreadLocalType));
    // A type with NO default reads as `none` here. The declaration of such a
    // type is refused (#sec-defaultvalueof, and the rule that a declaration of
    // it needs an initializer), but the CONSTRUCTION is not the read: an agent
    // that writes before it reads uses the storage exactly as intended, so the
    // error belongs to the unwritten read rather than to this line.
    tl.ThreadLocalDefault = fromType === undefined ? Value.undefined : fromType as Value;
    tl.ThreadLocalHasDefault = fromType !== undefined;
  } else {
    tl.ThreadLocalDefault = Value.undefined;
  }
  return tl;
}

export function bootstrapSynchronization(realmRec: Realm) {
  const lockProto = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, lockProto, [
    ['hold', Lock_hold as never, 1],
    ['acquire', Lock_acquire as never, 0],
    ['asyncHold', Lock_asyncHold as never, 0],
  ]);
  realmRec.Intrinsics['%Lock.prototype%'] = lockProto;
  realmRec.Intrinsics['%Lock%'] = bootstrapConstructor(realmRec, LockConstructor as never, 'Lock', 0, lockProto, []);

  const conditionProto = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, conditionProto, [
    ['wait', Condition_wait as never, 1],
    ['asyncWait', Condition_asyncWait as never, 1],
    ['notify', Condition_notify as never, 0],
    ['notifyAll', Condition_notifyAll as never, 0],
  ]);
  realmRec.Intrinsics['%Condition.prototype%'] = conditionProto;
  realmRec.Intrinsics['%Condition%'] = bootstrapConstructor(realmRec, ConditionConstructor as never, 'Condition', 0, conditionProto, []);

  const threadLocalProto = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, threadLocalProto, [
    ['value', [function* getValue(_a: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
      if (!isThreadLocal(thisValue)) {
        return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a ThreadLocal'));
      }
      // "reading its value reads the storage of the surrounding agent"
      const stored = thisValue.ThreadLocalStorage.get(surroundingAgent);
      if (stored !== undefined) {
        return stored;
      }
      // "An agent that has not written the storage reads DefaultValueOf(_T_)."
      // Where _T_ HAS no default there is nothing to hand back, and the read is
      // the error rather than the construction: an agent that writes before it
      // reads uses the storage exactly as intended, so refusing `new` would
      // refuse a program the clause permits.
      if (thisValue.ThreadLocalType !== undefined && thisValue.ThreadLocalHasDefault === false) {
        return Throw.TypeError('$1 has no default value, so a declaration of it needs an initializer', Value(displayType(thisValue.ThreadLocalType)));
      }
      return thisValue.ThreadLocalDefault;
    } as never, function* setValue(a: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
      if (!isThreadLocal(thisValue)) {
        return Throw.TypeError('$1 is not assignable to $2', thisValue, Value('a ThreadLocal'));
      }
      // The storage has a type, so a write crosses it: a propagated literal
      // converts and a value the type forbids is refused, exactly as a write to
      // a typed binding or an array element does. Without this a
      // `ThreadLocal.<uint32>` handed back a plain Number for what it stored.
      let written = a[0] ?? Value.undefined;
      if (thisValue.ThreadLocalType !== undefined) {
        written = Q(yield* RequireType(written, thisValue.ThreadLocalType));
      }
      thisValue.ThreadLocalStorage.set(surroundingAgent, written);
      return Value.undefined;
    } as never]],
  ]);
  realmRec.Intrinsics['%ThreadLocal.prototype%'] = threadLocalProto;
  realmRec.Intrinsics['%ThreadLocal%'] = bootstrapConstructor(realmRec, ThreadLocalConstructor as never, 'ThreadLocal', 1, threadLocalProto, []);
  Assert(realmRec.Intrinsics['%Lock%'] !== undefined);
}
