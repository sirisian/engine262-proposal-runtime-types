import type { ParseNode } from '../parser/ParseNode.mts';
import { ContainsExpression } from '../static-semantics/ContainsExpression.mts';
import { IsSimpleParameterList } from '../static-semantics/IsSimpleParameterList.mts';

type Node = ParseNode & Record<string, unknown>;
interface Scope {
  readonly outer?: Scope;
  readonly names: Set<string>;
  readonly writes: Set<string>;
  readonly capturedWrites: Set<string>;
  variable: Scope;
  callable: Scope;
  argumentsOwner?: Scope;
  mappedParameters?: Set<string>;
}
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object'
  && typeof (value as { type?: unknown }).type === 'string';
const skip = new Set(['parent', 'location', 'sourceText', 'strict']);
const parameters = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'];
const bodies = ['FunctionBody', 'ConciseBody', 'AsyncConciseBody', 'GeneratorBody', 'AsyncBody', 'AsyncGeneratorBody'];
const functions = new Set(['FunctionDeclaration', 'GeneratorDeclaration', 'AsyncFunctionDeclaration', 'AsyncGeneratorDeclaration']);
const expressions = new Set(['FunctionExpression', 'GeneratorExpression', 'AsyncFunctionExpression', 'AsyncGeneratorExpression']);
const declarations = new Set(['ClassDeclaration', 'TypeAliasDeclaration', 'InterfaceDeclaration', 'EnumDeclaration', 'MetaDeclaration']);
const loops = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement']);

/** Binding targets only: defaults, computed keys and annotations declare no names here. */
function bindingNames(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((child) => bindingNames(child, result));
  else if (isNode(value)) {
    if (value.type === 'BindingIdentifier') result.push(value.name as string);
    else for (const key of ['BindingIdentifier', 'BindingPattern', 'BindingList', 'VariableDeclarationList', 'ForBinding',
      'BindingElement', 'BindingElementList', 'BindingPropertyList', 'BindingRestElement', 'BindingRestProperty',
      'ImportClause', 'ImportedDefaultBinding', 'NameSpaceImport', 'NamedImports', 'ImportsList', 'ImportedBinding']) {
      bindingNames(value[key], result);
    }
  }
  return result;
}

/**
 * #sec-elision-stability: replacement is a property of a lexical binding, not
 * of its spelling. Build scopes before resolving writes, so hoisting and TDZ
 * shadowing do not depend on traversal order. No program value is inspected.
 * Undefined leaves the caller's existing conservative screen in place.
 */
export function LexicalMutationAnalysis(root: ParseNode): {
  unassigned: (node: ParseNode, name: string) => boolean | undefined,
  capturedWrite: (node: ParseNode, name: string) => boolean | undefined,
  exposedParameters: ReadonlySet<string>,
} {
  const scopes = new WeakMap<ParseNode, Scope>();
  const writes: { node: ParseNode, name: string }[] = [];
  const uncertain = new Set<string>();
  const globalObjectNames = new Set<string>();
  let dynamic = false;
  const argumentsExposed = new Set<Scope>();
  const makeScope = (outer?: Scope, variable = false): Scope => {
    const scope = { outer, names: new Set<string>(), writes: new Set<string>(), capturedWrites: new Set<string>() } as Scope;
    scope.variable = variable || !outer ? scope : outer.variable;
    scope.callable = outer?.callable ?? scope;
    scope.argumentsOwner = outer?.argumentsOwner;
    return scope;
  };
  const declare = (target: unknown, scope: Scope): void => {
    for (const name of bindingNames(target)) scope.names.add(name);
  };
  const targetWrites = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(targetWrites);
    else if (isNode(value)) {
      if (value.type === 'IdentifierReference') writes.push({ node: value, name: value.name as string });
      else {
        // A property target changes storage, not the binding of its receiver.
        const keys: Record<string, string[]> = {
          ParenthesizedExpression: ['Expression'], AssignmentExpression: ['LeftHandSideExpression'],
          ArrayLiteral: ['ElementList'], ObjectLiteral: ['PropertyDefinitionList'],
          PropertyDefinition: ['AssignmentExpression'], CoverInitializedName: ['IdentifierReference'], SpreadElement: ['AssignmentExpression'],
          AssignmentRestElement: ['AssignmentExpression'],
        };
        for (const key of keys[value.type] ?? []) targetWrites(value[key]);
      }
    }
  };
  const children = (node: Node, scope: Scope, excluded: readonly string[] = []): void => {
    for (const key of Object.keys(node)) if (!skip.has(key) && !excluded.includes(key)) visit(node[key], scope);
  };
  const visit = (value: unknown, enclosing: Scope): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, enclosing));
      return;
    }
    if (!isNode(value)) return;
    const node = value;
    if (node.type === 'IdentifierReference' && node.name === 'arguments' && enclosing.argumentsOwner) {
      argumentsExposed.add(enclosing.argumentsOwner);
    }
    let scope = enclosing;
    if (node.type === 'WithStatement' || node.type === 'RefExpression' || node.type === 'RefRebindingStatement' || node.Ref) dynamic = true;
    if (node.type === 'CallExpression' && isNode(node.CallExpression)
      && node.CallExpression.type === 'IdentifierReference' && node.CallExpression.name === 'eval') dynamic = true;
    // Annex B may copy a block function into another environment. Until that
    // copy has an identity here, it cannot justify relaxing the spelling screen.
    if (functions.has(node.type)) {
      declare(node.BindingIdentifier, scope);
      if (root.type === 'Script' && scope === rootScope) {
        for (const name of bindingNames(node.BindingIdentifier)) globalObjectNames.add(name);
      }
      if (!node.strict && scope !== scope.variable) {
        for (const name of bindingNames(node.BindingIdentifier)) uncertain.add(name);
      }
    }
    if (parameters.some((key) => key in node)) {
      // Computed method names and decorators are outside the parameter scope.
      for (const key of ['ClassElementName', 'PropertyName', 'Decorators']) visit(node[key], scope);
      if (expressions.has(node.type) && node.BindingIdentifier) {
        scope = makeScope(scope);
        declare(node.BindingIdentifier, scope);
      }
      const parameterScope = makeScope(scope, true);
      parameterScope.callable = parameterScope;
      declare((node.TypeParameters as { TypeParameterList?: unknown } | null)?.TypeParameterList, parameterScope);
      const formals = parameters.flatMap((key) => node[key] ? [node[key]] : []);
      if (node.type !== 'ArrowFunction' && node.type !== 'AsyncArrowFunction') {
        parameterScope.argumentsOwner = parameterScope;
        if (!node.strict && formals.every((list) => IsSimpleParameterList(list as ParseNode | readonly ParseNode[]))) {
          parameterScope.mappedParameters = new Set(formals.flatMap((list) => bindingNames(list)));
        }
      }
      formals.forEach((list) => declare(list, parameterScope));
      scopes.set(node, parameterScope);
      formals.forEach((list) => visit(list, parameterScope));
      // With no parameter expressions, var declarations share parameter cells.
      const separate = formals.some((list) => !(isNode(list) && list.type === 'BindingIdentifier')
        && ContainsExpression(list as ParseNode | readonly ParseNode[]));
      const bodyScope = separate ? makeScope(parameterScope, true) : parameterScope;
      for (const key of bodies) visit(node[key], bodyScope);
      children(node, parameterScope, [...parameters, ...bodies, 'BindingIdentifier', 'ClassElementName', 'PropertyName', 'Decorators']);
      return;
    }
    if (declarations.has(node.type) && !node.Partial
      && !(node.ClassModifiers as readonly string[] | null)?.includes('partial')) declare(node.BindingIdentifier, scope);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      visit(node.Decorators, scope);
      scope = makeScope(scope);
      // Instance initializers may execute later through construction. Treat
      // class-owned writes conservatively as crossing a callable boundary.
      scope.callable = scope;
      declare(node.BindingIdentifier, scope);
      declare((node.TypeParameters as { TypeParameterList?: unknown } | null)?.TypeParameterList, scope);
      scopes.set(node, scope);
      children(node, scope, ['Decorators']);
      return;
    }
    if (node.type === 'Block' || node.type === 'CaseBlock' || node.type === 'Catch' || loops.has(node.type)) scope = makeScope(scope);
    if (node.type === 'ClassStaticBlock' || node.type === 'DoExpression' && node.star) scope = makeScope(scope, true);
    if (node.type === 'DoExpression' && node.star) scope.callable = scope;
    scopes.set(node, scope);
    if (node.type === 'Catch') declare(node.CatchParameter, scope);
    if (node.type === 'LexicalDeclaration' || node.type === 'ForDeclaration') declare(node, scope);
    if (node.type === 'ImportDeclaration') declare(node, scope);
    if (node.type === 'VariableDeclaration') {
      declare(node, scope.variable);
      if (root.type === 'Script' && scope.variable === rootScope) {
        for (const name of bindingNames(node)) globalObjectNames.add(name);
      }
      if (node.Initializer) for (const name of bindingNames(node)) writes.push({ node, name });
    }
    if (loops.has(node.type) && node.ForBinding) {
      declare(node.ForBinding, scope.variable);
      if (root.type === 'Script' && scope.variable === rootScope) {
        for (const name of bindingNames(node.ForBinding)) globalObjectNames.add(name);
      }
      for (const name of bindingNames(node.ForBinding)) writes.push({ node, name });
    }
    if (node.type === 'AssignmentExpression') targetWrites(node.LeftHandSideExpression);
    if (node.type === 'UpdateExpression') targetWrites(node.LeftHandSideExpression ?? node.UnaryExpression);
    if (loops.has(node.type)) targetWrites(node.LeftHandSideExpression);
    // Path-scoped match bindings require their governing Boolean outcome.
    // Retain the old screen for those names until that identity is available.
    if (node.type === 'MatchBindingPattern') uncertain.add(node.Name as string);
    if (node.type === 'CaptureBinding') for (const name of bindingNames(node)) uncertain.add(name);
    children(node, scope);
  };
  const rootScope = makeScope();
  visit(root, rootScope);
  const binding = (node: ParseNode, name: string): Scope | undefined => {
    for (let scope = scopes.get(node); scope; scope = scope.outer) if (scope.names.has(name)) return scope;
    return undefined;
  };
  for (const write of writes) {
    const owner = binding(write.node, write.name);
    owner?.writes.add(write.name);
    if (owner && scopes.get(write.node)?.callable !== owner.callable) owner.capturedWrites.add(write.name);
  }
  const knownBinding = (node: ParseNode, name: string): Scope | undefined => {
    if (dynamic || uncertain.has(name)) return undefined;
    const scope = binding(node, name);
    // Script var/function bindings can also be replaced through the global
    // object. A lexical-write inventory alone is not a proof for those cells.
    return scope && !(scope === rootScope && globalObjectNames.has(name)) ? scope : undefined;
  };
  return {
    exposedParameters: new Set([...argumentsExposed].flatMap((scope) => [...scope.mappedParameters ?? []])),
    unassigned: (node, name) => {
      const scope = knownBinding(node, name);
      return scope ? !scope.writes.has(name) : undefined;
    },
    // A mapped arguments object can expose parameter cells without a lexical
    // write in a nested function. Do not infer isolation from this inventory.
    capturedWrite: (node, name) => {
      const scope = knownBinding(node, name);
      if (scope?.mappedParameters?.has(name) && argumentsExposed.has(scope)) return true;
      return scope?.capturedWrites.has(name);
    },
  };
}
