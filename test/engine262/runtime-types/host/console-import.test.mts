import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, runSingleJobInQueue, Throw,
  CreateBuiltinFunction, CreateNonEnumerableDataPropertyOrThrow, Value,
  createBuiltinModuleLoader, composeModuleLoaders,
} from '#self';
import { Inspector } from '#self/inspector';

class TestInspector extends Inspector {
  readonly sent: any[] = [];

  protected send(data: object): void { this.sent.push(data); }

  request(id: number, method: string, params: unknown): void { this.onMessage(id, method, params); }
}

/**
 * The playground console, end to end: define a snippet, import it, use the
 * macro. Mirrors 262_worker.mts, where the loader is installed for every agent
 * rather than behind a flag - without one, every import answers "Host does not
 * set a module loader".
 */
function makeConsole() {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const cache = new Map<string, string>();
  agent.hostDefinedOptions.hostHooks ??= {};
  const builtinLoader = createBuiltinModuleLoader({
    loadBuiltinModule: (req: any, _r: any, cb: any) => {
      const src = cache.get(req.Specifier);
      if (src !== undefined) { cb(src); return; }
      cb(Throw.Error(`No virtual module found for specifier ${req.Specifier}`) as any);
    },
  } as any);
  const snippetLoader: typeof builtinLoader = (referrer, moduleRequest, hostDefined, finish, suggestError) => {
    const asked = moduleRequest.Specifier;
    const stripped = asked.replace(/^\.\//, '');
    if (stripped !== asked && cache.has(stripped)) {
      builtinLoader(referrer, { ...moduleRequest, Specifier: stripped }, hostDefined, finish, suggestError);
      return;
    }
    finish(undefined);
  };
  (agent.hostDefinedOptions.hostHooks as any).HostLoadImportedModule = composeModuleLoaders([snippetLoader, builtinLoader] as any) as any;
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  CreateNonEnumerableDataPropertyOrThrow(realm.GlobalObject, Value('defineModule'), CreateBuiltinFunction(function* define([s, src]: any) {
    cache.set(s.stringValue(), src.stringValue());
    return Value.undefined;
  } as any, 2, Value('defineModule'), []));
  pop?.();

  const inspector = new TestInspector();
  inspector.attachAgent(agent, [realm]);
  inspector.request(0, 'Runtime.enable', {});
  inspector.request(0, 'Debugger.enable', {});
  const uniqueContextId = inspector.sent
    .find((m) => m.method === 'Runtime.executionContextCreated')?.params?.context?.uniqueId;
  const drain = () => { let g = 0; while (agent.jobQueue.length > 0 && g++ < 500) { setSurroundingAgent(agent); runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {}); } };
  return async (expression: string) => {
    inspector.sent.length = 0;
    inspector.request(1, 'Runtime.evaluate', { expression, uniqueContextId, replMode: true });
    for (let t = 0; t < 50; t += 1) {
      drain();
      const reply = inspector.sent.find((m) => m.id === 1);
      if (reply) return reply.result;
      await new Promise((r) => { setTimeout(r, 0); });
    }
    return undefined;
  };
}

const describeError = (r: any) => String(r?.exceptionDetails?.exception?.description ?? '');

test('console: a snippet is defined, then imported and used', async () => {
  const evaluate = makeConsole();
  await evaluate('defineModule("jsx.js", "export function jsx(t) { return t; }");');
  for (const specifier of ['./jsx.js', 'jsx.js']) {
    const r = await evaluate(`import { jsx } from "${specifier}" with { preprocessor: "true" };`);
    expect(describeError(r), `${specifier} should import`).toBe('');
  }
});

test('console: an imported module entry runs its body', async () => {
  const evaluate = makeConsole();
  await evaluate('defineModule("jsx.js", "export function jsx(t) { return t; }");');
  const r = await evaluate('import { jsx } from "./jsx.js" with { preprocessor: "true" };\n'
    + 'globalThis.ran = "yes";');
  expect(describeError(r)).toBe('');
  await evaluate('0;');
  const read = await evaluate('globalThis.ran;');
  expect(read?.result?.value).toBe('yes');
});

test('console: a snippet that was never defined says so', async () => {
  const evaluate = makeConsole();
  const r = await evaluate('import { jsx } from "jsx.js" with { preprocessor: "true" };');
  expect(describeError(r)).toContain('No virtual module found');
});
