import type { ParseNode } from '../parser/ParseNode.mts';
import type { Known } from './records.mts';

/**
 * A sufficient proof for R = C[R] | S with finite literal seeds S and only
 * literal array/object constructors C. Unsupported transfers supply no proof.
 * The caller must establish the identity and stability of the self binding.
 */
export function HasLiteralConstructorGrowth(fn: ParseNode.FunctionDeclaration, parameters: readonly Known[]): boolean {
  if (fn.TypeAnnotation || fn.TypeParameters || fn.Decorators?.length || !fn.BindingIdentifier) return false;
  const name = fn.BindingIdentifier.name;
  const names: string[] = [];
  for (const formal of fn.FormalParameters) {
    if (formal.type !== 'SingleNameBinding' || formal.Initializer || formal.BindingIdentifier?.type !== 'BindingIdentifier') return false;
    names.push(formal.BindingIdentifier.name);
  }
  if (names.includes(name)) return false;
  const list = fn.FunctionBody.FunctionStatementList;
  if (list?.length !== 1 || list[0].type !== 'ReturnStatement' || !list[0].Expression) return false;

  const unwrap = (node: ParseNode): ParseNode => node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
  const independentTest = (node: ParseNode): boolean => {
    node = unwrap(node);
    if (node.type === 'IdentifierReference') {
      const type = parameters[names.indexOf(node.name)];
      return type?.Kind === 'primitive' && type.Name === 'boolean';
    }
    if (node.type !== 'RelationalExpression' || node.operator !== '>' || !node.RelationalExpression) return false;
    const left = unwrap(node.RelationalExpression);
    const right = unwrap(node.ShiftExpression);
    if (left.type !== 'IdentifierReference' || right.type !== 'NumericLiteral'
      || !['0', '1'].includes(right.SourceText ?? '')) return false;
    const type = parameters[names.indexOf(left.name)];
    return type?.Kind === 'primitive' && (type.Name === 'number'
      || ['uint', 'int'].includes(type.Name) && type.Arguments[0] === 32);
  };
  // -1: unsupported, 0: finite constant, 1: an unwrapped recursive result,
  // 2: a recursive result below at least one preserved constructor.
  const contribution = (node: ParseNode): number => {
    node = unwrap(node);
    switch (node.type) {
      case 'NullLiteral':
      case 'BooleanLiteral':
      case 'NumericLiteral':
      case 'StringLiteral': return 0;
      case 'CallExpression': {
        const callee = unwrap(node.CallExpression);
        if (callee.type !== 'IdentifierReference' || callee.name !== name || node.Arguments.length !== names.length) return -1;
        return node.Arguments.every((arg, i) => arg.type === 'IdentifierReference' && arg.name === names[i]) ? 1 : -1;
      }
      case 'ArrayLiteral': {
        if (node.ElementList.length !== 1) return -1;
        const child = contribution(node.ElementList[0]);
        return child < 0 ? -1 : child > 0 ? 2 : 0;
      }
      case 'ObjectLiteral': {
        if (node.Decorators?.length || node.PropertyDefinitionList.length !== 1) return -1;
        const property = node.PropertyDefinitionList[0];
        if (property.type !== 'PropertyDefinition' || property.TypeAnnotation
          || property.PropertyName?.type !== 'IdentifierName' || property.PropertyName.name === '__proto__') return -1;
        const child = contribution(property.AssignmentExpression);
        return child < 0 ? -1 : child > 0 ? 2 : 0;
      }
      case 'ConditionalExpression': {
        if (!independentTest(node.ShortCircuitExpression)) return -1;
        const yes = contribution(node.AssignmentExpression_a);
        const no = contribution(node.AssignmentExpression_b);
        return yes < 0 || no < 0 ? -1 : Math.max(yes, no);
      }
      default: return -1;
    }
  };
  return contribution(list[0].Expression) === 2;
}
