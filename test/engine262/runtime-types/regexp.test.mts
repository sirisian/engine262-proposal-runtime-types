import { test, expect } from 'vitest';
import { evaluated, run, expectThrown, runFlagOff } from './harness.mts';

/**
 * Design: regexp.md - the capture-type inference of a regular expression
 * literal.
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

// -- The regexp surface this rests on --------------------------------------------

/**
 * Extension coverage (regexp.md, typed regular expressions).
 *
 * The core of the typed layer is implemented: `RegExp` is a nominal type, and a
 * regular expression literal has the type `RegExp.<Captures, Groups>` inferred
 * from its pattern, checked at an annotated declaration - the section above
 * covers that. The fuller match-result surface (exact exec-result shapes,
 * group-name access checking on a result, typed replace callbacks, the Flags
 * argument, `RegExp.template`, string narrowing by pattern) is not implemented.
 * What follows is the untyped regexp runtime, which the typed layer leaves
 * unchanged.
 */

// -- The untyped runtime is intact ---------------------------------------------
test('regexp: a literal tests and matches as usual', () => {
  expect(evaluated('let r = /abc/; String(r.test("abc"));')).toBe('true');
  expect(evaluated('let r = /abc/; String(r.test("xyz"));')).toBe('false');
});

test('regexp: numbered captures are read from the match result', () => {
  expect(evaluated('let m = "abc".match(/a(b)c/); m[1];')).toBe('b');
  // multiple captures
  expect(evaluated('let m = "2020-01".match(/(\\d+)-(\\d+)/); m[1] + "/" + m[2];')).toBe('2020/01');
});

test('regexp: named groups are read from the groups object', () => {
  expect(evaluated('let m = "2020".match(/(?<year>\\d+)/); m.groups.year;')).toBe('2020');
});

test('regexp: matchAll and replace work as usual', () => {
  expect(evaluated('let out = [...("aXbXc".matchAll(/X/g))]; String(out.length);')).toBe('2');
  expect(evaluated('"a-b".replace(/-/, "+");')).toBe('a+b');
  // a replace callback receives the match
  expect(evaluated('"ab".replace(/(a)(b)/, (m, g1, g2) => g2 + g1);')).toBe('ba');
});

test('regexp: flags are readable on the literal', () => {
  expect(evaluated('let r = /abc/gi; r.flags;')).toBe('gi');
  expect(evaluated('let r = /abc/g; String(r.global);')).toBe('true');
});

// -- RegExp as a type name -----------------------------------------------------
test('regexp: RegExp is usable as a type name', () => {
  // RegExp is registered as a nominal type (a regexp value is a RegExp)
  expect(evaluated('let r: RegExp = /abc/; typeof r;')).toBe('object');
  expect(evaluated('let r = /abc/; String(r instanceof RegExp);')).toBe('true');
});

// -- The typed-capture layer -------------------------------------------------
test('regexp: a literal carries its inferred capture shape as its type', () => {
  // /(.)(.)/  has type RegExp.<[string, string], {}> inferred from the literal, so
  // an annotation of the matching shape is accepted and a differing one is a type
  // error. The full coverage of the inference is in the section above.
  expect(evaluated('let r: RegExp.<[string, string], {}> = /(.)(.)/; "ok";')).toBe('ok');
  expect((run('let r: RegExp.<[string], {}> = /(.)(.)/; "ok";') as { Type: string }).Type).toBe('throw');
});
