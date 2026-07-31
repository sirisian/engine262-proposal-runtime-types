import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * WORK-REMAINING §1 items 1 and 2.
 *
 * `sec-is-pattern`: "the bindings are in scope in exactly the positions the
 * truth of the test governs ... each such position evaluating in env."
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

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
  expect(evaluated('let n = 0; const log = []; while ((n += 1) is let c and 1..5) { log.push(String(c)); } log.join(",");')).toBe('1,2,3,4');
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

test('PINNED: a `match` STATEMENT needs an explicit semicolon', () => {
  // ASI does not apply after a `match` expression statement, even across a
  // newline - so `match (x) { ... }` followed by any statement is a parse
  // error. **This is what made abrupt completions look broken for several
  // cycles**: the programs testing them never parsed, and the failure was read
  // as evidence about completions rather than about ASI.
  expect(outcome('function f() { match (1) { when 1: 7; default: 0; } return 3; }')).toBe('SyntaxError');
  // Narrower than it first appeared: ASI DOES apply at TOP LEVEL across a
  // newline, and fails inside a function body - so the defect is in how the
  // statement terminates there, not in ASI generally.
  expect(outcome('match (1) { when 1: 7; default: 0; }\n"after";')).toBe('ACCEPTED');
  // With the semicolon, both are fine.
  expect(outcome('function f() { match (1) { when 1: 7; default: 0; }; return 3; }')).toBe('ACCEPTED');
  expect(evaluated('match (1) { when 1: 7; default: 0; }; "after";')).toBe('after');
  // A match as the LAST statement of a body needs none, since nothing follows.
  expect(evaluated('function f() { match (1) { when 1: 7; default: 0; } } String(f());')).toBe('undefined');
});
