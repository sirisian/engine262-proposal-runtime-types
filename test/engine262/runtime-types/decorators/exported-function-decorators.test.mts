import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * A decorated EXPORTED function declaration is decorated like an unexported one:
 * `@dec export function f() {}` behaves as `@dec function f() {}` does, for every decorator.
 * The decorators sit on the EXPORT node rather than on the declaration, so the export
 * evaluator hands them to the function evaluator instead of reimplementing the application;
 * that keeps the rules of #sec-decorator-application - sub-targets are applied and a
 * replacement is written back through the binding - in the one place that owns them.
 */

const NL = String.fromCharCode(10);

function runModule(source: string): Promise<string> {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (r: { Specifier: string }, _realm: unknown, cb: (v: unknown) => void) => {
        cb(Throw.Error(`no module ${r.Specifier}`) as never);
      },
    } as never),
  ]) as never;
  const parsed = realm.compileModule(source, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') return Promise.resolve('compile threw');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15000);
    realm.evaluateModule((parsed as { Value: unknown }).Value as never, undefined, (c: unknown) => {
      clearTimeout(timer);
      const completion = c as { Type?: string, PromiseState?: string, Value?: { PromiseState?: string } };
      if (completion?.Type === 'throw') return resolve('threw');
      const state = completion?.PromiseState ?? completion?.Value?.PromiseState;
      return resolve(state === 'rejected' ? 'threw' : state === 'fulfilled' ? 'ok' : `unsettled(${state})`);
    });
  });
}

const MARK = 'let seen = "";' + NL + 'function mark(c) { seen += "@"; }' + NL;

test('a decorator on an exported function declaration runs', () => runModule(
  MARK + '@mark' + NL + 'export function f() { return 1; }' + NL
  + 'if (seen !== "@") { throw new Error("decorator did not run: " + seen); }')
  .then((r) => expect(r).toBe('ok')));

test('an undecorated exported function is unaffected', () => runModule(
  'export function g() { return 1; }' + NL + 'if (g() !== 1) { throw new Error("wrong"); }')
  .then((r) => expect(r).toBe('ok')));

// A decorated exported CLASS throws here, and did so before this change too -
// verified by reverting it and running this file, where both this and the
// function case failed. So the class branch has its own defect, untouched by
// routing the function one, and this records it rather than asserting a green
// that was never there.
test('a decorated exported class throws, which is a separate pre-existing defect', () => runModule(
  MARK + '@mark' + NL + 'export class C {}' + NL
  + 'if (seen !== "@") { throw new Error("decorator did not run: " + seen); }')
  .then((r) => expect(r).toBe('threw')));
