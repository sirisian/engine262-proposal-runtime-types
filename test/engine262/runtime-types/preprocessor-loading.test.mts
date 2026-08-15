import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
  LoadPreprocessorModule, PreprocessorExport,
} from '#self';


/**
 * `sec-preprocessor-modules`: "A preprocessor module is fetched and evaluated
 * BEFORE the importing module is parsed. The loader blocks on it as it blocks
 * for a module with top-level await."
 *
 * The blocking is the point, and it does not need asynchrony: a host may call
 * `FinishLoadingImportedModule` synchronously, and where it does the graph
 * resolves before `LoadRequestedModules` returns. A host that cannot gets a
 * diagnostic rather than a hang - which the specification does not say, because
 * it does not say what a host that cannot block is owed.
 */
const NL = String.fromCharCode(10);

/** A host whose loader answers from a map, synchronously. */
/** Runs `f` with the realm's execution context on the stack. */
function inRealm<T>(realm: ManagedRealm, f: () => T): T {
  const pop = (realm as unknown as { pushTopContext(): (() => void) | undefined }).pushTopContext();
  try {
    return f();
  } finally {
    pop?.();
  }
}

function realmWithModules(modules: Record<string, string>, defer = false) {
  const pending: (() => void)[] = [];
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _hostDefined: unknown, payload: unknown) {
        const source = modules[request.Specifier];
        const realm = (globalThis as { __realm?: ManagedRealm }).__realm as ManagedRealm;
        const finish = () => {
          if (source === undefined) {
            FinishLoadingImportedModule(referrer as never, request as never, payload as never, realm.compileModule('throw new Error("not found");') as never);
            return;
          }
          const compiled = realm.compileModule(source, { specifier: request.Specifier } as never);
          FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
        };
        if (defer) {
 pending.push(finish);
} else {
 finish();
}
      },
    },
  } as never));
  const realm = new ManagedRealm();
  (globalThis as { __realm?: ManagedRealm }).__realm = realm;
  return { realm, pending };
}

test('a preprocessor module loads, links and evaluates before anything is parsed', () => {
  const { realm } = realmWithModules({
    './m.js': 'export const jsx = (t) => t;' + NL + 'export const other = 1;',
  });
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type === 'throw').toBe(false);
});

test('the EXPORT name is what the module is asked for', () => {
  // `import { jsx as h }` declares `@h` and asks for `jsx`. Keying by the bound
  // name and asking by the exported one is the whole reason the pre-scan keeps
  // both.
  const { realm } = realmWithModules({
    './m.js': 'export const jsx = (t) => t;',
  });
  const loaded = inRealm(realm, () => {
    const module = LoadPreprocessorModule(realm, realm as never, './m.js');
    if ((module as { Type?: string }).Type === 'throw') {
 return 'LOAD FAILED';
}
    const found = PreprocessorExport(module as never, 'jsx');
    const missing = PreprocessorExport(module as never, 'nope');
    return (found === undefined ? 'none' : 'callable') + '/' + (missing === undefined ? 'none' : 'callable');
  });
  expect(loaded).toBe('callable/none');
});

test('a host that defers gets a diagnostic, not a hang', () => {
  // The importing module's PARSE is what is waiting, so there is nothing to wait
  // WITH. Saying so is better than blocking forever.
  const { realm } = realmWithModules({ './m.js': 'export const jsx = 1;' }, true);
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type).toBe('throw');
});

test('a module that throws while evaluating propagates', () => {
  const { realm } = realmWithModules({ './m.js': 'throw new Error("boom");' });
  const result = inRealm(realm, () => LoadPreprocessorModule(realm, realm as never, './m.js')) as { Type?: string };
  expect(result.Type).toBe('throw');
});

test('a macro resolved from its MODULE expands as one from the hook does', () => {
  // The claim of this phase, and the whole point of the fallback: the two paths
  // are compared on ONE test rather than by migrating every test at once.
  //
  // `sec-preprocessor-modules` says a preprocessor module is fetched and
  // evaluated before the importing module is parsed, and that its exports are
  // what a decoration names. So the module is loaded and its export read.
  // `HostResolveReplacementDecorator`, which is not in the specification, stays
  // behind it until the tests move.
  const MACRO = 'export const m = (t) => [{ kind: "string", value: JSON.stringify("EXPANDED"), span: t[0] && t[0].span }];';
  const SOURCE = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL
    + 'export const v = @m { anything };';
  const expanded = (c: { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } }) => {
    const text = c.Value?.ECMAScriptCode?.sourceText ?? '';
    return c.Type === 'normal' ? text.slice(text.indexOf(NL) + 1).trim() : 'REFUSED';
  };

  // From the MODULE: a host that loads, and no decorator hook at all.
  const { realm } = realmWithModules({ './m.js': MACRO });
  const viaModule = expanded(realm.compileModule(SOURCE) as never);

  // From the HOOK: no loader, the fallback answering instead.
  const macro: { current?: unknown } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: () => macro.current },
  } as never));
  const hookRealm = new ManagedRealm();
  macro.current = (hookRealm.evaluateScriptSkipDebugger(
    '((t) => [{ kind: "string", value: JSON.stringify("EXPANDED"), span: t[0] && t[0].span }])',
  ) as { Value?: unknown }).Value;
  const viaHook = expanded(hookRealm.compileModule(SOURCE) as never);

  expect(viaModule).toBe('export const v = "EXPANDED";');
  expect(viaModule).toBe(viaHook);
});
