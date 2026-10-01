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
 * #sec-check-elision and #sec-divergence: propagate possible completions.
 * Sequential code consumes only normal flow. Switch clauses may fall through;
 * loops and labels consume only the breaks/continues that target them.
 */
export const canCompleteNormally = (
  stmt: ParseNode | null | undefined,
  covers?: (n: ParseNode) => boolean,
  nonReturning?: (n: ParseNode) => boolean,
): boolean => {
  type Outcome = 'normal' | 'return' | 'throw' | `break:${string}` | `continue:${string}`;
  type Outcomes = Set<Outcome>;
  const union = (...sets: Outcomes[]): Outcomes => new Set(sets.flatMap((set) => [...set]));
  const sequence = (list: readonly ParseNode[] = []): Outcomes => {
    let result: Outcomes = new Set(['normal']);
    for (const node of list) {
      if (!result.delete('normal')) break;
      result = union(result, visit(node));
    }
    return result;
  };
  const visit = (node: ParseNode | null | undefined, labels: readonly string[] = []): Outcomes => {
    if (!node) return new Set(['normal']);
    // A never result may throw or diverge. Keep the exceptional possibility
    // so a surrounding catch/finally still participates in completion.
    if (nonReturning?.(node)) return new Set(['throw']);
    const n = node as ParseNode & Record<string, unknown>;
    if (n.type === 'ConciseBody' || n.type === 'AsyncConciseBody') return new Set(['return']);
    switch (n.type) {
      case 'ReturnStatement': return new Set(['return']);
      case 'ThrowStatement': return new Set(['throw']);
      case 'BreakStatement': return new Set<Outcome>([`break:${n.LabelIdentifier?.name ?? ''}`]);
      case 'ContinueStatement': return new Set<Outcome>([`continue:${n.LabelIdentifier?.name ?? ''}`]);
      case 'FunctionBody': case 'AsyncBody': case 'GeneratorBody': case 'AsyncGeneratorBody': case 'Block':
        return sequence((n.FunctionStatementList ?? n.StatementList
          ?? (n.Block as ParseNode.Block | undefined)?.StatementList) as readonly ParseNode[] | undefined);
      case 'IfStatement':
        return union(visit(n.Statement_a as ParseNode), visit(n.Statement_b as ParseNode));
      case 'TryStatement': {
        const handlers = (n.CatchClauses as readonly ParseNode.Catch[] | undefined)
          ?? (n.Catch ? [n.Catch as ParseNode.Catch] : []);
        // A statement may throw through an expression or a cleanup. Conservatively
        // consider each handler even when the body has no explicit throw.
        const incoming = union(visit(n.Block as ParseNode), ...handlers.map((handler) => visit(handler.Block)));
        const finalizer = (n.Finally as { Block?: ParseNode } | undefined)?.Block ?? n.Finally as ParseNode | undefined;
        if (!finalizer || incoming.size === 0) return incoming;
        const final = visit(finalizer);
        const completes = final.delete('normal');
        return completes ? union(incoming, final) : final;
      }
      case 'SwitchStatement': {
        const cb = n.CaseBlock as ParseNode.CaseBlock | undefined;
        if (!cb) return new Set(['normal']);
        const clauses = [...(cb.CaseClauses_a ?? []), ...(cb.DefaultClause ? [cb.DefaultClause] : []), ...(cb.CaseClauses_b ?? [])];
        let suffix: Outcomes = new Set(['normal']);
        let result: Outcomes = new Set(cb.DefaultClause || covers?.(node) ? [] : ['normal']);
        // Each label is an entry point; a normal clause reaches its successor.
        for (const clause of clauses.toReversed()) {
          const current = sequence(clause.StatementList ?? []);
          const fallsThrough = current.delete('normal');
          suffix = fallsThrough ? union(current, suffix) : current;
          result = union(result, suffix);
        }
        if (result.delete('break:')) result.add('normal');
        return result;
      }
      case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement':
      case 'ForInStatement': case 'ForOfStatement': case 'ForAwaitStatement': {
        const body = visit(n.Statement as ParseNode);
        const test = (n.type === 'ForStatement' ? n.Expression_b : n.Expression) as ParseNode | undefined;
        const unbounded = (n.type === 'ForStatement' && !test)
          || (['WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(n.type)
            && test?.type === 'BooleanLiteral' && test.value === true);
        let iterates = body.delete('normal');
        iterates = body.delete('continue:') || iterates;
        for (const label of labels) iterates = body.delete(`continue:${label}`) || iterates;
        const exits = body.delete('break:');
        // A do loop must reach its test; other loops may perform zero steps.
        const testDiverges = test !== undefined && nonReturning?.(test);
        if (exits || (!unbounded && !testDiverges && (n.type !== 'DoWhileStatement' || iterates))) body.add('normal');
        if (iterates && testDiverges) body.add('throw');
        return body;
      }
      case 'LabelledStatement': {
        const label = (n.LabelIdentifier as ParseNode.LabelIdentifier).name;
        const result = visit(n.LabelledItem as ParseNode, [...labels, label]);
        if (result.delete(`break:${label}`)) result.add('normal');
        return result;
      }
      default: return new Set(['normal']);
    }
  };
  return visit(stmt).has('normal');
};

/** Whether a statement contains a `break` that could leave its enclosing loop. */
export const containsBreak = (node: ParseNode | null | undefined, label?: string,
  nestedBreakTargets = 0, localLabels: readonly string[] = []): boolean => {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as ParseNode & Record<string, unknown>;
  if (n.type === 'BreakStatement') {
    const target = (node as ParseNode.BreakStatement).LabelIdentifier?.name;
    if (label !== undefined) return target === label;
    return target === undefined ? nestedBreakTargets === 0 : !localLabels.includes(target);
  }
  // Not descending into a nested function, whose `break` is not this loop's.
  if (typeof n.type === 'string' && /Function|Arrow|Method|Class/.test(n.type)) {
    return false;
  }
  // Nested loops and switches consume their own unlabelled breaks. A local
  // labelled statement likewise consumes only breaks naming its label.
  const depth = nestedBreakTargets + (['WhileStatement', 'DoWhileStatement', 'ForStatement',
    'ForOfStatement', 'ForInStatement', 'ForAwaitStatement', 'SwitchStatement'].includes(n.type) ? 1 : 0);
  const labels = n.type === 'LabelledStatement'
    ? [...localLabels, (node as ParseNode.LabelledStatement).LabelIdentifier.name] : localLabels;
  for (const key of Object.keys(n)) {
    if (key === 'parent' || key === 'location') {
      continue;
    }
    const v = (n as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      if (v.some((x) => containsBreak(x as ParseNode, label, depth, labels))) {
        return true;
      }
    } else if (v && typeof v === 'object' && containsBreak(v as ParseNode, label, depth, labels)) {
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
 * A known non-callable disposal member is also impossible. The checker supplies
 * member lookup/callability so this predicate need not resolve class shapes.
 * Unknown members and open object types retain runtime protocol discovery.
 */
export const canCarryDisposal = (t: TypeRecord, possibleDisposer: (type: TypeRecord) => boolean): boolean => {
  switch (t.Kind) {
    case 'any':
      return true;
    case 'union':
      return t.Members.some((member) => canCarryDisposal(member, possibleDisposer));
    case 'literal':
      return t.Value === Value.null || t.Value === Value.undefined;
    case 'primitive':
      return t.Name === 'null' || t.Name === 'undefined';
    case 'void':
      return false;
    default:
      return possibleDisposer(t);
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
