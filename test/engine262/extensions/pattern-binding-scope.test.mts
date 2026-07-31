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

test('PINNED: a `match` statement gets no ASI inside any BLOCK', () => {
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // Characterised over three rounds, each narrowing the claim.
  //
  // At TOP LEVEL, ASI applies across a newline as for any expression statement.
  expect(outcome2('match (1) { when 1: 7; default: 0; }\n5;')).toBe('ACCEPTED');
  // Inside ANY BLOCK - a function body, an arrow body, a bare block - it does
  // not. **So `match` is inconsistent WITH ITSELF**, which is the sharpest
  // statement of the defect and the reason it is a defect at all.
  expect(outcome2('function f() {\nmatch (1) { when 1: 7; default: 0; }\nreturn 3;\n}')).toBe('SyntaxError');
  expect(outcome2('{\nmatch (1) { when 1: 7; default: 0; }\n5;\n}')).toBe('SyntaxError');
  // ORDINARY brace-ending expressions in the same position are fine, so the
  // block's statement list is not at fault.
  expect(outcome2('function f() {\n({a:1})\nreturn 3;\n}')).toBe('ACCEPTED');
  expect(outcome2('function f() {\n(class {})\nreturn 3;\n}')).toBe('ACCEPTED');
  // A `do` EXPRESSION fails at BOTH levels, so it is NOT the comparison it
  // first appeared to be: `do { }` followed by anything is ambiguous with a
  // do-while missing its `while`, which is a legitimate refusal rather than the
  // same defect.
  expect(outcome2('do { 1; }\n5;')).toBe('SyntaxError');
  // An explicit `;` works everywhere and is what every `match`-statement test
  // in this suite relies on.
  expect(outcome2('function f() { match (1) { when 1: 7; default: 0; }; return 3; }')).toBe('ACCEPTED');
  // NOT part of the defect: an expression statement followed by another with no
  // separator is a SyntaxError in any JavaScript.
  expect(outcome2('match (1) { when 1: 7; default: 0; } 5;')).toBe('SyntaxError');
});
