import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * A specifier requested TWICE against a realm with a `resolverCache`.
 *
 * `ModuleCache.load` records an entry as pending, hands the loader a `setCache`
 * to resolve it with, and answers later requests from the resolved value. A
 * loader that delivers its module by calling the chain's `finish` directly
 * satisfies the FIRST request and tells the cache nothing - the entry stays
 * pending - so the second request awaits a promise nothing will settle, and the
 * load never completes. Nothing reports this: a load that does not finish
 * raises no error, so the console simply answers nothing.
 *
 * Two requests for one specifier is the ordinary case rather than a corner. A
 * preprocessor module is loaded at PARSE time by `LoadPreprocessorModule`, so
 * the macro can be read before the importing module is parsed, and again at
 * EVALUATION as the ordinary import that named it. Every module carrying a
 * preprocessor import therefore takes this path.
 */
const NL = String.fromCharCode(10);

function realmWithCache(modules: Record<string, string>) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });

  const builtin = createBuiltinModuleLoader({
    loadBuiltinModule: (moduleRequest, _realm, callback) => {
      const source = modules[moduleRequest.Specifier];
      if (source !== undefined) {
        callback(source);
        return;
      }
      callback(Throw.Error(`No virtual module found for ${moduleRequest.Specifier}`) as never);
    },
  });
  // The devtools' own normalising loader: `./m.js` names the snippet `m.js`.
  const relative: typeof builtin = (referrer, moduleRequest, hostDefined, finish, suggestError) => {
    const stripped = moduleRequest.Specifier.replace(/^\.\//, '');
    if (stripped !== moduleRequest.Specifier && modules[stripped] !== undefined) {
      builtin(referrer, { ...moduleRequest, Specifier: stripped }, hostDefined, finish, suggestError);
      return;
    }
    finish(undefined);
  };
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([relative, builtin]) as never;
  return realm;
}

const MACRO = 'export const m = (t) => t;' + NL + 'export const value = 7;';

test('a module with a preprocessor import evaluates when the realm has a resolverCache', async () => {
  const realm = realmWithCache({ 'm.js': MACRO });
  const source = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL
    + 'globalThis.__ran = true;';

  const parsed = realm.compileModule(source, { specifier: 'console' } as never);
  expect((parsed as { Type?: string }).Type).not.toBe('throw');

  // The load must COMPLETE. Before, the second request for `./m.js` - this one,
  // the import itself - awaited the entry the parse-time load left pending, and
  // the callback below was never reached at all.
  const settled = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 5000);
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (completion) => {
      clearTimeout(timer);
      resolve((completion as { Type?: string }).Type === 'throw' ? 'threw' : 'evaluated');
    });
  });
  expect(settled).toBe('evaluated');
});

test('one specifier requested twice answers both times', () => {
  const realm = realmWithCache({ 'm.js': MACRO });
  // Two separate modules importing the same specifier: the second must be
  // served from the cache rather than left waiting on it.
  const first = realm.compileModule('import { value } from "./m.js";' + NL + 'export const a = value;');
  expect((first as { Type?: string }).Type).not.toBe('throw');

  const second = realm.compileModule('import { value } from "./m.js";' + NL + 'export const b = value;');
  const outcomes: string[] = [];
  for (const module of [first, second]) {
    let done = false;
    realm.evaluateModule((module as unknown as { Value: never }).Value, undefined, () => {
      done = true;
    });
    outcomes.push(done ? 'settled' : 'PENDING');
  }
  expect(outcomes).toEqual(['settled', 'settled']);
});
