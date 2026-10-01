import type { ParseNode } from '../parser/ParseNode.mts';

type ValueSource = ParseNode.ExpressionStatement | 'empty' | 'undefined' | 'unknown';
export interface CompletionPath {
  value: ValueSource;
  effects: readonly ParseNode[];
}
interface Outcome extends CompletionPath {
  kind: 'normal' | 'break' | 'continue' | 'return' | 'throw';
  target?: string;
  value: ValueSource;
}

/** #sec-completiontypeof: retain UpdateEmpty values across targeted exits. */
export function CompletionPaths(list: readonly ParseNode[] = [], covers?: (node: ParseNode) => boolean,
  nonReturning?: (node: ParseNode) => boolean): readonly CompletionPath[] {
  const normal = (value: ValueSource = 'empty', effects: readonly ParseNode[] = []): Outcome => ({ kind: 'normal', value, effects });
  const unique = (outcomes: Outcome[]): Outcome[] => {
    const result: Outcome[] = [];
    for (const outcome of outcomes) {
      const existing = result.find((other) => other.kind === outcome.kind && other.target === outcome.target && other.value === outcome.value);
      if (existing) existing.effects = [...new Set([...existing.effects, ...outcome.effects])];
      else result.push({ ...outcome });
    }
    return result;
  };
  const updateEmpty = (outcomes: Outcome[], previous: CompletionPath): Outcome[] => outcomes.map((outcome) =>
    outcome.value === 'empty' ? { ...outcome, value: previous.value, effects: [...previous.effects, ...outcome.effects] } : outcome);
  let budget = 4096;
  const sequence = (statements: readonly ParseNode[], initial: Outcome[] = [normal()]): Outcome[] => {
    let outcomes = initial;
    for (const statement of statements) {
      if (!outcomes.some((outcome) => outcome.kind === 'normal')) break;
      const next = visit(statement);
      outcomes = unique(outcomes.flatMap((outcome) => outcome.kind === 'normal' ? updateEmpty(next, outcome) : [outcome]));
    }
    return outcomes;
  };
  const visit = (node: ParseNode): Outcome[] => {
    if (--budget < 0) return [normal('unknown')];
    if (nonReturning?.(node)) return [{ kind: 'throw', value: 'unknown', effects: [] }];
    switch (node.type) {
      case 'ExpressionStatement': return [normal(node)];
      case 'BreakStatement': return [{ kind: 'break', target: node.LabelIdentifier?.name, value: 'empty', effects: [] }];
      case 'ContinueStatement': return [{ kind: 'continue', target: node.LabelIdentifier?.name, value: 'empty', effects: [] }];
      case 'ReturnStatement': return [{ kind: 'return', value: 'unknown', effects: [] }];
      case 'ThrowStatement': return [{ kind: 'throw', value: 'unknown', effects: [] }];
      case 'Block': return sequence(node.StatementList ?? []);
      case 'LabelledStatement':
        return visit(node.LabelledItem).map((outcome) => outcome.kind === 'break' && outcome.target === node.LabelIdentifier.name
          ? { ...outcome, kind: 'normal' as const } : outcome);
      case 'IfStatement':
        return updateEmpty([...visit(node.Statement_a), ...(node.Statement_b ? visit(node.Statement_b) : [normal()])], normal('undefined'));
      case 'TryStatement': {
        const handlers = node.CatchClauses ?? (node.Catch ? [node.Catch] : []);
        // Expressions and cleanup can throw without an explicit throw node.
        const incoming = [...visit(node.Block).filter((outcome) => !handlers.length || outcome.kind !== 'throw'),
          ...handlers.flatMap((handler) => visit(handler.Block))];
        if (!node.Finally) return updateEmpty(incoming, normal('undefined'));
        const final = visit(node.Finally);
        return updateEmpty(unique(incoming.flatMap((outcome) => final.map((ending) => ending.kind === 'normal' ? { ...outcome, effects: [...outcome.effects, node.Finally!] } : ending))), normal('undefined'));
      }
      case 'SwitchStatement': {
        const block = node.CaseBlock;
        const clauses = [...(block.CaseClauses_a ?? []), ...(block.DefaultClause ? [block.DefaultClause] : []), ...(block.CaseClauses_b ?? [])];
        const outcomes: Outcome[] = block.DefaultClause || covers?.(node) ? [] : [normal('undefined')];
        for (let index = 0; index < clauses.length; index += 1) {
          outcomes.push(...sequence(clauses.slice(index).flatMap((clause) => clause.StatementList ?? []), [normal('undefined')])
            .map((outcome) => outcome.kind === 'break' && !outcome.target ? { ...outcome, kind: 'normal' as const } : outcome));
        }
        return unique(outcomes);
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'ForAwaitStatement':
      case 'WhileStatement': case 'DoWhileStatement': {
        // The iteration count and last value are not established by this
        // bounded summary. Keep outgoing targeted exits without guessing it.
        const body = visit(node.Statement);
        return unique([normal('unknown'), ...body.filter((outcome) => outcome.kind === 'return' || outcome.kind === 'throw'
          || ((outcome.kind === 'break' || outcome.kind === 'continue') && outcome.target))]);
      }
      case 'EmptyStatement': case 'DebuggerStatement': case 'VariableStatement': case 'LexicalDeclaration':
      case 'FunctionDeclaration': case 'ClassDeclaration': case 'TypeAliasDeclaration': case 'InterfaceDeclaration':
        return [normal('empty', [node])];
      default: return [normal('unknown')];
    }
  };
  const outcomes = sequence(list).filter((outcome) => outcome.kind === 'normal');
  // Budget exhaustion must never turn an unexplored path into a proof.
  return budget < 0 ? [normal('unknown')] : unique(outcomes);
}

export function CompletionValues(list: readonly ParseNode[] = [], covers?: (node: ParseNode) => boolean,
  nonReturning?: (node: ParseNode) => boolean): readonly ValueSource[] {
  return [...new Set(CompletionPaths(list, covers, nonReturning).map((path) => path.value))];
}
