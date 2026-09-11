import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule, ProduceArtifact,
} from '#self';

/**
 * #sec-expansion-artifact: "The artifact also carries the extracted
 * documentation for the origins of #sec-provenance, since a dependency's sources
 * are exactly what a consumer does not have on disk, which is the one thing
 * provenance alone cannot supply."
 *
 * An origin says WHERE a type was written. On a published dependency that points
 * at a file the consumer does not have, so the text travels with the artifact or
 * the origin is a reference to nothing.
 *
 * Three decisions, all recorded before this was built. RAW text rather than a
 * structured subset, so a consumer that cannot parse a comment shows nothing and
 * is still correct. EVERY origin's text rather than the first, since choosing the
 * first declared is the load-order crowning that kept documentation out of the
 * node model. And an ARTIFACT-LOCAL table rather than a path, so it cannot go
 * stale relative to the key the contract already checks.
 */

const GRAPH: Record<string, string> = {
  'user.mts': '/** A registered user. */\nexport class User { name: string; }\n',
  'main.mts': 'import { User } from "user.mts";\n'
    + '// One page of users.\n'
    + '// Cursor-based.\n'
    + 'type Page = { u: User };\n'
    + 'type Undocumented = { k: string };\n'
    + '/** A slug. */\n'
    + 'type Slug = string;\n'
    + 'export { Page, Undocumented, Slug };\n',
};

function produce(): Promise<unknown> {
  const held: { realm?: ManagedRealm } = {};
  const cache = new Map<string, unknown>();
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _h: unknown, payload: unknown) {
        const realm = held.realm as ManagedRealm;
        let compiled = cache.get(request.Specifier);
        if (compiled === undefined) {
          compiled = realm.compileModule(GRAPH[request.Specifier]!, { specifier: request.Specifier } as never);
          cache.set(request.Specifier, compiled);
        }
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  held.realm = new ManagedRealm();
  const parsed = held.realm.compileModule(GRAPH['main.mts']!, { specifier: 'main.mts' } as never) as unknown as { Value?: never };
  return new Promise((resolve) => {
    (held.realm as unknown as {
      evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void,
    }).evaluateModule(parsed.Value, undefined, () => resolve(parsed.Value));
  });
}

test('an artifact carries the text written above each exported type', async () => {
  const docs = ProduceArtifact(await produce())!.documentation as
    Record<string, readonly { source: string, text: string }[]>;

  // A run of line comments, taken whole.
  expect(docs.Page?.[0]?.text).toBe('// One page of users.\n// Cursor-based.');
  // A block comment, delimiters included: which parts are documentation is the
  // consumer's business, so nothing is stripped here.
  expect(docs.Slug?.[0]?.text).toBe('/** A slug. */');
  // And it says which module the text came from, since a graph has several.
  expect(docs.Page?.[0]?.source).toBe('main.mts');
});

test('a type with no comment above it carries none, rather than an empty one', async () => {
  // There is a difference between documented as nothing and not documented, and
  // only the second is true here.
  const docs = ProduceArtifact(await produce())!.documentation;
  expect(Object.keys(docs).sort()).toEqual(['Page', 'Slug']);
  expect('Undocumented' in docs).toBe(false);
});

test('the documentation survives the wire with the rest of the artifact', async () => {
  const artifact = ProduceArtifact(await produce())!;
  const wire = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
  expect(wire.documentation).toEqual(artifact.documentation);
});
