import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * `rational` AND `rational.<64>` ARE ONE TYPE, by membership as well as identity.
 *
 * `table-type-name-shorthands`: "`complex` is `complex.<number>` and `rational`
 * is `rational.<64>`" - the bare name IS the application, so the two spellings
 * must not be distinguishable afterwards.
 *
 * They were. `rational.<64> === rational` answered *true*, because the Type
 * Objects intern to one; but a rational VALUE carried `rational` with an empty
 * argument list while the written `rational.<64>` carried `[64]`, so
 * `r is rational.<64>` answered *false* and `const s: rational.<64> = r` was
 * refused. The same type by identity and not by membership.
 *
 * That contradiction is also what made a metadata parameterization over
 * `rational` unreachable: its base is `rational.<64>`, the crossing's first step
 * brings the value to that base, and that step refused a rational - so the
 * failure surfaced three layers away from its cause, in a crossing that never
 * reached its meta-type gates.
 */

test('the two spellings agree on membership, not only identity', () => {
  expect(evaluated('String(rational.<64> === rational);')).toBe('true');
  expect(evaluated('const r: rational = 1/3; String(r is rational.<64>);')).toBe('true');
  expect(evaluated('const r: rational = 1/3; String(r := rational.<64>);')).toBe('1/3');
  expect(evaluated('const r: rational = 1/3; const s: rational.<64> = r; String(s);')).toBe('1/3');
});

test('a metadata parameterization over rational is now reachable', () => {
  expect(evaluated(`type U = { unit: int32 };
    meta U { default = { unit: 0 }; subtype(a: U, b: U): boolean { return true; } }
    primitive rational { operator rational.<U>() { return this; } }
    type Ratio = rational.<64>.<{ unit: 1 }>;
    const r: rational = 1 / 3; String(r := Ratio);`)).toBe('1/3');
});

test('a NARROWER width is still a different type', () => {
  // Only the DEFAULT width is normalized away; `rational.<32>` is its own type
  // and a 64-bit rational is not a member of it.
  expect(evaluated('const r: rational = 1/3; String(r is rational.<32>);')).toBe('false');
});

test('the bare spelling is what displays, and arithmetic is untouched', () => {
  expect(evaluated('const r: rational = 1/3; String(Reflect.typeOf(r));')).toBe('rational');
  expect(evaluated('const r: rational = 1/3; String(r := rational);')).toBe('1/3');
  expect(evaluated('const r: rational = 1/3; String(r + r + r);')).toBe('1');
});
