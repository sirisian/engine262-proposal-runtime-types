import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * #sec-checked-contracts has two halves and they behaved differently across a
 * module boundary. The VERIFIED half fires at every concrete evaluation of an
 * imported builder. The ASSUMED half - what lets a generic body reason about a
 * deferred application before specialization - reads the builder's DECLARATION
 * for its `where` clauses, and the only declarations in reach were those in the
 * caller's own compilation. So `sanitize<T>` checked against a locally declared
 * `omit` and not against the same `omit` imported from a module, which is the
 * case typeprogramming.md 6.2 is written for.
 *
 * Rust's where clauses and C++'s concepts are part of a published interface and
 * cross a compilation boundary; a contract that stops at one has no precedent.
 * The declaration travels the channel that already carries what an imported name
 * IS, recorded when the exporting module is checked and read when the importer
 * links.
 */

const NL = String.fromCharCode(10);

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
    }),
  ]) as never;
  const parsed = realm.compileModule(body, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') return Promise.resolve('compile threw');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15000);
    realm.evaluateModule((parsed as { Value: unknown }).Value as never, undefined, (c: never) => {
      clearTimeout(timer);
      resolve(settle(c));
    });
  });
}

const OMIT = 'export function omit(T: type, k: string): type where Reflect.isAssignable(T, return) { return T; }';

test("an imported builder's contract refuses a body that contradicts it", () => runWith('kit', OMIT,
  'import { omit } from "kit";' + NL
  + 'function bad<T>(value: T): omit(T, "password") { return "no"; }')
  .then((r) => expect(r).toBe('threw')));

test('and admits one that does not', () => runWith('kit', OMIT,
  'import { omit } from "kit";' + NL
  + 'function good<T>(value: T): omit(T, "password") { return value; }' + NL
  + 'good.<{ a: uint8 }>({ a: 1 });')
  .then((r) => expect(r).toBe('ok')));

test('a builder with no contract is still untouched', () => runWith('kit',
  'export function pairOf(T: type): type { return Reflect.makeType({ kind: "tuple", elements: [{ type: T, rest: false }, { type: T, rest: false }] }); }',
  'import { pairOf } from "kit";' + NL
  + 'function f<T>(a: pairOf(T)): pairOf(T) { return a; }' + NL
  + 'f.<uint8>([1, 2]);')
  .then((r) => expect(r).toBe('ok')));
