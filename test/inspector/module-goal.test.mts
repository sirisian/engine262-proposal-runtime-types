import { expect, test } from 'vitest';
import { TestInspector } from './utils.mts';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * `Runtime.compileScript` and `Runtime.evaluate` must agree about which goal an
 * entry has.
 *
 * The console calls `compileScript` FIRST, to decide whether what was typed is
 * complete. `evaluate` detects module syntax and takes the module goal;
 * `compileScript` branched on the evaluate-mode dropdown alone, so in the
 * default mode a static `import` failed the completeness check and the
 * goal-detecting path was never reached. Selecting `module` by hand was the
 * only way through - and a preprocessor import has no other goal available, so
 * macros in the console appeared not to work at all.
 */
const NL = String.fromCharCode(10);

function setup() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  const builtin = createBuiltinModuleLoader({
    loadBuiltinModule: (request, _realm, callback) => {
      callback(request.Specifier === 'm.js'
        ? 'export const m = (t) => t;'
        : Throw.Error('missing') as never);
    },
  });
  const relative: typeof builtin = (referrer, request, hostDefined, finish, suggestError) => {
    const stripped = request.Specifier.replace(/^\.\//, '');
    if (stripped !== request.Specifier) {
      builtin(referrer, { ...request, Specifier: stripped }, hostDefined, finish, suggestError);
      return;
    }
    finish(undefined);
  };
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([relative, builtin]) as never;

  const inspector = new TestInspector();
  inspector.attachAgent(agent, [realm]);
  return inspector;
}

const compile = (inspector: TestInspector, expression: string) => inspector.runtime.compileScript({
  expression, sourceURL: '', persistScript: false, executionContextId: 0,
}) as Promise<{ exceptionDetails?: { exception?: { description?: string } } }>;

test('module syntax compiles in the default (script) evaluate mode', async () => {
  const inspector = setup();
  // No `engine262_setEvaluateMode`: this is the console as it opens.
  const plain = await compile(inspector, 'import { m } from "./m.js";' + NL + 'const x = 1;');
  expect(plain.exceptionDetails).toBe(undefined);

  const preprocessor = await compile(
    inspector,
    'import { m } from "./m.js" with { preprocessor: "true" };' + NL + 'const x = 1;',
  );
  expect(preprocessor.exceptionDetails).toBe(undefined);

  const exporting = await compile(inspector, 'export const y = 2;');
  expect(exporting.exceptionDetails).toBe(undefined);
});

test('a genuine syntax error still reports, and unfinished input still wraps', async () => {
  const inspector = setup();
  // The two must stay distinguishable: the end-of-input message is what makes
  // the console wait for the next line rather than submit, so a real error
  // wearing it could never be shown.
  const broken = await compile(inspector, 'const = ;');
  expect(broken.exceptionDetails?.exception?.description).toContain('Unexpected token');

  const unfinished = await compile(inspector, 'function f() {');
  expect(unfinished.exceptionDetails?.exception?.description).toContain('Unexpected end of input');
});

test('a dynamic import() is not module syntax and stays on the script goal', async () => {
  const inspector = setup();
  // It is an ordinary expression a script parses, and it resolves during
  // evaluation - after expansion is over - so it neither needs the module goal
  // nor implies it.
  const dynamic = await compile(inspector, 'const p = import("./m.js");');
  expect(dynamic.exceptionDetails).toBe(undefined);
});
