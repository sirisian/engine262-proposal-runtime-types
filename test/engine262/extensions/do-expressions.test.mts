import { test, expect } from 'vitest';
import {
  evaluated, ok, expectError, expectErrorFlagOff, evaluatedFlagOff,
} from '../readme/harness.mts';

/**
 * PLAN-do-expressions.md phase 2 (the parser) and the plain form's evaluation,
 * per #sec-do-expressions and #sec-do-expression-early-errors.
 *
 * The two landed together because the evaluator's dispatch is exhaustive: a new
 * PrimaryExpression that nothing evaluates does not typecheck, so a parser-only
 * commit was not available. The runtime half is small for the reason the plan
 * recorded - Evaluate_StatementList already threads UpdateEmpty exactly as the
 * base specification does, so a block's completion already CARRIES its
 * completion value, and this only reads it.
 */

test('the value is the completion value', () => {
  expect(evaluated('String(do { 1 });')).toBe('1');
  expect(evaluated('String(do { 1; 2 });')).toBe('2');
  expect(evaluated('String(do { let t = 3; t * 2 });')).toBe('6');
  expect(evaluated('String(do { { 5 } });')).toBe('5');
  expect(evaluated('String(do { lbl: { 5 } });')).toBe('5');
});

test('an empty do is undefined, which is void 0 rather than the void type', () => {
  expect(evaluated('String(do { });')).toBe('undefined');
  expect(evaluated('String(do { ; });')).toBe('undefined');
  // A binding of it is fine: `undefined` is a value, where `void` is the
  // absence of one and is a return type.
  expect(ok('const x = do { };')).toBe(true);
});

test('a branching tail takes the branch that ran', () => {
  expect(evaluated('String(do { if (true) 1; else 2 });')).toBe('1');
  expect(evaluated('String(do { if (false) 1; else 2 });')).toBe('2');
  expect(evaluated('String(do { try { 1 } catch { 2 } });')).toBe('1');
  expect(evaluated('function f() { throw new Error(); } String(do { try { f() } catch { 2 } });')).toBe('2');
  // With a `break`, whose own completion is empty, so the value stays the
  // clause's. Without one the clause falls through and the value is the last
  // clause that ran - `case 1: 5; default: 6;` is 6, not 5, which is ordinary
  // fall-through rather than anything a `do` introduces.
  expect(evaluated('String(do { switch (1) { case 1: 5; break; default: 6; } });')).toBe('5');
  expect(evaluated('String(do { switch (1) { case 1: 5; default: 6; } });')).toBe('6');
  // A `finally` runs but its completion is discarded.
  expect(evaluated('String(do { try { 1 } finally { 99 } });')).toBe('1');
});

test('control flow leaves the expression', () => {
  // The property that makes a `do` unlike an immediately-invoked arrow, whose
  // `return` would land in the arrow.
  expect(evaluated('function f() { const x = do { return 7; }; return 0; } String(f());')).toBe('7');
  expect(evaluated(`
    function f() {
      let n = 0;
      for (const x of [1, 2, 3]) { const y = do { if (x === 2) continue; x }; n += y; }
      return n;
    }
    String(f());
  `)).toBe('4');
  expect(evaluated(`
    function f() { outer: { const x = do { break outer; }; return 'no'; } return 'yes'; }
    f();
  `)).toBe('yes');
});

test('the Early Errors refuse a completion value nobody predicts', () => {
  // A declaration's completion is empty, so the value would fall back to the
  // statement before it.
  expectError('const x = do { let y = 1; };');
  expectError('const x = do { const y = 1; };');
  expectError('const x = do { class C {} };');
  expectError('const x = do { function g() {} };');

  // An `if` with no `else` is its consequent's value or undefined by a
  // condition the reader has to trace.
  expectError('const c = true; const x = do { if (c) 1 };');

  // A loop's is the last iteration's value, or undefined for none.
  expectError('const c = false; const x = do { while (c) { 1 } };');
  expectError('const x = do { for (;;) { 1 } };');
  expectError('const ys = []; const x = do { for (const y of ys) { 1 } };');
  expectError('const c = false; const x = do { do { 1 } while (c) };');
});

test('the rule is on the completion, so it reaches through nesting', () => {
  // A branch whose value would be a loop's.
  expectError('const c = true; const i = 0; function f() {} const x = do { if (c) { while (i) f() } else { 42 } };');
  // Through a label and through a block.
  expectError('const x = do { lbl: { let y = 1; } };');
  expectError('const x = do { { let y = 1; } };');
});

test('a do is not allowed where a statement is legal', () => {
  // `do {` in statement position begins a `do`-`while`, and does still.
  expect(evaluated('let i = 0; do { i += 1; } while (i < 3); String(i);')).toBe('3');
  // Which is why a nested `do` needs parentheses: the inner one would otherwise
  // be in statement position and read as a `do`-`while` missing its `while`.
  expectError('const x = do { do { 7 } };');
  expect(evaluated('String(do { (do { 7 }) });')).toBe('7');
});

test('the base language is untouched with the feature off', () => {
  expectErrorFlagOff('const x = do { 1 };');
  expectErrorFlagOff('const x = do * { yield 1; };');
  expectErrorFlagOff('const x = async do * { yield 1; };');
  // And `do`-`while`, which shares the keyword, still runs.
  expect(evaluatedFlagOff('let i = 0; do { i += 1; } while (i < 3); String(i);')).toBe('3');
});

test('async do without a star is not a form', () => {
  // An async block whose value is a promise of its completion value is a
  // different feature with its own history; this proposal does not take it.
  expectError('const x = async do { 1 };');
});

/**
 * PLAN-do-expressions.md phase 3b: `do *`, per #sec-do-generator-expressions.
 *
 * A `do *` evaluates to a generator object, and the construction is a generator
 * function's with one difference that is the entire point of the form: the
 * closure is created with lexical `this`, as an arrow's is. Building it from the
 * generator-expression path instead gives back a generator whose `this` is
 * undefined in strict code - a failure that shows up only where the body reads
 * `this`, which is why that test is here rather than implied.
 */

test('a do * is a generator object', () => {
  expect(evaluated('String([...do * { yield 1; yield 2; }]);')).toBe('1,2');
  expect(evaluated('String([...do * { yield* [1, 2]; yield* [3]; }]);')).toBe('1,2,3');
  expect(evaluated('let n = 0; for (const x of do * { yield 1; yield 2; }) { n += x; } String(n);')).toBe('3');
  expect(evaluated('String([...do * { }].length);')).toBe('0');
});

test('a do * binds `this` lexically', () => {
  // The `.call(this)` this syntax exists to delete. An object method's `this`
  // reaches the body without being threaded through a call.
  expect(evaluated(`
    const o = { xs: [1, 2], m() { return [...do * { for (const x of this.xs) yield x; }]; } };
    String(o.m());
  `)).toBe('1,2');
});

test('the Early Errors do not apply to a do *', () => {
  // A do * has no completion value - its body's completion is discarded, as any
  // generator body's is - so the restrictions have nothing to restrict. The
  // design's motivating example ends in a loop.
  expect(evaluated('const xs = [1, 2]; String([...do * { for (const x of xs) yield x; }]);')).toBe('1,2');
  expect(ok('const g = do * { let t = 1; };')).toBe(true);
  expect(ok('const c = true; const g = do * { if (c) yield 1; };')).toBe(true);
  // While the plain form still refuses each.
  expectError('const xs = []; const x = do { for (const y of xs) { 1 } };');
});

test('return in a do * sets the generator\'s return value', () => {
  // The sharpest edge in the feature: adding a `*` changes what `return` does.
  // In a `do` it leaves the enclosing function; here it completes the generator.
  expect(evaluated('const g = do * { return 7; }; String(g.next().value);')).toBe('7');
  expect(evaluated('function f() { const g = do * { return 7; }; return g.next().value + 1; } String(f());')).toBe('8');
  // Against the plain form, where the same source returns from `f`.
  expect(evaluated('function f() { const x = do { return 7; }; return 0; } String(f());')).toBe('7');
});

test('async do * is an async generator', () => {
  expect(evaluated('const g = async do * { yield 1; }; String(typeof g.next);')).toBe('function');
});
