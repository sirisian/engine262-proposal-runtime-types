import { surroundingAgent } from '../execution-context/Agent.mts';
import type { TypeRecord } from './records.mts';

const pending = new WeakMap<object, readonly TypeRecord[]>();

/** #sec-typed-promise-executors: construction supplies types before the executor runs. */
export function SetPendingPromiseTypes(types: readonly TypeRecord[] | undefined): void {
  if (types) pending.set(surroundingAgent, types);
  else pending.delete(surroundingAgent);
}

export function TakePendingPromiseTypes(): readonly TypeRecord[] | undefined {
  const types = pending.get(surroundingAgent);
  pending.delete(surroundingAgent);
  return types;
}
