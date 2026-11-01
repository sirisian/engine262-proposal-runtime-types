import type { ParseNode } from '../parser/ParseNode.mts';
import { ObjectValue, Value } from '../value.mts';
import { intrinsicData } from './intrinsic-origin.mts';

type Node = ParseNode & Record<string, unknown>;
type Flow = { values: Set<Candidate>, users: Set<(value: Candidate) => void> };
type Aggregate = { kind: 'aggregate', slots: Map<string | undefined, Flow>, all: Flow, native?: ObjectValue };
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
  binding: (node: ParseNode, name: string) => object,
  inputs: ReadonlyMap<object, readonly ParseNode[]>,
  scalar: (node: ParseNode) => Iterable<string>,
  key: (node: ParseNode) => string | undefined,
  propertyKey: (node: ParseNode) => string | undefined,
  external: (node: ParseNode.IdentifierReference) => Value | undefined,
  globalBinding: (node: ParseNode.IdentifierReference) => boolean,
  nativeOrigins: (value: Value) => readonly string[],
  unknown: readonly string[],
  optional: (node: ParseNode) => ParseNode,
}): {
  origins: (node: ParseNode | undefined) => Set<string>,
  contained: (node: ParseNode | undefined) => Set<string>,
  element: (node: ParseNode | undefined, index: number) => Set<string>,
  exhausted: () => boolean,
} {
  const expressions = new Map<ParseNode, Flow>();
  const bindings = new Map<object, Flow>();
  const functions = new Map<ParseNode, Callable>();
  const native = new Map<ObjectValue, Aggregate>();
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
  const aggregate = (): Aggregate => ({ kind: 'aggregate', slots: new Map(), all: newFlow() });
  const globalObject = aggregate();
  const nativeValue = (value: Value | undefined, to: Flow): void => {
    if (!value) return;
    const kinds = options.nativeOrigins(value);
    if (kinds.length) {
      kinds.forEach((kind) => add(to, kind));
      return;
    }
    if (!(value instanceof ObjectValue)) return;
    if (value.Get !== ObjectValue.prototype.Get) {
      options.unknown.forEach((kind) => add(to, kind));
      return;
    }
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
      if (object.native) nativeValue(intrinsicData(object.native, Value(key)), found);
    }
    return found;
  };
  const load = (base: Flow, key: string | undefined, to: Flow): void => watch(base, (value) => {
    if (typeof value === 'string') {
      if (value === 'global') edge(key === undefined ? globalObject.all : slot(globalObject, key), to);
      if (value === 'global' && key === 'globalThis') add(to, 'global');
      else if (value === 'global' && key && ['eval', 'Function', 'Object', 'Reflect'].includes(key)) add(to, key);
      else if (key && (value === 'Reflect' && ['set', 'defineProperty', 'deleteProperty'].includes(key)
        || value === 'Object' && ['defineProperty', 'defineProperties', 'assign'].includes(key))) add(to, key);
    } else if (value.kind === 'aggregate') {
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
  const project = (base: Flow, key: string | undefined): Flow => {
    const result = newFlow(); load(base, key, result); return result;
  };
  const target = (value: unknown, source: Flow): void => {
    if (!isNode(value)) return;
    const node = value;
    if (node.type === 'BindingIdentifier' || node.type === 'IdentifierReference') {
      edge(source, binding(node, node.name));
      if (options.globalBinding(node as ParseNode.IdentifierReference)) edge(source, slot(globalObject, node.name));
    } else if (node.type === 'MemberExpression') store(expression(node.MemberExpression), options.key(node), source);
    else if (node.type === 'ParenthesizedExpression') target(node.Expression, source);
    else if (node.type === 'SingleNameBinding' || node.type === 'BindingElement') {
      target(node.BindingIdentifier ?? node.BindingPattern, source);
      if (node.Initializer) target(node.BindingIdentifier ?? node.BindingPattern, expression(node.Initializer));
    } else if (node.type === 'ObjectBindingPattern') {
      for (const property of node.BindingPropertyList) {
        const key = property.type === 'SingleNameBinding' ? property.BindingIdentifier.name : options.propertyKey(property.PropertyName);
        target(property.type === 'SingleNameBinding' ? property : property.BindingElement, project(source, key));
      }
    } else if (node.type === 'ArrayBindingPattern') {
      node.BindingElementList.forEach((part, index) => target(part, project(source, String(index))));
    } else if (node.type === 'ArrayLiteral') {
      node.ElementList.forEach((part, index) => target(part, project(source, String(index))));
    } else if (node.type === 'ObjectLiteral') {
      for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') target(property, project(source, property.name));
        else if (property.type === 'PropertyDefinition' && property.PropertyName) {
          target(property.AssignmentExpression, project(source, options.propertyKey(property.PropertyName)));
        }
      }
    } else if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') {
      target(node.LeftHandSideExpression, source);
      target(node.LeftHandSideExpression, expression(node.AssignmentExpression));
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
  const invoke = (callee: Flow, args: readonly Flow[], receiver: Flow, result: Flow, packed?: Flow): void => watch(callee, (value) => {
    if (value === 'Function') add(result, 'dynamic-function');
    if (typeof value !== 'string' && value.kind === 'bound') {
      if (packed) {
        const combined = aggregate(), flow = newFlow(); add(flow, combined);
        value.arguments.forEach((argument, index) => edge(argument, slot(combined, String(index))));
        // Unknown arity is a wildcard contribution, never an ignored suffix.
        edge(project(packed, undefined), slot(combined, undefined));
        invoke(value.callee, [], value.receiver, result, flow);
      } else invoke(value.callee, [...value.arguments, ...args], value.receiver, result);
      return;
    }
    if (typeof value === 'string' || value.kind !== 'callable') return;
    value.parameters.forEach((parameter, index) => {
      const argument = packed ? project(packed, String(index)) : args[index];
      if (argument) target(parameter, argument);
    });
    edge(receiver, value.receiver);
    edge(value.result, result);
  });
  const expression = (value: unknown): Flow => {
    if (!isNode(value)) return newFlow();
    const node = value;
    const previous = expressions.get(node);
    if (previous) return previous;
    const result = newFlow();
    expressions.set(node, result);
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
      target(node.LeftHandSideExpression, result);
    } else if (node.type === 'ObjectLiteral' || node.type === 'ArrayLiteral') {
      const object = aggregate(); add(result, object);
      if (node.type === 'ArrayLiteral') {
        node.ElementList.forEach((part, index) => {
          if (part.type === 'SpreadElement') edge(project(expression(part.AssignmentExpression), undefined), slot(object, undefined));
          else edge(expression(part), slot(object, String(index)));
        });
      } else for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') edge(expression(property), slot(object, property.name));
        else if (property.type === 'PropertyDefinition') {
          if (property.PropertyName) edge(expression(property.AssignmentExpression), slot(object, options.propertyKey(property.PropertyName)));
          else edge(project(expression(property.AssignmentExpression), undefined), slot(object, undefined));
        } else if (property.type === 'MethodDefinition') {
          const key = options.propertyKey(property.ClassElementName);
          if (property.UniqueFormalParameters !== null) edge(expression(property), slot(object, key));
          else if (property.PropertySetParameterList === null) edge(callable(property as Node).result, slot(object, key));
        }
      }
    } else if (node.type === 'MemberExpression') load(expression(node.MemberExpression), options.key(node), result);
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
      let args = (node.Arguments ?? []).map(expression);
      let receiver = callee.type === 'MemberExpression' ? expression(callee.MemberExpression) : newFlow();
      let packed: Flow | undefined;
      if (callee.type === 'MemberExpression' && options.key(callee) === 'bind') {
        add(result, { kind: 'bound', callee: expression(callee.MemberExpression), arguments: args.slice(1), receiver: args[0] ?? newFlow() });
        depth -= 1;
        return result;
      }
      if (callee.type === 'MemberExpression' && ['call', 'apply'].includes(options.key(callee) ?? '')) {
        receiver = args[0] ?? newFlow();
        if (options.key(callee) === 'apply') packed = args[1];
        args = options.key(callee) === 'call' ? args.slice(1) : [];
        callee = callee.MemberExpression;
      }
      invoke(expression(callee), args, receiver, result, packed);
      const argument = (index: number): Flow => packed ? project(packed, String(index)) : args[index] ?? newFlow();
      watch(expression(callee), (kind) => {
        const key = !packed && node.Arguments?.[1] ? options.propertyKey(node.Arguments[1]) : undefined;
        if (kind === 'set') store(argument(0), key, argument(2));
        if (kind === 'defineProperty') store(argument(0), key, project(argument(2), 'value'));
        if (kind === 'assign') {
          edge(argument(0), result);
          const sources = packed ? [project(packed, undefined)] : args.slice(1);
          for (const source of sources) store(argument(0), undefined, project(source, undefined));
        }
        if (kind === 'defineProperties') store(argument(0), undefined, project(project(argument(1), undefined), 'value'));
      });
    }
    depth -= 1;
    return result;
  };
  for (const value of nodes) {
    const node = value as Node;
    expression(node);
    if (node.type === 'LexicalBinding' || node.type === 'VariableDeclaration') target(node.BindingIdentifier ?? node.BindingPattern, expression(node.Initializer));
    if (node.type === 'ReturnStatement') for (let at = node.parent; at; at = at.parent) {
      if (parameterKeys.some((key) => key in at)) {
        edge(expression(node.Expression), callable(at as Node).result);
        break;
      }
    }
  }
  settle();
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
        if (typeof value === 'string') result.add(value);
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
  };
}
