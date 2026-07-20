import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — typed iteration and generators, explicit resource
 * management.
 * Sections: Typed Iteration and Generators, Explicit Resource Management.
 *
 *  - Typed generators work: the yield-type shorthand `function* f(): int32` and
 *    the full `Generator.<Y, R, N>` form parse, and the generator yields and
 *    iterates. The yield/return/next TYPE checking is a static-checker feature.
 *  - Explicit Resource Management (`using` / `await using`) is not in the base
 *    engine262 at all, so the runtime-types annotation on it has nothing to attach
 *    to. Documented as a base-engine dependency (PENDING-CAPABILITIES.md
 *    capability K).
 */

// ── Typed Iteration and Generators ────────────────────────────────────────────
// A generator annotates its yield type directly; the full generic form names the
// yield, return, and next types.
test('Generators: the yield-type shorthand parses and yields', () => {
  expect(evaluated('function* f(): int32 { yield (1 := int32); yield (2 := int32); } let g = f(); String(g.next().value);')).toBe('1');
  // the second yield
  expect(evaluated('function* f(): int32 { yield (1 := int32); yield (2 := int32); } let g = f(); g.next(); String(g.next().value);')).toBe('2');
});

test('Generators: the full Generator.<Y, R, N> form parses', () => {
  expect(evaluated('function* g(): Generator.<int32, string, boolean> { yield (0 := int32); } let it = g(); String(it.next().value);')).toBe('0');
  // done flag after exhaustion
  expect(evaluated('function* g(): Generator.<int32, string, boolean> { yield (0 := int32); } let it = g(); it.next(); String(it.next().done);')).toBe('true');
});

test('Generators: a typed generator iterates with for-of', () => {
  expect(evaluated('function* f(): int32 { yield (1 := int32); yield (2 := int32); yield (3 := int32); } let sum = 0; for (const x of f()) { sum += x; } String(sum);')).toBe('6');
  // spread of a typed generator
  expect(ok('function* f(): int32 { yield (1 := int32); yield (2 := int32); } let a = [...f()]; a.length === 2;')).toBe(true);
});

// ── Documented gap: explicit resource management ──────────────────────────────
test('Explicit Resource Management: using declarations are not in the base engine (documents the gap)', () => {
  // Target (README): `using f: File = open();` accepts const-style annotations.
  // The base engine262 does not implement `using` at all, so it does not parse.
  expectThrown('let disposed = false; { using r = { [Symbol.dispose]() { disposed = true; } }; } disposed;');
  expectThrown('using f = { [Symbol.dispose]() {} };');
});
