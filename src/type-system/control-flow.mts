import type { ParseNode } from '../parser/ParseNode.mts';
import { Value } from '../value.mts';
import type { TypeRecord } from './records.mts';

/**
 * Control flow as the checker needs to read it: whether a statement can finish
 * without a `return` or a `throw`, whether a `break` could leave a loop, and
 * whether an expression sits in a position that guards a branch.
 *
 * These read the Parse Node and the Type Record only - no checker state - so
 * they live beside the checker rather than inside its walk.
 */

/**
 * Whether _stmt_ can complete NORMALLY - that is, without returning or
 * throwing.
 *
 * Distinct from `endsWithReturn` below, and
 * deliberately not built on it: that helper is conservative in the direction
 * ELISION wants, where a false negative merely keeps a check that was not
 * needed. Here a false negative REJECTS A CORRECT PROGRAM, so the
 * conservatism has to run the other way - when this cannot tell, it answers
 * *true* ("can complete"), which withholds the error.
 *
 * Syntactic. It recognises the shapes a reader would call
 * obviously total; anything else is assumed to complete.
 */
export const canCompleteNormally = (
  stmt: ParseNode | null | undefined,
  /**
   * Whether a `switch` is exhaustive over its discriminant, which only the
   * checker knows: it reads the enum's members or the sealed class's subclasses.
   * #sec-divergence counts "every enumerator, every direct subclass, or a
   * `default`" alike, and without this only the `default` was visible here - so
   * a `switch` covering every enumerator, each clause returning, was still told
   * it can complete without a return.
   */
  covers?: (n: ParseNode) => boolean,
): boolean => {
  const again = (n: ParseNode | null | undefined) => canCompleteNormally(n, covers);
  if (!stmt) {
    return true;
  }
  const n = stmt as ParseNode & Record<string, unknown>;
  if (n.ExpressionBody !== undefined || n.AssignmentExpression !== undefined) {
    return false;
  }
  switch (n.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return false;
    case 'FunctionBody':
    case 'Block': {
      // A function BODY carries `FunctionStatementList`, not `StatementList`,
      // which is why `endsWithReturn` reads both. Missing it here made every
      // body fall to `default` and answer "can complete", so the phase-1
      // count named every annotated function rather than the incomplete ones.
      const list = (n.FunctionStatementList
        ?? n.StatementList
        ?? (n.Block as { StatementList?: readonly ParseNode[] })?.StatementList) as readonly ParseNode[] | undefined;
      if (!list || list.length === 0) {
        return true;
      }
      // A block completes normally when its LAST reachable statement does.
      return again(list[list.length - 1]);
    }
    case 'IfStatement': {
      const alt = n.Statement_b as ParseNode | undefined;
      if (!alt) {
        // No `else`: the test may be false, so control reaches the tail.
        return true;
      }
      return again(n.Statement_a as ParseNode)
        || again(alt);
    }
    case 'TryStatement': {
      const block = n.Block as ParseNode | undefined;
      const handler = (n.Catch as { Block?: ParseNode })?.Block;
      const fin = (n.Finally as { Block?: ParseNode })?.Block ?? n.Finally as ParseNode | undefined;
      // A `finally` that cannot complete decides the whole statement.
      if (fin && !again(fin)) {
        return false;
      }
      if (handler) {
        return again(block) || again(handler);
      }
      return again(block);
    }
    case 'WhileStatement': {
      // `while (true)` with no reachable `break` cannot complete. A `break`
      // anywhere inside is enough to assume it can, which is the conservative
      // reading.
      const test = n.Expression as { type?: string, value?: unknown } | undefined;
      const alwaysTrue = test?.type === 'BooleanLiteral' && test.value === true;
      if (!alwaysTrue) {
        return true;
      }
      return containsBreak(n.Statement as ParseNode);
    }
    case 'SwitchStatement': {
      // A `switch` completes normally unless it has a `default` AND no clause
      // completes normally AND no clause can `break` out. Without a `default`
      // an unmatched value falls through, so the statement completes.
      const cb = n.CaseBlock as {
        CaseClauses_a?: readonly ParseNode[],
        DefaultClause?: ParseNode,
        CaseClauses_b?: readonly ParseNode[],
      } | undefined;
      // An exhaustive `switch` needs no `default`: #sec-divergence counts
      // "every enumerator, every direct subclass, or a `default`", and the
      // checker is what can tell. Without the hook only the `default` was seen.
      // `cb` is tested on its own so that the walk below sees it as present.
      // The earlier form - `!cb?.DefaultClause` - narrowed it as a side effect,
      // and adding the exhaustiveness hook to the condition took that away: a
      // switch covered by the hook now reaches the walk, and could in principle
      // reach it with no CaseBlock at all. No block means no clause to fall out
      // of, which completes normally.
      if (!cb || (!cb.DefaultClause && !(covers?.(stmt) === true))) {
        return true;
      }
      // The `default` is only present when there IS one: an exhaustive switch
      // reaches here without one, and splicing an *undefined* into the list
      // crashed the walk below on its `StatementList`. The early return above
      // used to guarantee it.
      const clauses = [
        ...(cb.CaseClauses_a ?? []),
        ...(cb.DefaultClause ? [cb.DefaultClause] : []),
        ...(cb.CaseClauses_b ?? []),
      ];
      for (const c of clauses) {
        const list = (c as { StatementList?: readonly ParseNode[] }).StatementList;
        // An EMPTY clause falls through to the next one rather than
        // completing, so it does not decide the statement.
        if (!list || list.length === 0) {
          continue;
        }
        if (again(list[list.length - 1]!)) {
          return true;
        }
        if (containsBreak(c as ParseNode)) {
          return true;
        }
      }
      return false;
    }
    case 'ForStatement': {
      // `for (;;)` is `while (true)` with the test left out, so it reads the
      // same way: no test at all, and the only way out is a `break`. A `for`
      // WITH a test completes whenever the test is false, which this analysis
      // does not evaluate. `for (let i = 0;;)` is the testless form too - an
      // initializer says nothing about leaving.
      //
      // Missing, so `function f(): uint8 { for (;;) { } }` was told it can
      // complete without a return while `while (true) { }` beside it was not.
      if (n.Expression_b !== undefined && n.Expression_b !== null) {
        return true;
      }
      return containsBreak(n.Statement as ParseNode);
    }
    case 'DoWhileStatement': {
      // The body runs BEFORE the condition is read, which is what separates
      // this from `while`: a `while` whose body cannot complete may still
      // complete by never entering it, and a `do` cannot. So a body that cannot
      // complete carries the statement, whatever the condition says.
      const test = n.Expression as { type?: string, value?: unknown } | undefined;
      const alwaysTrue = test?.type === 'BooleanLiteral' && test.value === true;
      const body = n.Statement as ParseNode;
      if (alwaysTrue) {
        return containsBreak(body);
      }
      return again(body) || containsBreak(body);
    }
    case 'LabelledStatement': {
      // A `break` naming the label resumes after the labelled statement, so it
      // completes normally however total the statement it labels is.
      // `containsBreak` counts a labelled `break` as readily as an unlabelled
      // one, which is what keeps this answer on the safe side: it can only push
      // toward "can complete", and that withholds an error rather than raising
      // a wrong one.
      const item = n.LabelledItem as ParseNode | undefined;
      return again(item) || containsBreak(item);
    }
    default:
      return true;
  }
};

/** Whether a statement contains a `break` that could leave its enclosing loop. */
export const containsBreak = (node: ParseNode | null | undefined): boolean => {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as ParseNode & Record<string, unknown>;
  if (n.type === 'BreakStatement') {
    return true;
  }
  // Not descending into a nested function, whose `break` is not this loop's.
  if (typeof n.type === 'string' && /Function|Arrow|Method|Class/.test(n.type)) {
    return false;
  }
  for (const key of Object.keys(n)) {
    if (key === 'parent' || key === 'location') {
      continue;
    }
    const v = (n as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      if (v.some((x) => containsBreak(x as ParseNode))) {
        return true;
      }
    } else if (v && typeof v === 'object' && containsBreak(v as ParseNode)) {
      return true;
    }
  }
  return false;
};

/**
 * Whether a function body's straight-line exit is a `return` with a value.
 *
 * This is the second half of the return-boundary condition and the half that
 * is easy to forget: a function whose every explicit return is proven can
 * STILL fall off the end, and falling off the end hands back *undefined*,
 * which no numeric or object annotation admits. Requiring the body to end in
 * a `return` makes that path impossible without a control-flow graph.
 *
 * It is deliberately syntactic and therefore conservative. A body ending in
 * `if (c) return a; else return b;` is not elided even though both arms
 * return, and a CONCISE arrow body is not elided at all - it has no
 * ReturnStatement node to prove. Both are misses rather than errors: the
 * boundary runs and the program is correct, which is the right direction to
 * be wrong in when the alternative is skipping a check that was needed.
 */
export const endsWithReturn = (body: ParseNode | readonly ParseNode[] | null | undefined): boolean => {
  if (!body) {
    return false;
  }
  const list = Array.isArray(body)
    ? body as readonly ParseNode[]
    : (body as { FunctionStatementList?: readonly ParseNode[], StatementList?: readonly ParseNode[] }).FunctionStatementList
      ?? (body as { StatementList?: readonly ParseNode[] }).StatementList;
  if (!list || list.length === 0) {
    return false;
  }
  const last = list[list.length - 1]!;
  return last.type === 'ReturnStatement' && !!(last as { Expression?: ParseNode | null }).Expression;
};

/**
 * proposal-runtime-types (README, explicit resource management): a `using`
 * declaration's declared type must be one whose values can carry a disposal
 * method, since the declaration promises to dispose what it binds. A value type
 * and `void` never can, so annotating a resource with one is a mistake the
 * checker reports; `never` is the empty union and falls out of the union arm. `null` and `undefined` ARE admitted, because the
 * declaration permits them at runtime and registers nothing.
 *
 * This is the direction of the README's rule rather than its exact form. The
 * precise statement is that the declared type must include `[Symbol.dispose]`,
 * which cannot be checked yet because the type grammar has no symbol-keyed
 * member: `{ [Symbol.dispose](): void }` is rejected with "a computed member name
 * is not supported yet", so no type can declare the method to be looked for.
 * Rejecting every object type instead would make the annotation unusable, so the
 * checker catches what it provably can and the exact membership check waits on
 * that grammar.
 */
export const canCarryDisposal = (t: TypeRecord): boolean => {
  switch (t.Kind) {
    case 'any':
      return true;
    case 'union':
      return (t as { Members: readonly TypeRecord[] }).Members.some(canCarryDisposal);
    case 'literal': {
      const v = (t as { Value: unknown }).Value;
      return v === Value.null || v === Value.undefined;
    }
    case 'primitive':
      // `null` and `undefined` are primitive types named for their one value
      // (#sec-null-and-undefined-types), and a `using` declaration accepts
      // either - the disposal is simply skipped. They were literal types
      // before, and the case above answered for them.
      return (t as { Name?: string }).Name === 'null' || (t as { Name?: string }).Name === 'undefined';
    case 'void':
      return false;
    default:
      return true;
  }
};

/**
 * Whether a test sits where it decides a branch: the condition of `if`, `while`,
 * `do`, or `for`, the test of a conditional expression, or inside a parenthesis
 * or a `!` over one of those. The operands of `&&` and `||` guard in a weaker
 * sense and the specification does not name them, so they are left out of this
 * pass along with a test written as an ordinary Boolean value.
 */
export const guardsABranch = (node: ParseNode): boolean => {
  let child: ParseNode = node;
  let parent = (child as { parent?: ParseNode }).parent;
  while (parent) {
    switch (parent.type) {
      case 'IfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ConditionalExpression':
        return (parent as unknown as Record<string, unknown>).Expression === child
          || (parent as unknown as Record<string, unknown>).ShortCircuitExpression === child;
      case 'ForStatement':
        return (parent as unknown as Record<string, unknown>).Expression_b === child;
      case 'ParenthesizedExpression':
      case 'UnaryExpression':
        child = parent;
        parent = (parent as { parent?: ParseNode }).parent;
        continue;
      default:
        return false;
    }
  }
  return false;
};
