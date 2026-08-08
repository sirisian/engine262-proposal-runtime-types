import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - typed iteration and generators, explicit resource
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

// -- Typed Iteration and Generators --------------------------------------------
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
  expect(evaluated('function* f(): int32 { yield (1 := int32); yield (2 := int32); yield (3 := int32); } let sum = (0 := int32); for (const x of f()) { sum += x; } String(sum);')).toBe('6');
  // spread of a typed generator
  expect(ok('function* f(): int32 { yield (1 := int32); yield (2 := int32); } let a = [...f()]; a.length === 2;')).toBe(true);
});

// -- Explicit resource management ----------------------------------------------
test('Explicit Resource Management: a using declaration disposes its resource', () => {
  // A resource is disposed when the block is left, so the flag is set by the time
  // the block's value is read.
  expect(evaluated('let disposed = false; { using r = { [Symbol.dispose]() { disposed = true; } }; } String(disposed);')).toBe('true');
  // Still to come (README): the const-style annotation `using f: File = open()`,
  // with the rule that the declared type must carry the disposal method.
  expect(evaluated('typeof Symbol.dispose;')).toBe('symbol');
});
