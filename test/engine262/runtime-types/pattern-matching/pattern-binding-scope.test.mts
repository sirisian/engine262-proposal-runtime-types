import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * WORK-REMAINING section 1 items 1 and 2.
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
