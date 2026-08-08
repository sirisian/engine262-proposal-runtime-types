import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A `match` clause evaluates its arm in a declarative environment holding the
 * clause's bound names. That environment must be dropped on EVERY exit, not
 * only on the paths that fall through to the next clause - the success paths
 * returned without restoring it, leaving the running context's
 * LexicalEnvironment a child of the one the surrounding code expects.
 *
 * A `for` head containing a match then asked its loop environment for a binding
 * that lived one link up, and crashed on `Assert(binding !== undefined)` inside
 * CreatePerIterationEnvironment.
 */

test('a match in a `for` head does not disturb the loop environment', () => {
  expect(evaluated('let out = 0; for (let i = match ([1]) { when [let n]: n; default: 0; }; i < 3; i++) { out += i; } String(out);')).toBe('3');
  expect(evaluated('let out = 0; for (let i = 0; i < match ([3]) { when [let n]: n; default: 0; }; i++) { out += i; } String(out);')).toBe('3');
  expect(evaluated('let out = 0; for (let i = 0; i < 3; i += match ([1]) { when [let n]: n; default: 0; }) { out += i; } String(out);')).toBe('3');
  // Not about the BINDINGS: the clause environment is created either way, so a
  // match binding nothing crashed too.
  expect(evaluated('let out = 0; for (let i = match ([1]) { when [_]: 1; default: 0; }; i < 3; i++) { out += i; } String(out);')).toBe('3');
  // `var` was unaffected, having no per-iteration environment to copy - which is
  // the observation that located the fault.
  expect(evaluated('let out = 0; for (var i = match ([1]) { when [let n]: n; default: 0; }; i < 3; i++) { out += i; } String(out);')).toBe('3');
});

test('every arm form restores the environment', () => {
  // Expression arm, block arm, throwing arm, and a nested match.
  expect(evaluated('let out = 0; for (const x of [[1],[2]]) { out += match (x) { when [let n]: n; default: 0; }; } String(out);')).toBe('3');
  expect(evaluated('String(match ([1]) { when [let n]: { n * 2; } default: 0; });')).toBe('2');
  expect(evaluated('let k = "no"; try { match ([1]) { when [let n]: throw new Error("x"); default: 0; }; } catch (e) { k = "caught"; } k;')).toBe('caught');
  expect(evaluated('let out = 0; for (let i = 0; i < 2; i++) { out += match ([i]) { when [let n]: match ([n]) { when [let m]: m; default: 0; }; default: 0; }; } String(out);')).toBe('1');
});

test('a clause binding still does not escape its arm', () => {
  // The restore must drop the environment, not merge it: `n` is unreachable
  // after the match, which is what makes the arm a scope.
  expect(evaluated('let out = 0; for (const x of [[1]]) { out += match (x) { when [let n]: n; default: 0; }; } String(out);')).toBe('1');
  expectThrown('match ([1]) { when [let n]: n; default: 0; }; n;');
});

/**
 * `MatchProperty : MatchBindingPattern` - the shorthand where the bound name is
 * also the member name. The specification gives it as an alternative and
 * patternmatching.md's opening example uses it, but the parser accepted only
 * `key: pattern`, so the design's own headline form was a Syntax Error.
 */
test('an object pattern may bind a member by its own name', () => {
  // The design's opening example.
  expect(evaluated('const r = { status: 200, body: "hi" }; String(match (r) { when { status: 200, let body }: body; default: "no"; });')).toBe('hi');
  expect(evaluated('const o = { a: 1 }; String(match (o) { when { let a }: a; default: 0; });')).toBe('1');
  expect(evaluated('const o = { a: 1, b: 2 }; String(match (o) { when { let a, let b }: a + b; default: 0; });')).toBe('3');
  expect(evaluated('const o = { k: 1, v: 9 }; String(match (o) { when { k: 1, let v }: v; default: 0; });')).toBe('9');
  expect(evaluated('const o = { a: 1 }; String(match (o) { when { const a }: a; default: 0; });')).toBe('1');
  // A member the subject lacks fails the clause rather than binding undefined.
  expect(evaluated('const o = { b: 1 }; String(match (o) { when { let a }: a; default: "fell"; });')).toBe('fell');
  // The explicit and array forms are untouched.
  expect(evaluated('const o = { a: 1 }; String(match (o) { when { a: let x }: x; default: 0; });')).toBe('1');
  expect(evaluated('String(match ([1]) { when [let n]: n; default: 0; });')).toBe('1');
  // And it composes with the environment fix above.
  expect(evaluated('let out = 0; for (let i = match ({ a: 1 }) { when { let a }: a; default: 0; }; i < 3; i++) { out += i; } String(out);')).toBe('3');
  expectThrown('match ({ a: 1 }) { when { let a }: a; default: 0; }; a;');
});
