import {
  Descriptor,
  Assert,
  Get,
  GetValue,
  ObjectValue,
  Set,
  ToPropertyKey,
  type PropertyKeyValue,
  OrdinaryObjectCreate,
  PutValue,
  Q,
  ReferenceValue,
  SameValueZero,
  Throw,
  Value,
  X,
  NumberValue,
  NewPromiseCapability,
  Call,
  HostEnqueuePromiseJob,
  ToNumber,
  surroundingAgent,
  type Agent,
  type PromiseCapabilityRecord,
  type Arguments,
  type ValueEvaluator,
  type PlainEvaluator,
} from '#self';
import type { Realm } from '../execution-context/Realm.mts';
import { assignProps } from './bootstrap.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { isFloatTypeName, isIntegerTypeName } from '../type-system/numeric-signatures.mts';
import { OnAbort } from './AbortController.mts';

/**
 * proposal-runtime-types #sec-threading-atomics.
 *
 * The Atomics operations of the pinned edition take a TypedArray and an index.
 * This clause admits a typed binding reached through a reference, so a program
 * holding a `uint32` may operate on it atomically without first arranging for it
 * to live inside a byte buffer.
 *
 * WHAT IS SIMULATED. In this engine a job runs to completion before any other
 * agent runs, so every operation here is trivially atomic and the seq-cst
 * ordering costs nothing. That is not what these tests are for. What they check
 * is the SURFACE the clause specifies and a real implementation would have to get
 * right anyway: which targets are admitted, which types each operation restricts
 * itself to, that a store passes the typed-storage boundary, that compareExchange
 * compares with SameValueZero, and that the float add is a read-modify-write
 * whose result is the sum. Nothing here demonstrates atomicity, and nothing here
 * could - a simulation with no interleaving below a job boundary has no race to
 * exclude.
 */

/**
 * #sec-validateatomictarget resolves every admitted shape to one description of a
 * place in memory. Here that description is the place ITSELF - a reference, or an
 * object and a key - rather than a block and a byte index, because this engine
 * reaches typed storage through those and not through addresses. The distinction
 * costs nothing for the surface these tests check, and is recorded as a
 * divergence in the test file.
 */
type AtomicTarget =
  | { readonly Shape: 'reference', readonly Reference: ReferenceValue, readonly Type: TypeRecord }
  | { readonly Shape: 'property', readonly Object: ObjectValue, readonly Key: PropertyKeyValue, readonly Type: TypeRecord };

/**
 * #sec-validateatomictarget, for the reference shape. The TypedArray shape needs
 * the TypedArray Atomics of the pinned edition, which this engine does not have,
 * and the object-property shape needs the declared type of a typed own data
 * property; both are recorded as not implemented in the test file.
 *
 * The `shared` modifier is NOT consulted. The restrictions are restrictions of
 * type: an integer type where the operation needs bit patterns, and a value type
 * of a size an implementation operates on atomically.
 */
function* ValidateAtomicTarget(args: Arguments, operation: 'integer-only' | 'any-value-type'): PlainEvaluator<AtomicTarget> {
  const first = args[0];
  let target: AtomicTarget;
  if (first instanceof ReferenceValue) {
    // The borrow was already validated where the `ref` argument was EVALUATED
    // (RequireBorrowableReference in RefExpression), which is how every `ref`
    // argument reaches every callee, so it is not re-applied here.
    const current = Q(yield* GetValue(first.Location));
    target = { Shape: 'reference', Reference: first, Type: RuntimeTypeOf(current) };
  } else if (first instanceof ObjectValue) {
    // The object-property shape: `Atomics.add(obj, 'count', v)`. The property
    // must be a TYPED own data property - an `any`-typed slot has no width for an
    // operation to be atomic over, and an accessor is not storage.
    const key = Q(yield* ToPropertyKey(args[1] ?? Value.undefined));
    const desc = Q(yield* first.GetOwnProperty(key));
    if (!(desc instanceof Descriptor) || desc.Value === undefined) {
      return Throw.TypeError('$1 is not assignable to $2', args[1] ?? Value.undefined, Value('a typed own data property'));
    }
    target = { Shape: 'property', Object: first, Key: key, Type: RuntimeTypeOf(desc.Value) };
  } else {
    return Throw.TypeError('$1 is not assignable to $2', first ?? Value.undefined, Value('a reference to typed storage or an object with a typed property'));
  }
  if (!IsAdmittedValueType(target.Type)) {
    return Throw.TypeError('$1 is not assignable to $2', Value(displayType(target.Type)), Value('a value type Atomics operates on'));
  }
  if (operation === 'integer-only' && !IsIntegerTyped(target.Type)) {
    return Throw.TypeError('$1 is not assignable to $2', Value(displayType(target.Type)), Value('an integer type'));
  }
  return target;
}

/**
 * The operand of an operation that takes one. It follows the target: the
 * reference shape puts it at position 1, the property shape at position 2, the
 * key having taken position 1.
 */
function operandOf(target: AtomicTarget, args: Arguments): Value {
  return (target.Shape === 'reference' ? args[1] : args[2]) ?? Value.undefined;
}

function IsAdmittedValueType(t: TypeRecord): boolean {
  if (t.Kind === 'shared') {
    return IsAdmittedValueType(t.Target);
  }
  return t.Kind === 'primitive' && (isIntegerTypeName(t.Name) || isFloatTypeName(t.Name));
}

function IsIntegerTyped(t: TypeRecord): boolean {
  if (t.Kind === 'shared') {
    return IsIntegerTyped(t.Target);
  }
  return t.Kind === 'primitive' && isIntegerTypeName(t.Name);
}

/** Read the target. One ReadSharedMemory event of #sec-threading-memory-model. */
function* AtomicRead(target: AtomicTarget): ValueEvaluator {
  if (target.Shape === 'reference') {
    return Q(yield* GetValue(target.Reference.Location));
  }
  return Q(yield* Get(target.Object, target.Key));
}

/**
 * Write the target. The value passes the typed-storage boundary, so a store of a
 * value not of the target's type throws as an ordinary assignment would and the
 * same conversion applies - which is why this goes through PutValue and Set
 * rather than writing a slot directly.
 */
function* AtomicWrite(target: AtomicTarget, value: Value): PlainEvaluator<void> {
  // #sec-atomics-typed-operations: "A value stored through any of these
  // operations passes the typed-storage boundary ... so a store of a value not
  // of the target's type throws as an ordinary assignment to that storage would,
  // and the same conversion applies."
  //
  // The conversion is performed HERE rather than left to the storage, because a
  // LEXICAL BINDING has no run-time typed-storage boundary in this engine (see
  // the note in threading-atomics.test.mts). Without it the arithmetic wrote back
  // a plain Number, which a binding accepts, and the slot silently stopped being
  // a uint32 - so ONE `Atomics.add(ref a, 5)` succeeded and the next threw
  // "number is not a value type Atomics operates on", the operation having
  // destroyed the type it was operating on. A typed own data property converts on
  // its own; converting first is what that storage would do anyway.
  const converted = Q(yield* ConvertValue(value, target.Type));
  if (target.Shape === 'reference') {
    Q(yield* PutValue(target.Reference.Location, converted));
    return;
  }
  Q(yield* Set(target.Object, target.Key, converted, Value.true));
}

function* Atomics_load(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  return Q(yield* AtomicRead(target));
}

function* Atomics_store(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const value = operandOf(target, args);
  Q(yield* AtomicWrite(target, value));
  return value;
}

function* Atomics_exchange(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const old = Q(yield* AtomicRead(target));
  Q(yield* AtomicWrite(target, operandOf(target, args)));
  return old;
}

/**
 * #sec-atomics-compare-exchange-predicate: the expected value is compared with
 * the value read using SameValueZero.
 *
 * On an integer target every candidate predicate agrees. On a float target this
 * is the choice that makes a compare-exchange loop terminate: strict equality
 * would retry forever once the observed value is NaN, since NaN is not strictly
 * equal to itself. It also matches -0 to +0, which is the forgiving direction for
 * a sentinel.
 */
function* Atomics_compareExchange(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const expected = operandOf(target, args);
  const replacement = (target.Shape === 'reference' ? args[2] : args[3]) ?? Value.undefined;
  const old = Q(yield* AtomicRead(target));
  // The expected value is converted to the target's type BEFORE it is compared.
  // Without this, `Atomics.compareExchange(ref a, 1, 5)` on a `uint32` compares a
  // typed uint32 against a plain Number and never matches, so every CAS silently
  // fails - which is worse than throwing, since a claim loop would spin. The
  // TypedArray form of the operation does the same conversion for the same
  // reason; the clause now says so.
  const expectedTyped = Q(yield* ConvertValue(expected, target.Type));
  if (SameValueZero(old, expectedTyped)) {
    Q(yield* AtomicWrite(target, replacement));
  }
  return old;
}

function arithmetic(_name: string, apply: (a: number, b: number) => number, restriction: 'integer-only' | 'any-value-type') {
  return function* op(args: Arguments): ValueEvaluator {
    const target = Q(yield* ValidateAtomicTarget(args, restriction));
    const operand = operandOf(target, args);
    if (!(operand instanceof NumberValue) && !isTypedNumber(operand)) {
      return Throw.TypeError('$1 is not assignable to $2', operand, Value(displayType(target.Type)));
    }
    // #sec-atomics-float-arithmetic: on a float target a real implementation
    // performs this as a seq-cst compare-exchange loop, one attempt being one
    // ReadModifyWriteSharedMemory event. Here a job runs alone, so the loop would
    // succeed on its first attempt every time and is written as the single
    // read-modify-write it degenerates to. The OBSERVABLE result is the same,
    // which is what the surface tests check.
    const old = Q(yield* AtomicRead(target));
    const result = apply(numberOf(old), numberOf(operand));
    Q(yield* AtomicWrite(target, Value(result)));
    return old;
  };
}

function isTypedNumber(value: Value): boolean {
  return 'numberValue' in (value as object);
}

function numberOf(value: Value): number {
  return Number((value as unknown as { numberValue(): number | bigint }).numberValue());
}

export function bootstrapAtomics(realmRec: Realm) {
  const atomics = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, atomics, [
    ['load', Atomics_load as never, 1],
    ['store', Atomics_store as never, 2],
    ['exchange', Atomics_exchange as never, 2],
    ['compareExchange', Atomics_compareExchange as never, 3],
    // add and sub take the integers AND the floats; the bitwise operations do
    // not, a bitwise operation on a floating-point value having no meaning the
    // program intended.
    ['add', arithmetic('add', (a, b) => a + b, 'any-value-type') as never, 2],
    ['sub', arithmetic('sub', (a, b) => a - b, 'any-value-type') as never, 2],
    ['and', arithmetic('and', (a, b) => a & b, 'integer-only') as never, 2],
    ['or', arithmetic('or', (a, b) => a | b, 'integer-only') as never, 2],
    ['xor', arithmetic('xor', (a, b) => a ^ b, 'integer-only') as never, 2],
    // #sec-atomics-typed-wait: integer-only, "a futex compares bit patterns".
    ['wait', Atomics_wait as never, 2],
    ['waitAsync', Atomics_waitAsync as never, 2],
    ['notify', Atomics_notify as never, 2],
  ]);
  // Every one of these takes its target by reference at position 0
  // (#sec-atomics-reference-arguments), so that position must not decay.
  for (const name of ['load', 'store', 'exchange', 'compareExchange', 'add', 'sub', 'and', 'or', 'xor', 'wait', 'waitAsync', 'notify']) {
    const fn = X(Get(atomics, Value(name)));
    (fn as unknown as { RefParameterIndices: readonly number[] }).RefParameterIndices = [0];
  }
  Assert(atomics !== undefined);
  realmRec.Intrinsics['%Atomics%'] = atomics;
}

export { ValidateAtomicTarget };

/**
 * #sec-atomics-typed-wait. The WaiterList of the pinned edition is keyed by a
 * block and a byte index; here it is keyed by the place itself, for the reason
 * given above the AtomicTarget type.
 */
interface Waiter {
  readonly agent: Agent;
  readonly capability: PromiseCapabilityRecord;
  readonly realm: Realm;
  notified: boolean;
  cancelAbort?: () => void;
}

const waiterLists = new WeakMap<object, Map<string, Waiter[]>>();

function waiterListFor(target: AtomicTarget): Waiter[] {
  // Keyed by the STORAGE, not by the reference that reached it. Every `ref a`
  // expression makes a new Reference Record, so keying on the record would give
  // the waiter and the notifier different lists for one binding - which is the
  // spec's point in keying its WaiterList by a block and a byte index rather than
  // by whatever expression produced the access.
  let owner: object;
  let key: string;
  if (target.Shape === 'reference') {
    const record = target.Reference.Location;
    owner = record.Base as object;
    key = String((record.ReferencedName as unknown as { stringValue?(): string }).stringValue?.() ?? record.ReferencedName);
  } else {
    owner = target.Object;
    key = String((target.Key as unknown as { stringValue?(): string }).stringValue?.() ?? target.Key);
  }
  let byKey = waiterLists.get(owner);
  if (byKey === undefined) {
    byKey = new Map();
    waiterLists.set(owner, byKey);
  }
  let list = byKey.get(key);
  if (list === undefined) {
    list = [];
    byKey.set(key, list);
  }
  return list;
}

/**
 * `Atomics.wait` throws where the surrounding agent's [[CanBlock]] is false, as
 * it does today.
 *
 * It throws HERE in every case, because an agent of the simulated cluster does
 * not block: a job runs to completion before the driver runs anything else, so a
 * blocking wait would stop the cluster rather than one thread of it. That is a
 * divergence of the SIMULATION and not of the clause, recorded in the test file.
 * `waitAsync` is the form this engine can honour, and it is the form a program on
 * a thread that may not block has to use anyway.
 */
function* Atomics_wait(args: Arguments): ValueEvaluator {
  Q(yield* ValidateAtomicTarget(args, 'integer-only'));
  return Throw.TypeError('$1 is not assignable to $2', Value('Atomics.wait'), Value('an agent that can block; use waitAsync'));
}

/**
 * `Atomics.waitAsync` parks until a notify, returning a promise. Its reactions
 * run on the agent that created them, as every reaction does
 * (#sec-threading-scheduling), which here is the agent that called it.
 *
 * A wait is a cancellation checkpoint (#sec-thread-cancellation): a signal
 * aborted while the wait is parked WAKES it, and the wait then completes with the
 * signal's abort reason. This is the checkpoint E2b could not implement for want
 * of anything to park on.
 */
function* Atomics_waitAsync(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'integer-only'));
  const expected = operandOf(target, args);
  const capability = X(NewPromiseCapability(surroundingAgent.currentRealmRecord.Intrinsics['%Promise%']));
  const current = Q(yield* AtomicRead(target));
  const expectedTyped = Q(yield* ConvertValue(expected, target.Type));
  if (!SameValueZero(current, expectedTyped)) {
    // The value already differs, so there is nothing to wait for.
    X(Call(capability.Resolve, Value.undefined, [Value('not-equal')]));
    return capability.Promise;
  }
  const waiter: Waiter = {
    agent: surroundingAgent,
    capability,
    realm: surroundingAgent.currentRealmRecord,
    notified: false,
  };
  const signal = surroundingAgent.threadAbortSignal;
  if (signal !== undefined) {
    waiter.cancelAbort = OnAbort(signal as never, () => {
      if (waiter.notified) {
        return;
      }
      waiter.notified = true;
      // The abort is delivered THROUGH this wait, so the thread is now unwinding
      // and its remaining jobs are that unwinding. Nothing may abandon them.
      waiter.agent.threadAbortDelivered = true;
      settleWaiter(waiter, capability.Reject, signal.AbortSignalReason);
    });
  }
  surroundingAgent.threadPendingWaits = (surroundingAgent.threadPendingWaits ?? 0) + 1;
  waiterListFor(target).push(waiter);
  return capability.Promise;
}

/** Settle a waiter on ITS OWN agent's queue, which is where its reactions live. */
function settleWaiter(waiter: Waiter, settle: Value, value: Value): void {
  waiter.agent.threadPendingWaits = Math.max(0, (waiter.agent.threadPendingWaits ?? 1) - 1);
  HostEnqueuePromiseJob(function* settleJob(): PlainEvaluator {
    X(Call(settle, Value.undefined, [value]));
  }, waiter.realm, waiter.agent);
}

/** `Atomics.notify` wakes up to `count` waiters and answers how many it woke. */
function* Atomics_notify(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'integer-only'));
  const countValue = operandOf(target, args);
  const count = countValue === Value.undefined ? Infinity : Number(Q(yield* ToNumber(countValue)).numberValue());
  const list = waiterListFor(target);
  let woken = 0;
  while (list.length > 0 && woken < count) {
    const waiter = list.shift()!;
    if (waiter.notified) {
      continue;
    }
    waiter.notified = true;
    waiter.cancelAbort?.();
    settleWaiter(waiter, waiter.capability.Resolve, Value('ok'));
    woken += 1;
  }
  return Value(woken);
}
