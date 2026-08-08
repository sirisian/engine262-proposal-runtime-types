import { test, expect } from 'vitest';
import { evaluated, expectError, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-match-expression (The Match Expression).
 *
 * The one form of this feature that can break an existing program, since
 * `match` is not a reserved word.
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
  // prove it - exhaustiveness.test.mts owns that half.
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
  expect(evaluated('match (5) { when 1..<3: "low"; when 4..<6: "mid"; default: "high"; }')).toBe('mid');
  expect(evaluated('match ({ x: 1 }) { when { x: _ }: "has x"; default: "no"; }')).toBe('has x');
  expect(evaluated('match ("aaa") { when /^a+$/: "as"; default: "no"; }')).toBe('as');
  expect(evaluated('match (uint8(1)) { when uint8: "typed"; default: "no"; }')).toBe('typed');
  expect(evaluated('match (5) { when 4 or 5: "either"; default: "no"; }')).toBe('either');
});

test('THE CACHE COVERS THE TYPE PATH TOO', () => {
  // #sec-match-expression: the cache memoizes reads "so that a property is
  // read at most once HOWEVER MANY PATTERNS LOOK, and every pattern of one
  // `match` sees the same values."
  //
  // It did not hold for a structural TYPE pattern, because `IsOfType` is given
  // no cache at any of its five call sites in `PatternMatches` while every
  // other subject-touching operation takes one. A structural object type is now
  // matched MEMBER BY MEMBER THROUGH THE CACHE, so the reads happen where the
  // cache already is rather than the cache moving into the type system.
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'match (o) { when { g: 2 }: 1; when { g: 1 }: 2; default: 3; }; String(n);')).toBe('1');
  expect(evaluated('let n = 0; const o = { get g() { n += 1; return 1; } }; '
    + 'match (o) { when { g: _ and 2 }: 1; when { g: _ and 1 }: 2; default: 3; }; String(n);')).toBe('1');
});

test('IT WAS A WRONG ARM, NOT A SLOWER ONE', () => {
  // The assertion that says why this was worth changing. With a getter whose
  // value CHANGES, the uncached path read `g` twice - 1, then 2 - and so
  // matched NO clause, where a single read matches the second. The two
  // spellings chose DIFFERENT ARMS, and which path a member takes is invisible
  // in the source.
  const G = 'let n = 0; const o = { get g() { n += 1; return n; } }; ';
  expect(evaluated(`${G} match (o) { when { g: 2 }: "two"; when { g: 1 }: "one"; default: "none"; }`)).toBe('one');
  expect(evaluated(`${G} match (o) { when { g: _ and 2 }: "two"; when { g: _ and 1 }: "one"; default: "none"; }`)).toBe('one');
});

test('the three kinds that CANNOT be routed still use IsOfType', () => {
  // Each measured before the change and unchanged by it.
  //
  // OPTIONAL members: `{ g?: uint8 }` matches `{}`, where a member-by-member
  // test would require `g` present and answer false.
  expect(evaluated('type T = { g?: uint8 }; String(({}) is T);')).toBe('true');
  // INDEX SIGNATURES name no members to walk.
  expect(evaluated('type T = { [k: string]: uint8 }; String(({ a: uint8(1) }) is T);')).toBe('true');
  // NOMINAL types: a class rejects a plain object with the right members, so it
  // can never become a structural test.
  expect(evaluated('class C { g: uint8 = 1; } String(new C() is C);')).toBe('true');
  expect(evaluated('class C { g: uint8 = 1; } String(({ g: uint8(1) }) is C);')).toBe('false');
  // An INTERFACE is structural here and may be routed.
  expect(evaluated('interface I { g: uint8 } String(({ g: uint8(1) }) is I);')).toBe('true');
});

test('the two spellings still agree on every ANSWER', () => {
  // Eleven pairs were stress-tested when the change was designed; these are the
  // ones a regression would most likely break.
  expect(evaluated('String(({ g: 2 }) is { g: 2 });')).toBe('true');
  expect(evaluated('String(({ g: 3 }) is { g: 2 });')).toBe('false');
  expect(evaluated('String(({ g: 2, h: 9 }) is { g: 2 });')).toBe('true');
  expect(evaluated('String(({}) is { g: 2 });')).toBe('false');
  expect(evaluated('String(({ g: { k: 1 } }) is { g: { k: 1 } });')).toBe('true');
  expect(evaluated('String((5) is { g: 2 });')).toBe('false');
  expect(evaluated('String((null) is { g: 2 });')).toBe('false');
  // An INHERITED member matches, because presence walks the prototype chain as
  // `IsOfType` does.
  expect(evaluated('String((Object.create({ g: 2 })) is { g: 2 });')).toBe('true');
});
test('a BLOCK arm is a do expression\'s block', () => {
  // proposal-runtime-types #sec-do-expression-modifications. An arm's Block IS
  // a `do` expression's Block: its value is its completion value, which a Block
  // already produces, so nothing special is computed for it - that was true
  // under the narrower rule this replaces as well, and no program changes
  // meaning.
  expect(evaluated('String(match (1) { when 1: { 42; } default: 0; });')).toBe('42');
  expect(evaluated('String((() => { let n = 0; return match (1) { when 1: { n = 5; n * 2; } default: 0; }; })());')).toBe('10');
  // An expression arm is unaffected.
  expect(evaluated('String(match (1) { when 1: 7; default: 0; });')).toBe('7');

  // What DOES change, in both directions. An arm may now end in an `if` with an
  // `else`, a `try`, or a `switch`, which the old rule made `void` and so
  // unreadable at the use site.
  expect(evaluated('String(match (1) { when 1: { if (true) 5; else 6; } default: 0; });')).toBe('5');
  expect(evaluated('String(match (1) { when 1: { try { 5 } catch { 6 } } default: 0; });')).toBe('5');

  // And an arm ending in a declaration is a Syntax Error naming it, where it
  // used to be a silent `void` - this line asserted 'undefined' before, which
  // was the old rule's answer and the reason the error is better.
  expectError('const x = match (1) { when 1: { let a = 1; } default: 0; };');
  expectError('const ys = []; const x = match (1) { when 1: { for (const y of ys) { 1 } } default: 0; };');
});

test('an abrupt completion cannot leave a block arm', () => {
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
  // Asserted by what it PRODUCES: the arm parses and runs, and the abrupt
  // completion is produced - but taking the enclosing function's value throws,
  // so the `return` neither returns nor is silently swallowed.
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome2('(function f() { match (1) { when 1: { return 1; } default: 0; } })();')).toBe('ACCEPTED');
  expect(outcome2('String((function f() { match (1) { when 1: { return "r"; } default: 0; } return "fell"; })());')).toBe('SyntaxError');
});

test('what the match expression does not yet carry', () => {
  // STATEMENT position works through the same speculative parse as expression
  // position, since a `match` expression is a valid expression statement - the
  // COVER the spec describes is what a conforming parser needs, and the
  // speculation reaches the same programs here.
  expect(outcome('match (1) { when 1: 1; default: 2; }')).toBe('ACCEPTED');
  // BINDINGS are bindings.test.mts's. What remains of the checker half is
  // NARROWING and EXHAUSTIVENESS.
  expect(evaluated('String(match (1) { when let x: x + 1; default: 0; });')).toBe('2');
});

// -- The environment a match restores --------------------------------------------

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
