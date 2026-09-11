import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw, performDevtoolsEval, skipDebugger,
  AbruptCompletion, EnsureCompletion, composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * checkInTwoPasses (src/type-system/check.mts): a statement list is checked
 * twice, because an inference anchored by one of the list's OWN bindings is
 * decided from the frame the pass starts with, and only the second pass starts
 * with them. CheckScript and CheckModule always ran two passes; the console
 * entry (CheckScriptInSession) and the link-time check (CheckModuleWithImports)
 * ran one, and silently accepted what script scope refuses. A typed lexical
 * binding has no run-time boundary, so nothing catches such a program later.
 */

const NL = String.fromCharCode(10);

function scriptThrows(source: string): boolean {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const c = new ManagedRealm().evaluateScriptSkipDebugger(source) as { Type?: string };
  return c.Type === 'throw';
}

function consoleThrows(entries: readonly string[]): boolean[] {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  return entries.map((source) => {
    const c = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    return c instanceof AbruptCompletion;
  });
}

// `f` is anchored by `arr`'s annotation, so `let s: string = f()` is a type
// error - if the checker saw `arr` when it decided whether `f` publishes.
const READS_OWN_BINDING = [
  'let arr: [].<uint8> = [1, 2];',
  'function f() { return arr[0]; }',
  'let s: string = f();',
].join(NL);

test('script scope refuses a body reading a same-text binding (the baseline)', () => {
  expect(scriptThrows(READS_OWN_BINDING)).toBe(true);
});

test('a console entry refuses the same text as ONE entry', () => {
  expect(consoleThrows([READS_OWN_BINDING])).toEqual([true]);
});

test('...and across entries, where the session frame supplies the binding', () => {
  expect(consoleThrows([
    'let arr: [].<uint8> = [1, 2];',
    'function f() { return arr[0]; }' + NL + 'let s: string = f();',
  ])).toEqual([false, true]);
});

function settle(c: { Type?: string, PromiseState?: string, Value?: { PromiseState?: string } }): string {
  if (c?.Type === 'throw') return 'threw';
  const state = c?.PromiseState ?? c?.Value?.PromiseState;
  return state === 'rejected' ? 'threw' : state === 'fulfilled' ? 'ok' : `unsettled(${state})`;
}

function linkWith(source: string, body: string): Promise<string> {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (request: { Specifier: string }, _realm: unknown, callback: (v: unknown) => void) => {
        callback(request.Specifier === 'dep' ? source : Throw.Error(`no module ${request.Specifier}`) as never);
      },
    } as never),
  ]) as never;
  const parsed = realm.compileModule(body, { specifier: 'main' } as never);
  // The parse-time check must NOT already see it: that is the point of the case.
  if ((parsed as { Type?: string }).Type === 'throw') return Promise.resolve('compile threw');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15000);
    realm.evaluateModule((parsed as { Value: unknown }).Value as never, undefined, (c: unknown) => {
      clearTimeout(timer);
      resolve(settle(c as Parameters<typeof settle>[0]));
    });
  });
}

// The binding's TYPE comes from an imported class, so at parse time `c` is
// untyped and `f` is unanchored; only the link-time pass can see the anchor,
// and the anchor is a binding of the module's own.
const DEP_CLASS = 'export class C { x: uint8 = 1; }';

test('link time: a direct read through the imported class is refused (the baseline)', () => linkWith(DEP_CLASS,
  'import { C } from "dep";' + NL + 'let c: C = new C();' + NL + 'if (false) { let s: string = c.x; }')
  .then((r) => expect(r).toBe('threw')));

test('link time: a body reading the same-text binding typed by the import is refused', () => linkWith(DEP_CLASS,
  'import { C } from "dep";' + NL + 'let c: C = new C();' + NL + 'function f() { return c.x; }' + NL + 'if (false) { let s: string = f(); }')
  .then((r) => expect(r).toBe('threw')));

test('link time: nothing is reported twice, and a correct program still links', () => linkWith(DEP_CLASS,
  'import { C } from "dep";' + NL + 'let c: C = new C();' + NL + 'function f() { return c.x; }' + NL + 'let u: uint8 = f();')
  .then((r) => expect(r).toBe('ok')));
