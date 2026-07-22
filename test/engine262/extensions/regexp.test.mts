import { test, expect } from 'vitest';
import { evaluated, run } from '../readme/harness.mts';

/**
 * Extension coverage (regexp.md, typed regular expressions).
 *
 * The core of the typed layer is implemented: `RegExp` is a nominal type, and a
 * regular expression literal has the type `RegExp.<Captures, Groups>` inferred
 * from its pattern, checked at an annotated declaration. That inference and its
 * checking are exercised in extensions/typed-regexp.test.mts. The fuller
 * match-result surface (exact exec-result shapes, group-name access checking on a
 * result, typed replace callbacks, the Flags argument, `RegExp.template`, string
 * narrowing by pattern) is capability P's deferred remainder. This file verifies
 * the untyped regexp runtime, which the typed layer leaves unchanged.
 */

// ── The untyped runtime is intact ─────────────────────────────────────────────
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

// ── RegExp as a type name ─────────────────────────────────────────────────────
test('regexp: RegExp is usable as a type name', () => {
  // RegExp is registered as a nominal type (a regexp value is a RegExp)
  expect(evaluated('let r: RegExp = /abc/; typeof r;')).toBe('object');
  expect(evaluated('let r = /abc/; String(r instanceof RegExp);')).toBe('true');
});

// ── The typed-capture layer (capability P core) ───────────────────────────────
test('regexp: a literal carries its inferred capture shape as its type', () => {
  // /(.)(.)/  has type RegExp.<[string, string], {}> inferred from the literal, so
  // an annotation of the matching shape is accepted and a differing one is a type
  // error. The full coverage of the inference is in typed-regexp.test.mts.
  expect(evaluated('let r: RegExp.<[string, string], {}> = /(.)(.)/; "ok";')).toBe('ok');
  expect((run('let r: RegExp.<[string], {}> = /(.)(.)/; "ok";') as { Type: string }).Type).toBe('throw');
});
