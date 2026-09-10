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
  // A fresh agent per call: the record is keyed by SPECIFIER now, and every
  // fixture here uses the same one.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(source, { specifier: 'm.mts' } as never) as unknown as {
    Value?: { ECMAScriptCode?: never, LoadRequestedModules?: unknown },
  };
  const record = parsed?.Value;
  if (!record || typeof record.LoadRequestedModules !== 'function') {
    return undefined;
  }
  const map = ExportedAliasesOf('m.mts');
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

test('a class is here too, exported or not', () => {
  // It was in NEITHER module-level map: a class's name is hoisted into a local
  // table of class nodes and its type is published against the node, so nothing
  // carried it out. That ran a long way - a module exporting a class contributed
  // nothing to an importer, the import-aware check is gated on that being
  // non-empty and so never ran, an annotation naming the import did not resolve,
  // and the alias built over it was deleted by the rule that stops an unresolved
  // alias standing as an empty object type. Every step was right on its own.
  expect(aliasesOf('export class U { a: uint8; }\n')).toEqual(['U']);
  expect(aliasesOf('class U { a: uint8; }\n')).toEqual(['U']);
  expect(aliasesOf('export class U { a: uint8; }\ntype P = { a: uint8 };\n')).toEqual(['P', 'U']);
});

// A type over an imported name needs the module to be LINKED, since the pass that
// can resolve it is the one holding the module's imports. Compiling alone cannot,
// and that is not a defect: the import has not resolved yet. `produce.test.mts`
// covers the linked case, where `type Page = { u: User }` survives.
test('a type over an unresolved import is dropped, not left half-formed', () => {
  // Dropped rather than standing as an empty object type, which would turn an
  // unmodelled type into a spurious error at every annotation naming it.
  expect(aliasesOf('import { U } from "u.mts";\ntype P = { u: U };\ntype S = { b: string };\n'))
    .toEqual(['S']);
});
