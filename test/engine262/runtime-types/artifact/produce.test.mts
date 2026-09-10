import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule, ProduceArtifact,
} from '#self';

/**
 * #sec-expansion-artifact, end to end over a real module graph: "a serialization
 * of the interning table for the concrete types a module graph's public surface
 * produces ... keyed by a hash of the module graph that produced it."
 *
 * The producer assembles one and does not hash - the clause names how the hash is
 * computed among the things it does not fix - so what comes out carries the
 * INVENTORY the key is taken over, and a semantics identifier as its own field
 * so a consumer can tell a stale dependency from a version skew.
 */

function evaluateGraph(modules: Record<string, string>, entry: string): Promise<unknown> {
  const held: { realm?: ManagedRealm } = {};
  const cache = new Map<string, unknown>();
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _h: unknown, payload: unknown) {
        const realm = held.realm as ManagedRealm;
        let compiled = cache.get(request.Specifier);
        if (compiled === undefined) {
          // A host must return the SAME record for one specifier; compiling a
          // fresh one per request makes a cyclic graph load forever.
          compiled = realm.compileModule(modules[request.Specifier]!, { specifier: request.Specifier } as never);
          cache.set(request.Specifier, compiled);
        }
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  held.realm = new ManagedRealm();
  const parsed = held.realm.compileModule(modules[entry]!, { specifier: entry } as never) as unknown as { Value?: never };
  return new Promise((resolve) => {
    (held.realm as unknown as {
      evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void,
    }).evaluateModule(parsed.Value, undefined, () => resolve(parsed.Value));
  });
}

const GRAPH = {
  'user.mts': 'export class User { name: string; }\n',
  'main.mts': 'import { User } from "user.mts";\n'
    + 'type Page = { u: User };\n'
    + 'type Secret = { k: string };\n'
    + 'export { Page };\n',
};

test('an artifact carries a module\'s public surface and nothing else', async () => {
  const artifact = ProduceArtifact(await evaluateGraph(GRAPH, 'main.mts'))!;
  expect(artifact).toBeTruthy();
  // The PUBLIC surface: `Page` is exported, `Secret` is not.
  expect(Object.keys(artifact.table.exports)).toEqual(['Page']);
  // The graph the key is taken over: both modules, source and specifier.
  expect(artifact.graph.map((e) => e.specifier).sort()).toEqual(['main.mts', 'user.mts']);
  expect(artifact.semantics).toBeTruthy();
});

test('a nominal names the module that declares it, not the one that uses it', async () => {
  // It cannot be carried by value - its record holds a declaration and a
  // constructor, neither of which crosses a boundary - so it travels as its
  // module specifier and declared name, and a consumer resolves that.
  const artifact = ProduceArtifact(await evaluateGraph(GRAPH, 'main.mts'))!;
  const nominal = artifact.table.types.find((e) => (e as { Kind?: string }).Kind === 'nominal');
  expect((nominal as never as { nominal: { name?: string, source?: string } }).nominal)
    .toEqual({ name: 'User', source: 'user.mts' });
});

test('a module with no exported types yields no artifact', async () => {
  // An empty artifact is worse than none: a consumer would verify a hash and
  // read nothing.
  expect(ProduceArtifact(await evaluateGraph({ 'only.mts': 'export const x = 1;\n' }, 'only.mts')))
    .toBe(undefined);
});
