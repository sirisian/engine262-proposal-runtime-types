import { test, expect } from 'vitest';
import { ok, expectThrown } from '../harness.mts';

/**
 * A literal in a meta type's `default` takes the type its claim shape gives the key (#sec-literal-propagation):
 * `meta D { default = { m: 0 } }` against `type D = { m: int32 }` is accepted, the literal being converted to
 * `int32` as it is everywhere else a literal has a context. Without that the default would be the one place a
 * literal had to state a type the declaration beside it already fixes: `{ m: (0 := int32) }`. The membership
 * check judges the SNAPSHOT rather than the live object, which keeps a getter on the default to exactly one
 * read; the conversion happens to the snapshot, after that single read.
 *
 * Fixture: examples/primitivemetadata.md of the ecmascript-types repository, which declares `int32` exponent
 * fields with bare-literal defaults.
 */

const SUB = ' subtype(a, b) { return a.m === b.m; }';

test('a bare literal adopts the claim shape\'s type', () => {
  expect(ok(`type D = { m: int32 }; meta D { default = { m: 0 };${SUB} }`)).toBe(true);
  // Several keys, as a meta type with several members writes them.
  expect(ok('type D = { m: int32, kg: int32 };'
    + ' meta D { default = { m: 0, kg: 0 }; subtype(a, b) { return a.m === b.m; } }')).toBe(true);
});

test('the explicit spelling still works', () => {
  // `(0 := int32)` was the only way to write this before, and programs using it
  // must keep running.
  expect(ok(`type D = { m: int32 }; meta D { default = { m: (0 := int32) };${SUB} }`)).toBe(true);
  // A field whose type needs no conversion is unaffected.
  expect(ok(`type D = { m: number }; meta D { default = { m: 0 };${SUB} }`)).toBe(true);
});

test('a genuinely wrong default is still refused', () => {
  // The check is not loosened: a string cannot become an `int32`, so the
  // membership test still fails and reports what it always did.
  expectThrown(`type D = { m: int32 }; meta D { default = { m: "s" };${SUB} }`,
    'the default of a meta type must be a value of its constraint shape');
});
