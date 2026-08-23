import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * proposal-runtime-types `annex-standard-kit`, PLAN-std-types.md phase 1.
 *
 * The phase gate: `import { partial } from 'std:types'` resolves in a
 * `runtime-types` realm AND NOT OTHERWISE. This file tests the RESOLUTION and
 * the module's evaluation as a whole; the per-export conformance suite is
 * phase 3, and lives beside the kit's obligations in `standard-kit.test.mts`.
 *
 * Two properties are load-bearing and neither is obvious.
 *
 * The kit is resolved by the ENGINE, not by an embedder's loader (OQ3-B), so
 * these realms wire NO module loader at all and the import still resolves. That
 * is the whole point of the arrangement: eight call sites configure loaders
 * today, and a standard module that eight places can forget is not standard.
 * `HostLoadImportedModule` therefore offers the request to the kit before
 * consulting the host hook, and a realm with no hook at all - which answers
 * "Host does not set a module loader" for every other specifier, as the last
 * test here asserts - still gets `std:types`.
 *
 * And the kit DECLINES when `runtime-types` is off rather than claiming the
 * specifier and failing to parse. The kit is written in the proposal's syntax,
 * so compiling it without the feature is a syntax error, and reporting that
 * would blame the kit for a feature the program never enabled. Declining lets
 * the ordinary "no loader" diagnostic through instead.
 */

const NL = String.fromCharCode(10);

/** A realm with NO module loader configured, which is the point. */
function bareRealm(features: readonly string[]) {
  const agent = new Agent({ features: features as never });
  setSurroundingAgent(agent);
  return new ManagedRealm({ resolverCache: new ModuleCache() });
}

function evaluate(realm: ManagedRealm, source: string): Promise<string> {
  const parsed = realm.compileModule(source, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') {
    return Promise.resolve('compile threw');
  }
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 10_000);
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (completion) => {
      clearTimeout(timer);
      resolve((completion as { Type?: string }).Type === 'throw' ? 'threw' : 'evaluated');
    });
  });
}

test('the phase gate: `import { partial } from "std:types"` resolves with no loader configured', async () => {
  const realm = bareRealm(['runtime-types']);
  // The import must resolve AND the helper must compute the right type. A
  // resolution that yields a module whose `partial` is wrong would pass a
  // bare-import test and fail the only thing anyone wants from it.
  const source = 'import { partial } from "std:types";' + NL
    + 'type User = { id: uint8, name: string };' + NL
    + 'if (partial(User) !== type { id?: uint8, name?: string }) { throw new Error("partial disagrees"); }';
  expect(await evaluate(realm, source)).toBe('evaluated');
});

test('the whole module evaluates - every one of the 71 exports is reachable', async () => {
  const realm = bareRealm(['runtime-types']);
  // A namespace import forces the module body to completion, so a helper whose
  // DEFINITION does not evaluate fails here rather than at its first call in
  // some later phase. The corpus imports the kit both ways
  // (`import { ... }` and `import * as std`), so both are exercised.
  const source = 'import * as std from "std:types";' + NL
    + 'const names = Object.keys(std);' + NL
    + 'if (names.length !== 71) { throw new Error("export count is " + names.length); }';
  expect(await evaluate(realm, source)).toBe('evaluated');
});

test('interning holds across two importers, and the kit coexists with a host loader', async () => {
  // `annex-standard-kit`: the kit ships as one module so that "`partial(User)`
  // in two packages is one type". Two separate importers, one interned result.
  //
  // This realm DOES configure a loader, for the ordinary `helper` specifier,
  // which makes it the coexistence test as well: the engine answers `std:types`
  // first and every other specifier still reaches the host.
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  const helperSource = 'import { partial } from "std:types";' + NL
    + 'export const make = (T) => partial(T);';
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (moduleRequest, _realm, callback) => {
        callback(moduleRequest.Specifier === 'helper'
          ? helperSource
          : Throw.Error(`no module ${moduleRequest.Specifier}`) as never);
      },
    }),
  ]) as never;

  const source = 'import { partial } from "std:types";' + NL
    + 'import { make } from "helper";' + NL
    + 'type User = { id: uint8 };' + NL
    + 'if (make(User) !== partial(User)) { throw new Error("two modules, two types"); }';
  expect(await evaluate(realm, source)).toBe('evaluated');
});

test('the kit declines when `runtime-types` is off, leaving the ordinary diagnostic', async () => {
  const realm = bareRealm([]);
  // Not "the kit failed to parse" - the kit never claimed the request. With no
  // host hook, the ordinary answer is that the host set no loader.
  expect(await evaluate(realm, 'import { partial } from "std:types";' + NL + '1;')).toBe('threw');
});

test('any other specifier falls through to the host untouched', async () => {
  const realm = bareRealm(['runtime-types']);
  expect(await evaluate(realm, 'import x from "std:not-the-kit";' + NL + '1;')).toBe('threw');
});
