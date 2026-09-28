import type { ParseNode } from '../parser/ParseNode.mts';

type ValueSource = ParseNode.ExpressionStatement | 'empty' | 'undefined' | 'unknown';
interface Outcome {
  kind: 'normal' | 'break' | 'continue' | 'return' | 'throw';
  target?: string;
  value: ValueSource;
}

/** #sec-completiontypeof: retain UpdateEmpty values across targeted exits. */
export function CompletionValues(list: readonly ParseNode[] = [], covers?: (node: ParseNode) => boolean): readonly ValueSource[] {
  const normal = (value: ValueSource = 'empty'): Outcome => ({ kind: 'normal', value });
  const unique = (outcomes: Outcome[]): Outcome[] => outcomes.filter((item, index) =>
    outcomes.findIndex((other) => other.kind === item.kind && other.target === item.target && other.value === item.value) === index);
  const updateEmpty = (outcomes: Outcome[], value: ValueSource): Outcome[] => outcomes.map((outcome) =>
    outcome.value === 'empty' ? { ...outcome, value } : outcome);
  let budget = 4096;
  const sequence = (statements: readonly ParseNode[], initial: Outcome[] = [normal()]): Outcome[] => {
    let outcomes = initial;
    for (const statement of statements) {
      if (!outcomes.some((outcome) => outcome.kind === 'normal')) break;
      const next = visit(statement);
      outcomes = unique(outcomes.flatMap((outcome) => outcome.kind === 'normal' ? updateEmpty(next, outcome.value) : [outcome]));
    }
    return outcomes;
  };
  const visit = (node: ParseNode): Outcome[] => {
    if (--budget < 0) return [normal('unknown')];
    switch (node.type) {
      case 'ExpressionStatement': return [normal(node)];
      case 'BreakStatement': return [{ kind: 'break', target: node.LabelIdentifier?.name, value: 'empty' }];
      case 'ContinueStatement': return [{ kind: 'continue', target: node.LabelIdentifier?.name, value: 'empty' }];
      case 'ReturnStatement': return [{ kind: 'return', value: 'unknown' }];
      case 'ThrowStatement': return [{ kind: 'throw', value: 'unknown' }];
      case 'Block': return sequence(node.StatementList ?? []);
      case 'LabelledStatement':
        return visit(node.LabelledItem).map((outcome) => outcome.kind === 'break' && outcome.target === node.LabelIdentifier.name
          ? normal(outcome.value) : outcome);
      case 'IfStatement':
        return updateEmpty([...visit(node.Statement_a), ...(node.Statement_b ? visit(node.Statement_b) : [normal()])], 'undefined');
      case 'TryStatement': {
        const handlers = node.CatchClauses ?? (node.Catch ? [node.Catch] : []);
        // Expressions and cleanup can throw without an explicit throw node.
        const incoming = [...visit(node.Block).filter((outcome) => !handlers.length || outcome.kind !== 'throw'),
          ...handlers.flatMap((handler) => visit(handler.Block))];
        if (!node.Finally) return updateEmpty(incoming, 'undefined');
        const final = visit(node.Finally);
        return updateEmpty(unique(incoming.flatMap((outcome) => final.map((ending) => ending.kind === 'normal' ? outcome : ending))), 'undefined');
      }
      case 'SwitchStatement': {
        const block = node.CaseBlock;
        const clauses = [...(block.CaseClauses_a ?? []), ...(block.DefaultClause ? [block.DefaultClause] : []), ...(block.CaseClauses_b ?? [])];
        const outcomes: Outcome[] = block.DefaultClause || covers?.(node) ? [] : [normal('undefined')];
        for (let index = 0; index < clauses.length; index += 1) {
          outcomes.push(...sequence(clauses.slice(index).flatMap((clause) => clause.StatementList ?? []), [normal('undefined')])
            .map((outcome) => outcome.kind === 'break' && !outcome.target ? normal(outcome.value) : outcome));
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
        return [normal()];
      default: return [normal('unknown')];
    }
  };
  const outcomes = sequence(list).filter((outcome) => outcome.kind === 'normal');
  // Budget exhaustion must never turn an unexplored path into a proof.
  return budget < 0 ? ['unknown'] : [...new Set(outcomes.map((outcome) => outcome.value))];
}
