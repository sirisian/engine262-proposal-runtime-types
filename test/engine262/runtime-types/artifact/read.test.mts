import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
  ProduceArtifact, ReadArtifact, ExportedAliasesOf, GraphKey, Sha256, GetTypeObject,
} from '#self';

/**
 * #sec-expansion-artifact's consumer: "A consumer verifies the hash and reads the
 * types out of it rather than evaluating them; on a mismatch it evaluates, and
 * determinism is what makes the two agree."
 *
 * Nothing had ever read a produced artifact. The table round-tripped in a test
 * that assembled its roots by hand; the thing the producer emits had never been
 * read by anything, which is what this covers.
 *
 * The key is SHA-256 over a canonical encoding of the graph inventory. The clause
 * leaves the digest open and is silent on the hash's INPUT, which is where
 * interoperability lives: two producers serializing one inventory differently get
 * different keys, and a consumer then reads every current artifact as stale.
 */

const GRAPH: Record<string, string> = {
  'user.mts': 'export class User { name: string; }\n',
  'main.mts': 'import { User } from "user.mts";\ntype Page = { u: User };\ntype Secret = { k: string };\nexport { Page };\n',
};

/** Evaluate the graph in a FRESH agent and return its entry module. */
function evaluateGraph(): Promise<unknown> {
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

/** Resolve a carried nominal name against whatever the current agent has. */
function resolver(name: { name?: string, source?: string }): object | undefined {
  return ExportedAliasesOf(name.source)?.get(String(name.name)) as object | undefined;
}

test('an artifact produced in one agent reads in another', async () => {
  const produced = ProduceArtifact(await evaluateGraph())!;
  const wire = JSON.parse(JSON.stringify(produced));

  // A different agent, which has never seen the producer's Type Objects.
  const second = await evaluateGraph();
  const read = ReadArtifact(wire, resolver);
  expect(read).toBeTruthy();
  expect([...read!.keys()]).toEqual(['Page']);

  // The type read out IS the type the second agent's own evaluation produced.
  // The reader returns Type Objects and the alias map holds records, so the
  // comparison is at the record: interning makes one record one Type Object, so
  // equal records here means the artifact rebuilt the very type evaluation gives.
  // Compared as TYPE OBJECTS, which is where identity lives: interning makes one
  // type one object, so `===` here says the artifact rebuilt the very type the
  // second agent's own evaluation produced, rather than a lookalike.
  const own = GetTypeObject(ExportedAliasesOf('main.mts')!.get('Page') as never);
  expect(read!.get('Page')).toBe(own);
  void second;
});

test('the key is the same for the same graph, and different for a changed one', async () => {
  const first = ProduceArtifact(await evaluateGraph())!;
  const again = ProduceArtifact(await evaluateGraph())!;
  expect(first.key).toBe(again.key);
  expect(first.key.startsWith('sha256:')).toBe(true);

  const edited = first.graph.map((e) => (e.specifier === 'user.mts'
    ? { specifier: e.specifier, source: `${e.source}// touched\n` }
    : e));
  expect(GraphKey(edited)).not.toBe(first.key);
});

test('the encoding is length-prefixed, so no two graphs encode alike', () => {
  // `{a, bc}` and `{ab, c}` are different graphs, and would be one byte string
  // under any separator a specifier or a source could itself contain.
  expect(GraphKey([{ specifier: 'a', source: 'bc' }]))
    .not.toBe(GraphKey([{ specifier: 'ab', source: 'c' }]));
});

test('an artifact that does not describe its own graph is declined', async () => {
  const produced = ProduceArtifact(await evaluateGraph())!;
  const tampered = { ...produced, key: `sha256:${'0'.repeat(64)}` };
  expect(ReadArtifact(tampered, resolver)).toBe(undefined);
});

test('a version or a semantics it does not know is declined, not misread', async () => {
  const produced = ProduceArtifact(await evaluateGraph())!;
  expect(ReadArtifact({ ...produced, semantics: 'something/else' }, resolver)).toBe(undefined);
  const newer = { ...produced, table: { ...produced.table, version: 999 } };
  expect(ReadArtifact(newer, resolver)).toBe(undefined);
});

test('an unresolvable nominal is declined', async () => {
  const produced = ProduceArtifact(await evaluateGraph())!;
  expect(ReadArtifact(produced, () => undefined)).toBe(undefined);
});

test('SHA-256 matches the published vectors', () => {
  const bytes = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  expect(Sha256(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(Sha256(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(Sha256(bytes('a'.repeat(1000000))))
    .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
