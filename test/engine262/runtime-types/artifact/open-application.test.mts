import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, ProduceArtifact, HasSlotInsideApplication,
  ExportedAliasesOf, ExportedTypesOf,
} from '#self';

/**
 * #sec-expansion-artifact: "An artifact contains no open application."
 * `partial(T)` in an exported generic "evaluates against the consumer's T, at the
 * consumer, so the evaluator is not removed by the artifact and cannot be."
 *
 * This was the one sentence of the clause nothing implemented. It held anyway,
 * but by accident: a generic signature carries TypeParameter records, those hit
 * the leaf refusal written for symbols, and the whole artifact was refused with a
 * message about an encoding gap. Three things wrong with that - it lost every
 * ordinary type beside the generic, it blamed the encoding for a rule, and it
 * would have silently admitted open applications the moment a TypeParameter
 * became encodable.
 */

function artifactFor(source: string): Promise<ReturnType<typeof ProduceArtifact>> {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(source, { specifier: 'm.mts' } as never) as unknown as { Value?: never };
  return new Promise((resolve) => {
    (realm as unknown as {
      evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void,
    }).evaluateModule(parsed.Value, undefined, () => resolve(ProduceArtifact(parsed.Value)));
  });
}

const WITH_GENERIC = 'function mk(T: type): type { return T; }\n'
  + 'export function f<T>(v: T): mk(T) { return v; }\n'
  + 'type Page = { a: uint8 };\n'
  + 'export { Page };\n';

test('an open application is skipped, and the rest of the surface survives', async () => {
  const artifact = (await artifactFor(WITH_GENERIC))!;
  expect(artifact).toBeTruthy();
  // The ordinary type is carried...
  expect(Object.keys(artifact.table.exports)).toContain('Page');
  // ...and the generic is not.
  expect(Object.keys(artifact.table.exports)).not.toContain('f');
  // Named rather than dropped quietly, so a producer can say what it left out.
  expect(Object.keys(artifact.skipped)).toEqual(['f']);
});

test('a closed application is pre-evaluated and carried, which is the point', async () => {
  // "every closed application among them pre-evaluated" - `Box.<uint8>` has no
  // unbound slot, so it is evaluated and its result travels.
  const artifact = (await artifactFor('type Box<T> = { v: T };\ntype B = Box.<uint8>;\nexport { B };\n'))!;
  expect(Object.keys(artifact.table.exports)).toEqual(['B']);
  expect(artifact.skipped).toEqual({});
});

test('the clause\'s own shape never reaches a record here', async () => {
  // `mk(T)` in a return position RESOLVES AWAY: the record for `f` holds
  // `function, parameter, type` and no ~application~ at all. So the clause's rule
  // - "an artifact contains no open application" - holds in this engine without
  // being enforced, and the shape that actually reaches a root is the generic
  // SIGNATURE, whose parameter is unbound for the reason the clause gives.
  //
  // That is why the producer tests for an unbound parameter rather than for an
  // application containing one: it subsumes the clause's case and covers the one
  // that occurs.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(WITH_GENERIC, { specifier: 'm.mts' } as never) as unknown as { Value?: never };
  await new Promise((resolve) => {
    (realm as unknown as {
      evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void,
    }).evaluateModule(parsed.Value, undefined, resolve as never);
  });
  const generic = ExportedTypesOf((parsed.Value as unknown as { ECMAScriptCode: never }).ECMAScriptCode)?.get('f');
  expect(HasSlotInsideApplication(generic as never)).toBe(false);
  const kinds = new Set<string>();
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object' || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const k = (v as { Kind?: string }).Kind;
    if (typeof k === 'string') kinds.add(k);
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      Object.entries(v).forEach(([key, x]) => { if (key !== 'Declaration') walk(x); });
    }
  };
  walk(generic);
  expect(kinds.has('parameter')).toBe(true);
  expect(kinds.has('application')).toBe(false);
  void ExportedAliasesOf;
});
