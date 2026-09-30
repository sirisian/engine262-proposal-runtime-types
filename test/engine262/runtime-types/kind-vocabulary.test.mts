import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { KIND_NAMES } from '#self';

/**
 * Spec: #sec-reflection-shape-rules and #table-reflection-contexts. Every reflection carries a `kind`, a string
 * naming the context it came from.
 *
 * The `kind` vocabulary lives in two places - the specification's reflection contexts and the engine's mapping from
 * parse nodes - and two copies of one list is the shape this project has been bitten by most. So the engine's set is
 * checked against the SPECIFICATION, which is normative: the decorators chapter of spec.emu defines a context per
 * position, and every `kind` is one of their names. A mapping that carried `'TryBlock'`, `'SwitchBlock'` or
 * `'MatchBlock'`, none of which the specification defines, is what this test catches.
 *
 * The converse is NOT asserted. The specification defines more contexts than the engine's mapping produces, which
 * is an implementation gap rather than drift, and one this test should not pretend is closed.
 */

/**
 * The specification, found rather than assumed.
 *
 * The test reads spec.emu from the proposal-runtime-types repository, which is not part of this one, so it may be
 * absent (a checkout without its sibling). The candidates are tried in order and the tests SKIP where none exists,
 * because a test that cannot read its source should say so rather than fail as though it had found drift.
 */
const SPEC_CANDIDATES = [
  '/home/claude/proposal-runtime-types/spec.emu',
  '/home/claude/work/proposal-runtime-types/spec.emu',
  new URL('../../../../proposal-runtime-types/spec.emu', import.meta.url).pathname,
];

function specificationPath(): string | null {
  for (const candidate of SPEC_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const specPath = specificationPath();

/**
 * The names in the first column of the tables of the decorators chapter (the reflection contexts, and the family
 * labels beside them). The chapter is the emu-clause `sec-decorators`, found by counting clause nesting.
 */
function specifiedContexts(path: string): Set<string> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const first = lines.findIndex((line) => line.includes('id="sec-decorators"'));
  const names = new Set<string>();
  if (first === -1) {
    return names;
  }
  const cell = /<td>\s*(?:<code>)?`?([A-Z][A-Za-z]+)`?(?:<\/code>)?\s*<\/td>/g;
  let depth = 0;
  for (let i = first; i < lines.length; i += 1) {
    depth += (lines[i].match(/<emu-clause/g) ?? []).length;
    for (const match of lines[i].matchAll(cell)) {
      names.add(match[1]);
    }
    depth -= (lines[i].match(/<\/emu-clause>/g) ?? []).length;
    if (depth <= 0) {
      break;
    }
  }
  return names;
}

test.skipIf(specPath === null)('every kind the engine produces is a context the specification defines', () => {
  const specified = specifiedContexts(specPath as string);
  // No exemptions: kept as a plain filter rather than an empty exemption set, so that adding a kind the
  // specification does not define fails here rather than being waved through by a set someone forgot to empty.
  // (A captured region reports `Block`, which the specification defines.)
  const undefinedKinds = KIND_NAMES.filter((k) => !specified.has(k));
  expect(undefinedKinds).toEqual([]);
});

test.skipIf(specPath === null)('the specification is readable and has the contexts this depends on', () => {
  // If the specification moves or its shape changes, the test above would pass vacuously by finding nothing
  // defined and nothing undefined.
  const specified = specifiedContexts(specPath as string);
  expect(specified.size).toBeGreaterThan(40);
  expect(specified.has('ClassField')).toBe(true);
  expect(specified.has('MatchArmBlock')).toBe(true);
});
