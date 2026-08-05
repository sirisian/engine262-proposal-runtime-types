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
  if (FirstParameterAdmits(func, first)) {
    return none;
  }
  const rest = args.slice(1) as Arguments;
  const keys = X(first.OwnPropertyKeys());
  if (keys.length === 0) {
    // An explicit empty bag.
    return { options: first, callArgs: rest };
  }
  const signal = Q(yield* Get(first, Value('signal')));
  if (signal instanceof ObjectValue && IsAbortSignal(signal)) {
    return { options: first, callArgs: rest };
  }
  return none;
}

/**
 * Whether the callee's declared first parameter admits `value`. The declared type
 * wins over the brand when it exists; an unannotated function has nothing to say
 * and the brand decides.
 */
function FirstParameterAdmits(_func: FunctionObject, _value: ObjectValue): boolean {
  // Placeholder for the typed half of #sec-classifythreadarguments. Reading the
  // declared parameter type here needs the callee's signature record, which is
  // carried on typed function objects only; until that lookup is wired, an
  // annotated first parameter is not consulted and the brand decides alone. This
  // is a KNOWN DIVERGENCE from the specification, recorded in the test file.
  return false;
}

/** Whether `value` is an AbortSignal, by brand rather than by shape. */
function IsAbortSignal(value: ObjectValue): boolean {
  return 'AbortSignalAborted' in value;
}

/**
 * proposal-runtime-types #sec-createthread: create an agent of the surrounding
 * agent's cluster, call `func` on it, and return a promise for the result.
 *
 * The capability is created on the CALLING thread, so its reactions are that
 * thread's reactions and the handle settles there - which is the general rule of
 * #sec-threading-scheduling and not a carve-out for this one promise.
 */
export function CreateThread(func: FunctionObject, args: Arguments, signal: ObjectValue | undefined): Value {
  const capability = X(NewPromiseCapability(surroundingAgent.currentRealmRecord.Intrinsics['%Promise%']));
  if (signal !== undefined && IsAborted(signal)) {
    X(Call(capability.Reject, Value.undefined, [AbortReason(signal)]));
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
  enqueueOn(thread, realm, function* threadBody(): PlainEvaluator {
    const result = EnsureCompletion(yield* Call(func, Value.undefined, args));
    SettleFromThread(spawner, realm, capability, result);
    cluster.removeThread(thread);
    return Value.undefined;
  });

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
  const value = result.Value;
  HostEnqueuePromiseJob(function* settleJob(): PlainEvaluator {
    X(Call(settle, Value.undefined, [value]));
    return Value.undefined;
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

function IsAborted(signal: ObjectValue): boolean {
  return (signal as unknown as { AbortSignalAborted?: boolean }).AbortSignalAborted === true;
}

function AbortReason(signal: ObjectValue): Value {
  return (signal as unknown as { AbortSignalReason?: Value }).AbortSignalReason ?? Value.undefined;
}

/** proposal-runtime-types #sec-function.prototype.callthread */
export function* FunctionProto_callThread(args: Arguments, { thisValue }: { thisValue: Value }): ValueEvaluator {
  const func = thisValue;
  if (!IsCallable(func) || !isFunctionObject(func)) {
    return Throw.TypeError('NotAFunction', func);
  }
  const { options, callArgs } = Q(yield* ClassifyThreadArguments(func, args));
  let signal: ObjectValue | undefined;
  if (options !== undefined) {
    const s = Q(yield* Get(options, Value('signal')));
    if (s !== Value.undefined) {
      if (!(s instanceof ObjectValue) || !IsAbortSignal(s)) {
        return Throw.TypeError('NotAFunction', s);
      }
      signal = s;
    }
  }
  return CreateThread(func, callArgs, signal);
}
