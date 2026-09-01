// PLAN-variadic-and-named-generic-arguments.md Phase 0 - cases pinned as
// `test.fails` until their findings close. Each flips to `test` in the phase
// that fixes it, so a silent fix or a regression is equally loud.
//
// F-N (remainder): a POSITIONAL short argument list in type position keeps its
// short record while the specialization fills defaults, so an annotation and
// its own `new` disagree for trailing-defaulted VALUE parameters. Named lists
// canonicalize already (this patch); positional canonicalization changes
// displayed identities and lands with the binder unification.
//
// F-O: library generics resolve through a SECOND checker arm (beyond
// resolveType's builtin site) that binds positionally - the two checker paths
// disagree with each other about `Map.<V: uint8, K: string>`, and the runtime
// enforcement for a checker-null annotation never fires, so an unknown name on
// a library generic passes silently. The library half of OQ-17 completes when
// that arm routes through the shared ordering.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test.fails('annotation and construction agree across spellings (B7 boundary)', () => {
  expect(evaluated(`${BUFFER} let c: Buffer.<Size: 1024> = new Buffer.<uint8, 1024>(); 'ok';`)).toBe('ok');
  expectThrown(`${BUFFER} let c: Buffer.<Size: 1024> = new Buffer.<Size: 512>();`, 'is not assignable');
});

test.fails('library generics bind by the names the specification writes (A26, A27)', () => {
  // Before: `Map.<V: uint8, K: string>` was silently `Map.<uint8, string>`.
  expect(evaluated("let m: Map.<K: string, V: uint8> = new Map(); m.set('k', 1); String(m.size);")).toBe('1');
  expect(evaluated("let m: Map.<V: uint8, K: string> = new Map(); m.set('k', 1); String(m.size);")).toBe('1');
  expect(evaluated('let s: Set.<T: uint8> = new Set(); s.add(1); String(s.size);')).toBe('1');
});

test.fails('an unknown name on a library generic is refused, not guessed (A29)', () => {
  expectThrown('let m: Map.<Z: uint8> = new Map();', 'does not name a type parameter');
});

test.fails('a library generic whose required parameter a named list leaves out is reported (A26 shape)', () => {
  expectThrown('let m: Map.<V: uint8> = new Map();', 'has no argument and no default');
});
