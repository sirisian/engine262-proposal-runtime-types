import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, runSingleJobInQueue, Throw,
  createBuiltinModuleLoader, composeModuleLoaders,
} from '#self';
import { Inspector } from '#self/inspector';

class TestInspector extends Inspector {
  readonly sent: any[] = [];

  protected send(data: object): void { this.sent.push(data); }

  request(id: number, method: string, params: unknown): void { this.onMessage(id, method, params); }
}

/**
 * Mirrors 262_worker.mts once the frontend has sent its snippets: the loader's
 * cache is SEEDED from them, so no `defineModule` call is needed and the
 * documented workflow - create a snippet named jsx.js, import it - works.
 */
function makeConsole(snippets: [string, string][]) {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const cache = new Map<string, string>(snippets);
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

const errorOf = (r: any) => String(r?.exceptionDetails?.exception?.description ?? '');
const MACRO: [string, string] = ['jsx.js', 'export function jsx(t) { return t; }'];

test('a snippet is importable by name, with no defineModule call', async () => {
  const evaluate = makeConsole([MACRO]);
  const r = await evaluate('import { jsx } from "jsx.js" with { preprocessor: "true" };');
  expect(errorOf(r)).toBe('');
});

test('and by the relative spelling anyone writes', async () => {
  const evaluate = makeConsole([MACRO]);
  const r = await evaluate('import { jsx } from "./jsx.js" with { preprocessor: "true" };');
  expect(errorOf(r)).toBe('');
});

test('a snippet that does not exist still says so', async () => {
  const evaluate = makeConsole([MACRO]);
  const r = await evaluate('import { x } from "missing.js";');
  expect(errorOf(r)).toContain('missing.js');
});
