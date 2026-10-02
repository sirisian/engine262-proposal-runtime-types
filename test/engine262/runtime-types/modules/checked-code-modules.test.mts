import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

// #sec-checked-code: a Module is a unit. One using none of the proposal's syntax
// keeps its behaviour, even when it imports from a typed module; proposal syntax
// at its top level makes the whole Module checked.

function settle(c: { Type?: string, PromiseState?: string, Value?: { PromiseState?: string } }): string {
  if (c?.Type === 'throw') return 'threw';
  const state = c?.PromiseState ?? c?.Value?.PromiseState;
  return state === 'rejected' ? 'threw' : state === 'fulfilled' ? 'ok' : `unsettled(${state})`;
}

function runWith(specifier: string, source: string, body: string): Promise<string> {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (request: { Specifier: string }, _realm: unknown, callback: (v: unknown) => void) => {
        callback(request.Specifier === specifier ? source : Throw.Error(`no module ${request.Specifier}`) as never);
      },
    } as never),
  ]) as never;
  const parsed = realm.compileModule(body, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') return Promise.resolve('compile threw');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15000);
    realm.evaluateModule((parsed as { Value: unknown }).Value as never, undefined, (c: unknown) => {
      clearTimeout(timer);
      resolve(settle(c as Parameters<typeof settle>[0]));
    });
  });
}

const TYPED = 'export let x: uint8 = 1;';

test('a module without proposal syntax keeps its behaviour', () => runWith('typed', TYPED,
  'if ([]) {} for (const v of []) {}')
  .then((r) => expect(r).toBe('ok')));

test('and so does one importing a typed binding', () => runWith('typed', TYPED,
  'import { x } from "typed"; if (x === 300) {} if ([]) {}')
  .then((r) => expect(r).toBe('ok')));

test('top-level proposal syntax checks the whole module', () => runWith('typed', TYPED,
  'let checked: number = 0; function u() { if ([]) {} }')
  .then((r) => expect(r).not.toBe('ok')));

test('a typed importer is checked', () => runWith('typed', TYPED,
  'import { x } from "typed"; let checked: number = 0; function u() { if ([]) {} }')
  .then((r) => expect(r).not.toBe('ok')));
