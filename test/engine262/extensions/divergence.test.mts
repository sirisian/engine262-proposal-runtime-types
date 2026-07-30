import { test, expect } from 'vitest';
import { Diverges } from '../../../src/type-system/divergence.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-do-expressions.md phase 0: divergence, per #sec-divergence.
 *
 * A statement DIVERGES when no path of control through it completes normally.
 * The clause is owed to `switch` and to `match` rather than to do expressions -
 * #sec-pattern-static-semantics already reads a match arm's type by it, and the
 * README's switch chapter defines it - and nothing in this engine computed it,
 * so CompletionTypeOf had nothing to call.
 *
 * It is tested directly rather than through a script because it has no
 * consumers yet: phase 4 gives it to CompletionTypeOf. That is also the honest
 * way to test it, since what it computes is a property of a Parse Node and not
 * an observable of a program.
 *
 * The analysis is SYNTACTIC, and the tests below are written to pin that: a
 * `while (cond)` does not diverge however plainly the reader can see that
 * `cond` is true.
 */

setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
const realm = new ManagedRealm();

/**
 * The first statement of `source`, parsed by the real parser.
 *
 * Parsed rather than hand-built: the analysis reads node types and field names,
 * so a hand-built shape that drifted from the parser's would let every test
 * pass against a module that fails on real code.
 */
function stmt(source: string) {
  // Wrapped in a function so that `return` and `break` are legal where the
  // rules need them, and unwrapped through the completion compileScript returns.
  const compiled = realm.compileScript(`function outer() { ${source} }`) as {
    Value?: { ECMAScriptCode: { ScriptBody: { StatementList: readonly unknown[] } } },
  };
  if (!compiled.Value?.ECMAScriptCode) {
    throw new Error(`did not compile: ${source}`);
  }
  const fn = compiled.Value.ECMAScriptCode.ScriptBody.StatementList[0] as {
    FunctionBody: { FunctionStatementList: readonly unknown[] },
  };
  return fn.FunctionBody.FunctionStatementList[0];
}

const diverges = (source: string, ctx = {}) => Diverges(stmt(source), ctx);

/**
 * The same, for a statement whose break targets a label declared OUTSIDE it.
 *
 * `lbl: { break other; }` is a Syntax Error on its own - there is no `other` to
 * name - so the label is declared around it and the INNER statement is the one
 * asked about. That is exactly the shape the rule is about: a break whose
 * target lies outside the node being analysed.
 */
function divergesNested(source: string, ctx = {}) {
  const outer = stmt(`other: { ${source} }`) as { LabelledItem: { StatementList: readonly unknown[] } };
  return Diverges(outer.LabelledItem.StatementList[0] as Parameters<typeof Diverges>[0], ctx);
}

test('a return and a throw diverge', () => {
  expect(diverges('return 1;')).toBe(true);
  expect(diverges('return;')).toBe(true);
  expect(diverges('throw new Error();')).toBe(true);
});

test('an ordinary statement does not', () => {
  expect(diverges('f();')).toBe(false);
  expect(diverges('let x = 1;')).toBe(false);
  expect(diverges(';')).toBe(false);
  expect(diverges('debugger;')).toBe(false);
});

test('a block diverges when ANY statement in it does', () => {
  // Not only the last: a diverging statement makes the rest unreachable.
  expect(diverges('{ return 1; }')).toBe(true);
  expect(diverges('{ f(); return 1; }')).toBe(true);
  expect(diverges('{ return 1; f(); }')).toBe(true);
  expect(diverges('{ f(); g(); }')).toBe(false);
  expect(diverges('{ }')).toBe(false);
});

test('an if diverges only with an else and both branches diverging', () => {
  expect(diverges('if (c) return 1; else return 2;')).toBe(true);
  expect(diverges('if (c) return 1;')).toBe(false);          // no else: falls through
  expect(diverges('if (c) return 1; else f();')).toBe(false);
  expect(diverges('if (c) f(); else return 2;')).toBe(false);
  expect(diverges('if (c) { return 1; } else { throw e; }')).toBe(true);
});

test('a break diverges only when its target is outside the node asked about', () => {
  // A break with nothing to target is a Syntax Error, so the rule is asked
  // through the constructs that make one legal.

  // A switch catches an unlabelled break, so a clause ending in one does not
  // diverge - which is why the switch below is not diverging.
  expect(diverges('switch (x) { default: break; }')).toBe(false);

  // A label declared INSIDE the node catches a break naming it.
  expect(diverges('lbl: { break lbl; }')).toBe(false);
  expect(divergesNested('lbl: { break other; }')).toBe(true);
  expect(diverges('lbl: { return 1; }')).toBe(true);
});

test('a switch diverges when it is exhaustive and every clause does', () => {
  // A `default` makes it exhaustive whatever the discriminant.
  expect(diverges('switch (x) { case 1: return 1; default: return 2; }')).toBe(true);
  expect(diverges('switch (x) { case 1: return 1; default: f(); }')).toBe(false);

  // Without a default it is not exhaustive as far as this module can see, and
  // the checker's knowledge is what the hook supplies.
  expect(diverges('switch (x) { case 1: return 1; case 2: return 2; }')).toBe(false);
  expect(diverges('switch (x) { case 1: return 1; case 2: return 2; }', {
    switchCoversDiscriminant: () => true,
  })).toBe(true);

  // The hook does not override the clauses: covering the discriminant is only
  // half of the rule.
  expect(diverges('switch (x) { case 1: return 1; case 2: f(); }', {
    switchCoversDiscriminant: () => true,
  })).toBe(false);

  // An empty switch covers nothing.
  expect(diverges('switch (x) { }', { switchCoversDiscriminant: () => true })).toBe(false);
});

test('while (true) and for (;;) diverge, as FORMS', () => {
  expect(diverges('while (true) { f(); }')).toBe(true);
  expect(diverges('for (;;) { f(); }')).toBe(true);

  // Syntactic: a condition the reader can evaluate is still a condition.
  expect(diverges('while (1) { f(); }')).toBe(false);
  expect(diverges('while (c) { f(); }')).toBe(false);
  expect(diverges('for (; true; ) { f(); }')).toBe(false);
  expect(diverges('for (let i = 0; i < 10; i += 1) { f(); }')).toBe(false);
});

test('a break targeting the infinite loop stops it diverging', () => {
  expect(diverges('while (true) { break; }')).toBe(false);
  expect(diverges('while (true) { if (c) break; }')).toBe(false);
  expect(diverges('for (;;) { break; }')).toBe(false);

  // A break belonging to something nested does not escape the loop.
  expect(diverges('while (true) { switch (x) { default: break; } }')).toBe(true);
  expect(diverges('while (true) { while (c) { break; } }')).toBe(true);

  // A labelled break naming something outside does escape.
  expect(diverges('outer: while (true) { break outer; }')).toBe(false);

  // A labelled loop's OWN label does not catch a break naming it: control
  // leaves the labelled statement, so it completes normally. Passing the
  // enclosing label set into the loop's break search made this look caught,
  // which is the inversion these tests found.
  expect(diverges('lbl: while (true) { break lbl; }')).toBe(false);
  expect(diverges('lbl: for (;;) { break lbl; }')).toBe(false);
  // While a label declared INSIDE the body does catch.
  expect(diverges('while (true) { inner: { break inner; } }')).toBe(true);

  // A break inside a function expression cannot cross the boundary, so the
  // loop still diverges. (The inner break is a Syntax Error in a real program;
  // what is pinned is that the walk does not follow it out.)
  expect(diverges('while (true) { const f = function () { while (c) { break; } }; }')).toBe(true);
});

test('a try is conservatively non-diverging, and composes correctly anyway', () => {
  // #sec-divergence lists no rule for a `try`, so this reports false even when
  // every path leaves. That is the conservative direction - reporting "does not
  // diverge" can only widen a type - and CompletionTypeOf has its own `try`
  // row that recurses into the blocks, where their tails are analysed here.
  expect(diverges('try { return 1; } catch { return 2; }')).toBe(false);
  expect(diverges('{ return 1; }')).toBe(true);   // the block inside it does
});
