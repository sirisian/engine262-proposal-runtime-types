import type { kAsyncContext } from '../utils/internal.mts';
import {
  type Realm, type AbstractModuleRecord, type ScriptRecord, type NullValue, type ExecutionContext, type FunctionObject,
  Assert,
  Call,
  IsCallable,
  Q,
  Value,
  type Arguments,
  type ValueEvaluator,
  surroundingAgent,
  type Agent,
  type PlainEvaluator,
  GetActiveScriptOrModule,
} from '#self';

/** https://tc39.es/ecma262/#job */
export interface Job {
  readonly queueName: string;
  readonly job: () => PlainEvaluator<unknown>;
  readonly callerRealm: Realm | undefined;
  readonly callerScriptOrModule: AbstractModuleRecord | ScriptRecord | NullValue;
}

/** https://tc39.es/ecma262/#sec-jobcallback-records */
export interface JobCallbackRecord {
  Callback: FunctionObject & { [kAsyncContext]?: ExecutionContext; };
  HostDefined: undefined;
}

/** https://tc39.es/ecma262/#sec-hostmakejobcallback */
export function HostMakeJobCallback(callback: FunctionObject): JobCallbackRecord {
  // 1. Assert: IsCallable(callback) is true.
  Assert(IsCallable(callback));
  // 2. Return the JobCallback Record { [[Callback]]: callback, [[HostDefined]]: empty }.
  return { Callback: callback, HostDefined: undefined };
}

/** https://tc39.es/ecma262/#sec-hostcalljobcallback */
export function* HostCallJobCallback(jobCallback: JobCallbackRecord, V: Value, argumentsList: Arguments): ValueEvaluator {
  // 1. Assert: IsCallable(jobCallback.[[Callback]]) is true.
  Assert(IsCallable(jobCallback.Callback));
  // 1. Return ? Call(jobCallback.[[Callback]], V, argumentsList).
  return Q(yield* Call(jobCallback.Callback, V, argumentsList));
}

// Atomics: HostEnqueueGenericJob

/** https://tc39.es/ecma262/#sec-hostenqueuepromisejob */
export function HostEnqueuePromiseJob(job: () => PlainEvaluator, realm: Realm | null, agent?: Agent) {
  if (surroundingAgent.debugger_isPreviewing) {
    return;
  }

  const callerRealm = realm || surroundingAgent.currentRealmRecord;
  const scriptOrModule = GetActiveScriptOrModule();
  // proposal-runtime-types #sec-threading-scheduling: "HostEnqueuePromiseJob
  // enqueues a job on the microtask queue of the agent it is paired with." A
  // caller that knows the home agent of a reaction passes it; everything else
  // enqueues on the surrounding agent, which is the single-threaded behaviour
  // and is also correct for a reaction attached by the agent now running.
  const target = agent ?? surroundingAgent;
  target.jobQueue.enqueuePromiseJob({
    queueName: 'PromiseJobs',
    job,
    callerRealm,
    callerScriptOrModule: scriptOrModule,
  });
}

// Atomics: HostEnqueueTimeoutJob
