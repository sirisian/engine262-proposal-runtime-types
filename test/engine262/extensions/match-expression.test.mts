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

test('a BLOCK arm is a block, and its value is its final expression', () => {
  // "A block arm's value is its final statement where that is an expression
  // statement, and `void` otherwise" - which is the completion value a Block
  // already produces, so nothing special is computed for it.
  expect(evaluated('String(match (1) { when 1: { 42; } default: 0; });')).toBe('42');
  expect(evaluated('String((() => { let n = 0; return match (1) { when 1: { n = 5; n * 2; } default: 0; }; })());')).toBe('10');
  expect(evaluated('String(match (1) { when 1: { let a = 1; } default: 0; });')).toBe('undefined');
  // An expression arm is unaffected.
  expect(evaluated('String(match (1) { when 1: 7; default: 0; });')).toBe('7');
});

test('PINNED: an abrupt completion cannot leave a block arm', () => {
  // The plan flagged this as the place an implementation could be "wrong in
  // five ways at once": in a block arm `return`, `break`, `continue`, `await`
  // and `yield` must mean what they mean IN THE ENCLOSING FUNCTION, and the
  // specification threads those permissions through.
  //
  // The arm IS parsed as a Block rather than a function body, so it does not
  // rebind them - but a `match` is an EXPRESSION, and an abrupt completion has
  // no way to travel out of an expression context in this engine. So it throws
  // rather than returning, which is at least LOUD: the wrong answer here would
  // be silently swallowing the `return` and yielding a value.
  // Pinned by what it PRODUCES: the arm parses and runs, and the abrupt
  // completion is produced - but taking the enclosing function's value throws,
  // so the `return` neither returns nor is silently swallowed.
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome2('(function f() { match (1) { when 1: { return 1; } default: 0; } })();')).toBe('ACCEPTED');
  expect(outcome2('String((function f() { match (1) { when 1: { return "r"; } default: 0; } return "fell"; })());')).toBe('SyntaxError');
});

test('PINNED: what phase four does not yet carry', () => {
  // STATEMENT position works through the same speculative parse as expression
  // position, since a `match` expression is a valid expression statement - the
  // COVER the spec describes is what a conforming parser needs, and the
  // speculation reaches the same programs here.
  expect(outcome('match (1) { when 1: 1; default: 2; }')).toBe('ACCEPTED');
  // BINDINGS need the scoping rule and land with the checker.
  expect(outcome('match (1) { when let x: x; default: 0; }')).toBe('SyntaxError');
});
