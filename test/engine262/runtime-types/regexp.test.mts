import { test, expect } from 'vitest';
import { evaluated, run, expectThrown, runFlagOff, ok, expectStaticTypeError } from './harness.mts';

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

// -- Guards on the two neighbouring clauses this one depends on ---------------
//
// PLAN-typed-regexp-capture-types.md phase 3. `sec-typed-regular-expressions`
// once stated both of these wrongly, and in each case the engine implemented the
// clause faithfully, so nothing but these tests disagreed.
//
// D1: an optional capture was `string | void`. `void` is the type with NO VALUES
// (#sec-null-and-undefined-types), and a capture no matching path entered holds
// *undefined* - so the declared type could not hold what the capture takes.
//
// D2: the no-capture case was the empty ARRAY type, on the stated ground that
// this was what a bare `[]` denotes. It is not - `[]` is the empty TUPLE - so the
// choice made to let `RegExp.<[], {}>` name a no-capture literal was exactly what
// refused it.

test('an optional capture type can hold what exec puts there', () => {
  // The fact D1 turns on, asserted as a VALUE crossing rather than as an
  // annotation being accepted: a non-participating capture is `undefined`, and
  // the declared type must admit it.
  expect(evaluated('const m = /(a)?/.exec(""); let c: string | undefined = m[1];'
    + ' String(c === undefined);')).toBe('true');
  expect(evaluated('const m = /(a)?/.exec("a"); let c: string | undefined = m[1]; String(c);')).toBe('a');
  // ...and `void` cannot, which is why it was the wrong type to assign.
  expectThrown('let x: string | void = undefined;');
});

test('a bare [] is the empty tuple, which is what the no-capture case emits', () => {
  // The fact D2 turns on. If `[]` ever becomes the array type, the clause's
  // choice has to change with it, and this fails rather than the annotation
  // quietly ceasing to work.
  expect(evaluated('String(Reflect.getReflection(type []).kind);')).toBe('tuple');
  expect(evaluated('String(Reflect.getReflection(type [].<any>).kind);')).toBe('array');
  expect(evaluated('String((type []) === (type [].<any>));')).toBe('false');
  expect(evaluated('let r: RegExp.<[], {}> = /abc/; "ok";')).toBe('ok');
});

test('the D2 trade: the array spelling stops naming a no-capture literal', () => {
  // Recorded as INTENDED. `RegExp.<[].<any>, {}>` matched a no-capture literal
  // before and does not now, because RegExp's arguments are invariant and
  // Captures is a tuple. That is the cost of `RegExp.<[], {}>` working, which is
  // the spelling the clause's own note calls the common one - but it is a change
  // to something that used to work, so it is asserted rather than discovered.
  expectThrown('let r: RegExp.<[].<any>, {}> = /abc/;');
  expect(evaluated('String(Reflect.isAssignable(type [], type [].<any>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type [].<any>, type []));')).toBe('false');
});

test('optionality itself is unchanged: only the type assigned to it moved', () => {
  // Twenty shapes were measured before the change and every one had the right
  // OPTIONALITY; the fix was one word. These are the rows that discriminate - a
  // fix that over-reached would show up here.
  expect(evaluated('let r: RegExp.<[string], {}> = /(a)+/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string], {}> = /(a){1,2}/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string | undefined], {}> = /(a){0,2}/; "ok";')).toBe('ok');
  // Only the FIRST group is optional here, which is what shows the analysis is
  // structural rather than blanket.
  expect(evaluated('let r: RegExp.<[string | undefined, string], {}> = /(a)?(b)/; "ok";')).toBe('ok');
  // A required capture must not gain an `undefined` arm.
  expectThrown('let r: RegExp.<[string | undefined], {}> = /(a)/;');
  // A non-capturing group and a backreference add no capture.
  expect(evaluated('let r: RegExp.<[], {}> = /(?:a)/; "ok";')).toBe('ok');
  expect(evaluated('let r: RegExp.<[string], {}> = /(a)\\1/; "ok";')).toBe('ok');
});

test('D30: a REGEXP reports `RegExp.<Captures, Groups>` at run time', () => {
  // It reported `{}` - an object with no structure - though the CHECKER has
  // always known the type: `RegExp.<[string], {}>` at `/(a)/` is accepted and a
  // wrong ARITY refused. Only REPORTING was missing.
  //
  // `inferRegExpLiteralType` is the same operation the checker uses, so the two
  // cannot disagree about a pattern, and no stamp is needed: the capture count
  // is derivable from `[[OriginalSource]]`.
  expect(evaluated('String(Reflect.typeOf(/abc/));')).toBe('RegExp.<[], {}>');
  expect(evaluated('String(Reflect.typeOf(/(a)/));')).toBe('RegExp.<[string], {}>');
  expect(evaluated('String(Reflect.typeOf(/(a)(b)/));')).toBe('RegExp.<[string, string], {}>');
  expect(evaluated('String(Reflect.typeOf(/(?<y>a)/));')).toBe('RegExp.<[string], { y: string }>');
  expect(evaluated('String(Reflect.typeOf(new RegExp("(a)")));')).toBe('RegExp.<[string], {}>');
});

test('D30: the neighbouring reporters are unaffected', () => {
  expect(evaluated('String(Reflect.typeOf(new Map.<string, uint8>()));')).toBe('Map.<string, uint.<8>>');
  // A PROMISE still reports `{}` - the rest of D30, deliberately left: its
  // arguments are not recoverable from the value.
  expect(evaluated('String(Reflect.typeOf(Promise.resolve(1)));')).toBe('{}');
});

test('D49: a BARE `RegExp` is the supertype of every parameterization', () => {
  // #sec-regexp: "A bare `RegExp`, the raw library type, is the supertype of
  // every such parameterization, so it holds a literal of any shape while a
  // written parameterization does not hold a value of another."
  //
  // Two tests here asserted this and had been FAILING unnoticed: they sit at the
  // top of `runtime-types/`, and every regression sweep named SUBDIRECTORIES, so
  // twenty files were never run.
  expect(ok('if (false) { let r: RegExp = /(a)/; } 1;')).toBe(true);
  expect(ok('if (false) { let r: RegExp = /abc/; } 1;')).toBe(true);
  expect(ok('if (false) { let r: RegExp = /(?<y>a)/; } 1;')).toBe(true);
  // A WRITTEN parameterization still holds no value of another.
  expect(ok('if (false) { let r: RegExp.<[string], {}> = /(a)/; } 1;')).toBe(true);
  expectStaticTypeError('let r: RegExp.<[string, string], {}> = /(a)/;');
});

test('D49 is stated for RegExp ALONE, not for every library name', () => {
  // #sec-untyped-collections: the rule is "stated per family rather than as a
  // general rule about an unparameterized built-in, because the families do not
  // agree on what an unparameterized use means".
  //
  // A bare `Map` is the UNTYPED COLLECTION, whose typed and untyped forms
  // "coexist in one program without interacting" - so it is NOT a supertype, and
  // widening this rule to every library name would decide a question the
  // specification has not asked.
  expectStaticTypeError('let m: Map = new Map.<string, uint8>();');
});
