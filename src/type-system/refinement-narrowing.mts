import type { ParseNode } from '../parser/ParseNode.mts';

/** A source path, not an evaluation of a candidate or a computed key. */
export function RefinementPath(node: ParseNode): readonly string[] | undefined {
  if (node.type === 'ParenthesizedExpression') return RefinementPath(node.Expression);
  if (node.type === 'ThisExpression') return [];
  if (node.type !== 'MemberExpression') return undefined;
  const base = RefinementPath(node.MemberExpression);
  const key = node.IdentifierName?.name
    ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : undefined);
  return base && typeof key === 'string' ? [...base, key] : undefined;
}

export interface RefinementProjection {
  /** Undefined means that the existing facts do not decide this test. */
  decide(node: ParseNode): boolean | undefined;
  decidePattern(subject: ParseNode, pattern: ParseNode.MatchPattern): boolean | undefined;
  assert(node: ParseNode): void;
}

/** Bound propagation by source assertions, including those in one conjunction,
 * rather than by the number of where keywords. */
export function RefinementProjectionSize(predicate: ParseNode): number {
  if (predicate.type === 'ParenthesizedExpression') return RefinementProjectionSize(predicate.Expression);
  if (predicate.type === 'ConditionalRefinement') return RefinementProjectionSize(predicate.Consequent)
    + (predicate.Alternate ? RefinementProjectionSize(predicate.Alternate) : 0);
  if (predicate.type === 'LogicalANDExpression') return RefinementProjectionSize(predicate.LogicalANDExpression)
    + RefinementProjectionSize(predicate.BitwiseORExpression);
  if (predicate.type === 'MatchExpression') return predicate.Clauses.reduce((total, clause) => total + RefinementProjectionSize(clause.Body), 0);
  return 1;
}

/** Select source branches without running predicates, helpers or builders.
 * An unknown earlier match clause prevents selecting a later one. */
export function ProjectRefinement(predicate: ParseNode, projection: RefinementProjection): void {
  if (predicate.type === 'ParenthesizedExpression') {
    ProjectRefinement(predicate.Expression, projection);
  } else if (predicate.type === 'ConditionalRefinement') {
    const decision = projection.decide(predicate.Test);
    const branch = decision === true ? predicate.Consequent : decision === false ? predicate.Alternate : undefined;
    if (branch) ProjectRefinement(branch, projection);
  } else if (predicate.type === 'MatchExpression' && !predicate.All) {
    for (const clause of predicate.Clauses) {
      const decision = clause.Pattern ? projection.decidePattern(predicate.Expression, clause.Pattern) : true;
      if (decision === undefined) return;
      if (!decision) continue;
      if (clause.Guard) {
        const guard = projection.decide(clause.Guard);
        if (guard === undefined) return;
        if (!guard) continue;
      }
      // Block arms can contain effects and bindings. They supply no projection.
      if (!clause.IsThrow && !clause.IsBlock) ProjectRefinement(clause.Body, projection);
      return;
    }
  } else if (predicate.type === 'LogicalANDExpression') {
    ProjectRefinement(predicate.LogicalANDExpression, projection);
    ProjectRefinement(predicate.BitwiseORExpression, projection);
  } else {
    projection.assert(predicate);
  }
}
