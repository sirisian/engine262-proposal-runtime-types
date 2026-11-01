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
  | 'String' | 'Symbol' | 'getOwnPropertyDescriptor' | 'reflect-getOwnPropertyDescriptor' | 'getOwnPropertyDescriptors' | 'prototype-setter' | 'create' | 'setPrototypeOf' | 'reflect-setPrototypeOf' | 'function-call' | 'function-apply' | 'function-bind' | 'set' | 'reflect-defineProperty' | 'defineProperty' | 'deleteProperty' | 'defineProperties' | 'assign' | 'opaque-value' | 'opaque-callable';
const allOrigins: readonly Origin[] = ['global', 'eval', 'Function', 'dynamic-function', 'Object', 'Reflect',
  'String', 'Symbol', 'getOwnPropertyDescriptor', 'reflect-getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'prototype-setter', 'create', 'setPrototypeOf', 'reflect-setPrototypeOf', 'function-call', 'function-apply', 'function-bind', 'set', 'reflect-defineProperty', 'defineProperty', 'deleteProperty', 'defineProperties', 'assign', 'opaque-value', 'opaque-callable'];
type Binding = { node: ParseNode, name: string };
type Effect = { node: ParseNode, names?: ReadonlySet<string>, lexical?: boolean, deferredOnly?: boolean, source?: ParseNode };
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
  // The suffix supplies the key; preceding comma operands still retain their
  // separately collected effects and cannot retarget an already captured base.
  if (node.type === 'CommaOperator') return stringKey(node.ExpressionList.at(-1), seen);
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
  const intrinsicTypeNames = new Map<ParseNode.Type, string>();
  const unavailableIntrinsicTypes = new Set<ParseNode.Type>();
  const intrinsicAdmission = (type: ParseNode.Type): string | undefined => {
    if (unavailableIntrinsicTypes.has(type)) return undefined;
    if (type.type === 'PredefinedType') return type.keyword;
    if (type.type === 'LiteralType') return type.kind === 'imaginary' ? undefined : type.kind;
    if (type.type !== 'TypeReference' || type.TypeArguments) return undefined;
    const name = type.TypeName;
    if (name.MemberNames.length || ResolveBindingDeclaration(name.IdentifierReference, name.IdentifierReference.name)) return undefined;
    const spelling = name.IdentifierReference.name;
    if (spelling === 'undefined' && externalValue(spelling) === Value.undefined) return spelling;
    if (!/^(?:any|void|string|boolean|number|bigint|uint(?:8|16|32|64)?|int(?:8|16|32|64)?|float(?:16|32|64))$/.test(spelling)
        || environment !== realm.GlobalEnv || realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(spelling))) return undefined;
    // These spellings fall back to intrinsic types only when no value binding
    // exists. Prove absence from raw ordinary descriptors; never run a getter.
    const seen = new Set<ObjectValue>();
    for (let at: Value = realm.GlobalObject; at !== Value.null;) {
      if (!(at instanceof ObjectValue) || seen.has(at) || seen.size >= 256
          || at.Get !== ObjectValue.prototype.Get || !('Prototype' in at) || at.properties.has(Value(spelling))) return undefined;
      seen.add(at); at = at.Prototype as Value;
    }
    if (inputs.get(bindingAt(name.IdentifierReference, spelling))?.length) return undefined;
    intrinsicTypeNames.set(type, spelling);
    return spelling;
  };
  const collectValues = () => GlobalEffectValues(nodes, {
    objectPrototype: realm.Intrinsics['%Object.prototype%'],
    arrayPrototype: realm.Intrinsics['%Array.prototype%'],
    functionPrototype: (node) => realm.Intrinsics[node?.type.startsWith('AsyncGenerator') ? '%AsyncGeneratorFunction.prototype%'
      : node?.type.startsWith('Generator') ? '%GeneratorFunction.prototype%' : node?.type.startsWith('Async') ? '%AsyncFunction.prototype%' : '%Function.prototype%'],
    binding: bindingAt, inputs, arrayIterationIsStable, provenDelegations, keyIsPrimitive, scalar: scalarOrigins, key: (node) => keyOf(node as Node), propertyKey: (node) => propertyKey(node as Node),
    external: (node) => {
      const declaration = ResolveBindingDeclaration(node, node.name);
      return !declaration || declaration.kind === 'import' ? externalValue(node.name) : undefined;
    },
    globalBinding: (node) => globalName(node, true),
    intrinsicAdmission,
    primitiveConversion: (node) => unwrap(node.Expression)?.type === 'NumericLiteral'
      && /^(?:number|bigint|uint|int|float)/.test(intrinsicAdmission(node.Type) ?? ''),
    admissionType: (node) => {
      if (node.type !== 'BindingIdentifier' && node.type !== 'IdentifierReference') return undefined;
      if (node.type === 'BindingIdentifier') return (node.parent as { TypeAnnotation?: ParseNode.TypeAnnotation } | undefined)?.TypeAnnotation?.Type;
      const declaration = ResolveBindingDeclaration(node, node.name);
      if (declaration?.kind === 'parameter') {
        const pending = functionKeys.flatMap((key) => {
          const part = (declaration.node as Node)[key];
          return (Array.isArray(part) ? part : [part]).filter(isNode);
        });
        while (pending.length) {
          const part = pending.pop()!;
          if (part.type === 'BindingIdentifier' && part.name === node.name) {
            for (let at = part.parent; at && at !== declaration.node; at = at.parent) {
              const annotation = (at as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type;
              if (annotation) return annotation;
            }
            return undefined;
          }
          for (const [key, value] of Object.entries(part)) if (!ignored.has(key) && key !== 'Initializer' && key !== 'TypeAnnotation') {
            pending.push(...(Array.isArray(value) ? value : [value]).filter(isNode));
          }
        }
        return undefined;
      }
      return (declaration?.node as { TypeAnnotation?: ParseNode.TypeAnnotation } | undefined)?.TypeAnnotation?.Type;
    },
    opaqueGlobalRead: (node) => node.parent?.type !== 'TypeName' && !ResolveBindingDeclaration(node, node.name) && globalName(node, true) && externalValue(node.name) === undefined,
    opaqueGlobalStore: (key) => {
      const seen = new Set<ObjectValue>();
      for (let at: Value = realm.GlobalObject; at !== Value.null;) {
        if (!(at instanceof ObjectValue) || seen.has(at) || seen.size >= 256
          || at.Set !== ObjectValue.prototype.Set || at.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty
          || at.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf || !('Prototype' in at)) return true;
        seen.add(at);
        const typed = (realm.GlobalObject as ObjectValue & { TypedProperties?: ReadonlyMap<string, unknown> }).TypedProperties;
        if (key === undefined ? typed?.size : typed?.has(key)) return true;
        const descriptor = key === undefined ? undefined : at.properties.get(Value(key));
        const descriptors = key === undefined ? at.properties.values() : descriptor ? [descriptor] : [];
        for (const entry of descriptors) {
          if (entry.Setter !== undefined && entry.Setter !== Value.undefined
            && intrinsicEffectOrigin(entry.Setter) !== 'prototype-setter') return true;
        }
        if (descriptor) return false;
        at = at.Prototype as Value;
      }
      return false;
    },
    nativeOrigins, globalData: (key) => intrinsicData(realm.GlobalObject, Value(key)), unknown: allOrigins, optional: (node) => optionalView(node as Node),
  });
  let values = collectValues();
  // Builtin type spellings are value bindings too. A property/reflection alias
  // can replace one without a direct assignment to its identifier. Remove
  // unsupported intrinsic hypotheses and rebuild their dependent may-flows.
  // Hypotheses only disappear; cap rebuilding and conservatively stand every
  // remaining hypothesis down if the small fixed-point budget is exhausted.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const [type, name] of intrinsicTypeNames) {
      if (unavailableIntrinsicTypes.has(type)) continue;
      let laterActivation = false;
      for (let at = type.parent; at; at = at.parent) if (functionKeys.some((key) => key in at)
        || at.type === 'FieldDefinition' && !at.static || /^(For|While|DoWhile)/.test(at.type)) laterActivation = true;
      const affected = values.globalWrites().some((write) => {
        if (write.key !== undefined && write.key !== name) return false;
        if (laterActivation) return true;
        return (values.executionSites(write.site) ?? [write.site]).some((site) => !site.location || !type.location
          || site.location.endIndex <= type.location.startIndex);
      });
      if (affected) {
        unavailableIntrinsicTypes.add(type); changed = true;
      }
    }
    if (!changed) break;
    if (pass === 3) for (const type of intrinsicTypeNames.keys()) unavailableIntrinsicTypes.add(type);
    values = collectValues();
  }
  const origins = (value: unknown): Set<string> => values.origins(isNode(value) ? value : undefined);
  const record = (node: Node, key?: string | ReadonlySet<string>, lexical = false): void => {
    const names = typeof key === 'string' ? new Set([key]) : key;
    const executions = values.executionSites(node);
    effects.push({ node, names, lexical, deferredOnly: executions !== undefined });
    for (const execution of executions ?? []) effects.push({ node: execution as Node, names, lexical, source: node });
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
    const summarizedBound = !kinds.size && values.boundInvocation(callee);
    if (!kinds.size && !summarizedBound && callee?.type === 'MemberExpression' && values.contained(callee.MemberExpression).has('global')) record(node);
    if (kinds.has('eval') || kinds.has('dynamic-function')) {
      record(node, undefined, true);
      continue;
    }
    if (!kinds.size && !summarizedBound) {
      const exposed = new Set(args.flatMap((arg) => [...values.contained(arg)]));
      if (exposed.has('global')) record(node);
      if (['eval', 'Function', 'dynamic-function', 'opaque-callable', 'opaque-value'].some((kind) => exposed.has(kind))) record(node, undefined, true);
    }
    if (!origins(args[0]).has('global')) continue;
    if (['set', 'defineProperty', 'reflect-defineProperty', 'deleteProperty'].some((kind) => kinds.has(kind as Origin))) {
      record(node, stringKey(args[1]));
    } else if (kinds.has('assign') || kinds.has('defineProperties')) {
      for (const source of kinds.has('assign') ? args.slice(1) : args.slice(1, 2)) {
        record(node, objectKeys(source));
      }
    } else if (!kinds.has('Function') && !kinds.has('create')) {
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
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition')
        && (at.ClassElementName === child || at.Decorators?.some((decorator) => decorator === child))) continue;
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
  const provenDelegationCallees = new Set<ParseNode.IdentifierReference>([...provenDelegations].flatMap((yielded) => {
    const call = unwrap(yielded.AssignmentExpression);
    const callee = call?.type === 'CallExpression' ? unwrap(call.CallExpression) : undefined;
    return callee?.type === 'IdentifierReference' ? [callee] : [];
  }));
  // This independent protocol proof already establishes the local callee at
  // the first resumption. A later opaque resume cannot erase that boundary.
  const activationOwner = (node: ParseNode): ParseNode | undefined => {
    let child = node;
    for (let at = node.parent; at; child = at, at = at.parent) {
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition')
        && (at.ClassElementName === child || at.Decorators?.some((decorator) => decorator === child))) continue;
      if (functionKeys.some((key) => key in at)) return at;
    }
    return undefined;
  };
  const beforeInActivation = (effect: ParseNode, read: ParseNode, owner: ParseNode): boolean => {
    // An effect after a capture can precede its next loop iteration, but an
    // ordinary later operation cannot erase that capture in this activation.
    for (let at = read.parent; at && at !== owner; at = at.parent) {
      if (/^(For|While|DoWhile)/.test(at.type) && contains(at, effect)) return true;
    }
    return precedes(effect, read);
  };
  const effectMayPrecede = (effect: Effect, read: ParseNode): boolean => {
    const owner = activationOwner(read);
    if (!owner) return !effect.deferredOnly && (deferred(read) || deferred(effect.node) || precedes(effect.node, read));
    if (effect.deferredOnly) {
      const sites = values.executionSites(effect.node, owner);
      return sites === undefined || sites.some((site) => beforeInActivation(site, read, owner));
    }
    const reads = values.executionSites(read);
    // An uncalled body's declaration still sees effects that actually execute
    // in the surrounding source before a possible later activation.
    if (!reads?.length) return true;
    return reads.some((site) => {
      // The original body effect above supplies ordering within this same
      // invocation. Its projected call boundary must not precede itself.
      // Opaque invocation work (for example apply's argument access) and
      // evaluation of the callee and arguments precede entry to the body.
      if (effect.node === site) return !effect.source || values.activationMayRepeat(read);
      if (contains(site, effect.node)) return true;
      return deferred(site) || deferred(effect.node) || precedes(effect.node, site);
    });
  };
  const affected = (node: ParseNode.IdentifierReference): boolean => !provenDelegationCallees.has(node) && (values.exhausted() && globalName(node, false) || effects.some((effect) =>
    globalName(node, !effect.lexical) && (!effect.names || effect.names.has(node.name)) && effectMayPrecede(effect, node)));
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
