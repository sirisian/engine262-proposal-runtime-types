import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader, EnsureCompletion, Get, Value, X,
  TypeDiagnosticOf, type ObjectValue, type JSStringValue, type TypeDiagnosticRecord,
} from '#self';

interface Outcome { status: 'ok' | 'rejected'; bodyRan: boolean; dependencyRan: boolean; errorClass?: string; diagnostic?: TypeDiagnosticRecord }

function runWith(specifier: string, source: string, body: string): Promise<Outcome> {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  realm.evaluateScriptSkipDebugger('globalThis.__moduleBodyRan = false; globalThis.__dependencyRan = false;');
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (request: { Specifier: string }, _realm: unknown, callback: (v: unknown) => void) => {
        callback(request.Specifier === specifier ? `globalThis.__dependencyRan = true; ${source}` : Throw.Error(`no module ${request.Specifier}`) as never);
      },
    } as never),
  ]) as never;
  const outcome = (error?: ObjectValue): Outcome => {
    const ran = EnsureCompletion(realm.evaluateScriptSkipDebugger('String(globalThis.__moduleBodyRan);'));
    expect(ran.Type).toBe('normal');
    const bodyRan = (ran.Value as JSStringValue).stringValue() === 'true';
    const dependency = EnsureCompletion(realm.evaluateScriptSkipDebugger('String(globalThis.__dependencyRan);'));
    expect(dependency.Type).toBe('normal');
    const dependencyRan = (dependency.Value as JSStringValue).stringValue() === 'true';
    if (!error) return { status: 'ok', bodyRan, dependencyRan };
    const pop = realm.pushTopContext();
    try {
      const constructor = X(Get(error, Value('constructor'))) as ObjectValue;
      const errorClass = (X(Get(constructor, Value('name'))) as JSStringValue).stringValue();
      return { status: 'rejected', bodyRan, dependencyRan, errorClass, diagnostic: TypeDiagnosticOf(error) };
    } finally { pop?.(); }
  };
  const parsed = EnsureCompletion(realm.compileModule(`globalThis.__moduleBodyRan = true; ${body}`, { specifier: 'main' } as never));
  if (parsed.Type === 'throw') return Promise.resolve(outcome(parsed.Value as ObjectValue));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Module evaluation did not settle')), 15000);
    realm.evaluateModule(parsed.Value as never, undefined, (completion: unknown) => {
      clearTimeout(timer);
      try {
        const c = completion as { Type?: string, Value?: ObjectValue, PromiseState?: string, PromiseResult?: ObjectValue };
        if (c.Type === 'throw') { resolve(outcome(c.Value)); return; }
        const promise = (c.PromiseState ? c : c.Value) as { PromiseState?: string, PromiseResult?: ObjectValue };
        expect(['fulfilled', 'rejected']).toContain(promise?.PromiseState);
        resolve(outcome(promise.PromiseState === 'rejected' ? promise.PromiseResult : undefined));
      } catch (error) { reject(error); }
    });
  });
}

const TYPED = 'export let x: uint8 = 1;';

test('a module without proposal syntax keeps its behaviour', async () => {
  expect(await runWith('typed', TYPED, 'if ([]) {} for (const v of []) {}'))
    .toMatchObject({ status: 'ok', bodyRan: true });
});

test('and so does one importing a typed binding', async () => {
  expect(await runWith('typed', TYPED, 'import { x } from "typed"; if (x === 300) {} if ([]) {}'))
    .toMatchObject({ status: 'ok', bodyRan: true });
});

test.each([
  'let checked: number = 0; function u() { if ([]) {} }',
  'import { x } from "typed"; let checked: number = 0; function u() { if ([]) {} }',
])('checked module rejection precedes its body: %s', async (body) => {
  expect(await runWith('typed', TYPED, body)).toMatchObject({
    status: 'rejected', bodyRan: false, errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_CONSTANT_CONDITION' },
  });
});

test.each(['', 'await 0;'])('a module performs deferred checking after its dependency and before its body: %s', async (suspension) => {
  expect(await runWith('typed', TYPED, `import { x } from 'typed'; ${suspension} type Invalid = float32.<{ unknownKey: 1 }>;`)).toMatchObject({
    status: 'rejected', bodyRan: false, dependencyRan: true, errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_UNCLAIMED_METADATA', phase: 'pre-evaluation' },
  });
});
