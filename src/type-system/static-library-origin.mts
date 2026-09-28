import { ObjectValue, Value, wellKnownSymbols } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';
import { OriginalLibraryFunction } from './library-operation-origin.mts';

export interface StaticLibraryOperation {
  readonly owner: string;
  readonly name: string;
  readonly generic: boolean;
  readonly positions?: number;
}

/**
 * #sec-proved-library-operations: a bounded proof over actual function origins.
 * All bodies and argument effects are screened; calls in future invocations
 * and any unavailable effects retain runtime checking. Composite positions
 * come from immutable tuple creation, never from mutable indexed storage.
 */
export function ProvenStaticLibraryOperations(
  root: ParseNode, realm: Realm,
  inertAnnotation: (node: ParseNode.TypeAnnotation) => boolean,
  inertTuple: (node: ParseNode.Type, length: number) => boolean,
): ReadonlyMap<ParseNode, StaticLibraryOperation> {
  const nodes: ParseNode[] = [];
  const definitions = new Map<string, ParseNode[]>();
  const mutated = new Set<string>();
  const unwrap = (node: ParseNode): ParseNode => node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    nodes.push(node);
    if (node.type === 'BindingIdentifier' && node.parent) definitions.set(node.name, [...(definitions.get(node.name) ?? []), node.parent]);
    const target = node.type === 'AssignmentExpression' ? unwrap(node.LeftHandSideExpression)
      : node.type === 'UpdateExpression' ? unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!) : null;
    if (target?.type === 'IdentifierReference') mutated.add(target.name);
    for (const [key, child] of Object.entries(node)) if (!['parent', 'location', 'sourceText'].includes(key)) visit(child);
  };
  visit(root);
  const topLevel = (node: ParseNode): boolean => {
    for (let p = node.parent; p; p = p.parent) if (/Function|Arrow|Method|Class/.test(p.type)) return false;
    return true;
  };
  const global = (name: string): boolean => !definitions.has(name) && !mutated.has(name)
    && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
    && intrinsicData(realm.GlobalObject, Value(name)) === (realm.Intrinsics as unknown as Record<string, Value>)[`%${name}%`];
  const initializer = (expression: ParseNode, seen = new Set<ParseNode>(), preserveAnnotations = false): ParseNode => {
    const node = unwrap(expression);
    if (node.type !== 'IdentifierReference' || mutated.has(node.name) || seen.has(node)) return node;
    seen.add(node);
    const declarations = definitions.get(node.name);
    const declaration = declarations?.length === 1 ? declarations[0] : undefined;
    return declaration?.type === 'LexicalBinding' && declaration.parent?.type === 'LexicalDeclaration'
      && declaration.parent.LetOrConst === 'const' && declaration.Initializer && topLevel(declaration)
      && !(preserveAnnotations && declaration.TypeAnnotation)
      ? initializer(declaration.Initializer, seen, preserveAnnotations) : node;
  };
  const scalar = (expression: ParseNode): boolean => {
    const node = initializer(expression);
    return ['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral'].includes(node.type)
      || (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator) && node.UnaryExpression.type === 'NumericLiteral')
      || (node.type === 'IdentifierReference' && node.name === 'undefined' && !definitions.has(node.name)
        && intrinsicData(realm.GlobalObject, Value(node.name)) === Value.undefined);
  };
  const literalData = (expression: ParseNode): boolean => {
    const node = unwrap(expression);
    if (scalar(node)) return true;
    if (node.type === 'ArrayLiteral') return node.ElementList.every((e) => !!e && scalar(e));
    return node.type === 'ObjectLiteral' && node.PropertyDefinitionList.every((p) => p.type === 'PropertyDefinition'
      && p.PropertyName?.type === 'IdentifierName' && p.PropertyName.name !== '__proto__'
      && !!p.AssignmentExpression && scalar(p.AssignmentExpression));
  };
  const composite = (expression: ParseNode): number | undefined => {
    const node = initializer(expression);
    if (node.type !== 'CallExpression' || node.Arguments.length !== 1 || !global('Composite')) return undefined;
    const callee = unwrap(node.CallExpression);
    if (callee.type !== 'TypeArgumentsExpression' || callee.Expression.type !== 'IdentifierReference' || callee.Expression.name !== 'Composite') return undefined;
    const source = unwrap(node.Arguments[0]);
    const args = callee.TypeArguments.TypeArgumentList;
    return source.type === 'ArrayLiteral' && literalData(source) && args.length === 1 && inertTuple(args[0], source.ElementList.length)
      ? source.ElementList.length : undefined;
  };
  const scalarIterationAbsent = (): boolean => {
    // Boxing uses these mutable prototype chains, even for a sized integer.
    // Inspect ordinary descriptors without invoking inherited accessors.
    for (const name of ['Number', 'BigInt', 'Boolean', 'Symbol']) {
      let prototype: Value = (realm.Intrinsics as unknown as Record<string, Value>)[`%${name}.prototype%`];
      const seen = new Set<Value>();
      while (prototype instanceof ObjectValue && !seen.has(prototype)) {
        seen.add(prototype);
        if (prototype.Get !== ObjectValue.prototype.Get || prototype.properties.has(wellKnownSymbols.iterator)) return false;
        prototype = (prototype as ObjectValue & { Prototype: Value }).Prototype;
      }
      if (prototype !== Value.null) return false;
    }
    return true;
  };
  const selected = (expression: ParseNode): StaticLibraryOperation | undefined => {
    const node = initializer(expression, new Set(), true);
    if (node.type !== 'MemberExpression') return undefined;
    const owner = unwrap(node.MemberExpression);
    const name = node.IdentifierName?.name ?? (node.Expression?.type === 'StringLiteral' ? node.Expression.value : undefined);
    if (owner.type !== 'IdentifierReference' || !name || !global(owner.name) || !OriginalLibraryFunction(realm, `%${owner.name}%`, name)) return undefined;
    const generic = !(owner.name === 'Object' && name === 'keys');
    if (!generic || (owner.name === 'Promise' && ['all', 'race', 'any', 'allSettled'].includes(name))
        || (owner.name === 'Array' && ['from', 'fromAsync', 'of'].includes(name))
        || (['Map', 'Object'].includes(owner.name) && name === 'groupBy')) return { owner: owner.name, name, generic };
    return undefined;
  };
  const callback = (expression: ParseNode): boolean => {
    const node = initializer(expression);
    return scalar(node) || node.type === 'ArrowFunction' || node.type === 'FunctionExpression';
  };
  const safe = (node: ParseNode): boolean => {
    if (node.type === 'MemberExpression') return node.parent?.type !== 'AssignmentExpression' && !!selected(node);
    if (node.type === 'TypeArgumentsExpression') return !!selected(node.Expression) || (!!node.parent && composite(node.parent) !== undefined);
    if (node.type !== 'CallExpression') return false;
    if (composite(node) !== undefined) return true;
    const callee = unwrap(node.CallExpression);
    const operation = selected(callee.type === 'TypeArgumentsExpression' ? callee.Expression : callee);
    if (!operation) return false;
    if (!operation.generic || operation.name === 'of') return node.Arguments.every(literalData);
    if (operation.owner === 'Promise') return callee.type === 'MemberExpression'
      && OriginalLibraryFunction(realm, '%Promise%', 'resolve') && scalarIterationAbsent()
      && node.Arguments.length === 1 && scalar(node.Arguments[0]);
    if (operation.name === 'groupBy' && intrinsicData(realm.Intrinsics['%ArrayIteratorPrototype%'], Value('next'))
        !== realm.Intrinsics['%ArrayIteratorPrototype.next%']) return false;
    return node.Arguments.length >= 1 && node.Arguments.length <= 3
      && composite(node.Arguments[0]) !== undefined
      && (!node.Arguments[1] || callback(node.Arguments[1])) && (!node.Arguments[2] || scalar(node.Arguments[2]));
  };
  if (nodes.some((node) => (node.type === 'TypeAnnotation' && !inertAnnotation(node))
      || (node.type === 'CallExpression' && !safe(node)) || node.type === 'NewExpression'
      || (node.type === 'AssignmentExpression' && node.LeftHandSideExpression.type === 'MemberExpression'
        && ['Array', 'Object', 'Map', 'Promise', 'Composite'].includes(node.LeftHandSideExpression.IdentifierName?.name
          ?? (node.LeftHandSideExpression.Expression?.type === 'StringLiteral' ? node.LeftHandSideExpression.Expression.value : ''))))
      || !intrinsicSourceIsStable(root, realm, safe)) return new Map();
  const result = new Map<ParseNode, StaticLibraryOperation>();
  for (const node of nodes) {
    if (!topLevel(node)) continue;
    if (node.type === 'TypeArgumentsExpression') {
      const operation = selected(node.Expression);
      if (operation) result.set(node, operation);
    }
    if (node.type === 'CallExpression' && safe(node)) {
      const callee = unwrap(node.CallExpression);
      const operation = selected(callee.type === 'TypeArgumentsExpression' ? callee.Expression : callee);
      if (operation) result.set(node, { ...operation, positions: node.Arguments[0] ? composite(node.Arguments[0]) : undefined });
    }
  }
  return result;
}
