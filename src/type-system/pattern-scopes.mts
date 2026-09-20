import type { ParseNode } from '../parser/ParseNode.mts';

/** #sec-is-pattern: binding sites, including the bindings of structural patterns. */
export function PatternBindingNames(pattern: ParseNode.MatchPattern | null): ParseNode.MatchBindingPattern[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'MatchBindingPattern': return [pattern];
    case 'MatchAndPattern':
    case 'MatchOrPattern': return [...PatternBindingNames(pattern.Left), ...PatternBindingNames(pattern.Right)];
    case 'MatchNotPattern': return PatternBindingNames(pattern.Operand);
    case 'MatchObjectPattern': return [...pattern.Properties.flatMap((property) => PatternBindingNames(property.Pattern)),
      ...PatternBindingNames(pattern.Rest ?? null)];
    case 'MatchArrayPattern': return pattern.Elements.flatMap(PatternBindingNames);
    case 'MatchExtractorPattern': return pattern.Elements.flatMap(PatternBindingNames);
    // A juxtaposition binds whatever its SHAPE binds; the head is a type and
    // binds nothing. Without this the bindings were never declared and
    // `when P { x: let n }` brought the engine down rather than binding `n`.
    case 'MatchJuxtapositionPattern': return PatternBindingNames(pattern.Shape);
    default: return [];
  }
}

type Sites = readonly ParseNode.IsExpression[];
export function ForPatternPositions(node: ParseNode.ForStatement) {
  return node.LexicalDeclaration || node.VariableDeclarationList
    ? { test: node.Expression_a, update: node.Expression_b }
    : { test: node.Expression_b, update: node.Expression_c };
}
const outcomes = new WeakMap<ParseNode, [Sites, Sites]>();
const scopes = new WeakMap<ParseNode, Sites>();
const union = (a: Sites, b: Sites): Sites => [...new Set([...a, ...b])];
const intersection = (a: Sites, b: Sites): Sites => a.filter((site) => b.includes(site));

/** The successful matches guaranteed by a Boolean path, without executing it. */
export function PatternBindingsWhen(test: ParseNode, truth: boolean): Sites {
  let pair = outcomes.get(test);
  if (!pair) {
    switch (test.type) {
      case 'ParenthesizedExpression':
        pair = [PatternBindingsWhen(test.Expression, false), PatternBindingsWhen(test.Expression, true)];
        break;
      case 'UnaryExpression':
        pair = test.operator === '!'
          ? [PatternBindingsWhen(test.UnaryExpression, true), PatternBindingsWhen(test.UnaryExpression, false)] : [[], []];
        break;
      case 'IsExpression':
        pair = [[], PatternBindingNames(test.Pattern ?? null).length ? [test] : []];
        break;
      case 'LogicalANDExpression': {
        const leftTrue = PatternBindingsWhen(test.LogicalANDExpression, true);
        pair = [intersection(PatternBindingsWhen(test.LogicalANDExpression, false),
          union(leftTrue, PatternBindingsWhen(test.BitwiseORExpression, false))),
        union(leftTrue, PatternBindingsWhen(test.BitwiseORExpression, true))];
        break;
      }
      case 'LogicalORExpression': {
        const leftFalse = PatternBindingsWhen(test.LogicalORExpression, false);
        pair = [union(leftFalse, PatternBindingsWhen(test.LogicalANDExpression, false)),
          intersection(PatternBindingsWhen(test.LogicalORExpression, true),
            union(leftFalse, PatternBindingsWhen(test.LogicalANDExpression, true)))];
        break;
      }
      default: pair = [[], []];
    }
    outcomes.set(test, pair);
  }
  return pair[truth ? 1 : 0];
}

/** #sec-narrowing: positions entered only after a particular test outcome. */
export function PatternScopeOf(node: ParseNode): Sites {
  const cached = scopes.get(node);
  if (cached) return cached;
  const parent = node.parent;
  let sites: Sites = [];
  if (parent) {
    switch (parent.type) {
      case 'IfStatement':
        if (node === parent.Statement_a || node === parent.Statement_b) sites = PatternBindingsWhen(parent.Expression, node === parent.Statement_a);
        break;
      case 'WhileStatement':
        if (node === parent.Statement) sites = PatternBindingsWhen(parent.Expression, true);
        break;
      case 'ForStatement': {
        const { test, update } = ForPatternPositions(parent);
        if (test && (node === parent.Statement || node === update)) sites = PatternBindingsWhen(test, true);
        break;
      }
      case 'ConditionalExpression':
        if (node === parent.AssignmentExpression_a || node === parent.AssignmentExpression_b) {
          sites = PatternBindingsWhen(parent.ShortCircuitExpression, node === parent.AssignmentExpression_a);
        }
        break;
      case 'LogicalANDExpression':
        if (node === parent.BitwiseORExpression) sites = PatternBindingsWhen(parent.LogicalANDExpression, true);
        break;
      case 'LogicalORExpression':
        if (node === parent.LogicalANDExpression) sites = PatternBindingsWhen(parent.LogicalORExpression, false);
        break;
      default: break;
    }
  }
  scopes.set(node, sites);
  return sites;
}

export function PatternHasGovernedPosition(site: ParseNode.IsExpression): boolean {
  for (let parent = site.parent; parent; parent = parent.parent) {
    const positions: ParseNode[] = [];
    switch (parent.type) {
      case 'IfStatement': positions.push(parent.Statement_a, ...(parent.Statement_b ? [parent.Statement_b] : [])); break;
      case 'WhileStatement': positions.push(parent.Statement); break;
      case 'ForStatement': {
        const { update } = ForPatternPositions(parent);
        positions.push(parent.Statement, ...(update ? [update] : []));
        break;
      }
      case 'ConditionalExpression': positions.push(parent.AssignmentExpression_a, parent.AssignmentExpression_b); break;
      case 'LogicalANDExpression': positions.push(parent.BitwiseORExpression); break;
      case 'LogicalORExpression': positions.push(parent.LogicalANDExpression); break;
      case 'ParenthesizedExpression': break;
      case 'UnaryExpression': if (parent.operator !== '!') return false; break;
      default: return false;
    }
    if (positions.some((position) => PatternScopeOf(position).includes(site))) return true;
  }
  return false;
}
