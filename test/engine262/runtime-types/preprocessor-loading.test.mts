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
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, hostDefined: unknown, payload: unknown) {
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
