import { R } from '../abstract-ops/spec-types.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { JSStringValue, NumberValue, ObjectValue, Value } from '../value.mts';
import { intrinsicData } from './intrinsic-origin.mts';
import { isIntrinsicPrototypeGetter } from './intrinsic-effect-origin.mts';

type Node = ParseNode & Record<string, unknown>;
type Flow = { values: Set<Candidate>, users: Set<(value: Candidate) => void>, primitiveLiteral?: boolean, knownPrimitive?: boolean, primitiveKinds?: Set<'null' | 'undefined' | 'other'>, stringLength?: number, expression?: ParseNode };
type Hook = { key: string | undefined, get: Flow, set: Flow, site: ParseNode, enumerable?: boolean };
type PropertyWrite = { key: string | undefined, source: Flow, site?: ParseNode };
type PrototypeChange = { source: Flow, site: ParseNode };
type Aggregate = { kind: 'aggregate', writes: PropertyWrite[], writeUsers: Set<() => void>, ordinaryPrototypeMutation: boolean, initialPrototypeEffects?: boolean, ownKeys: Set<string>, prototypes: PrototypeChange[], prototypeUsers: Set<() => void>, deletions: { key?: string, site: ParseNode }[], deletionUsers: Set<() => void>, hooks: Hook[], hookUsers: Set<() => void>, enumerability: { key: string | undefined, site: ParseNode, value?: boolean }[], slots: Map<string | undefined, Flow>, all: Flow, native?: ObjectValue, prototype?: ObjectValue, prototypeFlow?: Flow, mutations: Set<string | undefined>, array?: boolean,
  slotUsers: Set<(key: string | undefined, flow: Flow) => void> };
type Callable = { kind: 'callable', parameters: readonly Node[], result: Flow, receiver: Flow, properties: Aggregate };
type Bound = { kind: 'bound', callee: Flow, arguments: readonly Flow[], packed?: Flow, receiver: Flow, properties: Aggregate };
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
  functionPrototype: (node?: ParseNode) => ObjectValue,
  objectPrototype: ObjectValue,
  arrayIterationIsStable: (site: ParseNode) => boolean,
  keyIsPrimitive: (node: ParseNode) => boolean,
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
  globalWrites: () => readonly { site: ParseNode, key?: string }[],
} {
  const expressions = new Map<ParseNode, Flow>();
  const bindings = new Map<object, Flow>();
  const functions = new Map<ParseNode, Callable>();
  const native = new Map<ObjectValue, Aggregate>();
  const opaqueEffects = new Set<ParseNode>();
  const globalWrites: { site: ParseNode, key?: string }[] = [];
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
  const inputs = new Map<Flow, Set<Flow>>();
  const edge = (from: Flow, to: Flow): void => {
    let targets = edges.get(from);
    if (!targets) {
      targets = new Set();
      edges.set(from, targets);
    }
    if (targets.has(to)) return;
    targets.add(to);
    let sources = inputs.get(to);
    if (!sources) {
      sources = new Set();
      inputs.set(to, sources);
    }
    sources.add(from);
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
  const aggregate = (array = false): Aggregate => ({ kind: 'aggregate', writes: [], writeUsers: new Set(), ordinaryPrototypeMutation: true, ownKeys: new Set(), prototypes: [], prototypeUsers: new Set(), deletions: [], deletionUsers: new Set(), hooks: [], hookUsers: new Set(), enumerability: [], slots: new Map(), all: newFlow(), mutations: new Set(), array, slotUsers: new Set() });
  const propertiesOf = (value: Candidate): Aggregate | undefined => typeof value === 'string' ? undefined
    : value.kind === 'aggregate' ? value : value.properties;
  const functionProperties = (node?: ParseNode): Aggregate => {
    const object = { ...aggregate(), prototype: options.functionPrototype(node) };
    object.ordinaryPrototypeMutation = !node || !('Decorators' in node) || !node.Decorators?.length;
    object.ownKeys.add('length'); object.ownKeys.add('name');
    slot(object, 'length').knownPrimitive = true;
    slot(object, 'name').knownPrimitive = true;
    return object;
  };
  const globalObject = aggregate();
  const nativeValue = (value: Value | undefined, to: Flow): void => {
    if (!value) return;
    const kinds = options.nativeOrigins(value);
    if (kinds.length) {
      kinds.forEach((kind) => add(to, kind));
      if (kinds.includes('global')) return;
    }
    if (!(value instanceof ObjectValue)) {
      to.knownPrimitive = true;
      (to.primitiveKinds ??= new Set()).add(value === Value.null ? 'null' : value === Value.undefined ? 'undefined' : 'other');
      if (value instanceof JSStringValue) to.stringLength = value.stringValue().length;
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
        else if (!['call', 'apply', 'bind'].includes(key) || descriptor) add(found, 'opaque-value');
      }
    }
    for (const user of object.slotUsers) user(key, found);
    return found;
  };
  const deferred = (node: ParseNode): boolean => {
    let child = node;
    for (let at = node.parent; at; child = at, at = at.parent) {
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition') && at.ClassElementName === child) continue;
      if (parameterKeys.some((key) => key in at) || at.type === 'FieldDefinition' && !at.static
        || /^(For|While|DoWhile)/.test(at.type)) return true;
    }
    return false;
  };
  const mayPrecede = (before: ParseNode, after: ParseNode): boolean => before === after || deferred(before) || deferred(after)
    || !before.location || !after.location || before.location.endIndex <= after.location.startIndex;
  const matchingKey = (a: string | undefined, b: string | undefined): boolean => a === undefined || b === undefined || a === b;
  const beforePrototypeUse = (before: ParseNode, site?: ParseNode): boolean => {
    if (!site || mayPrecede(before, site)) return true;
    // Internal operations follow their operand/argument evaluation. A callee's
    // member-read node does not contain the call's later argument expressions.
    for (let at = before.parent; at; at = at.parent) if (at === site) return true;
    return false;
  };
  const canInherit = (object: Aggregate, key: string | undefined, site?: ParseNode): boolean => {
    const descriptor = key === undefined ? undefined : object.native?.properties.get(Value(key));
    if (descriptor?.Configurable === Value.false) return false;
    return !descriptor && (key === undefined || !object.ownKeys.has(key))
      || object.deletions.some((change) => matchingKey(key, change.key) && beforePrototypeUse(change.site, site));
  };
  const observePrototypes = (object: Aggregate, site: ParseNode | undefined, visit: (change: PrototypeChange) => void,
    key?: string, lookup = false): void => {
    const seen = new Set<PrototypeChange>();
    const update = (): void => {
      if (lookup && !canInherit(object, key, site)) return;
      for (const change of object.prototypes) {
        if (exhausted || --remaining < 0) {
          exhausted = true;
          return;
        }
        if (seen.has(change) || !beforePrototypeUse(change.site, site)) continue;
        seen.add(change); visit(change);
      }
    };
    object.prototypeUsers.add(update);
    if (lookup) object.deletionUsers.add(update);
    update();
  };
  const initialPrototype = (object: Aggregate): Flow => {
    const result = newFlow();
    if (object.prototypeFlow) edge(object.prototypeFlow, result);
    else nativeValue(object.native && 'Prototype' in object.native ? object.native.Prototype as Value : object.prototype, result);
    return result;
  };
  const prototypeAt = (object: Aggregate, site?: ParseNode): Flow => {
    const result = initialPrototype(object);
    observePrototypes(object, site, (change) => edge(change.source, result));
    return result;
  };
  // Consumers not yet given a positive inherited-operation summary retain an
  // effect at their use, including relinking of an intermediate prototype.
  const prototypeEffects = (source: Flow, site: ParseNode, key?: string, path = new Set<Aggregate>()): void => watch(source, (value) => {
    const object = propertiesOf(value);
    if (!object || path.has(object)) return;
    const next = new Set(path); next.add(object);
    if (next.size > 256) {
      exhausted = true;
      return;
    }
    observePrototypes(object, site, () => opaqueEffects.add(site), key, true);
    if (object.initialPrototypeEffects && canInherit(object, key, site)) watch(initialPrototype(object), (prototype) => {
      if (typeof prototype !== 'string' || prototype === 'opaque-value' || prototype === 'global') opaqueEffects.add(site);
    });
    let followed = false;
    const follow = (): void => {
      if (followed || !canInherit(object, key, site)) return;
      followed = true;
      prototypeEffects(initialPrototype(object), site, key, next);
    };
    object.deletionUsers.add(follow); follow();
  });
  const accessHooks = (object: Aggregate, key: string | undefined, receiver: Flow, site: ParseNode | undefined,
    read?: (key: string | undefined, value: Flow) => void, written?: Flow, excluded?: ReadonlySet<string>): void => {
    if (!site || exhausted) return;
    const observed = new Set<Hook>();
    const update = (): void => {
      for (const hook of object.hooks) {
        if (exhausted || --remaining < 0) {
          exhausted = true;
          return;
        }
        if (observed.has(hook) || !matchingKey(key, hook.key) || !mayPrecede(hook.site, site)
          || hook.key !== undefined && excluded?.has(hook.key)) continue;
        if (excluded && hook.enumerable === false && !object.enumerability.some((change) => change.value !== false
          && matchingKey(change.key, hook.key) && mayPrecede(hook.site, change.site) && mayPrecede(change.site, site))) continue;
        observed.add(hook);
        const result = newFlow();
        invoke(written ? hook.set : hook.get, written ? [written] : [], receiver, result, undefined, site);
        read?.(hook.key, result);
      }
    };
    object.hookUsers.add(update);
    update();
  };
  const load = (base: Flow, key: string | undefined, to: Flow, site?: ParseNode, receiver = base, path = new Set<Aggregate>()): void => watch(base, (value) => {
    if (typeof value === 'string') {
      if (value === 'opaque-value') {
        add(to, value);
        if (site) opaqueEffects.add(site);
      }
      if (value === 'global') edge(key === undefined ? globalObject.all : slot(globalObject, key), to);
      if (value === 'global' && key === 'globalThis') add(to, 'global');
      else if (value === 'global' && key && ['String', 'Symbol', 'Object', 'Reflect'].includes(key)) {
        const data = options.globalData(key);
        if (data) nativeValue(data, to);
        else {
          add(to, 'opaque-value');
          if (site) opaqueEffects.add(site);
        }
      } else if (value === 'global' && key && ['eval', 'Function'].includes(key)) add(to, key);
    } else {
      const object = propertiesOf(value)!;
      if (path.has(object) || path.size >= 256) {
        add(to, 'opaque-value');
        if (site) opaqueEffects.add(site);
        return;
      }
      const next = new Set(path); next.add(object);
      const adapter = key !== undefined && ['call', 'apply', 'bind'].includes(key);
      const descriptor = key === undefined ? undefined : object.native?.properties.get(Value(key));
      const inheritedOrdinary = path.size > 0 && object.native?.Get === ObjectValue.prototype.Get
        && object.native.GetOwnProperty === ObjectValue.prototype.GetOwnProperty
        && object.native.GetPrototypeOf === ObjectValue.prototype.GetPrototypeOf && 'Prototype' in object.native;
      accessHooks(object, key, receiver, site, (_key, result) => edge(result, to));
      let followedPrototype = false;
      const exposePrototype = (deletion: boolean): void => {
        if (followedPrototype) return;
        const prototype = object.native && 'Prototype' in object.native ? object.native.Prototype : object.prototype;
        followedPrototype = !!object.prototypeFlow || prototype instanceof ObjectValue || prototype === Value.null || deletion;
        if (object.prototypeFlow) load(object.prototypeFlow, key, to, site, receiver, next);
        if (prototype instanceof ObjectValue && prototype !== object.native) {
          const parent = newFlow(); nativeValue(prototype, parent);
          load(parent, key, to, site, receiver, next);
        } else if (deletion && prototype !== Value.null && !object.prototypeFlow) {
          // Source aggregates without an established prototype cannot certify
          // that removal reveals no inherited getter or callable.
          add(to, 'opaque-value');
          if (site) opaqueEffects.add(site);
        }
      };
      if ((!object.native || inheritedOrdinary) && canInherit(object, key, site)
        || adapter && !descriptor && !object.ownKeys.has(key!)) exposePrototype(false);
      observePrototypes(object, site, (change) => {
        load(change.source, key, to, site, receiver, next);
        if (!object.native && !object.prototype && !object.prototypeFlow) {
          add(to, 'opaque-value');
          if (site) opaqueEffects.add(site);
        }
      }, key, true);
      if (path.size && !object.native && !object.prototype && !object.prototypeFlow && canInherit(object, key, site)) {
        add(to, 'opaque-value');
        if (site) opaqueEffects.add(site);
      }
      const removed = (): void => {
        if (followedPrototype || descriptor?.Configurable === Value.false) return;
        for (const change of object.deletions) {
          if (exhausted || --remaining < 0) {
            exhausted = true;
            return;
          }
          if (matchingKey(key, change.key) && beforePrototypeUse(change.site, site)) {
            exposePrototype(true);
            return;
          }
        }
      };
      object.deletionUsers.add(removed);
      removed();
      if (inheritedOrdinary && site) {
        // Ordinary inherited data lookup and proven absence run no user code.
        // Accessors need their own identity/receiver proof, even for an unknown
        // primitive key. Never probe a getter to discover that proof.
        const descriptors = key === undefined ? object.native!.properties.values() : descriptor ? [descriptor] : [];
        for (const found of descriptors) {
          if (--remaining < 0) {
            exhausted = true; break;
          }
          if (found.Value !== undefined || found.Getter === Value.undefined) continue;
          if (!isIntrinsicPrototypeGetter(found.Getter)) {
            opaqueEffects.add(site); continue;
          }
          pendingPrototypeReads.push({ source: receiver, site });
          watch(receiver, (candidate) => {
            const base = propertiesOf(candidate);
            if (!base || (base.native ? base.native.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf : !base.ordinaryPrototypeMutation)) {
              opaque(to, site); return;
            }
            edge(prototypeAt(base, site), to);
          });
        }
      }
      if (object.native && !inheritedOrdinary && (key === undefined || descriptor?.Value === undefined && (!adapter || descriptor))) {
        if (site) opaqueEffects.add(site);
        add(to, 'opaque-value');
      }
      if (key === undefined) {
        if (object.native) for (const name of object.native.properties.keys()) {
          if (typeof name === 'string') slot(object, name);
          else if ('stringValue' in name) slot(object, name.stringValue());
        }
        edge(object.all, to);
      } else if (site && descriptor?.Value && object.native && options.nativeOrigins(descriptor.Value).length) {
        // Later ordinary stores must not retarget a captured intrinsic property.
        // Keep the initial value and only writes that may precede this lookup.
        nativeValue(intrinsicData(object.native, Value(key)), to);
        const seen = new Set<PropertyWrite>();
        const update = (): void => {
          for (const write of object.writes) {
            if (exhausted || --remaining < 0) {
              exhausted = true;
              return;
            }
            if (seen.has(write) || !matchingKey(key, write.key) || write.site && !beforePrototypeUse(write.site, site)) continue;
            seen.add(write); edge(write.source, to);
          }
        };
        object.writeUsers.add(update); update();
      } else edge(slot(object, key), to);
    }
  });
  const store = (base: Flow, key: string | undefined, from: Flow, site?: ParseNode, receiver = base, writeSite = site): void => watch(base, (value) => {
    if (value === 'global') {
      edge(from, slot(globalObject, key));
      if (site) globalWrites.push({ site, key });
    } else if (value === 'opaque-value' && site) opaqueEffects.add(site);
    else if (typeof value !== 'string') {
      const object = propertiesOf(value)!;
      if (site) prototypeEffects(base, site, key);
      object.mutations.add(key);
      if (object.native) {
        object.writes.push({ key, source: from, site: writeSite });
        for (const update of object.writeUsers) update();
      }
      edge(from, slot(object, key));
      accessHooks(object, key, receiver, site, undefined, from);
      if (site && object.native && (key === undefined || object.native.properties.get(Value(key))?.Value === undefined)) opaqueEffects.add(site);
    }
  });
  const remove = (base: Flow, key: string | undefined, site: ParseNode): void => watch(base, (value) => {
    if (value === 'global') globalWrites.push({ site, key });
    else if (value === 'opaque-value') opaqueEffects.add(site);
    else if (typeof value !== 'string') {
      const object = propertiesOf(value)!;
      if (object.native && object.native.Delete !== ObjectValue.prototype.Delete) opaqueEffects.add(site);
      // Deletion changes later lookup; it does not invoke an own getter/setter
      // and does not retract historical values from this may-flow graph.
      object.deletions.push({ key, site });
      for (const update of object.deletionUsers) update();
    }
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
  const pendingOperations: { source: Flow, result: Flow, site: ParseNode, copy?: boolean, arguments?: boolean, creationTarget?: Flow }[] = [];
  const pendingPrototypeReads: { source: Flow, site: ParseNode }[] = [];
  const pendingTypedDefinitions: { source: Flow, site: ParseNode }[] = [];
  const pendingPrototypeSources: { source: Flow, destination: Flow, defaultPrototype?: ObjectValue }[] = [];
  const pendingPrototypeTargets: { source: Flow, site: ParseNode }[] = [];
  const pendingKeys: { source: Flow, site: ParseNode }[] = [];
  const propertyKey = (source: Flow, site: ParseNode): void => {
    pendingKeys.push({ source, site });
  };
  // Empty carrier slots are bottom, but an expression with no primitive
  // evidence is unknown. Require every contributing expression to be primitive.
  const primitiveKeyState = (source: Flow, seen = new Set<Flow>()): 'bottom' | 'primitive' | 'unknown' => {
    if (source.values.size || seen.has(source) || seen.size >= 256 || exhausted) return 'unknown';
    if (--remaining < 0) {
      exhausted = true;
      return 'unknown';
    }
    seen.add(source);
    let proven = source.primitiveLiteral || source.knownPrimitive || source.expression && options.keyIsPrimitive(source.expression);
    for (const input of inputs.get(source) ?? []) {
      const state = primitiveKeyState(input, seen);
      if (state === 'unknown') {
        seen.delete(source);
        return state;
      }
      proven ||= state === 'primitive';
    }
    seen.delete(source);
    return proven ? 'primitive' : source.expression ? 'unknown' : 'bottom';
  };
  // Every contributing expression must supply evidence. Retain primitive kinds
  // only to distinguish null prototypes from ignored literal prototype values;
  // these facts do not establish a callable contract or execute a conversion.
  const unknownValue = 16, objectValue = 1, nullValue = 2, undefinedValue = 4, otherPrimitive = 8;
  const prototypeValueFacts = (source: Flow, ordinaryTarget: boolean, seen = new Set<Flow>()): number => {
    if (seen.has(source) || seen.size >= 256 || exhausted) return unknownValue;
    if (--remaining < 0) {
      exhausted = true;
      return unknownValue;
    }
    let facts = source.primitiveLiteral ? source.expression?.type === 'NullLiteral' ? nullValue : otherPrimitive : 0;
    if (source.knownPrimitive) {
      if (source.primitiveKinds) for (const kind of source.primitiveKinds) facts |= kind === 'null' ? nullValue : kind === 'undefined' ? undefinedValue : otherPrimitive;
      else facts |= otherPrimitive;
    }
    for (const value of source.values) {
      if (value === 'opaque-value' || value === 'global') return unknownValue;
      const object = propertiesOf(value);
      if (!object) continue;
      if (ordinaryTarget && (object.native ? object.native.SetPrototypeOf !== ObjectValue.prototype.SetPrototypeOf : !object.ordinaryPrototypeMutation)) return unknownValue;
      facts |= objectValue;
    }
    seen.add(source);
    for (const input of inputs.get(source) ?? []) {
      const inputFacts = prototypeValueFacts(input, ordinaryTarget, seen);
      if (inputFacts === unknownValue) {
        seen.delete(source);
        return unknownValue;
      }
      facts |= inputFacts;
    }
    seen.delete(source);
    return facts || (source.expression || source.values.size ? unknownValue : 0);
  };
  const setInitialPrototype = (object: Aggregate, source: Flow, defaultPrototype?: ObjectValue): void => {
    object.prototype = undefined;
    object.prototypeFlow = newFlow();
    object.initialPrototypeEffects = true;
    edge(source, object.prototypeFlow);
    pendingPrototypeSources.push({ source, destination: object.prototypeFlow, defaultPrototype });
  };
  const iterate = (source: Flow, site: ParseNode, index?: number): Flow => {
    prototypeEffects(source, site);
    const result = newFlow();
    pendingOperations.push({ source, result, site });
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
    // String copying enumerates UTF-16 index properties even though their
    // primitive values carry no capabilities. Target setters still see writes.
    for (let index = 0; index < (source.stringLength ?? 0); index += 1) {
      if (--remaining < 0) {
        exhausted = true;
        break;
      }
      if (!excluded.has(String(index))) slot(copy, String(index)).knownPrimitive = true;
    }
    pendingOperations.push({ source, result: slot(copy, undefined), site, copy: true });
    watch(source, (value) => {
      if (typeof value === 'string' || value.kind !== 'aggregate') {
        opaque(slot(copy, undefined), site);
      } else if (value.native) {
        accessHooks(value, undefined, source, site, (key, flow) => edge(flow, slot(copy, key)), undefined, excluded);
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
      } else {
        accessHooks(value, undefined, source, site, (key, flow) => edge(flow, slot(copy, key)), undefined, excluded);
        observeSlots(value, (key, flow) => {
          if (key === undefined || !excluded.has(key)) edge(flow, slot(copy, key));
        });
      }
    });
    return result;
  };
  const copiedProperties = (source: Flow, site: ParseNode, visit: (key: string | undefined, value: Flow) => void): void => {
    watch(copyRest(source, site), (object) => {
      if (typeof object === 'string' || object.kind !== 'aggregate') return;
      observeSlots(object, (key, flow) => {
        if (key !== undefined) visit(key, flow);
        else {
          let observed = false;
          watch(flow, () => {
            if (!observed) {
              observed = true;
              visit(key, flow);
            }
          });
        }
      });
    });
  };
  const descriptorField = (source: Flow, key: string, site: ParseNode, receiver = source, path = new Set<Aggregate>()): Flow => {
    prototypeEffects(source, site, key);
    const result = newFlow();
    watch(source, (value) => {
      if (typeof value === 'string' || value.kind !== 'aggregate') {
        opaque(result, site);
        return;
      }
      if (path.has(value) || path.size >= 256) {
        opaque(result, site);
        return;
      }
      const next = new Set(path); next.add(value);
      accessHooks(value, key, receiver, site, (_key, flow) => edge(flow, result));
      if (!value.native) {
        edge(slot(value, key), result);
        if (canInherit(value, key, site)) edge(descriptorField(initialPrototype(value), key, site, receiver, next), result);
        return;
      }
      let object: Value = value.native;
      const seen = new Set<Value>();
      while (object !== Value.null) {
        if (!(object instanceof ObjectValue) || object.Get !== ObjectValue.prototype.Get
          || object.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty || !('Prototype' in object) || seen.has(object)) {
          opaque(result, site);
          return;
        }
        seen.add(object);
        if (object !== value.native) {
          if (options.nativeOrigins(object).length) {
            opaque(result, site);
            return;
          }
          let prototype = native.get(object);
          if (!prototype) {
            prototype = { ...aggregate(), native: object };
            native.set(object, prototype);
          }
          accessHooks(prototype, key, receiver, site, (_key, flow) => edge(flow, result));
          observeSlots(prototype, (name, flow) => {
            if (matchingKey(name, key)) edge(flow, result);
          });
        }
        const descriptor = object.properties.get(Value(key));
        if (descriptor) {
          if (descriptor.Value === undefined) opaque(result, site);
          else nativeValue(descriptor.Value, result);
          break;
        }
        object = object.Prototype as Value;
      }
      // Preserve values installed through the current source, without turning
      // a proven absent optional field into an ordinary unknown Get.
      observeSlots(value, (name, flow) => {
        if (matchingKey(name, key)) edge(flow, result);
      });
    });
    return result;
  };
  const defineDescriptor = (target: Flow, key: string | undefined, descriptor: Flow, site: ParseNode, syntax?: ParseNode): void => {
    const fields = new Map(['enumerable', 'configurable', 'value', 'writable', 'type', 'get', 'set']
      .map((name) => [name, descriptorField(descriptor, name, site)]));
    pendingOperations.push({ source: descriptor, result: newFlow(), site, copy: true });
    // A present type may admit/convert/default a value using user code. Until
    // that operation has its own positive effect proof, preserve its effects.
    pendingTypedDefinitions.push({ source: fields.get('type')!, site });
    // Defining a property does not invoke its old setter.
    store(target, key, fields.get('value')!, undefined, target, site);
    let enumerable: boolean | undefined;
    let changesEnumerable = false;
    if (syntax?.type === 'ObjectLiteral') for (const property of syntax.PropertyDefinitionList) {
      if (property.type === 'PropertyDefinition' && property.PropertyName && options.propertyKey(property.PropertyName) === 'enumerable') {
        changesEnumerable = true;
        if (property.AssignmentExpression.type === 'BooleanLiteral') enumerable = property.AssignmentExpression.value;
      }
    }
    watch(target, (value) => {
      if (typeof value === 'string') {
        if (value === 'global') globalWrites.push({ site, key });
        if (value === 'opaque-value') opaqueEffects.add(site);
        return;
      }
      const object = propertiesOf(value)!;
      object.mutations.add(key);
      if (object.native && object.native.DefineOwnProperty !== ObjectValue.prototype.DefineOwnProperty) opaqueEffects.add(site);
      object.hooks.push({ key, get: fields.get('get')!, set: fields.get('set')!, site, enumerable });
      if (changesEnumerable) object.enumerability.push({ key, site, value: enumerable });
      for (const update of object.hookUsers) update();
    });
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
    pendingOperations.push({ source, result: slot(copy, undefined), site });
    return result;
  };
  const target = (value: unknown, source: Flow, site?: ParseNode): void => {
    if (!isNode(value)) return;
    const node = value;
    if (node.type === 'BindingIdentifier' || node.type === 'IdentifierReference') {
      edge(source, binding(node, node.name));
      if (options.globalBinding(node as ParseNode.IdentifierReference)) edge(source, slot(globalObject, node.name));
    } else if (node.type === 'MemberExpression') store(expression(node.MemberExpression), options.key(node), source, site);
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
    const result = { kind: 'callable' as const, parameters, result: newFlow(), receiver: newFlow(), properties: functionProperties(node) };
    functions.set(node, result);
    return result;
  };
  const copyArguments = (source: Flow, destination: Aggregate, start: number, offset: number, site?: ParseNode): void => {
    watch(source, (entry) => {
      const object = propertiesOf(entry);
      if (!object) {
        edge(project(source, undefined, site), slot(destination, undefined));
        return;
      }
      if (object.native) {
        const length = intrinsicData(object.native, Value('length'));
        const count = length instanceof NumberValue ? R(length) : undefined;
        if (count === undefined || !Number.isSafeInteger(count) || count < 0 || count > 256) {
          edge(project(source, undefined, site), slot(destination, undefined));
          return;
        }
        for (let index = start; index < count; index += 1) edge(project(source, String(index), site), slot(destination, String(index - start + offset)));
      } else observeSlots(object, (key, input) => {
        if (key === undefined) edge(input, slot(destination, undefined));
        else if (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) >= start) edge(input, slot(destination, String(Number(key) - start + offset)));
      });
    });
  };
  const argumentTail = (packed: Flow, site?: ParseNode): Flow => {
    const tail = aggregate(true), flow = newFlow(); add(flow, tail);
    copyArguments(packed, tail, 1, 0, site);
    return flow;
  };
  const invoke = (callee: Flow, args: readonly Flow[], receiver: Flow, result: Flow, packed?: Flow, site?: ParseNode, argumentNodes?: readonly ParseNode[]): void => watch(callee, (value) => {
    if (value === 'eval' || value === 'dynamic-function') {
      if (site) opaqueEffects.add(site);
    }
    if (value === 'function-call' || value === 'function-apply' || value === 'function-bind') {
      const argument = (index: number): Flow => packed ? project(packed, String(index), site) : args[index] ?? newFlow();
      if (value === 'function-bind') {
        project(receiver, 'length', site); project(receiver, 'name', site);
        const properties = functionProperties();
        properties.prototype = undefined;
        properties.prototypeFlow = newFlow();
        watch(receiver, (target) => {
          const object = propertiesOf(target);
          if (!object) {
            if (target === 'opaque-value') add(properties.prototypeFlow!, target);
          } else edge(prototypeAt(object, site), properties.prototypeFlow!);
        });
        add(result, { kind: 'bound', callee: receiver, arguments: packed ? [] : args.slice(1),
          packed: packed ? argumentTail(packed, site) : undefined, receiver: argument(0), properties });
      } else if (value === 'function-apply') {
        const argumentsObject = packed || args.length > 1 ? argument(1) : undefined;
        if (argumentsObject?.expression?.type === 'NullLiteral') invoke(receiver, [], argument(0), result, undefined, site);
        else {
          if (argumentsObject && site) {
            project(argumentsObject, 'length', site);
            pendingOperations.push({ source: argumentsObject, result: newFlow(), site, arguments: true });
          }
          invoke(receiver, [], argument(0), result, argumentsObject, site);
        }
      } else if (packed) {
        invoke(receiver, [], argument(0), result, argumentTail(packed, site), site);
      } else invoke(receiver, args.slice(1), argument(0), result, undefined, site, argumentNodes?.slice(1));
      return;
    }
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
      if (packed || value.packed) {
        const combined = aggregate(), flow = newFlow(); add(flow, combined);
        value.arguments.forEach((argument, index) => edge(argument, slot(combined, String(index))));
        // Unknown arity is a wildcard contribution, never an ignored suffix.
        if (value.packed) {
          edge(project(value.packed, undefined, site), slot(combined, undefined));
          args.forEach((argument) => edge(argument, slot(combined, undefined)));
        }
        if (packed) {
          if (value.packed) edge(project(packed, undefined, site), slot(combined, undefined));
          else copyArguments(packed, combined, 0, value.arguments.length, site);
        }
        invoke(value.callee, [], value.receiver, result, flow, site);
      } else invoke(value.callee, [...value.arguments, ...args], value.receiver, result, undefined, site);
      return;
    }
    if (site && typeof value === 'string') {
      const argument = (index: number): Flow => packed ? project(packed, String(index), site) : args[index] ?? newFlow();
      const key = !packed && argumentNodes?.[1] ? options.propertyKey(argumentNodes[1]) : undefined;
      if (['set', 'defineProperty', 'reflect-defineProperty', 'deleteProperty'].includes(value)) propertyKey(argument(1), site);
      if (value === 'create') {
        const object = aggregate(), created = newFlow(); add(created, object); add(result, object);
        setInitialPrototype(object, argument(0));
        const omitted = packed?.expression?.type === 'ArrayLiteral' && packed.expression.ElementList.length <= 1
          && packed.expression.ElementList.every((part) => part.type !== 'SpreadElement');
        if (!omitted && (packed || args.length > 1)) pendingOperations.push({ source: argument(1), result: newFlow(), site, creationTarget: created });
        const syntax = !packed ? argumentNodes?.[1] : undefined;
        // This fresh table cannot escape before the call. No getter/decorator
        // may delete a later descriptor entry while its own keys are consumed.
        if (syntax?.type === 'ObjectLiteral' && !syntax.Decorators?.length && syntax.PropertyDefinitionList.every((property) =>
          property.type === 'IdentifierReference' || property.type === 'PropertyDefinition' && property.PropertyName)) {
          for (const property of syntax.PropertyDefinitionList) {
            if (property.type === 'IdentifierReference') object.ownKeys.add(property.name);
            else if (property.type === 'PropertyDefinition' && property.PropertyName) {
              const name = options.propertyKey(property.PropertyName);
              if (name !== undefined && !(name === '__proto__' && ['IdentifierName', 'StringLiteral'].includes(property.PropertyName.type))) object.ownKeys.add(name);
            }
          }
        }
      }
      if (value === 'setPrototypeOf' || value === 'reflect-setPrototypeOf') {
        const target = argument(0), source = argument(1);
        pendingPrototypeTargets.push({ source: target, site });
        watch(target, (targetValue) => {
          if (targetValue === 'global') {
            globalWrites.push({ site });
            return;
          }
          if (targetValue === 'opaque-value') {
            opaqueEffects.add(site);
            return;
          }
          const object = propertiesOf(targetValue);
          if (!object) return;
          if (object.native ? object.native.SetPrototypeOf !== ObjectValue.prototype.SetPrototypeOf : !object.ordinaryPrototypeMutation) {
            opaqueEffects.add(site); return;
          }
          object.prototypes.push({ source, site });
          for (const update of object.prototypeUsers) update();
        });
        if (value === 'setPrototypeOf') edge(target, result);
        else result.knownPrimitive = true;
      }
      if (value === 'set') {
        const receiver = newFlow();
        edge(argument(0), receiver);
        if (packed || args.length > 3) edge(argument(3), receiver);
        store(argument(0), key, argument(2), site, receiver);
      }
      if (value === 'deleteProperty') remove(argument(0), key, site);
      if (value === 'defineProperty' || value === 'reflect-defineProperty') {
        defineDescriptor(argument(0), key, argument(2), site, argumentNodes?.[2]);
        if (value === 'defineProperty') edge(argument(0), result);
      }
      if (value === 'assign') {
        edge(argument(0), result);
        const sources = packed ? [project(packed, undefined, site)] : args.slice(1);
        for (const source of sources) copiedProperties(source, site, (name, flow) => store(argument(0), name, flow, site));
      }
      if (value === 'defineProperties') {
        edge(argument(0), result);
        copiedProperties(argument(1), site, (name, descriptor) => defineDescriptor(argument(0), name, descriptor, site));
      }
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
      if (parent.type === 'AssignmentExpression') return parent.AssignmentOperator === '=' && parent.LeftHandSideExpression === at;
      if (parent.type === 'ForOfStatement' || parent.type === 'ForAwaitStatement') return parent.LeftHandSideExpression === at;
      if (!['ArrayLiteral', 'ObjectLiteral', 'PropertyDefinition', 'SpreadElement', 'AssignmentRestElement', 'ParenthesizedExpression'].includes(parent.type)) return false;
    }
    return false;
  };
  const deletionOperand = (node: ParseNode): ParseNode => {
    while (node.type === 'ParenthesizedExpression') node = node.Expression;
    return node.type === 'OptionalExpression' && node.MemberExpression.type !== 'NullLiteral' ? options.optional(node) : node;
  };
  const isDeleteTarget = (node: ParseNode): boolean => {
    let at = node;
    while (at.parent?.type === 'ParenthesizedExpression') at = at.parent;
    const parent = at.parent;
    return parent?.type === 'UnaryExpression' && parent.operator === 'delete' && deletionOperand(parent.UnaryExpression) === node;
  };
  const expression = (value: unknown): Flow => {
    if (!isNode(value)) return newFlow();
    const node = value;
    const previous = expressions.get(node);
    if (previous) return previous;
    const result = newFlow();
    expressions.set(node, result);
    result.expression = node;
    if (['NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node.type)) result.primitiveLiteral = true;
    if (node.type === 'StringLiteral') result.stringLength = node.value.length;
    if (exhausted) return result;
    if (++depth > 256) {
      exhausted = true;
      depth -= 1;
      return result;
    }
    for (const kind of options.scalar(node)) add(result, kind);
    if (node.type === 'NewExpression') prototypeEffects(expression(node.MemberExpression), node);
    if (node.type === 'ClassTail' && node.ClassHeritage) prototypeEffects(expression(node.ClassHeritage), node);
    if (node.type === 'ForInStatement') prototypeEffects(expression(node.Expression), node);
    if (node.type === 'AwaitExpression') prototypeEffects(expression(node.UnaryExpression), node);
    if (node.type === 'TemplateLiteral' && node.parent?.type !== 'CallExpression' && node.parent?.type !== 'MemberExpression') {
      node.ExpressionList.forEach((part) => prototypeEffects(expression(part), node));
    }
    if (node.type === 'ExponentiationExpression' || node.type === 'UpdateExpression'
      || typeof node.operator === 'string' && !['delete', 'typeof', 'void', '!', '===', '!==', '&&', '||', '??'].includes(node.operator)) {
      for (const [key, part] of Object.entries(node)) if (key !== 'parent' && isNode(part)) prototypeEffects(expression(part), node);
    }

    if (node.type === 'IdentifierReference') {
      edge(binding(node, node.name), result);
      if (options.globalBinding(node)) edge(slot(globalObject, node.name), result);
      nativeValue(options.external(node), result);
    } else if (['ParenthesizedExpression', 'TypeArgumentsExpression'].includes(node.type)) edge(expression(node.Expression), result);
    else if (node.type === 'OptionalExpression') {
      if (node.MemberExpression.type !== 'NullLiteral') edge(expression(options.optional(node)), result);
    } else if (node.type === 'CommaOperator') edge(expression(node.ExpressionList.at(-1)), result);
    else if (node.type === 'ConditionalExpression') {
      if (node.ShortCircuitExpression.type === 'BooleanLiteral') {
        edge(expression(node.ShortCircuitExpression.value ? node.AssignmentExpression_a : node.AssignmentExpression_b), result);
      } else {
        edge(expression(node.AssignmentExpression_a), result); edge(expression(node.AssignmentExpression_b), result);
      }
    } else if (node.type === 'AssignmentExpression' && node.AssignmentOperator === '=') {
      edge(expression(node.AssignmentExpression), result);
      target(node.LeftHandSideExpression, result, node);
    } else if ((node.type === 'ObjectLiteral' || node.type === 'ArrayLiteral') && !isAssignmentTarget(node)) {
      const object = aggregate(node.type === 'ArrayLiteral' && !node.ElementList.some((part) => part.type === 'Elision')); add(result, object);
      if (node.type === 'ObjectLiteral') object.prototype = options.objectPrototype;
      if (node.type === 'ArrayLiteral') {
        object.ownKeys.add('length');
        let fixedIndex = true;
        node.ElementList.forEach((part, index) => {
          if (part.type === 'SpreadElement') {
            fixedIndex = false;
            edge(iterate(expression(part.AssignmentExpression), part), slot(object, undefined));
          } else {
            if (fixedIndex && part.type !== 'Elision') object.ownKeys.add(String(index));
            edge(expression(part), slot(object, fixedIndex ? String(index) : undefined));
          }
        });
      } else for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') {
          object.ownKeys.add(property.name);
          edge(expression(property), slot(object, property.name));
        } else if (property.type === 'PropertyDefinition') {
          if (property.PropertyName) {
            const key = options.propertyKey(property.PropertyName);
            if (key === '__proto__' && ['IdentifierName', 'StringLiteral'].includes(property.PropertyName.type)) {
              setInitialPrototype(object, expression(property.AssignmentExpression), options.objectPrototype);
            } else {
              if (key !== undefined) object.ownKeys.add(key);
              edge(expression(property.AssignmentExpression), slot(object, key));
            }
          } else edge(project(expression(property.AssignmentExpression), undefined, property), slot(object, undefined));
        } else if (property.type === 'MethodDefinition') {
          const key = options.propertyKey(property.ClassElementName);
          if (key !== undefined) object.ownKeys.add(key);
          if (property.UniqueFormalParameters !== null) edge(expression(property), slot(object, key));
          else {
            const get = newFlow(), set = newFlow();
            edge(expression(property), property.PropertySetParameterList === null ? get : set);
            object.hooks.push({ key, get, set, site: property, enumerable: true });
            for (const update of object.hookUsers) update();
          }
        }
      }
    } else if (node.type === 'AssignmentRestElement' || node.type === 'SpreadElement') {
      if (!isAssignmentTarget(node)) edge(iterate(expression(node.AssignmentExpression), node), result);
    } else if (node.type === 'YieldExpression' && node.hasStar) {
      // Retain the independently proven local resumed-input boundary. This
      // does not establish that arbitrary generator execution is effect-free.
      if (options.provenDelegations.has(node)) add(result, 'opaque-value');
      else edge(iterate(expression(node.AssignmentExpression), node), result);
    } else if (node.type === 'RelationalExpression' && node.operator === 'in' && !node.PrivateIdentifier) {
      propertyKey(expression(node.RelationalExpression), node);
    } else if (node.type === 'PropertyName') {
      propertyKey(expression(node.ComputedPropertyName), node);
    } else if (node.type === 'MemberExpression') {
      if (node.Expression) propertyKey(expression(node.Expression), node);
      const writeOnly = isAssignmentTarget(node) || isDeleteTarget(node);
      if (!writeOnly) load(expression(node.MemberExpression), options.key(node), result, node);
      if (!writeOnly && ['call', 'apply', 'bind'].includes(options.key(node) ?? '')) pendingOperations.push({ source: result, result, site: node, copy: true });
    } else if (parameterKeys.some((key) => key in node)) {
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
    } else if (node.type === 'UnaryExpression' && node.operator === 'delete') {
      const operand = deletionOperand(node.UnaryExpression);
      if (operand.type === 'MemberExpression') remove(expression(operand.MemberExpression), options.key(operand), node);
    } else if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      let callee: ParseNode = node.type === 'CallExpression' ? node.CallExpression : node.MemberExpression;
      while (callee.type === 'ParenthesizedExpression') callee = callee.Expression;
      const argumentNodes: readonly ParseNode.ArgumentListElement[] = node.Arguments ?? [];
      const args = argumentNodes.map(expression);
      const receiver = callee.type === 'MemberExpression' ? expression(callee.MemberExpression) : newFlow();
      let packed: Flow | undefined;
      if (!packed && argumentNodes.some((argument) => argument.type === 'AssignmentRestElement')) {
        const argumentsObject = aggregate(true); packed = newFlow(); add(packed, argumentsObject);
        let uncertain = false;
        argumentNodes.forEach((argument, index) => {
          uncertain ||= argument.type === 'AssignmentRestElement';
          edge(args[index], slot(argumentsObject, uncertain ? undefined : String(index)));
        });
      }
      invoke(expression(callee), args, receiver, result, packed, node, argumentNodes);
    }
    depth -= 1;
    return result;
  };
  for (const value of nodes) {
    const node = value as Node;
    expression(node);
    if (node.type === 'AssignmentExpression' && node.AssignmentOperator !== '=') target(node.LeftHandSideExpression, expression(node.AssignmentExpression), node);
    if (node.type === 'UpdateExpression') target(node.LeftHandSideExpression ?? node.UnaryExpression, newFlow(), node);
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
  let index = 0, prototypeIndex = 0;
  while (index < pendingOperations.length || prototypeIndex < pendingPrototypeSources.length) {
    const end = pendingOperations.length;
    for (; index < end; index += 1) {
      const request = pendingOperations[index];
      if (request.creationTarget) {
        const facts = prototypeValueFacts(request.source, false);
        if (!facts || facts === unknownValue || facts & objectValue) copiedProperties(request.source, request.site,
          (name, descriptor) => defineDescriptor(request.creationTarget!, name, descriptor, request.site));
        continue;
      }
      if (request.arguments) watch(request.source, (value) => {
        const object = propertiesOf(value);
        if (!object) {
          opaqueEffects.add(request.site);
          return;
        }
        if (object.native) {
          const length = intrinsicData(object.native, Value('length'));
          const count = length instanceof NumberValue ? R(length) : undefined;
          if (count === undefined || !Number.isSafeInteger(count) || count < 0 || count > 256 || object.hooks.length
            || object.mutations.has('length') || object.mutations.has(undefined)) {
            opaqueEffects.add(request.site);
          } else {
            for (let index = 0; index < count; index += 1) project(request.source, String(index), request.site);
          }
        } else if (object.array) {
          observeSlots(object, (key) => {
            if (key !== undefined && /^(0|[1-9][0-9]*)$/.test(key)) project(request.source, key, request.site);
          });
          if (inputs.get(slot(object, undefined))?.size || object.hooks.length
            || object.mutations.has('length') || object.mutations.has(undefined)) opaqueEffects.add(request.site);
        } else opaqueEffects.add(request.site);
      });
      if (!request.source.values.size && !(request.copy && (request.source.primitiveLiteral || request.source.knownPrimitive))) opaque(request.result, request.site);
    }
    settle();
    if (index < pendingOperations.length) continue;
    const prototypeEnd = pendingPrototypeSources.length;
    for (; prototypeIndex < prototypeEnd; prototypeIndex += 1) {
      const request = pendingPrototypeSources[prototypeIndex];
      const facts = prototypeValueFacts(request.source, false);
      if (!facts || facts === unknownValue) add(request.destination, 'opaque-value');
      else if (request.defaultPrototype && (facts & (undefinedValue | otherPrimitive))) nativeValue(request.defaultPrototype, request.destination);
    }
    settle();
  }
  for (const request of pendingPrototypeReads) {
    const facts = prototypeValueFacts(request.source, false);
    if (!facts || facts === unknownValue) opaqueEffects.add(request.site);
  }
  for (const request of pendingTypedDefinitions) {
    if (prototypeValueFacts(request.source, false) !== 0) opaqueEffects.add(request.site);
  }
  for (const request of pendingPrototypeTargets) {
    const facts = prototypeValueFacts(request.source, true);
    if (!facts || facts === unknownValue) opaqueEffects.add(request.site);
  }
  for (const request of pendingKeys) {
    if (primitiveKeyState(request.source) !== 'primitive') opaqueEffects.add(request.site);
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
          if (value.packed) visit(value.packed);
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
    globalWrites: () => globalWrites,
  };
}
