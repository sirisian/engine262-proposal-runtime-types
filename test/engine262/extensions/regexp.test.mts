import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * Extension coverage — regexp.md (typed regular expressions).
 *
 * The typed layer - `RegExp.<Captures, Groups, Flags>` inferred from a literal,
 * exact match-result shapes, typed replace callbacks, compile-time group-name
 * checking - is a static-inference subsystem that is not implemented (RegExp is
 * not registered as a type name). Documented as capability P. The untyped regexp
 * runtime is intact and verified here.
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

// ── Documented gap: the typed-capture layer ───────────────────────────────────
test('regexp: the RegExp.<Captures, Groups, Flags> literal-type inference is deferred (documents the gap)', () => {
  // Target (regexp.md): /(.)(.)/  has type RegExp.<[string, string], {}> inferred
  // from the literal, with exact match-result shapes and typed replace callbacks.
  // Today RegExp resolves as a plain nominal type but the capture/group/flags
  // inference from a literal is not performed; a literal's static type does not
  // carry its capture shape. This is the deferred typed layer (capability P).
  // The type-argument syntax parses as a nominal with arguments but does not
  // infer or check capture types.
  expect(evaluated('type R = RegExp.<[string, string], {}>; typeof R;')).toBe('object');
});
