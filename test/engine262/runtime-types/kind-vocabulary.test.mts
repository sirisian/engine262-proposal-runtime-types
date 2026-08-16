import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { KIND_NAMES } from '#self';

/**
 * The `kind` vocabulary lives in three places - `decorators.md`'s reflections,
 * the specification's list of positions, and the engine's mapping - and three
 * copies of one list is the shape this project has been bitten by most.
 *
 * So the engine's set is checked against the DOCUMENT, which is the authority:
 * `decorators.md` defines a reflection per position and every `kind` is one of
 * their names. An earlier draft of the mapping carried `'TryBlock'`,
 * `'SwitchBlock'` and `'MatchBlock'`, none of which the document defines; this
 * is the test that would have caught them.
 *
 * The converse is NOT asserted. The document defines 46 reflections and the
 * engine implements a subset - parameters, returns, enums, object members and
 * the accessor family are not yet decorable - which is an implementation gap
 * rather than drift, and one this test should not pretend is closed.
 */
const DECORATORS_MD = '/home/claude/ecmascript-types/decorators.md';

function documentedReflections(): Set<string> {
  const text = readFileSync(DECORATORS_MD, 'latin1');
  const names = new Set<string>();
  const pattern = new RegExp('type (' + '\\' + 'w+)Reflection', 'g');
  let match = pattern.exec(text);
  while (match !== null) {
    names.add(match[1]);
    match = pattern.exec(text);
  }
  return names;
}

test('every kind the engine produces is a reflection the document defines', () => {
  const documented = documentedReflections();
  // `Region` is the one value that is new: a captured region is not a position
  // `decorators.md` had, and Phase 2 of the plan adds it there.
  const expectedNew = new Set(['Region']);
  const undocumented = KIND_NAMES.filter((k) => !documented.has(k) && !expectedNew.has(k));
  expect(undocumented).toEqual([]);
});

test('the document is readable and has the reflections this depends on', () => {
  // If the document moves or its shape changes, the test above would pass
  // vacuously by finding nothing documented and nothing undocumented.
  const documented = documentedReflections();
  expect(documented.size).toBeGreaterThan(40);
  expect(documented.has('ClassField')).toBe(true);
  expect(documented.has('MatchArmBlock')).toBe(true);
});
