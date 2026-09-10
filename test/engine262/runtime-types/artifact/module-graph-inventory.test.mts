import { test, expect } from 'vitest';
/**
 * #sec-expansion-artifact: an artifact is "keyed by a hash of the module graph
 * that produced it", and "a mismatch re-derives".
 *
 * The clause does not fix HOW the hash is computed - it names that as unfixed,
 * beside what carries the bytes and how a producer finds a graph - so the engine
 * produces the INVENTORY a hash is taken over rather than a hash. An engine that
 * picked an algorithm would be fixing by implementation exactly what the clause
 * declines to fix.
 *
 * What the inventory contains is not open: the source text of every module
 * transitively, because a type is computed from it, and the specifier each was
 * reached by, because a rename that resolves elsewhere changes the graph even
 * when both files are byte-identical. Ordered canonically, because a graph
 * reached in a different order is the same graph.
 */
import { Agent, ManagedRealm, setSurroundingAgent, ModuleGraphInventory, FinishLoadingImportedModule } from '#self';
function graph(modules: Record<string, string>, entry: string): Promise<string> {
  const held: { realm?: ManagedRealm } = {};
  // A host must return the SAME module record for the same specifier. Compiling
  // a fresh one per request makes a cyclic graph load forever, which is what a
  // real loader's cache prevents.
  const cache = new Map<string, unknown>();
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _h: unknown, payload: unknown) {
        const src = modules[request.Specifier];
        const r = held.realm as ManagedRealm;
        let compiled = cache.get(request.Specifier);
        if (compiled === undefined) {
          compiled = src === undefined
            ? r.compileModule('throw new Error("no such module");')
            : r.compileModule(src, { specifier: request.Specifier } as never);
          cache.set(request.Specifier, compiled);
        }
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  held.realm = new ManagedRealm();
  const realm = held.realm;
  const parsed = realm.compileModule(modules[entry]!, { specifier: entry } as never) as unknown as { Value?: never };
  if (!parsed?.Value) return Promise.resolve('compile threw');
  return new Promise((resolve) => {
    (realm as unknown as { evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void })
      .evaluateModule(parsed.Value, undefined, () => {
        const inv = ModuleGraphInventory(parsed.Value);
        resolve(inv.map((e) => `${e.specifier}:${JSON.stringify(e.source)}`).join(' | '));
      });
  });
}
const A = { 'a.mts': 'import { x } from "b.mts";\nexport const y = x;\n', 'b.mts': 'export const x = 1;\n' };
const EDITED = { ...A, 'b.mts': 'export const x = 2;\n' };
const RENAMED = { 'a.mts': 'import { x } from "c.mts";\nexport const y = x;\n', 'c.mts': 'export const x = 1;\n' };
const CYCLE = { 'a.mts': 'import "b.mts";\nexport const y = 1;\n', 'b.mts': 'import "a.mts";\nexport const z = 2;\n' };

test('the inventory tracks the graph, and nothing a build machine varies', async () => {
  const base = await graph(A, 'a.mts');
  expect(base).toContain('a.mts');
  expect(base).toContain('b.mts');
  // Same graph twice: identical.
  expect(await graph(A, 'a.mts')).toBe(base);
  // A dependency edited: different.
  expect(await graph(EDITED, 'a.mts')).not.toBe(base);
  // A rename that resolves elsewhere: different, though both files are the same bytes.
  expect(await graph(RENAMED, 'a.mts')).not.toBe(base);
  // A cycle terminates.
  const cyc = await graph(CYCLE, 'a.mts');
  expect(cyc).toContain('a.mts');
  expect(cyc).toContain('b.mts');
});
