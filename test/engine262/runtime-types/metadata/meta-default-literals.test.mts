import { test, expect } from 'vitest';
import { ok, expectThrown } from '../harness.mts';

/**
 * A literal in a meta type's `default` takes the type its claim shape gives the
 * key.
 *
 * `meta D { default = { m: 0 } }` against `type D = { m: int32 }` was refused
 * with "the default of a meta type must be a value of its constraint shape". By
 * the time the membership test ran, `{ m: 0 }` held a plain number, and a plain
 * number is not an `int32`. Writing `{ m: (0 := int32) }` passed, which made the
 * default the one place a literal had to state a type the declaration beside it
 * already fixed - where #sec-literal-propagation gives a literal the type of its
 * context everywhere else.
 *
 * The membership check itself was right and is unchanged: it judges the SNAPSHOT
 * rather than the live object, which keeps a getter on the default to exactly one
 * read. The conversion happens to the snapshot, after that single read.
 *
 * Found by running `examples/primitivemetadata.md`, which declares `int32`
 * exponent fields with bare-literal defaults and so failed on every metadata
 * example it contains.
 */

const SUB = ' subtype(a, b) { return a.m === b.m; }';

test('a bare literal adopts the claim shape\'s type', () => {
  expect(ok(`type D = { m: int32 }; meta D { default = { m: 0 };${SUB} }`)).toBe(true);
  // Several keys, as the design documents write them.
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
