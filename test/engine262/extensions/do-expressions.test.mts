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

/**
 * PLAN-do-expressions.md phase 4: the checker, per #sec-completiontypeof.
 *
 * The type is a union over the TAILS, with divergence - phase 0's analysis,
 * which until now had no caller - removing the paths that cannot produce one.
 */

test('the type is the union over the tails', () => {
  expect(ok('const x: number = do { 1 };')).toBe(true);
  expect(ok("const x: uint8 = do { 'a' };")).toBe(false);
  expect(ok("const c = true; const x: number | string = do { if (c) 1; else 'a' };")).toBe(true);
  expect(ok("const c = true; const x: number = do { if (c) 1; else 'a' };")).toBe(false);
  expect(ok('const x: number = do { try { 1 } catch { 2 } };')).toBe(true);
  expect(ok("const x: number = do { try { 1 } catch { 'a' } };")).toBe(false);
});

test('a diverging tail contributes nothing, and all of them is never', () => {
  // never is the empty union and a subtype of everything, so a `do` that only
  // throws satisfies any annotation. The binding is unreachable, so its
  // declared type constrains nothing.
  expect(ok('function f() { const port: uint16 = do { throw new Error(); }; return port; }')).toBe(true);
  // A throwing branch drops out of the union rather than widening it.
  expect(ok('const c = true; function f() { const x: number = do { if (c) 1; else throw new Error(); }; }')).toBe(true);
});

test('a switch with no default contributes undefined', () => {
  expect(ok("const s = 'a'; const x: number = do { switch (s) { case 'a': 1; } };")).toBe(false);
  expect(ok("const s = 'a'; const x: number | undefined = do { switch (s) { case 'a': 1; } };")).toBe(true);
  expect(ok("const s = 'a'; const x: number = do { switch (s) { case 'a': 1; break; default: 2; } };")).toBe(true);
});

test('an exhaustive enum switch contributes no undefined', () => {
  // #sec-completiontypeof. Exhaustiveness is the SWITCH's, which the design
  // reserves to enums and sealed hierarchies, so the coverage the checker
  // already computes for its own diagnostics is what this reads - one
  // computation, consulted from both places, rather than two that drift.
  expect(ok(`
    enum E: uint8 { A, B }
    function f(e: E) { const x: number = do { switch (e) { case E.A: 1; break; case E.B: 2; break; } }; }
  `)).toBe(true);

  // Missing an enumerator, so a path takes no clause and the type carries
  // `undefined`.
  expect(ok(`
    enum E: uint8 { A, B }
    function f(e: E) { const x: number = do { switch (e) { case E.A: 1; break; } }; }
  `)).toBe(false);

  // A discriminant the design does not reserve the word for still needs a
  // `default`, which is the asymmetry with `match` the clause records.
  expect(ok("const s = 'a'; const x: number = do { switch (s) { case 'a': 1; break; } };")).toBe(false);
});

test('a clause\'s trailing break has an empty completion', () => {
  // `case E.A: 1; break;` completes with 1, not with nothing: a break's own
  // completion is empty and the value falls back to the statement before it,
  // which is what UpdateEmpty does at run time. Read as a divergence instead,
  // every clause would have typed as `never` and an exhaustive switch would
  // have been assignable to anything - passing for the wrong reason.
  expect(ok(`
    enum E: uint8 { A, B }
    function f(e: E) { const x: string = do { switch (e) { case E.A: 1; break; case E.B: 2; break; } }; }
  `)).toBe(false);
});

test('do * infers its Generator type', () => {
  expect(ok('const g: Generator.<number, void, void> = do * { yield 1; };')).toBe(true);
  expect(ok("const g: Generator.<number | string, void, void> = do * { yield 1; yield 'a'; };")).toBe(true);
  expect(ok('const g: Generator.<string, void, void> = do * { yield 1; };')).toBe(false);
  // A yield* contributes the DELEGATED generator's yield type, not the
  // generator itself.
  expect(ok(`
    function* inner(): Generator.<number, void, void> { yield 1; }
    const g: Generator.<number, void, void> = do * { yield* inner(); };
  `)).toBe(true);
});

/**
 * PLAN-do-expressions.md phase 5: the decorator contexts, per
 * #sec-do-expression-modifications.
 *
 * `DoBlock` and `DoGeneratorBlock` are two contexts rather than one with a
 * flag, because what the block IS differs - a block in one case and a generator
 * body in the other - which is the same reason `ForBlock` and `ForOfBlock` are
 * two.
 */

test('the do block contexts are registered', () => {
  expect(evaluated('String(Reflect.DoBlock !== undefined);')).toBe('true');
  expect(evaluated('String(Reflect.DoGeneratorBlock !== undefined);')).toBe('true');
});

test('a decorated do block reports its own kind', () => {
  // The decorator goes BEFORE the keyword, as doexpressions.md writes it: it
  // names the thing that produces the value, which is the expression.
  expect(evaluated(`
    let k = '';
    function d(c: Reflect.DoBlock) { k = c.kind; }
    const x = @d do { 1 };
    k;
  `)).toBe('DoBlock');
  // And the value still flows through.
  expect(evaluated('function d(c: Reflect.DoBlock) {} String(@d do { 5 });')).toBe('5');
  // A `do *` reaches its own context, though its body is a generator body
  // rather than a Block, so Evaluate_Block never sees it and the decorators are
  // applied where the generator is built.
  expect(evaluated(`
    let k = '';
    function d(c: Reflect.DoGeneratorBlock) { k = c.kind; }
    const g = @d do * { yield 1; };
    [...g].join('') + '/' + k;
  `)).toBe('1/DoGeneratorBlock');
  // A bare block still reports `Block`, so the subkind did not leak.
  expect(evaluated(`
    let k = '';
    function d(c: Reflect.Block) { k = c.kind; }
    @d { 1 }
    k;
  `)).toBe('Block');
});

test('a do block decorator fires on every entry', () => {
  // The per-entry rule is what makes a block decorator different from every
  // other kind: it observes an execution rather than a declaration.
  expect(evaluated(`
    let n = 0;
    function d(c: Reflect.DoBlock) { n += 1; }
    for (let i = 0; i < 3; i += 1) { const v = @d do { i }; }
    String(n);
  `)).toBe('3');
});

/**
 * Two things phase 5 does NOT do, recorded rather than left to be discovered.
 *
 * The RETURN REPLACEMENT is the new capability the design gives these two
 * contexts - a `DoBlock` decorator returning a value of the expression's type,
 * a `DoGeneratorBlock` decorator returning a generator - and it is not wired:
 * ApplyDecorators' result is still discarded by Evaluate_Block, as it is for
 * every other block. Without it `@memo do { ... }` runs the decorator and
 * ignores what it returns.
 *
 * The spelling is the design's - `@memo do { ... }`, the decorator before the
 * keyword - which was settled in favour of the design after the engine first
 * read it the other way round. `do @memo { ... }` also parses, and means what
 * it says: that decorates the BLOCK, which is the general block-decorator
 * feature and not this one.
 */

/**
 * The return replacement, per #sec-do-expression-modifications.
 *
 * The capability these two contexts exist for, and the reason the exclusion of
 * blocks from replacement had no content once a block had a value: every other
 * block produces nothing, so there was never anything for a block decorator to
 * replace.
 *
 * It fires on ENTRY, as every block decorator does, so a replacement means the
 * block is not evaluated at all - which is what makes `@memo do { ... }` a
 * memoization rather than a wrapper.
 */

test('a DoBlock decorator may replace the value', () => {
  expect(evaluated('function d(c: Reflect.DoBlock) { return 99; } String(@d do { 1 });')).toBe('99');
  // The block does not run: the decorator answered instead of wrapping.
  expect(evaluated(`
    let ran = false;
    function d(c: Reflect.DoBlock) { return 99; }
    const x = @d do { ran = true; 1 };
    String(ran);
  `)).toBe('false');
  // Returning nothing leaves the expression alone.
  expect(evaluated('function d(c: Reflect.DoBlock) {} String(@d do { 1 });')).toBe('1');
});

test('which is what memoization needs', () => {
  // Two evaluations of the expression, one evaluation of the block.
  expect(evaluated(`
    let calls = 0;
    let memo;
    function d(c: Reflect.DoBlock) { return memo; }
    function run() { return @d do { calls += 1; memo = 7; 7 }; }
    const a = run();
    const b = run();
    String(a + ',' + b + ',' + calls);
  `)).toBe('7,7,1');
});

test('a DoGeneratorBlock decorator may replace the generator', () => {
  // What it replaces is an ITERATOR, and wrapping one - filtering, limiting,
  // buffering a sequence - is what a decorator over a sequence is for.
  expect(evaluated(`
    function swap(c: Reflect.DoGeneratorBlock) { return [9, 8][Symbol.iterator](); }
    String([...@swap do * { yield 1; yield 2; yield 3; }]);
  `)).toBe('9,8');
  expect(evaluated(`
    function d(c: Reflect.DoGeneratorBlock) {}
    String([...@d do * { yield 1; yield 2; }]);
  `)).toBe('1,2');
});

/**
 * The context-sensitive Early Errors, per #sec-do-expression-early-errors.
 *
 * These three need the parser to know WHERE the `do` sits rather than what it
 * ends with, which is why they arrived after the structural two.
 */

test('a var may not appear in a do in a parameter expression', () => {
  // There is no function body for the binding to hoist into yet: the one it
  // would reach is the one being declared.
  expectError('function f(x = do { var v = 1; v }) { return x; }');
  // A `var` in a `do` anywhere else is fine, and so is a `var` in a function
  // whose parameters have defaults - the rule is about the conjunction.
  expect(evaluated('function f() { const x = do { var v = 1; v }; return x; } String(f());')).toBe('1');
  expect(evaluated('function f(a = 1) { var v = 2; return a + v; } String(f());')).toBe('3');
});

test('an unlabelled break may not appear in a do in a loop head', () => {
  // The loop is not yet entered, so which loop it targets is a puzzle.
  expectError('for (let i = do { break; }; ; ) {}');
  expectError('while (do { break; }) {}');

  // The body is a different place: a `break` in a `do` there targets the loop
  // it is in, which is ordinary.
  expect(evaluated(`
    let n = 0;
    for (let i = 0; i < 5; i += 1) { const x = do { if (i > 1) break; i }; n += x; }
    String(n);
  `)).toBe('1');
  // And a `do` in a head with no break is fine.
  expect(evaluated('let n = 0; for (let i = do { 0 }; i < 3; i += 1) { n += 1; } String(n);')).toBe('3');
  // A LABELLED break in a head names a loop that already exists.
  expect(ok('outer: for (let i = do { 0 }; i < 1; i += 1) { break outer; }')).toBe(true);
});

/**
 * The third, `return` in a computed property name, is refused - but by the base
 * language's rule that a `return` may not appear outside a function, which
 * fires first and says "Unexpected token". The behaviour is what the clause
 * asks for; the diagnostic is not the one it names. Recorded rather than
 * asserted on the message, since pinning the wrong message would make the
 * better one a test failure.
 */
