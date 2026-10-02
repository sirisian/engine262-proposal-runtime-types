import type { ParseNode } from './ParseNode.mts';

/**
 * The syntax this proposal adds to ECMAScript. Every production here is a
 * Syntax Error in the pinned edition, so no program written without the
 * proposal contains one, and its presence is what opts a unit into the checks
 * that read types inferred from code (#sec-checked-code).
 */
export const ProposalNodeTypes: ReadonlySet<string> = new Set([
  'AbstractMethodDefinition', 'ArrayType', 'CaptureBinding', 'ComputedType', 'ConditionalRefinement',
  'ConstantExpression', 'ContractReturn', 'DecoratedExpression', 'Decorator', 'DoExpression', 'EnumDeclaration',
  'EnumMember', 'FunctionType', 'FunctionTypeParameter', 'IndexSignature', 'IndexedAccessType',
  'InterfaceDeclaration', 'IntersectionType', 'IsExpression', 'KeyOfType', 'LiteralType', 'MatchAndPattern',
  'MatchArrayPattern', 'MatchBindingPattern', 'MatchClause', 'MatchExpression', 'MatchExtractorPattern',
  'MatchInterpolationPattern', 'MatchJuxtapositionPattern', 'MatchLiteralPattern', 'MatchNotPattern',
  'MatchObjectPattern', 'MatchOrPattern', 'MatchProperty', 'MatchRangePattern', 'MatchRegExpPattern',
  'MatchTypePattern', 'MatchWildcardPattern', 'MetaDeclaration', 'MetaDefaultHook', 'MethodSignature',
  'ModedRegion', 'NamedArgument', 'ObjectType', 'OperatorDefinition', 'ParameterizedType', 'ParenthesizedType',
  'PatternType', 'PipelineExpression', 'PredefinedType', 'PrimitiveOperatorDeclaration', 'RangeExpression',
  'RangeType', 'RefExpression', 'RefRebindingStatement', 'ReferenceType', 'SharedType', 'SpecializationEntry',
  'TargetTypedNew', 'TopicReference', 'TupleElement', 'TupleType', 'TypeAliasDeclaration', 'TypeAnnotation',
  'TypeArguments', 'TypeArgumentsExpression', 'TypeMember', 'TypeName', 'TypeOperatorExpression',
  'TypeParameter', 'TypeParameters', 'TypeReference', 'TypedConversionExpression', 'TypedInitializer',
  'UnionType', 'WhereClause',
]);

/** Fields this proposal adds to nodes ECMAScript already has. */
const proposalFields = ['Ref', 'ClassModifiers', 'ImplementsClause', 'protected', 'Partial', 'PlacementArguments'] as const;

/**
 * Whether a node is proposal syntax on its own: a node type this proposal
 * adds, or an existing node carrying one of its fields. Decorators are nodes
 * of their own type, so a decorator counts where it is written.
 */
export function IsProposalSyntax(node: ParseNode): boolean {
  if (ProposalNodeTypes.has(node.type)) {
    return true;
  }
  const fields = node as unknown as Record<string, unknown>;
  for (const key of proposalFields) {
    const value = fields[key];
    if (value === undefined || value === null || value === false) continue;
    // A placement `new` with an empty argument list is still placement syntax.
    if (Array.isArray(value) && value.length === 0 && key !== 'PlacementArguments') continue;
    return true;
  }
  return false;
}
