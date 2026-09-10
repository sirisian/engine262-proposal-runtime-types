import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, ExportedAliasesOf } from '#self';

/**
 * A module's TYPE declarations, which an expansion artifact publishes.
 *
 * `moduleExportedTypes` does not hold them, despite the name: it records what a
 * name's VALUE is typed as, so `const x: uint8` puts `x` there and
 * `type P = { a: uint8 }` puts nothing. Type declarations live in the check
 * frame's `aliases` map, and nothing was copying it out.
 *
 * Kept as a separate channel rather than merged into the first, because the two
 * answer different questions: an importer resolving a contract wants what a
 * name's value is typed as, and an artifact wants what a name IS as a type.
 */

function aliasesOf(source: string): string[] | undefined {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(source, { specifier: 'm.mts' } as never) as unknown as {
    Value?: { ECMAScriptCode?: never, LoadRequestedModules?: unknown },
  };
  const record = parsed?.Value;
  if (!record || typeof record.LoadRequestedModules !== 'function') {
    return undefined;
  }
  const map = ExportedAliasesOf(record.ECMAScriptCode as never);
  return map ? [...map.keys()] : undefined;
}

test('a type declaration is recorded, exported or not', () => {
  expect(aliasesOf('type P = { a: uint8 };\nexport { P };\n')).toEqual(['P']);
  expect(aliasesOf('type S = { a: uint8 };\n')).toEqual(['S']);
  expect(aliasesOf('type P = { a: uint8 };\ntype S = { b: string };\nexport { P };\n')).toEqual(['P', 'S']);
});

test('a generic alias is recorded too', () => {
  // It creates a binding and can be reflected on, so it publishes like any other.
  expect(aliasesOf('type Box<T> = { v: T };\nexport { Box };\n')).toEqual(['Box']);
});

test('a class is NOT here, because its binding is the constructor', () => {
  // `U === (type U)`, so a class's type comes from the value binding. A consumer
  // of this map has to consult both, which is what the producer does.
  expect(aliasesOf('export class U { a: uint8; }\n')).toEqual([]);
});

// KNOWN GAP, pinned. A type that REFERENCES AN IMPORTED NAME is dropped from the
// map: `type P = { u: U }` with `U` imported records nothing for `P`, while the
// same module's `type S = { b: string }` records fine, and merely having an
// import present does not do it. So an artifact cannot yet publish the types that
// most need publishing - the ones built over a dependency's classes.
test.fails('a type over an imported name is recorded', () => {
  expect(aliasesOf('import { U } from "u.mts";\ntype P = { u: U };\ntype S = { b: string };\n'))
    .toEqual(['P', 'S']);
});
