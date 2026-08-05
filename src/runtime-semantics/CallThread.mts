import {
  Agent,
  AbruptCompletion,
  Assert,
  Call,
  EnsureCompletion,
  Get,
  HostEnqueuePromiseJob,
  IsCallable,
  NewPromiseCapability,
  ObjectValue,
  Q,
  Throw,
  ThrowCompletion,
  Value,
  X,
  isFunctionObject,
  setSurroundingAgent,
  surroundingAgent,
  type Arguments,
  type FunctionObject,
  type PlainEvaluator,
  type PromiseCapabilityRecord,
  type ValueCompletion,
  type ValueEvaluator,
} from '#self';
import { IsOfType, TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';
import type { OverloadSignature } from '../type-system/overloads.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { AnnotatedFunction } from '../abstract-ops/runtime-types.mts';
import {
  AbortReasonOf, IsAborted, isAbortSignal, OnAbort, type AbortSignalObject,
} from '../intrinsics/AbortController.mts';

/**
 * proposal-runtime-types #sec-classifythreadarguments: decide whether the first
 * argument is the options bag or the first forwarded argument.
 *
 * The bag is recognized by the BRAND of the value it carries - an actual
 * AbortSignal under `signal` - and not by the shape of the object carrying it,
 * because a brand is the stronger evidence. A declared first parameter that admits
 * the object overrides the brand, which is the step no untyped resolution can
 * perform: this is the ambiguity untyped JavaScript cannot resolve and a type
 * annotation can. Argument count plays no part, since rest parameters and
 * overloads make a declared length useless for it.
 */
export function* ClassifyThreadArguments(func: FunctionObject, args: Arguments): PlainEvaluator<{ options: ObjectValue | undefined, callArgs: Arguments }> {
  const none = { options: undefined, callArgs: args };
  if (args.length === 0) {
    return none;
  }
  const first = args[0];
  if (!(first instanceof ObjectValue)) {
    return none;
  }
  if (Q(yield* FirstParameterAdmits(func, first))) {
    return none;
  }
  const rest = args.slice(1) as Arguments;
  const keys = X(first.OwnPropertyKeys());
  if (keys.length === 0) {
    // An explicit empty bag.
    return { options: first, callArgs: rest };
  }
  const signal = Q(yield* Get(first, Value('signal')));
  if (isAbortSignal(signal)) {
    return { options: first, callArgs: rest };
  }
  return none;
}

/**
 * proposal-runtime-types #sec-classifythreadarguments step 4: "If the declared
 * type of func has a signature whose first parameter admits first, return the
 * pair (~empty~, args)."
 *
 * This is the step no untyped resolution can perform, and the reason the bag rule
 * is stated the way it is. The brand test below is a heuristic - a good one, since
 * an object carrying a real AbortSignal under `signal` is an options bag in every
 * program not built to look like one - but a heuristic is all it can be without a
 * signature. Where there IS a signature, it is not a heuristic at all: a function
 * that declares its first parameter as admitting the object is asking for the
 * object, whatever the object carries, and no guess is needed or wanted.
 *
 * ANY signature suffices, not only a sole one. An overloaded callee is a callee
 * that can receive the object in at least one of its shapes, and forwarding it is
 * what the program meant. Overload resolution then picks among the shapes at the
 * call, which is its job and not this operation's.
 *
 * A parameter whose type cannot be resolved yet - a generic's unbound `T` - is
 * treated as not admitting rather than as admitting. Both answers are defensible;
 * this one keeps the bag reachable on a generic function, and a program that wants
 * the other reading annotates concretely.
 */
function* FirstParameterAdmits(func: FunctionObject, value: ObjectValue): PlainEvaluator<boolean> {
  for (const type of Q(yield* FirstParameterTypes(func))) {
    const admits = EnsureCompletion(yield* IsOfType(value, type));
    if (admits.Type === 'normal' && admits.Value === true) {
      return true;
    }
  }
  return false;
}

/** The resolvable declared types of the callee's first parameter, over every signature it has. */
function* FirstParameterTypes(func: FunctionObject): PlainEvaluator<TypeRecord[]> {
  const types: TypeRecord[] = [];
  const declared = (func as unknown as { OverloadSignatures?: readonly OverloadSignature[] }).OverloadSignatures;
  if (declared !== undefined) {
    for (const signature of declared) {
      const first = signature.Parameters[0];
      if (first !== undefined && first.Type.Kind !== 'parameter') {
        types.push(first.Type);
      }
    }
    return types;
  }
  const formals = (func as AnnotatedFunction).FormalParameters as readonly ParseNode[] | undefined;
  const first = formals?.[0] as { TypeAnnotation?: ParseNode.TypeAnnotation | null } | undefined;
  if (first?.TypeAnnotation) {
    // Resolved without propagating a failure, as soleSignatureParameterTypes does
    // and for the same reason: an unbound type parameter reports "T is not
    // defined", and that error must not escape an operation that is classifying
    // an argument rather than checking one.
    const attempted = EnsureCompletion(yield* TypeNodeToTypeRecord(first.TypeAnnotation.Type));
    if (attempted.Type === 'normal' && (attempted.Value as TypeRecord).Kind !== 'parameter') {
      types.push(attempted.Value as TypeRecord);
    }
  }
  return types;
}

/**
 * proposal-runtime-types #sec-createthread: create an agent of the surrounding
 * agent's cluster, call `func` on it, and return a promise for the result.
 *
 * The capability is created on the CALLING thread, so its reactions are that
 * thread's reactions and the handle settles there - which is the general rule of
 * #sec-threading-scheduling and not a carve-out for this one promise.
 */
export function CreateThread(func: FunctionObject, args: Arguments, signal: AbortSignalObject | undefined): Value {
  const capability = X(NewPromiseCapability(surroundingAgent.currentRealmRecord.Intrinsics['%Promise%']));
  if (signal !== undefined && IsAborted(signal)) {
    X(Call(capability.Reject, Value.undefined, [AbortReasonOf(signal)]));
    return capability.Promise;
  }

  const cluster = surroundingAgent.hostDefinedOptions.threadCluster;
  Assert(cluster !== undefined);

  const thread = new Agent({
    ...surroundingAgent.hostDefinedOptions,
    // A thread of a cluster whose embedder forbids blocking on the main thread
    // may still block; #sec-threading-agent-cluster leaves [[CanBlock]] to the
    // host, and permitting it on a spawned thread is the usual host choice.
    threadCluster: cluster,
  });
  thread.executionContextStack.push(...[]);
  cluster.addThread(thread);

  // The thread's work is one job on its own queue. Everything it does - the call,
  // the adoption of a thenable result, its trailing microtasks - happens there.
  const realm = surroundingAgent.currentRealmRecord;
  const spawner = surroundingAgent;
  // proposal-runtime-types #sec-thread-cancellation: a thread observes an abort
  // at a CANCELLATION CHECKPOINT, and one of them is "when it takes a job from
  // its microtask queue". Registering the check on the agent rather than on this
  // one job is what makes the rule hold for the thread's whole life: the body,
  // the resumption of any await inside it, and every trailing microtask are all
  // jobs of this queue, so all of them are checkpoints without needing to be
  // named separately.
  //
  // The checkpoint THROWS the signal's reason, which is an ordinary abrupt
  // completion - finally blocks run, using declarations dispose - rather than
  // tearing the thread down where it stands.
  if (signal !== undefined) {
    thread.threadAbortSignal = signal;
  }
  enqueueOn(thread, realm, function* threadBody(): PlainEvaluator {
    const result = EnsureCompletion(yield* Call(func, Value.undefined, args));
    SettleFromThread(spawner, realm, capability, result);
    cluster.removeThread(thread);
  });

  // A thread aborted while it still has queued work abandons that work and
  // rejects, which is the same completion the checkpoint would have produced had
  // the queue been reached. The waker is what the clause means by an abort
  // reaching a thread that is not currently running.
  if (signal !== undefined) {
    OnAbort(signal, () => {
      if (!cluster.agents.includes(thread)
        || thread.threadAbortDelivered === true
        || (thread.threadPendingWaits ?? 0) > 0) {
        // Delivered through something the thread was waiting on, which throws the
        // reason from that operation and unwinds ordinarily. The thread settles
        // its own handle when the unwinding reaches the top of its function.
        return;
      }
      thread.jobQueue.clearForAbort?.();
      SettleFromThread(spawner, realm, capability, ThrowCompletion(AbortReasonOf(signal)));
      cluster.removeThread(thread);
    });
  }

  return capability.Promise;
}

/**
 * Settle the handle. The settle runs on the SPAWNING agent's queue, which is
 * where the capability's reactions live: #sec-threading-scheduling routes a
 * reaction to the agent that created it, and this capability was created by the
 * caller of callThread.
 *
 * The thread's own microtask queue is drained before this runs, because the
 * cluster driver runs a thread's queued jobs in order and this settle is enqueued
 * behind them - which is #sec-createthread's "drain the microtask queue of thread"
 * step, and the reason everything the thread did happens-before the observation
 * of its result.
 */
function SettleFromThread(spawner: Agent, spawnerRealm: Agent['currentRealmRecord'], capability: PromiseCapabilityRecord, result: ValueCompletion): void {
  const isAbrupt = result instanceof AbruptCompletion;
  const settle = isAbrupt ? capability.Reject : capability.Resolve;
  const value = EnsureCompletion(result).Value;
  HostEnqueuePromiseJob(function* settleJob(): PlainEvaluator {
    X(Call(settle, Value.undefined, [value]));
  }, spawnerRealm, spawner);
}

function enqueueOn(agent: Agent, realm: ReturnType<() => Agent['currentRealmRecord']>, job: () => PlainEvaluator): void {
  const previous = surroundingAgent;
  setSurroundingAgent(agent);
  try {
    HostEnqueuePromiseJob(job, realm, agent);
  } finally {
    setSurroundingAgent(previous);
  }
}

/** proposal-runtime-types #sec-function.prototype.callthread */
export function* FunctionProto_callThread(args: Arguments, { thisValue }: { thisValue: Value }): ValueEvaluator {
  const func = thisValue;
  if (!IsCallable(func) || !isFunctionObject(func)) {
    return Throw.TypeError('$1 is not a function', func);
  }
  const { options, callArgs } = Q(yield* ClassifyThreadArguments(func, args));
  let signal: AbortSignalObject | undefined;
  if (options !== undefined) {
    const s = Q(yield* Get(options, Value('signal')));
    if (s !== Value.undefined) {
      if (!isAbortSignal(s)) {
        return Throw.TypeError('$1 is not assignable to $2', s, Value('AbortSignal'));
      }
      signal = s;
    }
  }
  return CreateThread(func, callArgs, signal);
}
