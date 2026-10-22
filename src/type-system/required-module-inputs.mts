import type { ThrowCompletion } from '../completion.mts';
import type { EnvironmentRecord } from '../execution-context/Environment.mts';
import { surroundingAgent } from '../execution-context/Agent.mts';

interface RequiredInputs {
  readonly home?: EnvironmentRecord;
  failure?: ThrowCompletion;
}

// This is checking state, not a property on a user-visible exception. A catch
// can handle an ordinary TDZ exception without establishing an unavailable
// producer input, and a same-shaped user exception cannot manufacture one.
const scopes = new WeakMap<object, RequiredInputs[]>();

export function BeginRequiredModuleInputs(home: EnvironmentRecord): () => void {
  const agent = surroundingAgent;
  const active = scopes.get(agent) ?? [];
  scopes.set(agent, active);
  active.push({ home });
  return () => {
    active.pop();
    if (!active.length) scopes.delete(agent);
  };
}

/** Called only for an actual uninitialized module binding read. */
export function RecordUnavailableModuleInput(environment: EnvironmentRecord, failure: ThrowCompletion): void {
  const active = scopes.get(surroundingAgent) ?? [];
  const required = active.some((scope) => scope.home === undefined);
  for (const scope of active) {
    // This source's own pending declarations retain ordinary preparation and
    // deferral. An imported producer cannot be initialized by that preparation.
    if (required || scope.home !== environment) scope.failure ??= failure;
  }
}

/** A foreign obligation can reach the consumer again through a cyclic import. */
export function RequireModuleInputs(): () => void {
  const active = scopes.get(surroundingAgent);
  // Runtime-only specialization keeps ordinary exception behaviour.
  if (!active?.length) return () => {};
  active.push({});
  return () => { active.pop(); };
}

/** Inspect before accepting a computed result or publishing a successful memo. */
export function RequiredModuleInputFailure(): ThrowCompletion | undefined {
  return scopes.get(surroundingAgent)?.find((scope) => scope.failure)?.failure;
}
