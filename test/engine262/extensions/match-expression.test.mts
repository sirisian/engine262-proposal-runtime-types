import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-pattern-matching.md phase four: the `match` expression.
 *
 * `sec-match-expression`. The only phase that can break an existing program,
 * which is why the plan puts it after a working core rather than first.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('EXISTING PROGRAMS USING `match` STILL WORK', () => {
  // `match` is a CONTEXTUAL keyword, and "in expression position there is no
  // overlap at all, since a call followed by `{` is already a Syntax Error
  // there". These are the assertions that promise is worth anything.
  expect(evaluated('const match = (x) => x + 1; String(match(1));')).toBe('2');
  expect(evaluated('String("abc".match(/b/)[0]);')).toBe('b');
  expect(evaluated('const o = { match(x) { return x * 2; } }; String(o.match(3));')).toBe('6');
  expect(evaluated('let match = 5; String(match);')).toBe('5');
});

test('clauses are tried in source order, first match wins', () => {
  expect(evaluated('match (1) { when 1: "one"; default: "other"; }')).toBe('one');
  expect(evaluated('match (2) { when 1: "one"; default: "other"; }')).toBe('other');
  expect(evaluated('match (2) { when 1: "a"; when 2: "b"; when 2: "c"; default: "d"; }')).toBe('b');
  // "If no clause matches, a TypeError is thrown" - and the exhaustiveness
  // rules make that throw statically impossible exactly where the types can
  // prove it, which is phase five.
  expect(outcome('match (5) { when 1: 1; }')).toBe('TypeError');
});

test('`default` must be LAST, and it is reserved', () => {
  expect(outcome('match (1) { default: 1; when 2: 2; }')).toBe('SyntaxError');
  expect(evaluated('match (99) { when 1: "one"; default: "fallback"; }')).toBe('fallback');
});

test('THE SUBJECT IS EVALUATED ONCE, before any pattern', () => {
  expect(evaluated('let n = 0; const f = () => { n += 1; return 1; }; '
    + 'match (f()) { when 1: 1; default: 2; }; String(n);')).toBe('1');
  // Even when a later clause matches, so the count is not an artefact of the
  // first arm succeeding.
  expect(evaluated('let n = 0; const f = () => { n += 1; return 9; }; '
    + 'match (f()) { when 1: 1; when 9: 2; default: 3; }; String(n);')).toBe('1');
});

test('a GUARD fails its arm without abandoning the match', () => {
  // "A falsy guard fails the arm and matching continues" - it does not end the
  // match, which is what makes a guard a refinement of one clause rather than a
  // second subject test.
  expect(evaluated('match (5) { when _ if (false): "no"; default: "yes"; }')).toBe('yes');
  expect(evaluated('match (5) { when _ if (true): "yes"; default: "no"; }')).toBe('yes');
  expect(evaluated('match (5) { when 5 if (false): "a"; when 5: "b"; default: "c"; }')).toBe('b');
});

test('a `throw` arm throws rather than yielding a value', () => {
  // Admitted "because an arm that reports an impossible case is the commonest
  // arm a total `match` has".
  expect(outcome('match (1) { when 1: throw new RangeError("x"); }')).toBe('RangeError');
  expect(evaluated('match (2) { when 1: throw new RangeError("x"); default: "fine"; }')).toBe('fine');
});

test('every pattern form works as a clause pattern', () => {
  expect(evaluated('match (5) { when 1..3: "low"; when 4..6: "mid"; default: "high"; }')).toBe('mid');
  expect(evaluated('match ({ x: 1 }) { when { x: _ }: "has x"; default: "no"; }')).toBe('has x');
  expect(evaluated('match ("aaa") { when /^a+$/: "as"; default: "no"; }')).toBe('as');
  expect(evaluated('match (uint8(1)) { when uint8: "typed"; default: "no"; }')).toBe('typed');
  expect(evaluated('match (5) { when 4 or 5: "either"; default: "no"; }')).toBe('either');
});

test('PINNED: the cache holds on the PATTERN path and not the TYPE path', () => {
  // A real consequence of the deferral discipline, and a tension worth stating
  // rather than papering over.
  //
  // Where a member's sub-pattern is something a |Type| cannot express, the
  // clause takes the pattern path and the Match Cache Record does its job: one
  // getter call however many clauses name the key.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'match (o) { when { g: _ and 2 }: 1; when { g: _ and 1 }: 2; default: 3; }; String(n);')).toBe('1');
  // Where every member IS type-expressible the clause takes the TYPE path,
  // which answers identically and does NOT participate in the cache - so the
  // getter runs once per clause. Two spellings that agree on the ANSWER differ
  // on how many times a getter runs.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'match (o) { when { g: 2 }: 1; when { g: 1 }: 2; default: 3; }; String(n);')).toBe('2');
});

test('PINNED: what phase four does not yet carry', () => {
  // STATEMENT position, where the braced sequel needs the COVER and refinement
  // "as the `type` operator's parenthesized operand is". Expression position
  // needs none, which is why it landed first.
  expect(outcome('match (1) { when 1: 1; default: 2; };')).toBe('ACCEPTED');
  // BLOCK arms, which must be blocks and not function bodies - `return`,
  // `break`, `continue`, `await` and `yield` all meaning what they mean in the
  // enclosing function.
  expect(outcome('match (1) { when 1: { 1; } default: 2; }')).toBe('SyntaxError');
  // And BINDINGS, which need the scoping rule and land with the checker.
  expect(outcome('match (1) { when let x: x; default: 0; }')).toBe('SyntaxError');
});
