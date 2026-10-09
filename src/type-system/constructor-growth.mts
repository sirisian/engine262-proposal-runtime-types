import type { ParseNode } from '../parser/ParseNode.mts';
import type { Known } from './records.mts';

export interface ConstructorDependency<T> {
  target: T;
  constructed: boolean;
}

/** The caller resolves stable declaration identities and compatible parameters. */
export function LiteralConstructorEquation<T>(fn: ParseNode.FunctionDeclaration, parameters: readonly Known[], resolve: (name: string) => T | undefined): ConstructorDependency<T>[] | undefined {
  if (fn.TypeAnnotation || fn.TypeParameters || fn.Decorators?.length || !fn.BindingIdentifier) return undefined;
  const names: string[] = [];
  for (const formal of fn.FormalParameters) {
    if (formal.type !== 'SingleNameBinding' || formal.Initializer || formal.BindingIdentifier?.type !== 'BindingIdentifier') return undefined;
    names.push(formal.BindingIdentifier.name);
  }
  const list = fn.FunctionBody.FunctionStatementList;
  if (list?.length !== 1 || list[0].type !== 'ReturnStatement' || !list[0].Expression) return undefined;

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
  const dependencies: ConstructorDependency<T>[] = [];
  const contribution = (node: ParseNode, constructed = false): boolean => {
    node = unwrap(node);
    switch (node.type) {
      case 'NullLiteral':
      case 'BooleanLiteral':
      case 'NumericLiteral':
      case 'StringLiteral': return true;
      case 'CallExpression': {
        const callee = unwrap(node.CallExpression);
        if (callee.type !== 'IdentifierReference' || names.includes(callee.name) || node.Arguments.length !== names.length
          || !node.Arguments.every((arg, i) => arg.type === 'IdentifierReference' && arg.name === names[i])) return false;
        const target = resolve(callee.name);
        if (target === undefined) return false;
        dependencies.push({ target, constructed });
        return true;
      }
      case 'ArrayLiteral': {
        return node.ElementList.length === 1 && contribution(node.ElementList[0], true);
      }
      case 'ObjectLiteral': {
        if (node.Decorators?.length || node.PropertyDefinitionList.length !== 1) return false;
        const property = node.PropertyDefinitionList[0];
        if (property.type !== 'PropertyDefinition' || property.TypeAnnotation
          || property.PropertyName?.type !== 'IdentifierName' || property.PropertyName.name === '__proto__') return false;
        return contribution(property.AssignmentExpression, true);
      }
      case 'ConditionalExpression': {
        return independentTest(node.ShortCircuitExpression)
          && contribution(node.AssignmentExpression_a, constructed) && contribution(node.AssignmentExpression_b, constructed);
      }
      default: return false;
    }
  };
  return contribution(list[0].Expression) ? dependencies : undefined;
}

/**
 * A closed component grows if a cycle retains a result below a constructor.
 * Unsupported outgoing equations invalidate the proof, including unknown
 * absorption. Merely reaching a constructor or a copy cycle is insufficient.
 */
export function FindConstructorGrowth<T>(roots: readonly T[], equation: (item: T) => readonly ConstructorDependency<T>[] | undefined): Set<T> {
  const equations = new Map<T, readonly ConstructorDependency<T>[] | undefined>();
  const callers = new Map<T, T[]>();
  const queue = [...roots];
  const invalid = new Set<T>();
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    if (equations.has(item)) continue;
    const edges = equation(item);
    equations.set(item, edges);
    if (!edges) invalid.add(item);
    for (const { target } of edges ?? []) {
      if (!callers.has(target)) callers.set(target, []);
      callers.get(target)!.push(item);
      queue.push(target);
    }
  }
  for (const item of invalid) for (const caller of callers.get(item) ?? []) invalid.add(caller);

  // Iterative Kosaraju traversal keeps graph depth off the native call stack.
  const visited = new Set<T>(invalid);
  const order: T[] = [];
  for (const start of equations.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ item: start, index: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = equations.get(top.item)!;
      if (top.index === edges.length) {
        order.push(top.item);
        stack.pop();
      } else {
        const { target } = edges[top.index++];
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ item: target, index: 0 });
        }
      }
    }
  }
  const components = new Map<T, number>();
  for (const start of order.reverse()) {
    if (components.has(start)) continue;
    const id = components.size;
    const stack = [start];
    components.set(start, id);
    while (stack.length) {
      for (const caller of callers.get(stack.pop()!) ?? []) {
        if (invalid.has(caller) || components.has(caller)) continue;
        components.set(caller, id);
        stack.push(caller);
      }
    }
  }
  const growing = new Set<number>();
  for (const [item, id] of components) {
    if (equations.get(item)!.some(({ target, constructed }) => constructed && components.get(target) === id)) growing.add(id);
  }
  return new Set([...components].filter(([, id]) => growing.has(id)).map(([item]) => item));
}
