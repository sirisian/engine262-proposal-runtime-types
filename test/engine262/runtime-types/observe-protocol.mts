import { expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
  EnsureCompletion, Get, Value, X, ObjectValue, JSStringValue,
} from '#self';

/** Observe a protocol's error phase, promise settlement and user effects. */
export function observeProtocol(source: string) {
  const imports: string[] = [];
  const agent = new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer, request, _hostDefined, payload) {
        imports.push(request.Specifier);
        FinishLoadingImportedModule(referrer, request, payload, realm.compileModule('export const answer = 42;'));
      },
    },
  });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('globalThis.__protocolBodyRan=false; globalThis.settled="unobserved"; globalThis.settledMessage=""; globalThis.hookRan=false;');
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(`globalThis.__protocolBodyRan=true; ${source}`));
  let kind: string | null = null;
  if (completion.Type === 'throw') {
    const pop = realm.pushTopContext();
    try {
      const constructor = X(Get(completion.Value as ObjectValue, Value('constructor')));
      kind = (X(Get(constructor as ObjectValue, Value('name'))) as JSStringValue).stringValue();
    } finally {
      pop?.();
    }
  }
  for (let i = 0; i < 1000 && agent.jobQueue?.length; i += 1) {
    (agent.jobQueue.shift() as { callback?: () => unknown }).callback?.();
  }
  expect(agent.jobQueue?.length ?? 0, 'protocol jobs must settle').toBe(0);
  const read = (expression: string): string => {
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`String(${expression});`));
    expect(result.Type).toBe('normal');
    return (result.Value as JSStringValue).stringValue();
  };
  return {
    completion: completion.Type, kind, imports,
    bodyRan: read('globalThis.__protocolBodyRan'),
    settled: read('globalThis.settled'),
    settledMessage: read('globalThis.settledMessage'),
    hookRan: read('globalThis.hookRan'),
  };
}
