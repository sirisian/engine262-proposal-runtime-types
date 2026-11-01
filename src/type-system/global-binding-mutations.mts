import type { ParseNode } from '../parser/ParseNode.mts';
import { ResolveInitializedBinding, type EnvironmentRecord } from '../execution-context/Environment.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { Value } from '../value.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import { intrinsicData } from './intrinsic-origin.mts';

type Node = ParseNode & Record<string, unknown>;
type Origin = 'global' | 'eval' | 'Function' | 'dynamic-function' | 'global-bound' | 'Object' | 'Reflect'
  | 'set' | 'defineProperty' | 'deleteProperty' | 'defineProperties' | 'assign';
const allOrigins: readonly Origin[] = ['global', 'eval', 'Function', 'dynamic-function', 'global-bound', 'Object', 'Reflect',
  'set', 'defineProperty', 'deleteProperty', 'defineProperties', 'assign'];
type Binding = { node: ParseNode, name: string };
type Effect = { node: ParseNode, names?: ReadonlySet<string>, lexical?: boolean };
const ignored = new Set(['parent', 'location', 'sourceText', 'strict']);
const functionKeys = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'];
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object'
  && typeof (value as { type?: unknown }).type === 'string';
const unwrap = (value: unknown): Node | undefined => {
  let node = isNode(value) ? value : undefined;
  while (node?.type === 'ParenthesizedExpression') node = node.Expression as Node;
  return node;
};
const children = (node: Node): Node[] => Object.entries(node).flatMap(([key, value]) =>
  ignored.has(key) ? [] : (Array.isArray(value) ? value : [value]).filter(isNode));
const stringKey = (value: unknown, seen = new Set<ParseNode>()): string | undefined => {
  const node = unwrap(value);
  if (!node || seen.has(node) || seen.size >= 256) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  seen.add(node);
  if (node.type === 'IdentifierReference') {
    const binding = ResolveBindingDeclaration(node, node.name);
    if (binding?.kind === 'const' && binding.initializer && !(binding.node as Node).TypeAnnotation && !(binding.node as Node).Ref) {
      return stringKey(binding.initializer, seen);
    }
  }
  return undefined;
};
const keyOf = (node: Node): string | undefined => (node.IdentifierName as { name?: string } | undefined)?.name ?? stringKey(node.Expression);

/**
 * A footprint of writes through global-object and dynamic-source aliases.
 * This withdraws declaration-result assumptions; it never proves a runtime
 * callee identity or removes a receiving check. Binding identities keep local
 * and module names distinct from properties of the global object.
 */
export function GlobalBindingMutations(root: ParseNode, environment: EnvironmentRecord, realm: Realm): { affects: (expression: ParseNode) => boolean } {
  const nodes: Node[] = [];
  const bindings = new Map<ParseNode, Map<string, Binding>>();
  const inputs = new Map<Binding, Node[]>();
  const effects: Effect[] = [];
  const bindingAt = (node: ParseNode, name: string): Binding => {
    const declaration = ResolveBindingDeclaration(node, name);
    const owner = declaration?.node ?? root;
    let names = bindings.get(owner);
    if (!names) {
      names = new Map();
      bindings.set(owner, names);
    }
    let binding = names.get(name);
    if (!binding) {
      binding = { node: owner, name };
      names.set(name, binding);
    }
    return binding;
  };
  const input = (target: unknown, value: unknown): void => {
    const at = unwrap(target), source = unwrap(value);
    if (!at || !source) return;
    if (at.type === 'SingleNameBinding' || at.type === 'BindingElement') {
      input(at.BindingIdentifier ?? at.BindingPattern, source);
      input(at.BindingIdentifier ?? at.BindingPattern, at.Initializer);
      return;
    }
    if (at.type === 'ObjectBindingPattern') {
      for (const property of at.BindingPropertyList) {
        const name = property.type === 'SingleNameBinding' ? property.BindingIdentifier : property.PropertyName;
        const projection = { type: 'MemberExpression', MemberExpression: source,
          IdentifierName: name.type === 'IdentifierName' || name.type === 'BindingIdentifier' ? name : undefined,
          Expression: name.type === 'PropertyName' ? name.ComputedPropertyName : name,
          parent: at.parent, location: at.location } as unknown as Node;
        input(property.type === 'SingleNameBinding' ? property : property.BindingElement, projection);
      }
      return;
    }
    if (at.type === 'ArrayBindingPattern' && source.type === 'ArrayLiteral' && !source.ElementList.some((part) => part.type === 'SpreadElement')) {
      at.BindingElementList.forEach((part, index) => input(part, source.ElementList[index]));
      return;
    }
    if (!['BindingIdentifier', 'IdentifierReference'].includes(at.type)) return;
    const binding = bindingAt(at, at.name as string);
    inputs.set(binding, [...inputs.get(binding) ?? [], source]);
  };
  const collect = (node: Node): void => {
    nodes.push(node);
    if (node.type === 'LexicalBinding' || node.type === 'VariableDeclaration') input(node.BindingIdentifier ?? node.BindingPattern, node.Initializer);
    if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') input(node.LeftHandSideExpression, node.AssignmentExpression);
    children(node).forEach(collect);
  };
  collect(root as Node);

  const optionalViews = new WeakMap<ParseNode, Node>();
  const optionalView = (node: Node): Node => {
    if (node.type !== 'OptionalExpression') return node;
    const previous = optionalViews.get(node);
    if (previous) return previous;
    const chain = (part: ParseNode.OptionalChain): Node => {
      const base = part.OptionalChain ? chain(part.OptionalChain) : optionalView(node.MemberExpression as Node);
      const view = { ...(part.Arguments ? { type: 'CallExpression', CallExpression: base, Arguments: part.Arguments }
        : { type: 'MemberExpression', MemberExpression: base, IdentifierName: part.IdentifierName, Expression: part.Expression }),
      parent: node.parent, location: node.location } as unknown as Node;
      if (part.Arguments) nodes.push(view);
      return view;
    };
    const view = chain(node.OptionalChain);
    optionalViews.set(node, view);
    return view;
  };
  for (const node of [...nodes]) if (node.type === 'OptionalExpression') optionalView(node);

  const externalOrigins = (name: string): Origin[] => {
    const binding = ResolveInitializedBinding(environment, name);
    const value = binding?.value ?? (environment === realm.GlobalEnv && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
      ? intrinsicData(realm.GlobalObject, Value(name)) : undefined);
    if (value === realm.GlobalObject) return ['global'];
    for (const candidate of ['eval', 'Function', 'Object', 'Reflect'] as const) {
      if (value !== undefined && value === realm.Intrinsics[`%${candidate}%`]) return [candidate];
    }
    return [];
  };

  // Aliases are may-origins: a later rebinding cannot make a possibly global
  // write disappear. This finite source inventory is not a value interpreter.
  const origins = (value: unknown, seen = new Set<Binding>(), budget = { remaining: 4096 }): Set<Origin> => {
    const node = unwrap(value);
    if (!node) return new Set();
    if (--budget.remaining < 0 || seen.size >= 256) return new Set(allOrigins);
    const from = (source: unknown, next = seen): Set<Origin> => origins(source, next, budget);
    if (node.type === 'OptionalExpression') return from(optionalView(node));
    if (node.type === 'IdentifierReference') {
      const declaration = ResolveBindingDeclaration(node, node.name);
      const binding = bindingAt(node, node.name);
      const external = !declaration || declaration.kind === 'import' ? externalOrigins(node.name) : [];
      const seed: Origin[] = external.length ? external : declaration?.kind === 'import'
        ? [...allOrigins]
        : !declaration && !ResolveInitializedBinding(environment, node.name) ? node.name === 'globalThis' ? ['global']
          : ['eval', 'Function', 'Object', 'Reflect'].includes(node.name) ? [node.name as Origin] : [] : [];
      if (seen.has(binding)) return new Set(seed);
      const next = new Set(seen); next.add(binding);
      return new Set([...seed, ...(inputs.get(binding) ?? []).flatMap((source) => [...from(source, next)])]);
    }
    if (node.type === 'ThisExpression') {
      for (let at = node.parent; at; at = at.parent) {
        if (['ClassDeclaration', 'ClassExpression', 'ClassStaticBlock', 'FieldDefinition'].includes(at.type)) return new Set();
        if (functionKeys.some((key) => key in at) && !['ArrowFunction', 'AsyncArrowFunction'].includes(at.type)) {
          return new Set(at.strict ? [] : ['global']);
        }
      }
      return new Set(root.type === 'Script' ? ['global'] : []);
    }
    if (node.type === 'CommaOperator') return from(node.ExpressionList.at(-1));
    if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') return from(node.AssignmentExpression);
    if (node.type === 'ConditionalExpression') {
      return new Set([...from(node.AssignmentExpression_a), ...from(node.AssignmentExpression_b)]);
    }
    if (node.type === 'MemberExpression') {
      const base = from(node.MemberExpression), key = keyOf(node);
      if (base.has('global') && key === 'globalThis') return new Set(['global']);
      if (base.has('global') && key && ['eval', 'Function', 'Object', 'Reflect'].includes(key)) return new Set([key as Origin]);
      if (key && (base.has('Reflect') && ['set', 'defineProperty', 'deleteProperty'].includes(key)
        || base.has('Object') && ['defineProperty', 'defineProperties', 'assign'].includes(key))) return new Set([key as Origin]);
      return new Set();
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = unwrap(node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression);
      if (callee?.type === 'MemberExpression' && keyOf(callee) === 'bind') {
        const kinds = from(callee.MemberExpression);
        if (node.Arguments?.some((arg) => from(arg).has('global'))) kinds.add('global-bound');
        return kinds;
      }
      const target = callee?.type === 'MemberExpression' && ['call', 'apply'].includes(keyOf(callee) ?? '') ? callee.MemberExpression : callee;
      return from(target).has('Function')
        ? new Set(['dynamic-function']) : new Set();
    }
    return new Set();
  };
  const record = (node: Node, key?: string, lexical = false): void => {
    effects.push({ node, names: key === undefined ? undefined : new Set([key]), lexical });
  };
  const write = (value: unknown, at: Node): void => {
    const node = unwrap(value);
    if (!node) return;
    if (node.type === 'MemberExpression') {
      if (origins(node.MemberExpression).has('global')) record(at, keyOf(node));
      return;
    }
    // Only target positions, never a pattern's key or default expression.
    const keys: Record<string, string[]> = {
      ArrayLiteral: ['ElementList'], ObjectLiteral: ['PropertyDefinitionList'],
      PropertyDefinition: ['AssignmentExpression'], CoverInitializedName: ['IdentifierReference'],
      SpreadElement: ['AssignmentExpression'], AssignmentRestElement: ['AssignmentExpression'],
      AssignmentExpression: ['LeftHandSideExpression'],
    };
    for (const key of keys[node.type] ?? []) {
      const child = node[key];
      (Array.isArray(child) ? child : [child]).forEach((part) => write(part, at));
    }
  };
  const objectKeys = (value: unknown): Set<string> | undefined => {
    const node = unwrap(value);
    if (node?.type !== 'ObjectLiteral') return undefined;
    const keys = new Set<string>();
    for (const property of node.PropertyDefinitionList ?? []) {
      if (property.type === 'IdentifierReference') {
        keys.add(property.name);
        continue;
      }
      const name = (property as Node).PropertyName as Node | undefined;
      const text = name?.type === 'IdentifierName' ? name.name : name?.type === 'StringLiteral' ? name.value
        : stringKey(name?.ComputedPropertyName);
      if (typeof text !== 'string') return undefined;
      keys.add(text);
    }
    return keys;
  };
  for (const node of nodes) {
    if (node.type === 'AssignmentExpression') write(node.LeftHandSideExpression, node);
    if (node.type === 'UpdateExpression') write(node.LeftHandSideExpression ?? node.UnaryExpression, node);
    if (node.type === 'UnaryExpression' && node.operator === 'delete') write(node.UnaryExpression, node);
    if (['ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(node.type)) write(node.LeftHandSideExpression, node);
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') continue;
    const callee = unwrap(node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression);
    // Binding arguments captures them; it does not invoke the target yet.
    if (callee?.type === 'MemberExpression' && keyOf(callee) === 'bind') continue;
    let kinds = origins(callee);
    let args: readonly ParseNode[] = node.Arguments ?? [];
    if (callee?.type === 'MemberExpression' && ['call', 'apply'].includes(keyOf(callee) ?? '')) {
      kinds = origins(callee.MemberExpression);
      if (!kinds.size && origins(args[0]).has('global')) record(node);
      args = keyOf(callee) === 'call' ? args.slice(1) : unwrap(args[1])?.type === 'ArrayLiteral'
        ? (unwrap(args[1]) as ParseNode.ArrayLiteral).ElementList : [];
    }
    if (!kinds.size && callee?.type === 'MemberExpression' && origins(callee.MemberExpression).has('global')) record(node);
    if (kinds.has('eval') || kinds.has('dynamic-function')) {
      record(node, undefined, true);
      continue;
    }
    if (kinds.has('global-bound')) record(node);
    if (!origins(args[0]).has('global')) {
      if (!kinds.size && args.some((arg) => origins(arg).has('global'))) record(node);
      continue;
    }
    if (['set', 'defineProperty', 'deleteProperty'].some((kind) => kinds.has(kind as Origin))) {
      record(node, stringKey(args[1]));
    } else if (kinds.has('assign') || kinds.has('defineProperties')) {
      for (const source of kinds.has('assign') ? args.slice(1) : args.slice(1, 2)) {
        effects.push({ node, names: objectKeys(source) });
      }
    } else if (!kinds.has('Function')) {
      // Giving an opaque operation the global object exposes every property.
      record(node);
    }
  }
  const deferred = (node: ParseNode): boolean => {
    for (let at = node.parent; at; at = at.parent) {
      if (functionKeys.some((key) => key in at) || at.type === 'FieldDefinition' && !at.static
        || ['ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement', 'WhileStatement', 'DoWhileStatement'].includes(at.type)) return true;
    }
    return false;
  };
  const globalName = (node: ParseNode.IdentifierReference, objectOnly: boolean): boolean => {
    const binding = ResolveBindingDeclaration(node, node.name);
    if (!binding) {
      const external = ResolveInitializedBinding(environment, node.name);
      return !external || !objectOnly && external.mutable !== false
        && external === realm.GlobalEnv.DeclarativeRecord.bindings.get(Value(node.name));
    }
    if (root.type !== 'Script' || !(objectOnly ? ['function', 'var'] : ['function', 'var', 'let']).includes(binding.kind)) return false;
    for (let at = binding.node.parent; at && at !== root; at = at.parent) {
      if (functionKeys.some((key) => key in at) || ['ClassDeclaration', 'ClassExpression', 'ClassStaticBlock'].includes(at.type)) return false;
      if (binding.kind !== 'var' && (at.type === 'Block'
        || ['ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement'].includes(at.type))) return false;
    }
    return true;
  };
  const affected = (node: ParseNode.IdentifierReference): boolean => effects.some((effect) =>
    globalName(node, !effect.lexical) && (!effect.names || effect.names.has(node.name)) && (deferred(node) || deferred(effect.node)
      || !effect.node.location || !node.location || effect.node.location.endIndex <= node.location.startIndex));
  const affects = (expression: ParseNode, seen = new Set<ParseNode>()): boolean => {
    const node = unwrap(expression);
    if (!node) return false;
    if (seen.has(node) || seen.size >= 256) return true;
    seen.add(node);
    if (node.type === 'IdentifierReference') {
      const binding = ResolveBindingDeclaration(node, node.name);
      if (binding?.kind === 'const' && binding.initializer && !(binding.node as Node).TypeAnnotation && !(binding.node as Node).Ref) {
        return affects(binding.initializer, seen);
      }
      return affected(node);
    }
    if (node.type === 'TypeArgumentsExpression') return affects(node.Expression, seen);
    if (node.type === 'CommaOperator') return !!node.ExpressionList.length && affects(node.ExpressionList.at(-1)!, seen);
    if (node.type === 'ConditionalExpression') return affects(node.AssignmentExpression_a, new Set(seen)) || affects(node.AssignmentExpression_b, seen);
    return false;
  };
  return { affects };
}
