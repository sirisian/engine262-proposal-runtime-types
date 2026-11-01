import type { ParseNode } from '../parser/ParseNode.mts';
import { ObjectValue, Value } from '../value.mts';
import { intrinsicData } from './intrinsic-origin.mts';

type Node = ParseNode & Record<string, unknown>;
type Flow = { values: Set<Candidate>, users: Set<(value: Candidate) => void>, primitiveLiteral?: boolean, knownPrimitive?: boolean };
type Aggregate = { kind: 'aggregate', slots: Map<string | undefined, Flow>, all: Flow, native?: ObjectValue, array?: boolean,
  slotUsers: Set<(key: string | undefined, flow: Flow) => void> };
type Callable = { kind: 'callable', parameters: readonly Node[], result: Flow, receiver: Flow };
type Bound = { kind: 'bound', callee: Flow, arguments: readonly Flow[], receiver: Flow };
type Candidate = string | Aggregate | Callable | Bound;
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';
const parameterKeys = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'];
const newFlow = (): Flow => ({ values: new Set(), users: new Set() });

/**
 * Inclusion-based, allocation/property-sensitive may-flow for global effects.
 * Values only accumulate. Calls connect arguments/returns; they execute no
 * code and establish neither a public contract nor a stable implementation.
 */
export function GlobalEffectValues(nodes: readonly ParseNode[], options: {
  arrayIterationIsStable: (site: ParseNode) => boolean,
  provenDelegations: ReadonlySet<ParseNode.YieldExpression>,
  binding: (node: ParseNode, name: string) => object,
  inputs: ReadonlyMap<object, readonly ParseNode[]>,
  scalar: (node: ParseNode) => Iterable<string>,
  key: (node: ParseNode) => string | undefined,
  propertyKey: (node: ParseNode) => string | undefined,
  external: (node: ParseNode.IdentifierReference) => Value | undefined,
  globalBinding: (node: ParseNode.IdentifierReference) => boolean,
  nativeOrigins: (value: Value) => readonly string[],
  globalData: (key: string) => Value | undefined,
  unknown: readonly string[],
  optional: (node: ParseNode) => ParseNode,
}): {
  origins: (node: ParseNode | undefined) => Set<string>,
  contained: (node: ParseNode | undefined) => Set<string>,
  element: (node: ParseNode | undefined, index: number) => Set<string>,
  exhausted: () => boolean,
  opaqueEffects: () => ReadonlySet<ParseNode>,
} {
  const expressions = new Map<ParseNode, Flow>();
  const bindings = new Map<object, Flow>();
  const functions = new Map<ParseNode, Callable>();
  const native = new Map<ObjectValue, Aggregate>();
  const opaqueEffects = new Set<ParseNode>();
  const queue: [Candidate, (value: Candidate) => void][] = [];
  // Bound propagation work, not elapsed time. Exhaustion loses precision; it
  // must never become evidence that an effect cannot occur.
  let remaining = Math.min(1048576, Math.max(16384, nodes.length * 128));
  let exhausted = false;
  let depth = 0;
  const add = (to: Flow, value: Candidate): void => {
    if (exhausted || to.values.has(value)) return;
    to.values.add(value);
    for (const user of to.users) queue.push([value, user]);
  };
  const watch = (from: Flow, user: (value: Candidate) => void): void => {
    if (exhausted) return;
    from.users.add(user);
    for (const value of from.values) queue.push([value, user]);
  };
  const edges = new Map<Flow, Set<Flow>>();
  const edge = (from: Flow, to: Flow): void => {
    let targets = edges.get(from);
    if (!targets) {
      targets = new Set();
      edges.set(from, targets);
    }
    if (targets.has(to)) return;
    targets.add(to);
    watch(from, (value) => add(to, value));
  };
  const settle = (): void => {
    for (let index = 0; index < queue.length && !exhausted; index += 1) {
      if (--remaining < 0) {
        exhausted = true;
        break;
      }
      const [value, user] = queue[index];
      user(value);
    }
    queue.length = 0;
  };
  const aggregate = (array = false): Aggregate => ({ kind: 'aggregate', slots: new Map(), all: newFlow(), array, slotUsers: new Set() });
  const globalObject = aggregate();
  const nativeValue = (value: Value | undefined, to: Flow): void => {
    if (!value) return;
    const kinds = options.nativeOrigins(value);
    if (kinds.length) {
      kinds.forEach((kind) => add(to, kind));
      if (!kinds.some((kind) => kind === 'String' || kind === 'Symbol')) return;
    }
    if (!(value instanceof ObjectValue)) {
      to.knownPrimitive = true;
      return;
    }
    if (value.Get !== ObjectValue.prototype.Get) {
      add(to, 'opaque-value');
      return;
    }
    // A callable without an effect summary can reach ambient state even
    // without a global object argument. This inspects engine-owned callability,
    // not its body. Recognized intrinsic summaries were handled above.
    if ('Call' in value && !kinds.length) add(to, 'opaque-callable');
    let object = native.get(value);
    if (!object) {
      object = { ...aggregate(), native: value };
      native.set(value, object);
    }
    add(to, object);
  };
  const slot = (object: Aggregate, key: string | undefined): Flow => {
    let found = object.slots.get(key);
    if (found) return found;
    found = newFlow();
    object.slots.set(key, found);
    edge(found, object.all);
    if (key !== undefined) {
      edge(slot(object, undefined), found);
      if (object.native) {
        const descriptor = object.native.properties.get(Value(key));
        if (descriptor?.Value !== undefined) nativeValue(intrinsicData(object.native, Value(key)), found);
        else add(found, 'opaque-value');
      }
    }
    for (const user of object.slotUsers) user(key, found);
    return found;
  };
  const load = (base: Flow, key: string | undefined, to: Flow, site?: ParseNode): void => watch(base, (value) => {
    if (typeof value === 'string') {
      if (value === 'opaque-value') {
        add(to, value);
        if (site) opaqueEffects.add(site);
      }
      if (value === 'global') edge(key === undefined ? globalObject.all : slot(globalObject, key), to);
      if (value === 'global' && key === 'globalThis') add(to, 'global');
      else if (value === 'global' && key && ['String', 'Symbol'].includes(key)) {
        const data = options.globalData(key);
        if (data) nativeValue(data, to);
        else {
          add(to, 'opaque-value');
          if (site) opaqueEffects.add(site);
        }
      } else if (value === 'global' && key && ['eval', 'Function', 'Object', 'Reflect'].includes(key)) add(to, key);
      else if (key && (value === 'Reflect' && ['set', 'defineProperty', 'deleteProperty'].includes(key)
        || value === 'Object' && ['defineProperty', 'defineProperties', 'assign'].includes(key))) add(to, key);
    } else if (value.kind === 'aggregate') {
      if (value.native && (key === undefined || value.native.properties.get(Value(key))?.Value === undefined)) {
        if (site) opaqueEffects.add(site);
        add(to, 'opaque-value');
      }
      if (key === undefined) {
        if (value.native) for (const name of value.native.properties.keys()) {
          if (typeof name === 'string') slot(value, name);
          else if ('stringValue' in name) slot(value, name.stringValue());
        }
        edge(value.all, to);
      } else edge(slot(value, key), to);
    }
  });
  const store = (base: Flow, key: string | undefined, from: Flow): void => watch(base, (value) => {
    if (value === 'global') edge(from, slot(globalObject, key));
    else if (typeof value !== 'string' && value.kind === 'aggregate') edge(from, slot(value, key));
  });
  const binding = (node: Node, name: string): Flow => {
    const owner = options.binding(node, name);
    let found = bindings.get(owner);
    if (found) return found;
    found = newFlow();
    bindings.set(owner, found);
    for (const source of options.inputs.get(owner) ?? []) edge(expression(source), found);
    return found;
  };
  const project = (base: Flow, key: string | undefined, site?: ParseNode): Flow => {
    const result = newFlow(); load(base, key, result, site); return result;
  };
  const opaque = (result: Flow, site: ParseNode): void => {
    add(result, 'opaque-value');
    opaqueEffects.add(site);
  };
  const pendingIterations: { source: Flow, result: Flow, site: ParseNode, copy?: boolean }[] = [];
  const iterate = (source: Flow, site: ParseNode, index?: number): Flow => {
    const result = newFlow();
    pendingIterations.push({ source, result, site });
    watch(source, (value) => {
      if (typeof value !== 'string' && value.kind === 'aggregate' && value.array && options.arrayIterationIsStable(site)) {
        edge(project(source, index === undefined ? undefined : String(index)), result);
      } else opaque(result, site);
    });
    return result;
  };
  const observeSlots = (object: Aggregate, visit: (key: string | undefined, flow: Flow) => void): void => {
    object.slotUsers.add(visit);
    for (const [key, flow] of object.slots) visit(key, flow);
  };
  const copyRest = (source: Flow, site: ParseNode, excluded = new Set<string>()): Flow => {
    const result = newFlow(), copy = aggregate(); add(result, copy);
    pendingIterations.push({ source, result: slot(copy, undefined), site, copy: true });
    watch(source, (value) => {
      if (typeof value === 'string' || value.kind !== 'aggregate') {
        opaque(slot(copy, undefined), site);
      } else if (value.native) {
        if (value.native.OwnPropertyKeys !== ObjectValue.prototype.OwnPropertyKeys
          || value.native.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty) {
          opaque(slot(copy, undefined), site);
          return;
        }
        // Enumerate only engine-owned ordinary own descriptors. A proxy never
        // reaches this path. Excluded/non-enumerable accessors are not read.
        for (const [name, descriptor] of value.native.properties) {
          const key = typeof name === 'string' ? name : 'stringValue' in name ? name.stringValue() : undefined;
          if (key !== undefined && excluded.has(key) || descriptor.Enumerable !== Value.true) continue;
          if (descriptor.Value === undefined) opaque(slot(copy, key), site);
          else nativeValue(descriptor.Value, slot(copy, key));
        }
        observeSlots(value, (key, flow) => {
          if (key === undefined || !excluded.has(key) && value.native!.properties.get(Value(key))?.Enumerable !== Value.false) edge(flow, slot(copy, key));
        });
      } else observeSlots(value, (key, flow) => {
        if (key === undefined || !excluded.has(key)) edge(flow, slot(copy, key));
      });
    });
    return result;
  };
  const arrayRest = (source: Flow, site: ParseNode, start: number): Flow => {
    const result = newFlow(), copy = aggregate(true); add(result, copy);
    // Iteration is an operation even when no remaining element is collected.
    const values = iterate(source, site);
    watch(source, (value) => {
      if (typeof value !== 'string' && value.kind === 'aggregate' && value.array && options.arrayIterationIsStable(site)) {
        observeSlots(value, (key, flow) => {
          if (key === undefined) edge(flow, slot(copy, undefined));
          else if (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) >= start) edge(flow, slot(copy, String(Number(key) - start)));
        });
      } else edge(values, slot(copy, undefined));
    });
    // Empty candidate sets are not proof that iteration cannot run user code.
    pendingIterations.push({ source, result: slot(copy, undefined), site });
    return result;
  };
  const target = (value: unknown, source: Flow, site?: ParseNode): void => {
    if (!isNode(value)) return;
    const node = value;
    if (node.type === 'BindingIdentifier' || node.type === 'IdentifierReference') {
      edge(source, binding(node, node.name));
      if (options.globalBinding(node as ParseNode.IdentifierReference)) edge(source, slot(globalObject, node.name));
    } else if (node.type === 'MemberExpression') store(expression(node.MemberExpression), options.key(node), source);
    else if (node.type === 'ParenthesizedExpression') target(node.Expression, source, site);
    else if (node.type === 'SingleNameBinding' || node.type === 'BindingElement') {
      target(node.BindingIdentifier ?? node.BindingPattern, source, site);
      if (node.Initializer) target(node.BindingIdentifier ?? node.BindingPattern, expression(node.Initializer), site);
    } else if (node.type === 'BindingRestProperty' || node.type === 'BindingRestElement' || node.type === 'ForBinding') {
      target(node.BindingIdentifier ?? node.BindingPattern, source, site);
    } else if (node.type === 'ForDeclaration') target(node.ForBinding, source, site);
    else if (node.type === 'ObjectBindingPattern') {
      const excluded = new Set<string>();
      for (const property of node.BindingPropertyList) {
        const key = property.type === 'SingleNameBinding' ? property.BindingIdentifier.name : options.propertyKey(property.PropertyName);
        if (key !== undefined) excluded.add(key);
        target(property.type === 'SingleNameBinding' ? property : property.BindingElement, project(source, key, site), site);
      }
      if (node.BindingRestProperty) target(node.BindingRestProperty, copyRest(source, node.BindingRestProperty, excluded), site);
    } else if (node.type === 'ArrayBindingPattern') {
      iterate(source, node);
      node.BindingElementList.forEach((part, index) => target(part, iterate(source, node, index), site));
      if (node.BindingRestElement) target(node.BindingRestElement, arrayRest(source, node, node.BindingElementList.length), site);
    } else if (node.type === 'ArrayLiteral') {
      iterate(source, node);
      node.ElementList.forEach((part, index) => {
        if (part.type === 'SpreadElement') target(part.AssignmentExpression, arrayRest(source, node, index), site);
        else target(part, iterate(source, node, index), site);
      });
    } else if (node.type === 'ObjectLiteral') {
      const excluded = new Set<string>();
      for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') {
          excluded.add(property.name);
          target(property, project(source, property.name, site), site);
        } else if (property.type === 'CoverInitializedName') {
          excluded.add(property.IdentifierReference.name);
          target(property.IdentifierReference, project(source, property.IdentifierReference.name, site), site);
          target(property.IdentifierReference, expression(property.Initializer), site);
        } else if (property.type === 'PropertyDefinition' && property.PropertyName) {
          const key = options.propertyKey(property.PropertyName);
          if (key !== undefined) excluded.add(key);
          target(property.AssignmentExpression, project(source, key, site), site);
        } else if (property.type === 'PropertyDefinition') {
          target(property.AssignmentExpression, copyRest(source, property, excluded), site);
        }
      }
    } else if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') {
      target(node.LeftHandSideExpression, source, site);
      target(node.LeftHandSideExpression, expression(node.AssignmentExpression), site);
    }
  };
  const callable = (node: Node): Callable => {
    const existing = functions.get(node);
    if (existing) return existing;
    const parameters = parameterKeys.flatMap((key) => Array.isArray(node[key]) ? node[key] as Node[] : isNode(node[key]) ? [node[key] as Node] : []);
    const result = { kind: 'callable' as const, parameters, result: newFlow(), receiver: newFlow() };
    functions.set(node, result);
    return result;
  };
  const invoke = (callee: Flow, args: readonly Flow[], receiver: Flow, result: Flow, packed?: Flow, site?: ParseNode): void => watch(callee, (value) => {
    if (value === 'Function') add(result, 'dynamic-function');
    // String/Symbol on a primitive literal cannot enter user coercion code. This is
    // a positive intrinsic summary, not trust in every native implementation.
    // Bound/call arguments keep their original flows; apply remains opaque.
    if ((value === 'String' || value === 'Symbol') && (site?.type !== 'CallExpression' || packed || args.length && !args[0].primitiveLiteral)) {
      // Successful calls return primitives even when coercion has effects.
      if (site?.type === 'NewExpression' && value === 'String') add(result, 'opaque-value');
      if (site) opaqueEffects.add(site);
    }
    if (value === 'opaque-callable' || value === 'opaque-value') {
      add(result, 'opaque-value');
      if (site) opaqueEffects.add(site);
    }
    if (typeof value !== 'string' && value.kind === 'bound') {
      if (packed) {
        const combined = aggregate(), flow = newFlow(); add(flow, combined);
        value.arguments.forEach((argument, index) => edge(argument, slot(combined, String(index))));
        // Unknown arity is a wildcard contribution, never an ignored suffix.
        edge(project(packed, undefined, site), slot(combined, undefined));
        invoke(value.callee, [], value.receiver, result, flow, site);
      } else invoke(value.callee, [...value.arguments, ...args], value.receiver, result, undefined, site);
      return;
    }
    if (typeof value === 'string' || value.kind !== 'callable') return;
    value.parameters.forEach((parameter, index) => {
      if (parameter.type === 'BindingRestElement') {
        const rest = aggregate(true), flow = newFlow(); add(flow, rest);
        if (packed) edge(project(packed, undefined, site), slot(rest, undefined));
        else args.slice(index).forEach((argument, offset) => edge(argument, slot(rest, String(offset))));
        target(parameter, flow, site);
        return;
      }
      const argument = packed ? project(packed, String(index), site) : args[index];
      if (argument) target(parameter, argument, site);
    });
    edge(receiver, value.receiver);
    edge(value.result, result);
  });
  const isAssignmentTarget = (node: ParseNode): boolean => {
    for (let at = node; at.parent; at = at.parent) {
      const parent = at.parent;
      if (parent.type === 'AssignmentExpression') return parent.LeftHandSideExpression === at;
      if (parent.type === 'ForOfStatement' || parent.type === 'ForAwaitStatement') return parent.LeftHandSideExpression === at;
      if (!['ArrayLiteral', 'ObjectLiteral', 'PropertyDefinition', 'SpreadElement', 'AssignmentRestElement', 'ParenthesizedExpression'].includes(parent.type)) return false;
    }
    return false;
  };
  const expression = (value: unknown): Flow => {
    if (!isNode(value)) return newFlow();
    const node = value;
    const previous = expressions.get(node);
    if (previous) return previous;
    const result = newFlow();
    expressions.set(node, result);
    if (['NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node.type)) result.primitiveLiteral = true;
    if (exhausted) return result;
    if (++depth > 256) {
      exhausted = true;
      depth -= 1;
      return result;
    }
    for (const kind of options.scalar(node)) add(result, kind);
    if (node.type === 'IdentifierReference') {
      edge(binding(node, node.name), result);
      if (options.globalBinding(node)) edge(slot(globalObject, node.name), result);
      nativeValue(options.external(node), result);
    } else if (['ParenthesizedExpression', 'TypeArgumentsExpression'].includes(node.type)) edge(expression(node.Expression), result);
    else if (node.type === 'OptionalExpression') edge(expression(options.optional(node)), result);
    else if (node.type === 'CommaOperator') edge(expression(node.ExpressionList.at(-1)), result);
    else if (node.type === 'ConditionalExpression') {
      edge(expression(node.AssignmentExpression_a), result); edge(expression(node.AssignmentExpression_b), result);
    } else if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') {
      edge(expression(node.AssignmentExpression), result);
      target(node.LeftHandSideExpression, result, node);
    } else if ((node.type === 'ObjectLiteral' || node.type === 'ArrayLiteral') && !isAssignmentTarget(node)) {
      const object = aggregate(node.type === 'ArrayLiteral' && !node.ElementList.some((part) => part.type === 'Elision')); add(result, object);
      if (node.type === 'ArrayLiteral') {
        node.ElementList.forEach((part, index) => {
          if (part.type === 'SpreadElement') edge(iterate(expression(part.AssignmentExpression), part), slot(object, undefined));
          else edge(expression(part), slot(object, String(index)));
        });
      } else for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') edge(expression(property), slot(object, property.name));
        else if (property.type === 'PropertyDefinition') {
          if (property.PropertyName) edge(expression(property.AssignmentExpression), slot(object, options.propertyKey(property.PropertyName)));
          else edge(project(expression(property.AssignmentExpression), undefined, property), slot(object, undefined));
        } else if (property.type === 'MethodDefinition') {
          const key = options.propertyKey(property.ClassElementName);
          if (property.UniqueFormalParameters !== null) edge(expression(property), slot(object, key));
          else if (property.PropertySetParameterList === null) edge(callable(property as Node).result, slot(object, key));
        }
      }
    } else if (node.type === 'AssignmentRestElement' || node.type === 'SpreadElement') {
      if (!isAssignmentTarget(node)) edge(iterate(expression(node.AssignmentExpression), node), result);
    } else if (node.type === 'YieldExpression' && node.hasStar) {
      // Retain the independently proven local resumed-input boundary. This
      // does not establish that arbitrary generator execution is effect-free.
      if (options.provenDelegations.has(node)) add(result, 'opaque-value');
      else edge(iterate(expression(node.AssignmentExpression), node), result);
    } else if (node.type === 'MemberExpression') load(expression(node.MemberExpression), options.key(node), result, node);
    else if (parameterKeys.some((key) => key in node)) {
      const fn = callable(node); add(result, fn);
      if (isNode(node.BindingIdentifier)) edge(result, binding(node.BindingIdentifier, node.BindingIdentifier.name as string));
      const concise = node.ConciseBody as Node | undefined;
      if (concise?.type === 'ConciseBody') edge(expression(concise.ExpressionBody.AssignmentExpression), fn.result);
    } else if (node.type === 'ThisExpression') {
      for (let at = node.parent; at; at = at.parent) {
        if (parameterKeys.some((key) => key in at) && !['ArrowFunction', 'AsyncArrowFunction'].includes(at.type)) {
          edge(callable(at as Node).receiver, result); break;
        }
      }
    } else if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      let callee: ParseNode = node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression;
      while (callee.type === 'ParenthesizedExpression') callee = callee.Expression;
      let argumentNodes: readonly ParseNode.ArgumentListElement[] = node.Arguments ?? [];
      let args = argumentNodes.map(expression);
      let receiver = callee.type === 'MemberExpression' ? expression(callee.MemberExpression) : newFlow();
      let packed: Flow | undefined;
      if (callee.type === 'MemberExpression' && options.key(callee) === 'bind') {
        add(result, { kind: 'bound', callee: expression(callee.MemberExpression), arguments: args.slice(1), receiver: args[0] ?? newFlow() });
        depth -= 1;
        return result;
      }
      if (callee.type === 'MemberExpression' && ['call', 'apply'].includes(options.key(callee) ?? '')) {
        receiver = args[0] ?? newFlow();
        if (options.key(callee) === 'apply') {
          packed = args[1];
          if (packed) project(packed, 'length', node);
        }
        args = options.key(callee) === 'call' ? args.slice(1) : [];
        argumentNodes = options.key(callee) === 'call' ? argumentNodes.slice(1) : [];
        callee = callee.MemberExpression;
      }
      if (!packed && argumentNodes.some((argument) => argument.type === 'AssignmentRestElement')) {
        const argumentsObject = aggregate(true); packed = newFlow(); add(packed, argumentsObject);
        let uncertain = false;
        argumentNodes.forEach((argument, index) => {
          uncertain ||= argument.type === 'AssignmentRestElement';
          edge(args[index], slot(argumentsObject, uncertain ? undefined : String(index)));
        });
      }
      invoke(expression(callee), args, receiver, result, packed, node);
      const argument = (index: number): Flow => packed ? project(packed, String(index), node) : args[index] ?? newFlow();
      watch(expression(callee), (kind) => {
        const key = !packed && node.Arguments?.[1] ? options.propertyKey(node.Arguments[1]) : undefined;
        if (kind === 'set') store(argument(0), key, argument(2));
        if (kind === 'defineProperty') store(argument(0), key, project(argument(2), 'value', node));
        if (kind === 'assign') {
          edge(argument(0), result);
          const sources = packed ? [project(packed, undefined, node)] : args.slice(1);
          for (const source of sources) store(argument(0), undefined, project(source, undefined, node));
        }
        if (kind === 'defineProperties') store(argument(0), undefined, project(project(argument(1), undefined, node), 'value', node));
      });
    }
    depth -= 1;
    return result;
  };
  for (const value of nodes) {
    const node = value as Node;
    expression(node);
    if (node.type === 'LexicalBinding' || node.type === 'VariableDeclaration') target(node.BindingIdentifier ?? node.BindingPattern, expression(node.Initializer), node);
    if (node.type === 'ForOfStatement' || node.type === 'ForAwaitStatement') {
      target(node.LeftHandSideExpression ?? node.ForBinding ?? node.ForDeclaration, iterate(expression(node.AssignmentExpression), node), node);
    }
    if (node.type === 'ReturnStatement') for (let at = node.parent; at; at = at.parent) {
      if (parameterKeys.some((key) => key in at)) {
        edge(expression(node.Expression), callable(at as Node).result);
        break;
      }
    }
  }
  settle();
  for (let index = 0; index < pendingIterations.length;) {
    const end = pendingIterations.length;
    for (; index < end; index += 1) {
      const request = pendingIterations[index];
      if (!request.source.values.size && !(request.copy && (request.source.primitiveLiteral || request.source.knownPrimitive))) opaque(request.result, request.site);
    }
    settle();
  }
  const summarize = (from: Flow, deep: boolean): Set<string> => {
    const result = new Set<string>();
    const seen = new Set<Flow>();
    const visit = (flow: Flow): void => {
      if (seen.has(flow) || exhausted) return;
      seen.add(flow);
      if (--remaining < 0) {
        exhausted = true;
        return;
      }
      for (const value of flow.values) {
        if (value === 'opaque-value') options.unknown.forEach((kind) => result.add(kind));
        else if (typeof value === 'string') result.add(value);
        else if (deep && value.kind === 'aggregate') {
          if (value.native) for (const key of value.native.properties.keys()) {
            if (typeof key === 'string') slot(value, key);
            else if ('stringValue' in key) slot(value, key.stringValue());
          }
          settle(); visit(value.all);
        } else if (deep && value.kind === 'callable') visit(value.result);
        else if (deep && value.kind === 'bound') {
          visit(value.callee); visit(value.receiver); value.arguments.forEach(visit);
        }
      }
    };
    visit(from);
    return exhausted ? new Set(options.unknown) : result;
  };
  return {
    origins: (node) => {
      const from = expression(node); settle(); return summarize(from, false);
    },
    contained: (node) => {
      const from = expression(node); settle(); return summarize(from, true);
    },
    element: (node, index) => {
      const from = project(expression(node), String(index)); settle(); return summarize(from, false);
    },
    exhausted: () => exhausted,
    opaqueEffects: () => opaqueEffects,
  };
}
