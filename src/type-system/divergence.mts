// Whether a statement can complete normally.
//
// proposal-runtime-types #sec-divergence. A statement DIVERGES when no path of
// control through it completes normally, and the analysis is syntactic: it
// reasons about the shapes of statements and never about the values of
// conditions. That is why the rules below name `while (true)` and `for (;;)` as
// FORMS rather than describing a condition - a rule that asked whether a
// condition was true would have to evaluate it, and the design's analyses do
// not.
//
// PLAN-do-expressions.md phase 0. The clause is owed to `switch` and to `match`
// rather than to do expressions: #sec-pattern-static-semantics already reads a
// match arm's type by divergence, and the README's switch chapter defines it.
// Nothing in this engine computed it, so CompletionTypeOf had nothing to call.

import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * What the analysis cannot decide for itself.
 *
 * A `switch` diverges when it is EXHAUSTIVE and every clause diverges, and
 * whether a `switch` with no `default` covers its discriminant is the checker's
 * knowledge, not this module's: it depends on the discriminant's type and on
 * the enum or sealed hierarchy behind it. A `switch` carrying a `default` is
 * exhaustive whatever its discriminant, which this module can see, so the hook
 * is consulted only for one without.
 */
export interface DivergenceContext {
  readonly switchCoversDiscriminant?: (node: ParseNode) => boolean;
}

interface Frame {
  /** Labels declared inside the node being asked about. */
  readonly labels: Set<string>;
  /** Whether a `break` with no label would be caught inside it. */
  breakables: number;
  /** Whether a `continue` with no label would be caught inside it. */
  continuables: number;
}

function label(node: { readonly LabelIdentifier?: { readonly name?: string } | null }): string | null {
  return node.LabelIdentifier?.name ?? null;
}

/**
 * Does control leave `node` without completing normally?
 *
 * "Leave `node`" is what makes a `break` conditional rather than absolute: a
 * `break` inside a `switch` inside the node is caught by that `switch` and does
 * NOT make the node diverge, while a `break` targeting something outside does.
 * The frame tracks what the node itself encloses, so the question asked is
 * always relative to the node the caller named.
 */
export function Diverges(node: ParseNode | null | undefined, ctx: DivergenceContext = {}): boolean {
  if (!node) {
    return false;
  }
  return divergesFrom(node, ctx, { labels: new Set(), breakables: 0, continuables: 0 });
}

function divergesFrom(node: ParseNode, ctx: DivergenceContext, frame: Frame): boolean {
  switch (node.type) {
    // A return or a throw always leaves.
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;

    // A break or a continue leaves only if what it targets is outside the node
    // being asked about. An unlabelled one is caught by any enclosing loop -
    // and a break by any enclosing switch - that the node itself contains.
    case 'BreakStatement': {
      const name = label(node as { LabelIdentifier?: { name?: string } | null });
      return name === null ? frame.breakables === 0 : !frame.labels.has(name);
    }
    case 'ContinueStatement': {
      const name = label(node as { LabelIdentifier?: { name?: string } | null });
      return name === null ? frame.continuables === 0 : !frame.labels.has(name);
    }

    // A block diverges when ANY statement in it does, not only the last: a
    // diverging statement makes everything after it unreachable.
    case 'Block': {
      const list = (node as { StatementList?: readonly ParseNode[] }).StatementList ?? [];
      return list.some((s) => divergesFrom(s, ctx, frame));
    }

    // An `if` needs both branches, so one without an `else` never diverges -
    // the missing branch completes normally by falling through.
    case 'IfStatement': {
      const n = node as { Statement_a: ParseNode, Statement_b?: ParseNode | null };
      if (!n.Statement_b) {
        return false;
      }
      return divergesFrom(n.Statement_a, ctx, frame) && divergesFrom(n.Statement_b, ctx, frame);
    }

    // A labelled statement catches a break naming it, so its body is analysed
    // with that label in scope; if the body's only exit is that break, control
    // resumes after the label and the whole does not diverge.
    case 'LabelledStatement': {
      const n = node as { LabelIdentifier: { name: string }, LabelledItem: ParseNode };
      const inner: Frame = { labels: new Set(frame.labels), breakables: frame.breakables, continuables: frame.continuables };
      inner.labels.add(n.LabelIdentifier.name);
      return divergesFrom(n.LabelledItem, ctx, inner);
    }

    // Exhaustive and every clause diverging. A `default` makes it exhaustive
    // whatever the discriminant; without one, only the checker knows.
    case 'SwitchStatement': {
      const block = (node as { CaseBlock: { CaseClauses_a?: readonly ParseNode[], DefaultClause?: ParseNode | null, CaseClauses_b?: readonly ParseNode[] } }).CaseBlock;
      const hasDefault = block.DefaultClause !== undefined && block.DefaultClause !== null;
      const exhaustive = hasDefault || ctx.switchCoversDiscriminant?.(node) === true;
      if (!exhaustive) {
        return false;
      }
      const clauses: ParseNode[] = [
        ...(block.CaseClauses_a ?? []),
        ...(block.DefaultClause ? [block.DefaultClause] : []),
        ...(block.CaseClauses_b ?? []),
      ];
      if (clauses.length === 0) {
        return false;
      }
      // A `break` targeting this switch is caught by it, so a clause ending in
      // one does NOT diverge - which is the whole reason the frame exists.
      const inner: Frame = { labels: new Set(frame.labels), breakables: frame.breakables + 1, continuables: frame.continuables };
      return clauses.every((c) => {
        const list = (c as { StatementList?: readonly ParseNode[] }).StatementList ?? [];
        return list.some((s) => divergesFrom(s, ctx, inner));
      });
    }

    // `while (true)` and `for (;;)` as FORMS, never a condition the analysis
    // would have to evaluate. They diverge when no break targets them.
    case 'WhileStatement': {
      const n = node as { Expression: ParseNode, Statement: ParseNode };
      if (!isLiteralTrue(n.Expression)) {
        return false;
      }
      return !containsEscapingBreak(n.Statement, emptyFrame());
    }
    case 'ForStatement': {
      const n = node as {
        Expression_a?: ParseNode | null, Expression_b?: ParseNode | null, Statement: ParseNode,
      };
      // `for (;;)`: no test at all. A `for (; true; )` is not this form; the
      // clause names the two forms and this follows it rather than widening it.
      if (n.Expression_b !== undefined && n.Expression_b !== null) {
        return false;
      }
      return !containsEscapingBreak(n.Statement, emptyFrame());
    }

    default:
      // Every other statement form completes normally as far as this analysis
      // is concerned, which is the conservative direction: reporting "does not
      // diverge" can only make a type wider. A `try` is deliberately among
      // them - CompletionTypeOf has its own rule for one and recurses into the
      // blocks, where their own tails are analysed here.
      return false;
  }
}

function emptyFrame(): Frame {
  return { labels: new Set(), breakables: 0, continuables: 0 };
}

/** `true` as a literal, which is the only condition the analysis reads. */
function isLiteralTrue(node: ParseNode): boolean {
  const n = node as { type: string, value?: unknown };
  return n.type === 'BooleanLiteral' && n.value === true;
}

/**
 * Does `node` contain a `break` that would leave the loop it sits in?
 *
 * Only breaks that escape count: one inside a nested loop or switch belongs to
 * that one, and one naming a label declared inside `node` is caught there.
 *
 * The label set starts EMPTY however the loop was reached, which is the fix for
 * an inversion the tests caught. A labelled loop's own label does not catch a
 * break naming it - `lbl: while (true) { break lbl; }` completes normally, so
 * the loop does not diverge - and passing the enclosing frame's labels in made
 * the loop's own label look like one declared inside its body. Only a label
 * declared WITHIN the body catches.
 */
function containsEscapingBreak(node: ParseNode | null | undefined, frame: Frame, insideNested = false): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as { type?: string, LabelIdentifier?: { name?: string } | null };
  if (n.type === 'BreakStatement') {
    const name = n.LabelIdentifier?.name ?? null;
    // An unlabelled break belongs to the nearest enclosing loop or switch, so
    // it escapes the loop being asked about only if nothing nested caught it.
    if (name === null) {
      return !insideNested;
    }
    // A labelled one escapes unless its label was declared inside the body,
    // and that includes a label naming the loop itself: control leaves the
    // labelled statement, so the loop completes normally.
    return !frame.labels.has(name);
  }
  // A break cannot cross a function or class boundary.
  if (n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
    || n.type === 'ArrowFunction' || n.type === 'GeneratorExpression'
    || n.type === 'GeneratorDeclaration' || n.type === 'AsyncFunctionExpression'
    || n.type === 'AsyncFunctionDeclaration' || n.type === 'AsyncArrowFunction'
    || n.type === 'AsyncGeneratorExpression' || n.type === 'AsyncGeneratorDeclaration'
    || n.type === 'ClassExpression' || n.type === 'ClassDeclaration') {
    return false;
  }
  let inner = frame;
  if (n.type === 'LabelledStatement') {
    const labels = new Set(frame.labels);
    labels.add((n as unknown as { LabelIdentifier: { name: string } }).LabelIdentifier.name);
    inner = { labels, breakables: frame.breakables, continuables: frame.continuables };
  }
  // Descending into a loop or a switch is what catches an unlabelled break
  // below it. The flag is threaded rather than tested on the child, because a
  // break is almost never a direct child - `while (c) { break; }` has it inside
  // a Block - and testing the child let every nested break escape.
  const nowNested = insideNested
    || n.type === 'WhileStatement' || n.type === 'DoWhileStatement'
    || n.type === 'ForStatement' || n.type === 'ForInStatement'
    || n.type === 'ForOfStatement' || n.type === 'SwitchStatement';
  for (const key of Object.keys(node)) {
    // A Parse Node carries a `parent` back-pointer, so a naive walk over its
    // keys goes up the tree and then down it again forever. `location` holds
    // the source range and can hold node references too.
    if (key === 'parent' || key === 'location') {
      continue;
    }
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      if (child.some((c) => containsEscapingBreak(c as ParseNode, inner, nowNested))) {
        return true;
      }
    } else if (child && typeof child === 'object' && 'type' in (child as object)) {
      if (containsEscapingBreak(child as ParseNode, inner, nowNested)) {
        return true;
      }
    }
  }
  return false;
}
