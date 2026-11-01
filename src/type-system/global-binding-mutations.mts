import type { ParseNode } from '../parser/ParseNode.mts';
import { ResolveInitializedBinding, type EnvironmentRecord } from '../execution-context/Environment.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { ObjectValue, Value, wellKnownSymbols } from '../value.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';
import { intrinsicEffectOrigin } from './intrinsic-effect-origin.mts';
import { GlobalEffectValues } from './global-effect-values.mts';
import { ProvenResumedDelegations } from './generator-intrinsics.mts';

type Node = ParseNode & Record<string, unknown>;
type Origin = 'global' | 'eval' | 'Function' | 'dynamic-function' | 'Object' | 'Reflect'
  | 'String' | 'Symbol' | 'setPrototypeOf' | 'reflect-setPrototypeOf' | 'function-call' | 'function-apply' | 'function-bind' | 'set' | 'reflect-defineProperty' | 'defineProperty' | 'deleteProperty' | 'defineProperties' | 'assign' | 'opaque-value' | 'opaque-callable';
const allOrigins: readonly Origin[] = ['global', 'eval', 'Function', 'dynamic-function', 'Object', 'Reflect',
  'String', 'Symbol', 'setPrototypeOf', 'reflect-setPrototypeOf', 'function-call', 'function-apply', 'function-bind', 'set', 'reflect-defineProperty', 'defineProperty', 'deleteProperty', 'defineProperties', 'assign', 'opaque-value', 'opaque-callable'];
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
  if (node.type === 'NumericLiteral') return String(node.value);
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
const propertyKey = (node: Node): string | undefined => node.type === 'IdentifierName' ? node.name : node.type === 'NumericLiteral' ? String(node.value)
  : stringKey(node.type === 'PropertyName' ? node.ComputedPropertyName : node);

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
    // Patterns are modeled by the value-flow pass at their actual enclosing
    // operation site; synthetic textual projections misorder default reads.
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

  const externalValue = (name: string): Value | undefined => {
    const binding = ResolveInitializedBinding(environment, name);
    return binding?.value ?? (environment === realm.GlobalEnv && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
      ? intrinsicData(realm.GlobalObject, Value(name)) : undefined);
  };
  const nativeOrigins = (value: Value | undefined): Origin[] => {
    if (value === realm.GlobalObject) return ['global'];
    const effect = intrinsicEffectOrigin(value);
    if (effect) return [effect];
    for (const candidate of ['eval', 'Function', 'Object', 'Reflect', 'String', 'Symbol'] as const) {
      if (value !== undefined && value === realm.Intrinsics[`%${candidate}%`]) return [candidate];
    }
    return [];
  };

  // Aliases are may-origins: a later rebinding cannot make a possibly global
  // write disappear. This finite source inventory is not a value interpreter.
  const scalarOrigins = (value: unknown, seen = new Set<Binding>(), budget = { remaining: 4096 }): Set<Origin> => {
    const node = unwrap(value);
    if (!node) return new Set();
    if (--budget.remaining < 0 || seen.size >= 256) return new Set(allOrigins);
    const from = (source: unknown, next = seen): Set<Origin> => scalarOrigins(source, next, budget);
    if (node.type === 'OptionalExpression') return from(optionalView(node));
    if (node.type === 'IdentifierReference') {
      const declaration = ResolveBindingDeclaration(node, node.name);
      const binding = bindingAt(node, node.name);
      const external = !declaration || declaration.kind === 'import' ? nativeOrigins(externalValue(node.name)) : [];
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
      if (base.has('global') && key && ['eval', 'Function'].includes(key)) return new Set([key as Origin]);
      return new Set();
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = unwrap(node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression);
      const target = callee;
      return from(target).has('Function')
        ? new Set(['dynamic-function']) : new Set();
    }
    return new Set();
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
  const arrayIterationProofs = new Map<ParseNode, boolean>();
  const arrayIterationIsStable = (site: ParseNode): boolean => {
    // Awaiting values and delegation can re-enter user code between steps.
    if (site.type === 'ForAwaitStatement' || site.type === 'YieldExpression') return false;
    const cached = arrayIterationProofs.get(site);
    if (cached !== undefined) return cached;
    const arrayPrototype = realm.Intrinsics['%Array.prototype%'];
    const iteratorPrototype = realm.Intrinsics['%ArrayIteratorPrototype%'];
    let stable = intrinsicData(arrayPrototype, wellKnownSymbols.iterator) === realm.Intrinsics['%Array.prototype.values%']
      && intrinsicData(iteratorPrototype, Value('next')) === realm.Intrinsics['%ArrayIteratorPrototype.next%'];
    // Even an intrinsic iterator can acquire a user-defined close hook.
    let prototype: Value = iteratorPrototype;
    const seen = new Set<Value>();
    while (stable && prototype !== Value.null) {
      if (!(prototype instanceof ObjectValue) || prototype.Get !== ObjectValue.prototype.Get || seen.has(prototype)
        || prototype.properties.has(Value('return')) || !('Prototype' in prototype)) {
        stable = false;
        break;
      }
      seen.add(prototype);
      prototype = prototype.Prototype as Value;
    }
    stable &&= intrinsicSourceIsStable(root, realm, (node) => node === site, site);
    arrayIterationProofs.set(site, stable);
    return stable;
  };
  const statements = root.type === 'Script' ? root.ScriptBody?.StatementList ?? []
    : root.type === 'Module' ? root.ModuleBody?.ModuleItemList ?? [] : [];
  const provenDelegations = ProvenResumedDelegations(root, statements, realm);
  const primitiveKeyProofs = new Map<ParseNode, boolean>();
  const intrinsicPrimitiveCall = (node: ParseNode): boolean => {
    if (node.type !== 'CallExpression') return false;
    const callee = unwrap(node.CallExpression);
    return callee?.type === 'IdentifierReference' && ['String', 'Symbol'].includes(callee.name)
      && !ResolveBindingDeclaration(callee, callee.name) && !inputs.get(bindingAt(callee, callee.name))?.length
      && externalValue(callee.name) === realm.Intrinsics[callee.name === 'String' ? '%String%' : '%Symbol%']
      && node.Arguments.every((argument) => ['NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(argument.type));
  };
  const localSymbolDeclaration = (value: unknown): ParseNode | undefined => {
    let node = unwrap(value);
    if (node?.type === 'CommaOperator') node = unwrap(node.ExpressionList.at(-1));
    if (node?.type !== 'IdentifierReference') return undefined;
    const declaration = ResolveBindingDeclaration(node, node.name);
    const initializer = declaration?.kind === 'const' ? unwrap(declaration.initializer) : undefined;
    return declaration?.kind === 'const' && !(declaration.node as Node).TypeAnnotation && !(declaration.node as Node).Ref && initializer?.type === 'CallExpression'
      && unwrap(initializer.CallExpression)?.name === 'Symbol' && intrinsicPrimitiveCall(initializer) ? declaration.node : undefined;
  };
  const localSymbolDataAccess = (node: ParseNode): boolean => {
    if (node.type !== 'MemberExpression' || !node.Expression) return false;
    const base = unwrap(node.MemberExpression), key = localSymbolDeclaration(node.Expression);
    if (base?.type !== 'IdentifierReference' || !key) return false;
    const declaration = ResolveBindingDeclaration(base, base.name);
    const object = declaration?.kind === 'const' ? unwrap(declaration.initializer) : undefined;
    if (declaration?.kind !== 'const' || (declaration.node as Node).TypeAnnotation || (declaration.node as Node).Ref || object?.type !== 'ObjectLiteral') return false;
    return object.PropertyDefinitionList.every((property) => property.type === 'PropertyDefinition' && property.PropertyName)
      && object.PropertyDefinitionList.some((property) => property.type === 'PropertyDefinition'
        && property.PropertyName?.type === 'PropertyName' && localSymbolDeclaration(property.PropertyName.ComputedPropertyName) === key);
  };
  const keyIsPrimitive = (value: ParseNode): boolean => {
    const node = unwrap(value);
    if (!node || node.type !== 'CallExpression' && node.type !== 'MemberExpression') return false;
    const cached = primitiveKeyProofs.get(node);
    if (cached !== undefined) return cached;
    const callee = unwrap(node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression);
    if (callee?.type !== 'IdentifierReference' || !['String', 'Symbol'].includes(callee.name)
      || ResolveBindingDeclaration(callee, callee.name) || inputs.get(bindingAt(callee, callee.name))?.length
      || externalValue(callee.name) !== realm.Intrinsics[callee.name === 'String' ? '%String%' : '%Symbol%']) return false;
    if (node.type === 'CallExpression') {
      if (!node.Arguments.every((argument) => ['NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(argument.type))) return false;
    } else {
      const key = keyOf(node);
      const data = key === undefined ? undefined : intrinsicData(externalValue(callee.name)!, Value(key));
      if (!data || data instanceof ObjectValue) return false;
    }
    // Ancestors enclose the selected operation; their own operation follows
    // its capture. Other children still participate in the effect screen.
    const enclosing = new Set<ParseNode>();
    for (let at: ParseNode | undefined = node; at; at = at.parent) enclosing.add(at);
    // The source screen may admit local data accesses under the same intrinsic
    // hypothesis. Only immutable Symbol keys naming an own literal data entry
    // qualify; deletion, reflection, escape calls and other effects still fail
    // the screen. This preserves local Symbol evidence without trusting an
    // arbitrary computed read or the spelling of a replaced intrinsic.
    const stable = intrinsicSourceIsStable(root, realm, (at) => enclosing.has(at) || intrinsicPrimitiveCall(at)
      || at.type === 'PropertyName' && !!localSymbolDeclaration(at.ComputedPropertyName) || localSymbolDataAccess(at), node, undefined, callee.name);
    primitiveKeyProofs.set(node, stable);
    return stable;
  };
  const values = GlobalEffectValues(nodes, {
    functionPrototype: (node) => realm.Intrinsics[node?.type.startsWith('AsyncGenerator') ? '%AsyncGeneratorFunction.prototype%'
      : node?.type.startsWith('Generator') ? '%GeneratorFunction.prototype%' : node?.type.startsWith('Async') ? '%AsyncFunction.prototype%' : '%Function.prototype%'],
    binding: bindingAt, inputs, arrayIterationIsStable, provenDelegations, keyIsPrimitive, scalar: scalarOrigins, key: (node) => keyOf(node as Node), propertyKey: (node) => propertyKey(node as Node),
    external: (node) => {
      const declaration = ResolveBindingDeclaration(node, node.name);
      return !declaration || declaration.kind === 'import' ? externalValue(node.name) : undefined;
    },
    globalBinding: (node) => globalName(node, true), nativeOrigins, globalData: (key) => intrinsicData(realm.GlobalObject, Value(key)), unknown: allOrigins, optional: (node) => optionalView(node as Node),
  });
  const origins = (value: unknown): Set<string> => values.origins(isNode(value) ? value : undefined);
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
    const kinds = origins(callee);
    if (['function-call', 'function-apply', 'function-bind'].some((kind) => kinds.has(kind))) continue;
    const args: readonly ParseNode[] = node.Arguments ?? [];
    if (!kinds.size && callee?.type === 'MemberExpression' && values.contained(callee.MemberExpression).has('global')) record(node);
    if (kinds.has('eval') || kinds.has('dynamic-function')) {
      record(node, undefined, true);
      continue;
    }
    if (!kinds.size) {
      const exposed = new Set(args.flatMap((arg) => [...values.contained(arg)]));
      if (exposed.has('global')) record(node);
      if (['eval', 'Function', 'dynamic-function', 'opaque-callable', 'opaque-value'].some((kind) => exposed.has(kind))) record(node, undefined, true);
    }
    if (!origins(args[0]).has('global')) continue;
    if (['set', 'defineProperty', 'reflect-defineProperty', 'deleteProperty'].some((kind) => kinds.has(kind as Origin))) {
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
  // Opaque lookup and prior-source invocation may run code with ambient
  // global access. Record the original operation site, not a speculative
  // getter execution or a source-wide spelling match.
  for (const site of values.opaqueEffects()) record(site as Node, undefined, true);
  for (const effect of values.globalWrites()) record(effect.site as Node, effect.key);
  const deferred = (node: ParseNode): boolean => {
    let child = node;
    for (let at = node.parent; at; child = at, at = at.parent) {
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition') && at.ClassElementName === child) continue;
      if (functionKeys.some((key) => key in at) || at.type === 'FieldDefinition' && !at.static
        || ['ForStatement', 'ForInStatement', 'ForOfStatement', 'ForAwaitStatement', 'WhileStatement', 'DoWhileStatement'].includes(at.type)) return true;
    }
    return false;
  };
  const inPattern = (read: ParseNode, operation: ParseNode): boolean => {
    const pattern = operation.type === 'LexicalBinding' || operation.type === 'VariableDeclaration' ? operation.BindingPattern
      : operation.type === 'AssignmentExpression' ? operation.LeftHandSideExpression : undefined;
    if (!pattern) return false;
    for (let at: ParseNode | undefined = read; at && at !== operation; at = at.parent) if (at === pattern) return true;
    return false;
  };
  const contains = (ancestor: ParseNode, node: ParseNode): boolean => {
    for (let at: ParseNode | undefined = node; at; at = at.parent) if (at === ancestor) return true;
    return false;
  };
  const precedes = (effect: ParseNode, read: ParseNode): boolean => {
    // Pattern operations and a simple store's final key conversion follow its
    // RHS. Evaluating the reference's base/key, and reading a compound target,
    // precede the RHS. Rest copies follow the preceding defaults.
    for (let at: ParseNode | undefined = effect; at; at = at.parent) {
      if ((at.type === 'LexicalBinding' || at.type === 'VariableDeclaration') && at.BindingPattern && contains(at.BindingPattern, effect)) {
        if (at.Initializer && contains(at.Initializer, read)) return false;
        break;
      }
      if (at.type === 'AssignmentExpression' && contains(at.LeftHandSideExpression, effect)) {
        const target = unwrap(at.LeftHandSideExpression);
        if ((target?.type === 'ArrayLiteral' || target?.type === 'ObjectLiteral'
          || at.AssignmentOperator === '=' && target === effect) && contains(at.AssignmentExpression, read)) return false;
        break;
      }
    }
    if (effect.type === 'ArrayBindingPattern' || effect.type === 'ArrayLiteral') {
      if (contains(effect, read)) return true;
    }
    return inPattern(read, effect) || !effect.location || !read.location || effect.location.endIndex <= read.location.startIndex;
  };
  const affected = (node: ParseNode.IdentifierReference): boolean => values.exhausted() && globalName(node, false) || effects.some((effect) =>
    globalName(node, !effect.lexical) && (!effect.names || effect.names.has(node.name)) && (deferred(node) || deferred(effect.node)
      || precedes(effect.node, node)));
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
