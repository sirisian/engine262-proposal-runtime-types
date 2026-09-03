// PLAN-variadic-and-named-generic-arguments.md Phase 0 - what remains, pinned
// as `test.fails` so a silent fix or a regression is equally loud. Each flips
// to `test` in the phase that closes it.
//
// F-N (remainder): a POSITIONAL short argument list in type position keeps its
// short record while the specialization fills trailing defaults, so an
// annotation and its own `new` disagree for a trailing-defaulted VALUE
// parameter. NAMED lists canonicalize already (this patch fills their holes
// and trailing defaults); positional canonicalization changes displayed
// identities (`B.<uint8>` would render with its defaults) and lands with the
// binder unification of Phase 0.1/0.2, where displayType learns the canonical
// form at the same time.
import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// NOT part of the remainder: the runtime BOUNDARY already tolerates a
// positional short list (assignability matches through the declaration), so
// this pins the tolerance as a plain test - only the interned identity below
// is still split across spellings.
test('a positional short list crosses its own specialization\'s boundary', () => {
  expect(evaluated('class B<T = uint8, S: uint32 = 256> { s(): uint32 { return S; } } let c: B.<uint8> = new B.<uint8>(); String(c.s());')).toBe('256');
});

test.fails('positional and named spellings of one application are one type in TYPE position (F-N remainder)', () => {
  // The named annotation canonicalizes to the full list; the positional one
  // stays short, so the two records differ until positional lists fill too.
  expect(evaluated("class B<T = uint8, S: uint32 = 256> {} type A = B.<uint8>; type C = B.<T: uint8>; String(A === C);")).toBe('true');
});
