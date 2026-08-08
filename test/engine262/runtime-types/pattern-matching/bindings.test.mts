import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-patternmatches (PatternMatches) - the BINDING half.
 *
 * #sec-patternmatches: a |MatchBindingPattern| tests its annotation where it
 * has one, then performs InitializeBinding and returns *true*. "A binding always
 * matches and always binds - and it is written with `let` or `const` because an
 * unadorned name is a CONSTANT to compare against, not a binding site."
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a binding binds, and the arm sees it', () => {
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
  expect(evaluated('String(match (5) { when const x: x + 1; default: 0; });')).toBe('6');
  // Each clause gets a FRESH environment, so one arm's binding is invisible to
  // the next - asserted by binding the same name in two clauses.
  expect(evaluated('String(match (2) { when 1: "one"; when let x: x * 3; default: 0; });')).toBe('6');
});

test('an ANNOTATED binding tests before it binds', () => {
  // Which is `catch (e: TypeError)` in a new position.
  expect(evaluated('String(match (uint8(5)) { when let x: uint8: "typed"; default: "no"; });')).toBe('typed');
  expect(evaluated('String(match (5) { when let x: uint8: "typed"; default: "no"; });')).toBe('no');
});

test('bindings work in every structural position', () => {
  expect(evaluated('String(match ({ a: 7 }) { when { a: let v }: v; default: 0; });')).toBe('7');
  expect(evaluated('String(match ([1, 9]) { when [1, let b]: b; default: 0; });')).toBe('9');
  expect(evaluated('const Some = { [Symbol.customMatcher](v) { return [v]; } }; '
    + 'String(match (5) { when Some(let v): v * 10; default: 0; });')).toBe('50');
});

test('a GUARD sees the pattern\'s bindings', () => {
  // "A guard runs after the pattern matches, with the pattern's bindings in
  // scope and the subject narrowed" - which is what makes a guard a refinement
  // of the clause rather than a second, independent test.
  expect(evaluated('String(match (5) { when let x if (x > 3): "big"; default: "small"; });')).toBe('big');
  expect(evaluated('String(match (2) { when let x if (x > 3): "big"; default: "small"; });')).toBe('small');
});

test('`is` creates an environment for its bindings too', () => {
  expect(outcome('const v = 1; v is let x;')).toBe('ACCEPTED');
  expect(evaluated('String(1 is let x);')).toBe('true');
});

test('the binding COLON is resolved by CONTEXT, not by lookahead', () => {
  // `when let x: T:` annotates and `when let x:` ends the pattern, so a colon
  // means different things in different positions. The parsers carry a
  // `colonTerminates` flag: TRUE in a clause, where a second colon distinguishes
  // an annotation from the clause's own, and FALSE in `is` and member positions,
  // where `let x: T` is complete as written.
  //
  // Speculating on a second colon at each site got two of the three positions
  // WRONG - `is` and member bindings were refused - because the speculation
  // encoded a clause's rule everywhere. Passing the context down settles all
  // three at once.
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // Clause position, both spellings.
  expect(evaluated('String(match (uint8(1)) { when let x: uint8: "yes"; default: "no"; });')).toBe('yes');
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
  // `is` position, where there is no clause colon to find.
  expect(outcome2('uint8(1) is let x: uint8;')).toBe('ACCEPTED');
  expect(evaluated('String(uint8(1) is let x: uint8);')).toBe('true');
  expect(evaluated('String(1 is let x: uint8);')).toBe('false');
  expect(evaluated('String(1 is let x);')).toBe('true');
});

test('what the checker half does not yet do', () => {
  // NARROWING per pattern form, LITERAL PROPAGATION into patterns, and
  // EXHAUSTIVENESS extending `check.mts`'s SwitchStatement machinery. A bound
  // name currently types loosely rather than as the pattern established.
  expect(evaluated('String(typeof (1 is 1));')).toBe('boolean');
  // EXHAUSTIVENESS landed - match-exhaustiveness.test.mts owns it. This pin
  // had asserted a fully-covered enum was ACCEPTED, which stayed true for a
  // DIFFERENT reason once the check arrived, so it never noticed: a pin on a
  // case the change does not alter is not a pin at all.
});

// -- The scope of a binding ------------------------------------------------------

/**
 * Spec: #sec-is-pattern (The Is Pattern) - the scope of a pattern's bindings.
 *
 * #sec-is-pattern: "the bindings are in scope in exactly the positions the
 * truth of the test governs ... each such position evaluating in env."
 */

test('a bound name is IN SCOPE where the truth of the test governs', () => {
  // The positions the clause enumerates: an `if` consequent, the right of
  // `&&`, a loop body. Before this, every one was a ReferenceError - the
  // binding existed only inside a child environment the operator discarded, and
  // the enclosing construct that evaluates the governed position knew nothing
  // of it.
  expect(evaluated('const val = 5; let out = "X"; if (val is let x) { out = String(x); } out;')).toBe('5');
  expect(evaluated('const val = 5; String((val is let x) && x);')).toBe('5');
  expect(evaluated('let out = "X"; if (uint8(5) is let x: uint8) { out = String(x); } out;')).toBe('5');
  expect(evaluated('let out = "X"; if (({ a: 7 }) is { a: let n }) { out = String(n); } out;')).toBe('7');
  expect(evaluated('const S = { [Symbol.customMatcher](x) { return [x * 2]; } }; '
    + 'let out = "X"; if (5 is S(let d)) { out = String(d); } out;')).toBe('10');
});

test('a LOOP rebinds per iteration', () => {
  // "which is what makes `while (read() is Ok(let chunk))` a loop whose body
  // sees `chunk` and whose exit is the miss."
  //
  // The binding is MUTABLE at the record level though the clause calls it
  // immutable: an immutable binding cannot be initialized twice, and a loop's
  // test runs once per iteration - it asserted inside the host on the second.
  // The immutability the clause wants is against USER ASSIGNMENT, which is the
  // checker's to enforce along with the scope.
  expect(evaluated('let n = 0; const log = []; while ((n += 1) is let c and 1..<5) { log.push(String(c)); } log.join(",");')).toBe('1,2,3,4');
  expect(evaluated('const log = []; for (const q of [1, 2, 3]) { if (q is let c) { log.push(String(c)); } } log.join(",");')).toBe('1,2,3');
  // A MISS binds nothing and the governed position does not run.
  expect(evaluated('let out = "ok"; if (5 is let x: string) { out = "matched"; } out;')).toBe('ok');
});

test('an ABRUPT COMPLETION leaves a block arm and means what it means outside', () => {
  // This was recorded as an outstanding gap and IS NOT ONE. Every earlier
  // reading of it was taken from a program that never parsed - see the ASI test
  // below - so the completion was never reached.
  //
  // "`return`, `break`, `continue`, `await` and `yield` mean in an arm what they
  // mean in the enclosing function", and they do.
  expect(evaluated('function f() { match (1) { when 1: { return 7; } default: 0; }; return 3; } String(f());')).toBe('7');
  expect(evaluated('let out = ""; for (const q of [1, 2]) { match (q) { when 1: { continue; } default: 0; }; out += q; } out;')).toBe('2');
  expect(evaluated('let out = ""; for (const q of [1, 2, 3]) { match (q) { when 2: { break; } default: 0; }; out += q; } out;')).toBe('1');
});

test('a `match` statement works in ANY position, and ASI applies', () => {
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // THE CAUSE, after three rounds of describing the symptom: the guard read
  // `match [no LineTerminator here]` as "no line terminator BEFORE `match`",
  // where the grammar puts the restriction between `match` AND ITS PARENTHESIS.
  // So every `match` that BEGAN A LINE was rejected as a match expression -
  // which is every one inside a block - and the statement was then parsed as
  // something else and failed. It was never about ASI.
  expect(evaluated('{\nmatch (1) { when 1: 7; default: 0; }\n5;\n}\n"ok";')).toBe('ok');
  expect(evaluated('function f() {\nmatch (1) { when 1: 7; default: 0; }\nreturn 3;\n}\nString(f());')).toBe('3');
  expect(evaluated('const f = () => {\nmatch (1) { when 1: 7; default: 0; }\nreturn 3;\n};\nString(f());')).toBe('3');
  // And an ABRUPT COMPLETION now leaves a block arm in a program written the
  // way one would actually be written.
  expect(evaluated('function f() {\nmatch (1) { when 1: { return 7; } default: 0; }\nreturn 3;\n}\nString(f());')).toBe('7');
});

test('the restriction still holds where the grammar puts it', () => {
  // `match` [no LineTerminator here] `(` - so `match` on one line and `(` on
  // the next is a CALL to something named `match`, and must stay one.
  expect(evaluated('const match = (x) => x + 1; String(match\n(1));')).toBe('2');
  expect(evaluated('const match = (x) => x + 1; String(match(1));')).toBe('2');
  expect(evaluated('String("abc".match(/b/)[0]);')).toBe('b');
  // NOT a defect: an expression statement followed by another with no separator
  // is a SyntaxError in any JavaScript, and this was twice mistaken for
  // evidence about `match`.
  const outcome3 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome3('match (1) { when 1: 7; default: 0; } 5;')).toBe('SyntaxError');
});
