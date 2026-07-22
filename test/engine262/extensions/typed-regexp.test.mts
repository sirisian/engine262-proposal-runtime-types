import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Capability P (regexp.md) core: the capture-type inference of a regular
 * expression literal.
 *
 * A regular expression literal has type `RegExp.<Captures, Groups>` inferred from
 * its pattern, where Captures is a tuple of the capture-group types in source
 * order and Groups is an object type of the named groups. A capture that can fail
 * to participate in a match, one under a zero-minimum quantifier, one in an
 * alternation branch, or one inside a lookaround, is typed `string | undefined`;
 * a capture entered by every matching path is `string`. The type is checked at an
 * annotated declaration: a `RegExp.<Captures, Groups>` annotation is invariant in
 * its arguments, so a literal whose inferred shape differs is a type error, while
 * a bare `RegExp` accepts any literal as the raw supertype of its parameterizations.
 *
 * Deferred with the rest of the typed match-result surface, since each needs a
 * facility another extension supplies: the Flags argument and the flag-dependent
 * shapes (the `d`-flag `indices`, the `g`-flag `match` overload); the typed exec
 * result and group-name access checking on it; the capture types threaded through
 * the String methods; `RegExp.template`; string narrowing by pattern; the dynamic
 * `new RegExp` construction assertion; and the custom matcher symbols. The untyped
 * regexp runtime is unchanged and is covered in extensions/regexp.test.mts.
 */

// -- capture count is inferred and checked (invariant RegExp.<C, G>) -----------
test('a literal with N captures has an N-element capture tuple', () => {
  expect(evaluated('let r: RegExp.<[string, string], {}> = /(\\d)(\\d)/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string], {}> = /(\\d)/; "ok";')).toBe('ok');
});

test('a capture-count mismatch is a type error', () => {
  expectThrown('let r: RegExp.<[string], {}> = /(\\d)(\\d)/; "ok";');
  expectThrown('let r: RegExp.<[string, string], {}> = /(\\d)/; "ok";');
});

test('a no-capture literal is the empty-capture shape', () => {
  expect(evaluated('let r: RegExp.<[], {}> = /abc/; "ok";')).toBe('ok');
  // a captured literal is not the no-capture shape, and the reverse
  expectThrown('let r: RegExp.<[], {}> = /(\\d)/; "ok";');
  expectThrown('let r: RegExp.<[string], {}> = /abc/; "ok";');
});

// -- optionality: a capture that can fail to participate is string | undefined -
test('an optional group is string | undefined', () => {
  expect(evaluated('let r: RegExp.<[string, string | undefined], {}> = /(\\d+)(\\.\\d+)?/; "ok";')).toBe('ok');
  // and it is not a plain string
  expectThrown('let r: RegExp.<[string, string], {}> = /(\\d+)(\\.\\d+)?/; "ok";');
});

test('a group under a zero-minimum quantifier is optional', () => {
  expect(evaluated('let r: RegExp.<[string | undefined], {}> = /(a)*/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string | undefined], {}> = /(a){0,3}/; "ok";')).toBe('ok');
});

test('a group under a positive-minimum quantifier is required', () => {
  expect(evaluated('let r: RegExp.<[string], {}> = /(a)+/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string], {}> = /(a){2,3}/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string], {}> = /(a){2}/; "ok";')).toBe('ok');
});

test('groups in an alternation are each optional', () => {
  expect(evaluated('let r: RegExp.<[string | undefined, string | undefined], {}> = /(?:(a)|(b))/; "ok";')).toBe('ok');
});

test('a group inside a lookahead is optional', () => {
  expect(evaluated('let r: RegExp.<[string | undefined], {}> = /(?=(a))/; "ok";')).toBe('ok');
});

// -- named groups occupy both a position and the Groups object -----------------
test('a named group appears in Groups', () => {
  expect(evaluated('let r: RegExp.<[string], { year: string }> = /(?<year>\\d{4})/; "ok";')).toBe('ok');
});

test('a named group also occupies its numbered capture position', () => {
  // named and unnamed together: Captures has both, Groups has the named one
  expect(evaluated('let r: RegExp.<[string, string], { y: string }> = /(?<y>\\d{4})-(\\d{2})/; "ok";')).toBe('ok');
});

test('an optional named group is string | undefined in both places', () => {
  expect(evaluated('let r: RegExp.<[string | undefined], { port: string | undefined }> = /(?<port>\\d+)?/; "ok";')).toBe('ok');
});

test('a wrong group name is a type error', () => {
  // Groups is { year: string }; an annotation naming a different group mismatches
  expectThrown('let r: RegExp.<[string], { day: string }> = /(?<year>\\d{4})/; "ok";');
});

// -- non-capturing constructs contribute nothing ------------------------------
test('a non-capturing group is not a capture', () => {
  expect(evaluated('let r: RegExp.<[string], {}> = /(?:ab)(c)/; "ok";')).toBe('ok');
});

test('a lookaround construct itself is not a capture', () => {
  // the lookahead adds no capture of its own; only the inner group counts
  expect(evaluated('let r: RegExp.<[], {}> = /a(?=b)/; "ok";')).toBe('ok');
});

// -- bare RegExp is the raw supertype -----------------------------------------
test('a bare RegExp annotation accepts a literal of any shape', () => {
  expect(evaluated('let r: RegExp = /(\\d)(\\d)/; typeof r;')).toBe('object');
  expect(evaluated('let r: RegExp = /abc/; typeof r;')).toBe('object');
  expect(evaluated('let r: RegExp = /(?<y>\\d)/; typeof r;')).toBe('object');
});

test('a bare RegExp annotation still rejects a non-regexp value', () => {
  expectThrown('let r: RegExp = 5; "ok";');
  expectThrown('let r: RegExp = "abc"; "ok";');
});

test('a parameterized RegExp does not accept a raw RegExp value', () => {
  // the raw type is the supertype, not the subtype: narrowing raw to a specific
  // shape is not allowed
  expectThrown('let raw: RegExp = /(\\d)/; let r: RegExp.<[string], {}> = raw; "ok";');
});

// -- the inference is inert with the feature off -------------------------------
test('the untyped regexp runtime is unchanged with the feature off', () => {
  // with the flag off there are no type annotations at all; a regexp literal is
  // an ordinary value and its methods work as in base JavaScript
  expect((runFlagOff('let r = /a(b)c/; r.test("abc");') as { Type: string }).Type).toBe('normal');
  expect((runFlagOff('let m = "abc".match(/a(b)c/); m[1];') as { Type: string }).Type).toBe('normal');
});
