import { R } from '../abstract-ops/spec-types.mts';
import { HasOwnClassOperator, HasOwnClassConversion } from '../abstract-ops/runtime-types.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { JSStringValue, NumberValue, ObjectValue, Value } from '../value.mts';
import { intrinsicData } from './intrinsic-origin.mts';
import { isIntrinsicPrototypeGetter } from './intrinsic-effect-origin.mts';
import { OrdinaryDataReadSupported } from './runtime.mts';
import { ScalarRestOwner } from './scalar-rests.mts';
import { CompletionPaths } from './completion-values.mts';

type Node = ParseNode & Record<string, unknown>;
type AdmissionProof = (source: ParseNode | undefined, target: ParseNode.Type, admitted?: ParseNode.Type) => boolean;
type AdmissionEffect = { site: ParseNode, transparent: (proof: AdmissionProof) => boolean };
type Flow = { admittedType?: ParseNode.Type, absent?: boolean, primitiveContract?: string, values: Set<Candidate>, users: Set<(value: Candidate) => void>, primitiveLiteral?: boolean, knownPrimitive?: boolean, primitiveKinds?: Set<'null' | 'undefined' | 'other'>, stringLength?: number, expression?: ParseNode };
type Hook = { key: string | undefined, get: Flow, set: Flow, site: ParseNode, enumerable?: boolean };
type IndexHook = { arity: number, get?: Flow, set?: Flow, site: ParseNode };
type ClassNode = ParseNode.ClassDeclaration | ParseNode.ClassExpression;
type PropertyWrite = { key: string | undefined, source: Flow, site?: ParseNode };
type PrototypeChange = { source: Flow, site: ParseNode };
type Aggregate = { kind: 'aggregate', sourceClass?: ClassNode, classPrototype?: ClassNode, classOperators?: boolean, indexHooks?: IndexHook[], typedKeys: Set<string | undefined>, writes: PropertyWrite[], writeUsers: Set<() => void>, ordinaryPrototypeMutation: boolean, initialPrototypeEffects?: boolean, ownKeys: Set<string>, prototypes: PrototypeChange[], prototypeUsers: Set<() => void>, deletions: { key?: string, site: ParseNode }[], deletionUsers: Set<() => void>, hooks: Hook[], hookUsers: Set<() => void>, enumerability: { key: string | undefined, site: ParseNode, value?: boolean }[], slots: Map<string | undefined, Flow>, all: Flow, native?: ObjectValue, prototype?: ObjectValue, prototypeFlow?: Flow, mutations: Set<string | undefined>, array?: boolean,
  slotUsers: Set<(key: string | undefined, flow: Flow) => void> };
type Callable = { kind: 'callable', definition: ParseNode, sites: Set<ParseNode>, parameters: readonly Node[], result: Flow, receiver: Flow, properties: Aggregate };
type Bound = { kind: 'bound', callee: Flow, arguments: readonly Flow[], packed?: Flow, receiver: Flow, properties: Aggregate };
type Candidate = string | Aggregate | Callable | Bound;
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';
const parameterKeys = ['FormalParameters', 'ArrowParameters', 'UniqueFormalParameters', 'PropertySetParameterList'];
const newFlow = (): Flow => ({ values: new Set(), users: new Set() });

// A `null` stored where the annotation admits null converts nothing, whatever
// else the annotation names.
const admitsNull = (type: ParseNode.Type): boolean => (type.type === 'PredefinedType' && type.keyword === 'null')
  || (type.type === 'UnionType' && type.Types.some(admitsNull));

// An imaginary literal makes a fresh complex value, and negating one is the
// built-in negation: a literal's plain receiver takes no operator block.
const literalInitializer = (value: unknown): boolean => {
  if (!isNode(value)) return false;
  if (value.type === 'UnaryExpression' && value.operator === '-') return (value.UnaryExpression as Node | undefined)?.type === 'NumericLiteral';
  return ['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral'].includes(value.type);
};

/**
 * #sec-class-value-origin-order, #sec-elision-stability: whether constructing a
 * source class runs no user code. Heritage other than a transparently
 * constructed class nothing reassigns, a decorator, an explicit constructor or
 * an instance field computed by an expression could. Methods,
 * accessors and operators run only when invoked, and static elements when the
 * class is defined, so none of them belongs to construction. A literal stored
 * in an untyped or intrinsic field converts nothing. A generic, partial or
 * otherwise modified class is not judged from this one body.
 */
export function TransparentlyConstructedClass(node: ClassNode, intrinsicAdmission: (type: ParseNode.Type) => string | undefined,
  propertyKey: (node: ParseNode) => string | undefined, parentClass?: (heritage: ParseNode) => ClassNode | undefined,
  seen = new Set<ClassNode>()): boolean {
  const tail = node.ClassTail;
  if (node.Decorators?.length || node.TypeParameters || node.ClassModifiers?.length || tail.WhereClauses?.length || seen.has(node)) return false;
  // A default derived constructor runs only its parent's construction: it
  // reads its own prototype, an ordinary function's, and passes the
  // arguments through without the iterator protocol.
  if (tail.ClassHeritage) {
    seen.add(node);
    const parent = parentClass?.(tail.ClassHeritage);
    if (!parent || !TransparentlyConstructedClass(parent, intrinsicAdmission, propertyKey, parentClass, seen)) return false;
  }
  for (const element of tail.ClassBody ?? []) {
    if ((element as { Decorators?: readonly unknown[] | null }).Decorators?.length) return false;
    switch (element.type) {
      case 'MethodDefinition': case 'GeneratorMethod': case 'AsyncMethod': case 'AsyncGeneratorMethod':
        if (!element.static && element.ClassElementName.type !== 'PrivateIdentifier'
          && propertyKey(element.ClassElementName) === 'constructor') return false;
        break;
      case 'FieldDefinition':
        if (element.static) break;
        if (element.accessor || element.Initializer && !literalInitializer(element.Initializer)
          || element.TypeAnnotation && !intrinsicAdmission(element.TypeAnnotation.Type)
            && !(element.Initializer?.type === 'NullLiteral' && admitsNull(element.TypeAnnotation.Type))) return false;
        break;
      case 'OperatorDefinition': case 'ClassStaticBlock':
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * Inclusion-based, allocation/property-sensitive may-flow for global effects.
 * Values only accumulate. Calls connect arguments/returns; they execute no
 * code and establish neither a public contract nor a stable implementation.
 */
export function GlobalEffectValues(nodes: readonly ParseNode[], options: {
  functionPrototype: (node?: ParseNode) => ObjectValue,
  objectPrototype: ObjectValue,
  arrayPrototype: ObjectValue,
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
  intrinsicAdmission: (type: ParseNode.Type) => string | undefined,
  admissionType: (node: ParseNode) => ParseNode.Type | undefined,
  primitiveConversion: (node: ParseNode.TypedConversionExpression) => boolean,
  opaqueGlobalRead: (node: ParseNode.IdentifierReference) => boolean,
  opaqueGlobalStore: (key: string | undefined) => boolean,
  nativeOrigins: (value: Value) => readonly string[],
  globalData: (key: string) => Value | undefined,
  unknown: readonly string[],
  optional: (node: ParseNode) => ParseNode,
  /** The class declaration a heritage expression names through a binding nothing writes. */
  parentClass?: (heritage: ParseNode) => ClassNode | undefined,
}): {
  boundInvocation: (node: ParseNode | undefined) => boolean,
  origins: (node: ParseNode | undefined) => Set<string>,
  contained: (node: ParseNode | undefined) => Set<string>,
  element: (node: ParseNode | undefined, index: number) => Set<string>,
  exhausted: () => boolean,
  opaqueEffects: () => ReadonlySet<ParseNode>,
  admissionEffects: () => readonly AdmissionEffect[],
  executionSites: (site: ParseNode, within?: ParseNode, canProject?: (site: ParseNode, callable: ParseNode) => boolean) => readonly ParseNode[] | undefined,
  activationMayRepeat: (site: ParseNode) => boolean,
  globalWrites: () => readonly { site: ParseNode, key?: string }[],
} {
  const expressions = new Map<ParseNode, Flow>();
  const bindings = new Map<object, Flow>();
  const functions = new Map<ParseNode, Callable>();
  const native = new Map<ObjectValue, Aggregate>();
  const opaqueEffects = new Set<ParseNode>();
  const admissionEffects: AdmissionEffect[] = [];
  const directSources = new Set<Flow>();
  const globalWrites: { site: ParseNode, key?: string }[] = [];
  // The transparency judgment of each class, the prototype of each
  // transparently constructed one, and its instances by construction site.
  const transparentClasses = new Map<ClassNode, boolean>();
  const classPrototypes = new Map<ClassNode, Aggregate>();
  const instances = new Map<ParseNode, Map<ClassNode, Aggregate>>();
  const transparentClass = (node: ClassNode): boolean => {
    let answer = transparentClasses.get(node);
    if (answer === undefined) {
      answer = TransparentlyConstructedClass(node, options.intrinsicAdmission, options.propertyKey, options.parentClass);
      transparentClasses.set(node, answer);
    }
    return answer;
  };
  const queue: [Candidate, (value: Candidate) => void][] = [];
  // Bound propagation work, not elapsed time. Exhaustion loses precision; it
  // must never become evidence that an effect cannot occur.
  let remaining = Math.min(1048576, Math.max(16384, nodes.length * 128));
  let exhausted = false;
  let depth = 0;
  const add = (to: Flow, value: Candidate, propagated = false): void => {
    if (!propagated) directSources.add(to);
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
    watch(from, (value) => add(to, value, true));
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
  const aggregate = (array = false): Aggregate => ({ kind: 'aggregate', typedKeys: new Set(), writes: [], writeUsers: new Set(), ordinaryPrototypeMutation: true, ownKeys: new Set(), prototypes: [], prototypeUsers: new Set(), deletions: [], deletionUsers: new Set(), hooks: [], hookUsers: new Set(), enumerability: [], slots: new Map(), all: newFlow(), mutations: new Set(), array, slotUsers: new Set() });
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
        else if (descriptor) add(found, 'opaque-value');
      }
    }
    for (const user of object.slotUsers) user(key, found);
    return found;
  };
  const deferred = (node: ParseNode): boolean => {
    let child = node;
    for (let at = node.parent; at; child = at, at = at.parent) {
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition')
        && (at.ClassElementName === child || at.Decorators?.some((decorator) => decorator === child))) continue;
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
        if (observed.has(hook) || !matchingKey(key, hook.key) || !beforePrototypeUse(hook.site, site)
          || hook.key !== undefined && excluded?.has(hook.key)) continue;
        if (excluded && hook.enumerable === false && !object.enumerability.some((change) => change.value !== false
          && matchingKey(change.key, hook.key) && mayPrecede(hook.site, change.site) && mayPrecede(change.site, site))) continue;
        observed.add(hook);
        const result = newFlow();
        invoke(written ? hook.set : hook.get, written ? [written] : [], receiver, result, undefined, site, undefined, true);
        read?.(hook.key, result);
      }
    };
    object.hookUsers.add(update);
    update();
  };
  const globalPropertyAt = (key: string | undefined, to: Flow, site?: ParseNode): void => {
    const seen = new Set<PropertyWrite>();
    const update = (): void => {
      for (const write of globalObject.writes) {
        if (exhausted || --remaining < 0) {
          exhausted = true; return;
        }
        if (seen.has(write) || !matchingKey(key, write.key) || write.site && !beforePrototypeUse(write.site, site)) continue;
        seen.add(write); edge(write.source, to);
      }
    };
    globalObject.writeUsers.add(update); update();
  };
  const load = (base: Flow, key: string | undefined, to: Flow, site?: ParseNode, receiver = base, path = new Set<Aggregate>()): void => {
    if (site) pendingLoads.push({ source: base, result: to, key, site });
    watch(base, (value) => {
      if (typeof value === 'string') {
        if (value === 'opaque-value') {
          add(to, value);
          if (site) opaqueEffects.add(site);
        }
        if (value === 'global') globalPropertyAt(key, to, site);
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
        if (object.sourceClass && key !== 'prototype') {
          if (site) opaque(to, site);
          else add(to, 'opaque-value');
          return;
        }
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
  };
  const recordDataWrite = (object: Aggregate, key: string | undefined, from: Flow, site?: ParseNode): void => {
    object.mutations.add(key);
    object.writes.push({ key, source: from, site });
    for (const update of object.writeUsers) update();
    edge(from, slot(object, key));
  };
  const receiverAdmissionEffects = (receiver: Flow, key: string | undefined, site: ParseNode): void => watch(receiver, (value) => {
    const object = propertiesOf(value);
    if (!object) {
      if (value === 'opaque-value') opaqueEffects.add(site);
      return;
    }
    pendingTypedStores.push({ object, key, site });
    if (!object.native) return;
    // Base [[Set]] also implements proposal storage admission. Its ordinary
    // method identity alone is not proof that this receiver runs no user code.
    if (!OrdinaryDataReadSupported(object.native)) opaqueEffects.add(site);
    const typed = object.native as ObjectValue & { TypedProperties?: ReadonlyMap<unknown, unknown>, TypedElement?: unknown, TypedTuple?: unknown };
    if (key === undefined ? typed.TypedProperties?.size : typed.TypedProperties?.has(key)) opaqueEffects.add(site);
    if ((key === undefined || /^(0|[1-9][0-9]*)$/.test(key))
      && (typed.TypedElement !== undefined || typed.TypedTuple !== undefined || ScalarRestOwner(typed).ScalarRestGuards?.length)) opaqueEffects.add(site);
  });
  const dataReceiverStore = (receiver: Flow, key: string | undefined, from: Flow, site: ParseNode): void => watch(receiver, (value) => {
    if (value === 'global') {
      globalWrites.push({ site, key }); recordDataWrite(globalObject, key, from, site); return;
    }
    const object = propertiesOf(value);
    if (!object) {
      if (value === 'opaque-value') opaqueEffects.add(site);
      return;
    }
    if (object.native) {
      if (object.native.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty
        || object.native.DefineOwnProperty !== ObjectValue.prototype.DefineOwnProperty) opaqueEffects.add(site);
      const own = key === undefined ? undefined : object.native.properties.get(Value(key));
      if (own && (own.Getter !== undefined || own.Setter !== undefined || own.Writable === Value.false)) return;
    }
    recordDataWrite(object, key, from, site);
  });
  // Ordinary [[Set]] chooses an own/inherited setter with the original
  // receiver. A data write is defined on Receiver, not its lookup target.
  const storeEffects = (base: Flow, key: string | undefined, from: Flow, receiver: Flow, site: ParseNode,
    path = new Set<Aggregate>()): void => watch(base, (value) => {
    const object = propertiesOf(value);
    if (!object) {
      if (value === 'opaque-value' || value === 'global' && path.size) opaqueEffects.add(site);
      return;
    }
    if (path.has(object) || path.size >= 256) {
      opaqueEffects.add(site); return;
    }
    const next = new Set(path); next.add(object);
    if (object.native ? object.native.Set !== ObjectValue.prototype.Set
      || object.native.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty
      || object.native.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf : !object.ordinaryPrototypeMutation) {
      opaqueEffects.add(site); return;
    }
    receiverAdmissionEffects(receiver, key, site);
    accessHooks(object, key, receiver, site, undefined, from);
    if (object.native) {
      const descriptor = key === undefined ? undefined : object.native.properties.get(Value(key));
      const descriptors = key === undefined ? object.native.properties.values() : descriptor ? [descriptor] : [];
      for (const found of descriptors) {
        if (--remaining < 0) {
          exhausted = true; return;
        }
        if (found.Value !== undefined) {
          if (found.Writable !== Value.false) dataReceiverStore(receiver, key, from, site);
        } else if (found.Setter !== Value.undefined && found.Setter !== undefined) {
          const setter = newFlow(); nativeValue(found.Setter, setter);
          invoke(setter, [from], receiver, newFlow(), undefined, site);
        }
      }
    } else if (key === undefined || object.ownKeys.has(key)) {
      // Source descriptor transitions still join candidates. This data route
      // is a may-write, not proof that an accessor was bypassed or replaced.
      dataReceiverStore(receiver, key, from, site);
    }
    const followSource = (source: Flow): void => {
      storeEffects(source, key, from, receiver, site, next);
      pendingStoreEnds.push({ source, receiver, key, from, site });
    };
    let followed = false;
    const follow = (): void => {
      if (followed || !canInherit(object, key, site)) return;
      followed = true;
      followSource(initialPrototype(object));
    };
    object.deletionUsers.add(follow); follow();
    observePrototypes(object, site, (change) => {
      // Relinking performed by this very setter cannot change the lookup
      // that selected it. Repeated/deferred executions remain conservative.
      if (change.site !== site || deferred(site)) followSource(change.source);
    }, key, true);
  });
  const store = (base: Flow, key: string | undefined, from: Flow, site?: ParseNode, receiver = base, writeSite = site): void => {
    if (site) {
      storeEffects(base, key, from, receiver, site);
      pendingReceivers.push({ source: base, site, store: true });
    }
    watch(base, (value) => {
      if (value === 'global') {
        recordDataWrite(globalObject, key, from, writeSite);
        if (site) {
          globalWrites.push({ site, key });
          if (options.opaqueGlobalStore(key)) opaqueEffects.add(site);
        }
      } else if (!site) {
        // Descriptor definition bypasses setters, preserving its write position.
        const object = propertiesOf(value);
        if (object) recordDataWrite(object, key, from, writeSite);
      }
    });
  };
  const remove = (base: Flow, key: string | undefined, site: ParseNode): void => {
    pendingReceivers.push({ source: base, site, store: false });
    watch(base, (value) => {
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
  };
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
  const pendingInvocations: { source: Flow, result: Flow, site: ParseNode, absent: boolean }[] = [];
  const pendingReceivers: { source: Flow, site: ParseNode, store: boolean }[] = [];
  const pendingLoads: { source: Flow, result: Flow, key?: string, site: ParseNode }[] = [];
  const pendingOperators: { sources: Flow[], result: Flow, site: ParseNode }[] = [];
  const pendingCoercions: { source: Flow, site: ParseNode }[] = [];
  const pendingOperations: { source: Flow, result: Flow, site: ParseNode, copy?: boolean, arguments?: boolean, creationTarget?: Flow }[] = [];
  const pendingDescriptorTypes: { object: Aggregate, key?: string, site: ParseNode, descriptor: Aggregate, initial: boolean }[] = [];
  const pendingDescriptorReads: { source: Flow, result: Flow, site: ParseNode, objectCoercion: boolean, all: boolean, prototype: ObjectValue }[] = [];
  const pendingPrototypeReads: { source: Flow, site: ParseNode }[] = [];
  const pendingTypedDefinitions: { source: Flow, site: ParseNode, target: Flow, key?: string }[] = [];
  const pendingTypedStores: { object: Aggregate, key?: string, site: ParseNode }[] = [];
  const pendingPrototypeSources: { source: Flow, destination: Flow, defaultPrototype?: ObjectValue }[] = [];
  const pendingStoreEnds: { source: Flow, receiver: Flow, key?: string, from: Flow, site: ParseNode }[] = [];
  const pendingLegacySetters: { target: Flow, source: Flow, site: ParseNode }[] = [];
  const pendingPrototypeTargets: { source: Flow, site: ParseNode }[] = [];
  const changePrototype = (target: Flow, source: Flow, site: ParseNode): void => {
    pendingPrototypeTargets.push({ source: target, site });
    watch(target, (targetValue) => {
      if (targetValue === 'global') {
        globalWrites.push({ site }); return;
      }
      if (targetValue === 'opaque-value') {
        opaqueEffects.add(site); return;
      }
      const object = propertiesOf(targetValue);
      if (!object) return;
      if (object.native ? object.native.SetPrototypeOf !== ObjectValue.prototype.SetPrototypeOf : !object.ordinaryPrototypeMutation) {
        opaqueEffects.add(site); return;
      }
      object.prototypes.push({ source, site });
      for (const update of object.prototypeUsers) update();
    });
  };
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
  const prototypeValueFacts = (source: Flow, ordinaryTarget: boolean, seen = new Set<Flow>(), globalTarget = false): number => {
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
      if (value === 'opaque-value' || value === 'global' && !globalTarget) return unknownValue;
      if (value === 'global') {
        facts |= objectValue;
        continue;
      }
      const object = propertiesOf(value);
      if (!object) continue;
      if (ordinaryTarget && (object.native ? object.native.SetPrototypeOf !== ObjectValue.prototype.SetPrototypeOf : !object.ordinaryPrototypeMutation)) return unknownValue;
      facts |= objectValue;
    }
    seen.add(source);
    for (const input of inputs.get(source) ?? []) {
      const inputFacts = prototypeValueFacts(input, ordinaryTarget, seen, globalTarget);
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
    const result = newFlow(), copy = aggregate(); copy.prototype = options.objectPrototype; add(result, copy);
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
        accessHooks(value, undefined, source, site, (key, flow) => recordDataWrite(copy, key, flow, site), undefined, excluded);
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
          else {
            const field = newFlow(); nativeValue(descriptor.Value, field); recordDataWrite(copy, key, field, site);
          }
        }
        observeSlots(value, (key, flow) => {
          if (key === undefined || !excluded.has(key) && value.native!.properties.get(Value(key))?.Enumerable !== Value.false) recordDataWrite(copy, key, flow, site);
        });
      } else {
        accessHooks(value, undefined, source, site, (key, flow) => recordDataWrite(copy, key, flow, site), undefined, excluded);
        observeSlots(value, (key, flow) => {
          if (key === undefined || !excluded.has(key)) recordDataWrite(copy, key, flow, site);
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
  const descriptorObject = (prototype: ObjectValue, fields: ReadonlyMap<string, Flow>): Aggregate => {
    const descriptor = aggregate(); descriptor.prototype = prototype;
    for (const [key, source] of fields) {
      descriptor.ownKeys.add(key);
      recordDataWrite(descriptor, key, source);
    }
    return descriptor;
  };
  // Descriptor observation copies own descriptor fields; it does not Get the
  // property, traverse its prototype, or invoke the described getter/setter.
  const observeDescriptors = (source: Flow, key: string | undefined, result: Flow, site: ParseNode,
    all: boolean, objectCoercion: boolean, prototype: ObjectValue): void => {
    const table = all ? aggregate() : undefined;
    if (table) {
      table.prototype = prototype; add(result, table);
    }
    const primitive = (): Flow => {
      const flow = newFlow(); flow.knownPrimitive = true; return flow;
    };
    const emit = (name: string | undefined, fields: ReadonlyMap<string, Flow>): Aggregate => {
      const descriptor = descriptorObject(prototype, fields);
      if (table) {
        const flow = newFlow(); add(flow, descriptor); recordDataWrite(table, name, flow, site);
      } else add(result, descriptor);
      return descriptor;
    };
    pendingDescriptorReads.push({ source, result: table ? slot(table, undefined) : result, site, objectCoercion, all, prototype });
    watch(source, (candidate) => {
      const object = propertiesOf(candidate);
      if (!object) {
        if (candidate === 'opaque-value' || candidate === 'global') opaque(table ? slot(table, undefined) : result, site);
        return;
      }
      if (object.native ? !OrdinaryDataReadSupported(object.native)
        || all && object.native.OwnPropertyKeys !== ObjectValue.prototype.OwnPropertyKeys : !object.ordinaryPrototypeMutation) {
        opaque(table ? slot(table, undefined) : result, site); return;
      }
      const unknownFields = object.slots.get(undefined);
      if (unknownFields) watch(unknownFields, (value) => {
        if (value === 'opaque-value') opaque(table ? slot(table, undefined) : result, site);
      });
      const flags = (): Map<string, Flow> => new Map([['enumerable', primitive()], ['configurable', primitive()]]);
      if (object.native) for (const [nameValue, descriptor] of object.native.properties) {
        if (--remaining < 0) {
          exhausted = true; return;
        }
        const name = typeof nameValue === 'string' ? nameValue : 'stringValue' in nameValue ? nameValue.stringValue() : undefined;
        if (!all && !matchingKey(name, key)) continue;
        const fields = new Map<string, Flow>();
        for (const [field, value] of [['value', descriptor.Value], ['writable', descriptor.Writable], ['get', descriptor.Getter],
          ['set', descriptor.Setter], ['enumerable', descriptor.Enumerable], ['configurable', descriptor.Configurable]] as const) {
          if (value !== undefined) {
            const flow = newFlow(); nativeValue(value, flow); fields.set(field, flow);
          }
        }
        const declared = (object.native as ObjectValue & { TypedProperties?: ReadonlyMap<unknown, object> })
          .TypedProperties?.get(typeof nameValue === 'string' ? nameValue : 'stringValue' in nameValue ? nameValue.stringValue() : nameValue) ?? descriptor.Type;
        if (declared !== undefined) {
          const flow = newFlow();
          if (declared instanceof ObjectValue) nativeValue(declared, flow);
          else add(flow, 'opaque-value');
          fields.set('type', flow);
        }
        emit(name, fields);
      }
      const writes = new Set<PropertyWrite>(), hooks = new Set<Hook>();
      const update = (): void => {
        for (const write of object.writes) {
          if (--remaining < 0) {
            exhausted = true; return;
          }
          if (writes.has(write) || !all && !matchingKey(write.key, key) || write.site && !beforePrototypeUse(write.site, site)) continue;
          writes.add(write);
          const fields = flags();
          fields.set('value', write.source); fields.set('writable', primitive());
          const descriptor = emit(write.key, fields);
          pendingDescriptorTypes.push({ object, key: write.key, site, descriptor, initial: object.typedKeys.has(write.key) || object.typedKeys.has(undefined) });
        }
        for (const hook of object.hooks) {
          if (--remaining < 0) {
            exhausted = true; return;
          }
          if (hooks.has(hook) || !all && !matchingKey(hook.key, key) || !beforePrototypeUse(hook.site, site)) continue;
          hooks.add(hook);
          const fields = flags(); fields.set('get', hook.get); fields.set('set', hook.set); emit(hook.key, fields);
        }
      };
      object.writeUsers.add(update); object.hookUsers.add(update); update();
      // Absence remains possible under historical descriptor/deletion joins.
      // This is not a proof that an own property definitely exists.
      if (!table) {
        result.knownPrimitive = true; (result.primitiveKinds ??= new Set()).add('undefined');
      }
    });
  };
  const defineDescriptor = (target: Flow, key: string | undefined, descriptor: Flow, site: ParseNode, syntax?: ParseNode): void => {
    const fields = new Map(['enumerable', 'configurable', 'value', 'writable', 'type', 'get', 'set']
      .map((name) => [name, descriptorField(descriptor, name, site)]));
    pendingOperations.push({ source: descriptor, result: newFlow(), site, copy: true });
    // A present type may admit/convert/default a value using user code. Until
    // that operation has its own positive effect proof, preserve its effects.
    pendingTypedDefinitions.push({ source: fields.get('type')!, site, target, key });
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
    const result = newFlow(), copy = aggregate(true); copy.prototype = options.arrayPrototype; add(result, copy);
    // Iteration is an operation even when no remaining element is collected.
    const values = iterate(source, site);
    watch(source, (value) => {
      if (typeof value !== 'string' && value.kind === 'aggregate' && value.array && options.arrayIterationIsStable(site)) {
        observeSlots(value, (key, flow) => {
          if (key === undefined) recordDataWrite(copy, undefined, flow, site);
          else if (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) >= start) recordDataWrite(copy, String(Number(key) - start), flow, site);
        });
      } else recordDataWrite(copy, undefined, values, site);
    });
    // Empty candidate sets are not proof that iteration cannot run user code.
    pendingOperations.push({ source, result: slot(copy, undefined), site });
    return result;
  };
  const literalAdmission = (source: Flow, seen = new Set<Flow>()): boolean => {
    if (--remaining < 0) {
      exhausted = true; return false;
    }
    if (seen.has(source) || seen.size >= 256 || source.values.size) return false;
    if (source.absent || source.primitiveContract) return true;
    const node = source.expression;
    // A bare intrinsic primitive can fit, convert numerically, or fail. None
    // of those outcomes invokes a source-class conversion or a meta hook.
    if (node?.type === 'NumericLiteral') return !node.Imaginary;
    if (node?.type === 'TypedConversionExpression' && options.primitiveConversion(node)) return true;
    if (node && ['StringLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return true;
    if (source.primitiveKinds?.size === 1 && source.primitiveKinds.has('undefined')) return true;
    const sources = inputs.get(source);
    if (!sources?.size) return false;
    seen.add(source);
    const result = [...sources].every((input) => literalAdmission(input, seen));
    seen.delete(source);
    return result;
  };
  const simpleSignature = (type: ParseNode.FunctionType): boolean => !type.TypeParameters
    && !!options.intrinsicAdmission(type.ReturnType) && type.FunctionTypeParameterList.every((parameter) => {
      const type = parameter.Type ?? parameter.TypeAnnotation?.Type;
      return !parameter.Initializer && !!type && !!options.intrinsicAdmission(type);
    });
  const literalAggregateAdmission = (source: Flow, type: ParseNode.Type): boolean => {
    const node = source.expression;
    if (type.type === 'FunctionType' && simpleSignature(type) && node
      && ['FunctionExpression', 'ArrowFunction', 'AsyncFunctionExpression', 'AsyncArrowFunction', 'GeneratorExpression', 'AsyncGeneratorExpression'].includes(node.type)) return true;
    if (type.type !== 'ArrayType' || type.ArrayExtent || node?.type !== 'ArrayLiteral') return false;
    const elements = type.TypeArguments?.TypeArgumentList;
    if (!elements || elements.length !== 1 || !options.intrinsicAdmission(elements[0])) return false;
    // A fresh dense literal of primitive constants has no element getter or
    // conversion callback. It can still acquire typed backing after admission.
    return node.ElementList.every((element) => ['StringLiteral', 'BooleanLiteral', 'NumericLiteral', 'NullLiteral'].includes(element.type)
      && literalAdmission(expression(element)));
  };
  const primitiveDomain = (source: Flow, seen = new Set<Flow>()): string | undefined => {
    if (--remaining < 0) {
      exhausted = true; return undefined;
    }
    if (seen.has(source) || seen.size >= 256 || source.values.size) return undefined;
    if (source.primitiveContract) return source.primitiveContract;
    const node = source.expression;
    if (node?.type === 'NumericLiteral') return node.Imaginary ? undefined : typeof node.value === 'bigint' ? 'bigint' : '#literal';
    if (node?.type === 'StringLiteral') return 'string';
    if (node?.type === 'BooleanLiteral') return 'boolean';
    if (node?.type === 'NullLiteral') return 'null';
    if (node?.type === 'TypedConversionExpression' && options.primitiveConversion(node)) return options.intrinsicAdmission(node.Type);
    const sources = inputs.get(source);
    if (!sources?.size) return undefined;
    seen.add(source);
    const domains = [...sources].map((input) => primitiveDomain(input, seen));
    seen.delete(source);
    return domains.every((domain) => domain === domains[0]) ? domains[0] : undefined;
  };
  const transparentPrototypeOperation = (source: Flow, site: ParseNode, conversion = false, seen = new Set<Aggregate>()): boolean => {
    const facts = prototypeValueFacts(source, false);
    if (!facts || facts === unknownValue || seen.size >= 256) return false;
    for (const value of source.values) {
      // Callability is irrelevant to this raw prototype-registration query.
      // Complete-input facts above still require its accompanying object.
      if (value === 'opaque-callable') continue;
      const object = propertiesOf(value);
      if (!object || seen.has(object) || object.sourceClass || object.classOperators
        || object.native && (conversion ? HasOwnClassConversion(object.native) : HasOwnClassOperator(object.native, 'unary !'))) return false;
      const next = new Set(seen); next.add(object);
      if (!transparentPrototypeOperation(initialPrototype(object), site, conversion, next)) return false;
      for (const change of object.prototypes) if (beforePrototypeUse(change.site, site)
        && !transparentPrototypeOperation(change.source, site, conversion, next)) return false;
    }
    return true;
  };
  const settleOperators = (): void => {
    for (const request of pendingOperators) {
      if (request.site.type === 'UnaryExpression' && request.site.operator === '!'
        && request.sources.every((source) => transparentPrototypeOperation(source, request.site))) {
        request.result.knownPrimitive = true; request.result.primitiveContract = 'boolean';
        continue;
      }
      const domains = request.sources.map((source) => primitiveDomain(source));
      const receiver = domains.find((domain) => domain !== '#literal') ?? 'number';
      // A primitive proof excludes coercion hooks, not a declared operator on a
      // different operand domain. Only its own intrinsic pair is transparent.
      if (!domains.length || domains.some((domain) => domain !== receiver
      && !(domain === '#literal' && /^(?:number|uint|int|float)/.test(receiver)))) {
        opaque(request.result, request.site);
        continue;
      }
      const node = request.site as Node;
      const operator = node.operator ?? node.MultiplicativeOperator ?? node.AssignmentOperator;
      const comparison = node.type === 'EqualityExpression' || node.type === 'RelationalExpression' || operator === '!';
      request.result.knownPrimitive = true;
      request.result.primitiveContract = comparison ? 'boolean'
        : receiver === 'string' && (operator === '+' || operator === '+=') ? 'string'
          : /^(?:number|bigint|uint|int|float)/.test(receiver) ? receiver : 'number';
    }
  };
  // Completed receiving operations may establish membership for a later
  // admission. This is value flow from enforcement, not a callable annotation
  // promoted to an observed result. Unknown/direct alternatives and cycles
  // prevent an all-input proof; the original operations keep their own effects.
  const admissionSourceProven = (source: Flow, target: ParseNode.Type, proof: AdmissionProof, seen = new Set<Flow>(), budget = { remaining: 4096 }): boolean => {
    if (--budget.remaining < 0 || exhausted || seen.has(source) || seen.size >= 256) return false;
    if (source.admittedType) return proof(undefined, target, source.admittedType);
    if (source.expression && proof(source.expression, target)) return true;
    const sources = inputs.get(source);
    if (directSources.has(source) || !sources?.size) return false;
    seen.add(source);
    const answer = [...sources].every((input) => admissionSourceProven(input, target, proof, seen, budget));
    seen.delete(source);
    return answer;
  };
  const pendingAdmissions: { source: Flow, result: Flow, target?: string, type: ParseNode.Type, site: ParseNode }[] = [];
  const admit = (source: Flow, type: ParseNode.Type | undefined, site: ParseNode): Flow => {
    if (!type) return source;
    const target = options.intrinsicAdmission(type);
    if (target === 'any' || target === 'void') return source;
    // Admission can convert a value and install storage obligations. A simple
    // primitive target constrains the result, independently of input effects.
    const result = newFlow();
    result.admittedType = type;
    if (target) {
      result.knownPrimitive = true; result.primitiveContract = target;
    } else {
      edge(source, result);
      if (type.type !== 'FunctionType' || !literalAggregateAdmission(source, type)) add(result, 'opaque-value');
    }
    pendingAdmissions.push({ source, result, target, type, site });
    return result;
  };
  const target = (value: unknown, source: Flow, site?: ParseNode, admitted = false): void => {
    if (!isNode(value)) return;
    const node = value;
    const annotation = admitted ? undefined : (node as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type ?? options.admissionType(node);
    // A pattern default is evaluated before that element's admission. Keep
    // its boundary on the element, rather than at the enclosing pattern start.
    const admissionSite = site && ['LexicalBinding', 'VariableDeclaration'].includes(site.type)
      ? node.type === 'BindingIdentifier' ? node.parent ?? node : node : site ?? node;
    source = admit(source, annotation, admissionSite);
    if (node.type === 'BindingIdentifier' || node.type === 'IdentifierReference') {
      const destination = binding(node, node.name);
      const kind = annotation && options.intrinsicAdmission(annotation);
      if (kind && kind !== 'any' && kind !== 'void') {
        destination.knownPrimitive = true; destination.primitiveContract = kind;
      }
      edge(source, destination);
      if (options.globalBinding(node as ParseNode.IdentifierReference)) recordDataWrite(globalObject, node.name, source, site ?? node);
    } else if (node.type === 'MemberExpression') {
      store(expression(node.MemberExpression), memberKey(node), source, site);
      if (node.Expression && site) indexAccess(expression(node.MemberExpression), indexOperands(node.Expression), undefined, site, source);
    } else if (node.type === 'ParenthesizedExpression') target(node.Expression, source, site);
    else if (node.type === 'SingleNameBinding' || node.type === 'BindingElement') {
      // The parent and its BindingIdentifier describe one receiving boundary.
      target(node.BindingIdentifier ?? node.BindingPattern, source, site, !!node.BindingIdentifier && !!annotation);
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
    const result = { kind: 'callable' as const, definition: node, sites: new Set<ParseNode>(), parameters, result: newFlow(), receiver: newFlow(), properties: functionProperties(node) };
    functions.set(node, result);
    const body = node.FunctionBody ?? node.ConciseBody;
    const ordinary = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDefinition'].includes(node.type);
    const fallsThrough = !isNode(body) || body.type !== 'ConciseBody'
      && (body.type !== 'FunctionBody' || CompletionPaths(body.FunctionStatementList).length > 0);
    // A result graph with only written returns is incomplete when execution
    // can fall through. Async/generator invocation returns a different channel.
    if (!ordinary || fallsThrough) directSources.add(result.result);
    if (ordinary && fallsThrough && isNode(body)) {
      const annotation = (node as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type;
      admit({ ...newFlow(), absent: true }, annotation, body);
    }
    for (const parameter of parameters) {
      const annotation = (parameter as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type;
      const kind = annotation && options.intrinsicAdmission(annotation);
      if (kind && kind !== 'any' && kind !== 'void' && isNode(parameter.BindingIdentifier)) {
        const flow = binding(parameter.BindingIdentifier, parameter.BindingIdentifier.name as string);
        flow.knownPrimitive = true; flow.primitiveContract = kind;
      }
    }
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
  // #sec-elision-stability: a transparently constructed class's prototype holds
  // its methods as data, its accessors as non-enumerable hooks and its index
  // accessors by index count, as an object literal's would. Any other operator
  // keeps operations that consult the prototype opaque.
  const classPrototype = (node: ClassNode, constructor: Flow): Aggregate => {
    const prototype = aggregate(); prototype.classPrototype = node;
    const heritage = node.ClassTail.ClassHeritage;
    if (heritage) {
      // A derived class's prototype inherits from its parent's.
      prototype.prototypeFlow = newFlow(); prototype.initialPrototypeEffects = true;
      watch(expression(heritage), (value) => {
        const parent = propertiesOf(value);
        if (parent?.sourceClass && classPrototypes.has(parent.sourceClass)) edge(slot(parent, 'prototype'), prototype.prototypeFlow!);
        else add(prototype.prototypeFlow!, 'opaque-value');
      });
    } else prototype.prototype = options.objectPrototype;
    prototype.ownKeys.add('constructor'); edge(constructor, slot(prototype, 'constructor'));
    classPrototypes.set(node, prototype);
    for (const element of node.ClassTail.ClassBody ?? []) {
      if ((element as { static?: boolean }).static) continue;
      if (element.type === 'OperatorDefinition') {
        if (element.OperatorName !== '[]') {
          prototype.classOperators = true; continue;
        }
        const callee = newFlow();
        if (element.OperatorGenerator || element.GeneratorBody) add(callee, 'opaque-value');
        else edge(expression(element), callee);
        const count = element.FormalParameters?.length ?? 0;
        (prototype.indexHooks ??= []).push(element.AccessorKind === 'set'
          ? { arity: Math.max(0, count - 1), set: callee, site: element } : { arity: count, get: callee, site: element });
        continue;
      }
      if (!['MethodDefinition', 'GeneratorMethod', 'AsyncMethod', 'AsyncGeneratorMethod'].includes(element.type)) continue;
      const method = element as ParseNode.MethodDefinition;
      const name = method.ClassElementName;
      const key = name.type === 'PrivateIdentifier' ? privateKey(name) : options.propertyKey(name);
      if (key !== undefined) prototype.ownKeys.add(key);
      if (method.type === 'MethodDefinition' && method.UniqueFormalParameters === null) {
        const get = newFlow(), set = newFlow();
        edge(expression(method), method.PropertySetParameterList === null ? get : set);
        prototype.hooks.push({ key, get, set, site: method, enumerable: false });
        for (const update of prototype.hookUsers) update();
      } else recordDataWrite(prototype, key, expression(method), method);
    }
    return prototype;
  };
  // One fresh instance per construction site: its literal fields are own data,
  // typed ones keep their storage admission, and its chain starts at the
  // class prototype, so later accesses reach the declared members.
  const instanceOf = (node: ClassNode, prototype: Aggregate, site: ParseNode): Aggregate => {
    let created = instances.get(site);
    if (!created) {
      created = new Map(); instances.set(site, created);
    }
    const existing = created.get(node);
    if (existing) return existing;
    const instance = aggregate();
    instance.prototypeFlow = newFlow(); instance.initialPrototypeEffects = true;
    add(instance.prototypeFlow, prototype);
    created.set(node, instance);
    const chain: ClassNode[] = [];
    for (let at: ClassNode | undefined = node; at && !chain.includes(at);) {
      chain.unshift(at);
      at = at.ClassTail.ClassHeritage ? options.parentClass?.(at.ClassTail.ClassHeritage) : undefined;
    }
    for (const element of chain.flatMap((cls) => cls.ClassTail.ClassBody ?? [])) {
      if (element.type !== 'FieldDefinition' || element.static) continue;
      const name = element.ClassElementName;
      const key = name.type === 'PrivateIdentifier' ? privateKey(name) : options.propertyKey(name);
      if (key !== undefined) instance.ownKeys.add(key);
      if (element.TypeAnnotation) instance.typedKeys.add(key);
      let value: Flow;
      if (element.Initializer) value = expression(element.Initializer);
      else {
        value = newFlow(); value.knownPrimitive = true;
        value.primitiveKinds = new Set(element.TypeAnnotation ? ['null', 'undefined', 'other'] : ['undefined']);
      }
      recordDataWrite(instance, key, value, site);
    }
    return instance;
  };
  // A private name is a key of its own, so `x.#m` reaches the element the
  // class declared. Sharing a spelling with an ordinary key only adds candidates.
  const privateKey = (name: ParseNode.PrivateIdentifier): string => `#${name.name.replace(/^#/, '')}`;
  const memberKey = (node: ParseNode): string | undefined => {
    const name = (node as { PrivateIdentifier?: ParseNode.PrivateIdentifier | null }).PrivateIdentifier;
    return name ? privateKey(name) : options.key(node);
  };
  const indexOperands = (key: ParseNode): Flow[] => (key.type === 'CommaOperator' ? key.ExpressionList : [key]).map((operand) => expression(operand));
  // proposal-runtime-types #sec-user-defined-operators: a computed access whose
  // indices are all numeric dispatches, by index count, to an index accessor on
  // the base's prototype chain instead of an ordinary property access. Both
  // alternatives stay possible here; the ordinary one is the load or store. A
  // native class prototype's operator is an unavailable summary.
  const indexAccess = (base: Flow, operands: readonly Flow[], result: Flow | undefined, site: ParseNode, written?: Flow,
    receiver = base, path = new Set<Aggregate>()): void => watch(base, (value) => {
    const object = propertiesOf(value);
    if (!object || path.has(object)) return;
    if (path.size >= 256) {
      if (result) add(result, 'opaque-value');
      opaqueEffects.add(site); return;
    }
    const next = new Set(path); next.add(object);
    if (object.native && HasOwnClassOperator(object.native, written ? `[]=#${operands.length}` : `[]#${operands.length}`)) {
      if (result) add(result, 'opaque-value');
      opaqueEffects.add(site);
    }
    for (const hook of object.indexHooks ?? []) {
      const callee = written ? hook.set : hook.get;
      if (callee && hook.arity === operands.length) {
        invoke(callee, written ? [...operands, written] : operands, receiver, result ?? newFlow(), undefined, site, undefined, true);
      }
    }
    indexAccess(initialPrototype(object), operands, result, site, written, receiver, next);
    observePrototypes(object, site, (change) => indexAccess(change.source, operands, result, site, written, receiver, next));
  });
  const invoke = (callee: Flow, args: readonly Flow[], receiver: Flow, result: Flow, packed?: Flow, site?: ParseNode, argumentNodes?: readonly ParseNode[], absent = false): void => {
    if (site) {
      pendingInvocations.push({ source: callee, result, site, absent });
      // Named/packed invocation requires the actual signature's argument
      // assignment. Until that relation is represented here, keep its effect
      // boundary even when the positional may-flow supplies some candidates.
      if (argumentNodes?.some((argument) => argument.type === 'NamedArgument')) opaqueEffects.add(site);
    }
    watch(callee, (value) => {
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
      if (value === 'String' || value === 'Symbol') result.knownPrimitive = site?.type !== 'NewExpression';
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
        if (['set', 'defineProperty', 'reflect-defineProperty', 'deleteProperty', 'getOwnPropertyDescriptor', 'reflect-getOwnPropertyDescriptor'].includes(value)) propertyKey(argument(1), site);
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
        if (value === 'prototype-setter') {
          pendingLegacySetters.push({ target: receiver, source: argument(0), site });
          result.knownPrimitive = true; result.primitiveKinds = new Set(['undefined']);
        }
        if (value === 'setPrototypeOf' || value === 'reflect-setPrototypeOf') {
          const target = argument(0);
          changePrototype(target, argument(1), site);
          if (value === 'setPrototypeOf') edge(target, result);
          else result.knownPrimitive = true;
        }
        if (value === 'set') {
          const receiver = newFlow();
          if (packed || args.length <= 3) edge(argument(0), receiver);
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
      if (typeof value !== 'string' && value.kind === 'aggregate' && value.native && site) {
        const origin = options.nativeOrigins(value.native).find((kind) =>
          ['getOwnPropertyDescriptor', 'reflect-getOwnPropertyDescriptor', 'getOwnPropertyDescriptors'].includes(kind));
        if (origin) {
          // FromPropertyDescriptor allocates in the actual built-in's realm,
          // including a borrowed cross-realm original.
          const prototype = (value.native as ObjectValue & { Realm?: { Intrinsics: Record<string, ObjectValue> } }).Realm?.Intrinsics['%Object.prototype%'];
          if (!prototype) {
            opaque(result, site); return;
          }
          const source = packed ? project(packed, '0', site) : args[0] ?? newFlow();
          const key = !packed && argumentNodes?.[1] ? options.propertyKey(argumentNodes[1]) : undefined;
          observeDescriptors(source, key, result, site, origin === 'getOwnPropertyDescriptors', origin !== 'reflect-getOwnPropertyDescriptor', prototype);
        }
      }
      if (typeof value !== 'string' && value.kind === 'aggregate' && value.sourceClass && site) {
        const cls = value.sourceClass;
        const prototype = site.type === 'NewExpression' ? classPrototypes.get(cls) : undefined;
        if (prototype) add(result, instanceOf(cls, prototype, site));
        else if (cls.ClassTail.ClassHeritage || cls.ClassTail.ClassBody?.length || cls.Decorators?.length) opaque(result, site);
        else add(result, 'opaque-value');
      }
      if (typeof value === 'string' || value.kind !== 'callable') return;
      if (site) value.sites.add(site);
      value.parameters.forEach((parameter, index) => {
        if (parameter.type === 'BindingRestElement') {
          const rest = aggregate(true), flow = newFlow(); rest.prototype = options.arrayPrototype; add(flow, rest);
          if (packed) recordDataWrite(rest, undefined, project(packed, undefined, site), site);
          else args.slice(index).forEach((argument, offset) => recordDataWrite(rest, String(offset), argument, site));
          target(parameter, flow, site);
          return;
        }
        const argument = packed ? project(packed, String(index), site) : args[index];
        if (argument) target(parameter, argument, site);
      });
      edge(receiver, value.receiver);
      edge(value.result, result);
    });
  };
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
    if (!isNode(value)) return { ...newFlow(), absent: true };
    const node = value;
    const previous = expressions.get(node);
    if (previous) return previous;
    const result = newFlow();
    expressions.set(node, result);
    result.expression = node;
    if (['NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node.type)) result.primitiveLiteral = true;
    if (node.type === 'StringLiteral') result.stringLength = node.value.length;
    if (node.type === 'UnaryExpression' && (node.operator === 'typeof' || node.operator === 'void')
      || node.type === 'EqualityExpression' && (node.operator === '===' || node.operator === '!==')) {
      result.knownPrimitive = true;
      result.primitiveContract = node.type === 'EqualityExpression' ? 'boolean' : node.operator === 'typeof' ? 'string' : 'undefined';
    }
    if (exhausted) return result;
    if (++depth > 256) {
      exhausted = true;
      depth -= 1;
      return result;
    }
    for (const kind of options.scalar(node)) add(result, kind);
    if (node.type === 'NewExpression') prototypeEffects(expression(node.MemberExpression), node);
    if (node.type === 'ClassTail' && node.ClassHeritage) load(expression(node.ClassHeritage), 'prototype', newFlow(), node);
    if (node.type === 'ForInStatement') prototypeEffects(expression(node.Expression), node);
    if (node.type === 'AwaitExpression' || node.type === 'YieldExpression' && !options.provenDelegations.has(node) || node.type === 'SuperCall'
      || node.type === 'Decorator' || node.type === 'ForInStatement' || node.type === 'TypedConversionExpression' && !options.primitiveConversion(node)
      || node.type === 'SuperProperty' || node.type === 'TargetTypedNew' || node.type === 'ImportCall'
      || node.type === 'WithStatement' || node.type === 'IsExpression' || node.type === 'MatchExpression'
      || node.type === 'RefRebindingStatement') {
      // These operations can enter code beyond the visible value-flow graph
      // (assimilation, suspension, superclass/decorator calls, enumeration or
      // conversion/refinement). No absent may-flow candidate is a purity proof.
      opaqueEffects.add(node);
    }
    if (node.type === 'TemplateLiteral' && node.parent?.type !== 'TaggedTemplateExpression') {
      node.ExpressionList.forEach((part) => pendingCoercions.push({ source: expression(part), site: node }));
    }
    if (['ExponentiationExpression', 'MultiplicativeExpression', 'BitwiseANDExpression', 'BitwiseXORExpression', 'BitwiseORExpression', 'UpdateExpression'].includes(node.type)
      || typeof node.operator === 'string' && !['delete', 'typeof', 'void', '===', '!==', '&&', '||', '??'].includes(node.operator)) {
      const operands: Flow[] = [];
      for (const [key, part] of Object.entries(node)) if (key !== 'parent' && isNode(part)) {
        operands.push(expression(part));
        if (node.type !== 'UnaryExpression' || node.operator !== '!') {
          prototypeEffects(expression(part), node);
          pendingCoercions.push({ source: expression(part), site: node });
        }
      }
      pendingOperators.push({ sources: operands, result, site: node });
    }

    if (node.type === 'AssignmentExpression' && !['=', '&&=', '||=', '??='].includes(node.AssignmentOperator)) {
      pendingCoercions.push({ source: expression(node.LeftHandSideExpression), site: node },
        { source: expression(node.AssignmentExpression), site: node });
      pendingOperators.push({ sources: [expression(node.LeftHandSideExpression), expression(node.AssignmentExpression)], result, site: node });
    }
    if (node.type === 'LexicalDeclaration' && node.LetOrConst === 'using') {
      opaqueEffects.add(node); opaqueEffects.add(node.parent ?? node);
    }

    if (node.type === 'IdentifierReference') {
      edge(binding(node, node.name), result);
      if (options.globalBinding(node)) globalPropertyAt(node.name, result, node);
      nativeValue(options.external(node), result);
      if (options.opaqueGlobalRead(node)) opaque(result, node);
    } else if (['ParenthesizedExpression', 'TypeArgumentsExpression'].includes(node.type)) edge(expression(node.Expression), result);
    // A reference reads the values its location holds; `ref x` carries those
    // of `x`, including the admission that initialized it.
    else if (node.type === 'RefExpression') edge(expression(node.Expression), result);
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
      object.prototype = node.type === 'ObjectLiteral' ? options.objectPrototype : options.arrayPrototype;
      if (node.type === 'ArrayLiteral') {
        object.ownKeys.add('length');
        let fixedIndex = true;
        node.ElementList.forEach((part, index) => {
          if (part.type === 'SpreadElement') {
            fixedIndex = false;
            recordDataWrite(object, undefined, iterate(expression(part.AssignmentExpression), part), part);
          } else {
            if (fixedIndex && part.type !== 'Elision') object.ownKeys.add(String(index));
            recordDataWrite(object, fixedIndex ? String(index) : undefined, expression(part), part);
          }
        });
      } else for (const property of node.PropertyDefinitionList) {
        if (property.type === 'IdentifierReference') {
          object.ownKeys.add(property.name);
          recordDataWrite(object, property.name, expression(property), property);
        } else if (property.type === 'PropertyDefinition') {
          if (property.PropertyName) {
            const key = options.propertyKey(property.PropertyName);
            if (property.TypeAnnotation) object.typedKeys.add(key);
            if (key === '__proto__' && ['IdentifierName', 'StringLiteral'].includes(property.PropertyName.type)) {
              setInitialPrototype(object, expression(property.AssignmentExpression), options.objectPrototype);
            } else {
              if (key !== undefined) object.ownKeys.add(key);
              recordDataWrite(object, key, admit(expression(property.AssignmentExpression), property.TypeAnnotation?.Type, property), property);
            }
          } else copiedProperties(expression(property.AssignmentExpression), property,
            (key, flow) => recordDataWrite(object, key, flow, property));
        } else if (property.type === 'MethodDefinition') {
          const key = options.propertyKey(property.ClassElementName);
          if (key !== undefined) object.ownKeys.add(key);
          if (property.UniqueFormalParameters !== null) recordDataWrite(object, key, expression(property), property);
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
      if (!writeOnly) load(expression(node.MemberExpression), memberKey(node), result, node);
      if (!writeOnly && node.Expression) indexAccess(expression(node.MemberExpression), indexOperands(node.Expression), result, node);
      if (!writeOnly && ['call', 'apply', 'bind'].includes(memberKey(node) ?? '')) pendingOperations.push({ source: result, result, site: node, copy: true });
    } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const object = functionProperties();
      object.sourceClass = node; object.ordinaryPrototypeMutation = false;
      object.ownKeys.add('prototype');
      // The own `prototype` property is non-writable and non-configurable, so
      // the modeled prototype is the one every construction installs.
      if (transparentClass(node)) add(slot(object, 'prototype'), classPrototype(node, result));
      else add(slot(object, 'prototype'), 'opaque-value');
      add(result, object);
      if (node.Decorators?.length) add(result, 'opaque-value');
      if (node.BindingIdentifier) edge(result, binding(node.BindingIdentifier as Node, node.BindingIdentifier.name));
    } else if (parameterKeys.some((key) => key in node)) {
      const fn = callable(node); add(result, fn);
      if (isNode(node.BindingIdentifier)) edge(result, binding(node.BindingIdentifier, node.BindingIdentifier.name as string));
      const concise = node.ConciseBody as Node | undefined;
      if (concise?.type === 'ConciseBody') edge(admit(expression(concise.ExpressionBody.AssignmentExpression), (node as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type, concise), fn.result);
    } else if (node.type === 'ThisExpression') {
      for (let at = node.parent; at; at = at.parent) {
        if (parameterKeys.some((key) => key in at) && !['ArrowFunction', 'AsyncArrowFunction'].includes(at.type)) {
          edge(callable(at as Node).receiver, result); break;
        }
      }
    } else if (node.type === 'UnaryExpression' && node.operator === 'delete') {
      const operand = deletionOperand(node.UnaryExpression);
      if (operand.type === 'MemberExpression') remove(expression(operand.MemberExpression), options.key(operand), node);
    } else if (node.type === 'TaggedTemplateExpression') {
      const callee = node.MemberExpression;
      const receiver = callee.type === 'MemberExpression' ? expression(callee.MemberExpression) : newFlow();
      const template = newFlow(); add(template, aggregate(true));
      invoke(expression(callee), [template, ...node.TemplateLiteral.ExpressionList.map(expression)], receiver, result, undefined, node);
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
    if (node.type === 'FieldDefinition') {
      // An instance field's boundary belongs to construction, not class
      // declaration. Its initializer/annotation retains that deferred owner;
      // constructing a nonempty class has a separate opaque invocation effect.
      const field = node as ParseNode.FieldDefinition;
      admit(expression(field.Initializer), field.TypeAnnotation?.Type, field.static ? field : field.Initializer ?? field.TypeAnnotation ?? field);
    }
    if (node.type === 'LexicalBinding' || node.type === 'VariableDeclaration') target(node.BindingIdentifier ?? node.BindingPattern, expression(node.Initializer), node);
    if (node.type === 'ForOfStatement' || node.type === 'ForAwaitStatement') {
      target(node.LeftHandSideExpression ?? node.ForBinding ?? node.ForDeclaration, iterate(expression(node.AssignmentExpression), node), node);
    }
    if (node.type === 'ReturnStatement') for (let at = node.parent; at; at = at.parent) {
      if (parameterKeys.some((key) => key in at)) {
        edge(admit(expression(node.Expression), (at as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation?.Type, node), callable(at as Node).result);
        break;
      }
    }
  }
  settle();
  let index = 0, prototypeIndex = 0, legacyIndex = 0, storeIndex = 0, invocationIndex = 0, loadIndex = 0, admissionIndex = 0;
  while (index < pendingOperations.length || prototypeIndex < pendingPrototypeSources.length || legacyIndex < pendingLegacySetters.length || storeIndex < pendingStoreEnds.length
    || invocationIndex < pendingInvocations.length || loadIndex < pendingLoads.length || admissionIndex < pendingAdmissions.length) {
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
      const facts = prototypeValueFacts(request.source, false);
      if (!facts || facts === unknownValue || !request.copy && !request.arguments && facts & otherPrimitive) opaque(request.result, request.site);
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
    const legacyEnd = pendingLegacySetters.length;
    for (; legacyIndex < legacyEnd; legacyIndex += 1) {
      const request = pendingLegacySetters[legacyIndex];
      const facts = prototypeValueFacts(request.source, false);
      // Invalid non-null primitive prototypes are ignored before consulting
      // the receiver's internal operation, including an exotic receiver.
      if (!facts || facts === unknownValue || facts & (objectValue | nullValue)) changePrototype(request.target, request.source, request.site);
    }
    settle();
    const storeEnd = pendingStoreEnds.length;
    for (; storeIndex < storeEnd; storeIndex += 1) {
      const request = pendingStoreEnds[storeIndex];
      const facts = prototypeValueFacts(request.source, false);
      if (!facts || facts === unknownValue) opaqueEffects.add(request.site);
      if (!facts || facts === unknownValue || facts & nullValue) dataReceiverStore(request.receiver, request.key, request.from, request.site);
    }
    settle();
    const invocationEnd = pendingInvocations.length;
    for (; invocationIndex < invocationEnd; invocationIndex += 1) {
      const request = pendingInvocations[invocationIndex];
      const facts = prototypeValueFacts(request.source, false);
      if (!facts && !request.absent || facts === unknownValue) opaque(request.result, request.site);
    }
    const loadEnd = pendingLoads.length;
    for (; loadIndex < loadEnd; loadIndex += 1) {
      const request = pendingLoads[loadIndex];
      const facts = prototypeValueFacts(request.source, false);
      if (!facts || facts === unknownValue || facts & otherPrimitive) {
        // Boxing can expose user accessors on primitive prototypes. A known
        // string's own length is the sole primitive property summary here.
        if (request.key === 'length' && request.source.stringLength !== undefined) request.result.knownPrimitive = true;
        else opaque(request.result, request.site);
      }
    }
    settle();
    settleOperators();
    settle();
    const admissionEnd = pendingAdmissions.length;
    for (; admissionIndex < admissionEnd; admissionIndex += 1) {
      const request = pendingAdmissions[admissionIndex];
      if (request.target ? !literalAdmission(request.source) && !transparentPrototypeOperation(request.source, request.site, true)
        : !literalAggregateAdmission(request.source, request.type) || !transparentPrototypeOperation(request.source, request.site, true)) {
        admissionEffects.push({ site: request.site, transparent: (proof) => admissionSourceProven(request.source, request.type, proof) });
        opaqueEffects.add(request.site);
        if (!request.target) add(request.result, 'opaque-value');
      }
    }
    settle();
  }
  for (const request of pendingReceivers) {
    // A global capability has its separately keyed store/delete summary.
    // Other incomplete alternatives, including primitive boxing setters,
    // cannot disappear just because no aggregate candidate was collected.
    const facts = prototypeValueFacts(request.source, false, new Set(), true);
    if (!facts || facts === unknownValue || request.store && facts & otherPrimitive) opaqueEffects.add(request.site);
  }
  settleOperators();
  settle();
  for (const request of pendingCoercions) {
    if (primitiveKeyState(request.source) !== 'primitive') opaqueEffects.add(request.site);
  }
  for (const request of pendingDescriptorReads) {
    const facts = prototypeValueFacts(request.source, false);
    if (!facts || facts === unknownValue) opaque(request.result, request.site);
    else if (request.objectCoercion && facts & (undefinedValue | nullValue | otherPrimitive)) {
      request.result.knownPrimitive = true;
      (request.result.primitiveKinds ??= new Set()).add('undefined');
      // String wrappers may expose primitive-valued own data descriptors.
      const field = newFlow(); field.knownPrimitive = true;
      add(request.result, descriptorObject(request.prototype, new Map(['value', 'writable', 'enumerable', 'configurable'].map((key) => [key, field]))));
    }
  }
  for (const request of pendingPrototypeReads) {
    const facts = prototypeValueFacts(request.source, false);
    if (!facts || facts === unknownValue) opaqueEffects.add(request.site);
  }
  for (const request of pendingTypedDefinitions) {
    if (prototypeValueFacts(request.source, false) === 0) continue;
    opaqueEffects.add(request.site);
    for (const value of request.target.values) propertiesOf(value)?.typedKeys.add(request.key);
  }
  for (const request of pendingDescriptorTypes) {
    const typed = request.initial || pendingTypedDefinitions.some((definition) => {
      if (--remaining < 0) {
        exhausted = true; return true;
      }
      return matchingKey(request.key, definition.key) && beforePrototypeUse(definition.site, request.site)
        && [...definition.target.values].some((value) => propertiesOf(value) === request.object)
        && prototypeValueFacts(definition.source, false) !== 0;
    });
    if (typed) {
      const field = newFlow(); add(field, 'opaque-value');
      request.descriptor.ownKeys.add('type'); recordDataWrite(request.descriptor, 'type', field);
    }
  }
  settle();
  for (const request of pendingTypedStores) {
    if (request.object.typedKeys.has(undefined) || request.key === undefined && request.object.typedKeys.size
      || request.object.typedKeys.has(request.key)) opaqueEffects.add(request.site);
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
  // A deferred body's operations do not precede every top-level capture.
  // Project its effects to the calls found by this graph, retaining the body
  // itself separately for reads that can execute in a later activation.
  const owner = (site: ParseNode): Callable | false | undefined => {
    let child = site;
    for (let at = site.parent; at; child = at, at = at.parent) {
      if ((at.type === 'MethodDefinition' || at.type === 'FieldDefinition')
        && (at.ClassElementName === child || at.Decorators?.some((decorator) => decorator === child))) continue;
      if (at.type === 'FieldDefinition' && !at.static) return false;
      if (parameterKeys.some((key) => key in at)) return functions.get(at) ?? false;
    }
    return undefined;
  };
  const repeatedActivations = new Map<ParseNode, boolean>();
  const activationMayRepeat = (site: ParseNode): boolean => {
    const cached = repeatedActivations.get(site);
    if (cached !== undefined) return cached;
    const pending = [site], seen = new Set<Callable>();
    let repeat = false;
    while (pending.length && !repeat) {
      if (--remaining < 0 || seen.size >= 256) {
        exhausted = true; repeat = true; break;
      }
      const next = pending.pop()!;
      for (let at = next.parent; at; at = at.parent) {
        if (/^(For|While|DoWhile)/.test(at.type)) {
          repeat = true; break;
        }
        if (parameterKeys.some((key) => key in at)) break;
      }
      const fn = owner(next);
      if (fn === false || fn && seen.has(fn)) repeat = true;
      else if (fn) {
        seen.add(fn); pending.push(...fn.sites);
      }
    }
    repeatedActivations.set(site, repeat);
    return repeat;
  };
  const executionSites = (site: ParseNode, within?: ParseNode, canProject?: (site: ParseNode, callable: ParseNode) => boolean): readonly ParseNode[] | undefined => {
    if (exhausted) return undefined;
    if (owner(site) === undefined) return within ? [] : undefined;
    const pending = [site], seen = new Set<ParseNode>(), result = new Set<ParseNode>();
    while (pending.length) {
      if (--remaining < 0) {
        exhausted = true;
        return undefined;
      }
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const fn = owner(next);
      // Some proofs require more than possible execution sites: each step
      // from an observation to its caller must preserve the requested fact.
      if (canProject && (fn === false || fn && !canProject(next, fn.definition))) return undefined;
      if (within && fn === functions.get(within)) result.add(next);
      else if (fn === undefined) {
        if (!within) result.add(next);
      } else if (fn) pending.push(...fn.sites);
    }
    return [...result];
  };
  return {
    executionSites, activationMayRepeat,
    // This proves only that invocation flow already accounts for the bound
    // target/arguments. It supplies no purity or receiving-result contract.
    boundInvocation: (node) => {
      const source = expression(node); settle();
      return !!source.values.size && [...source.values].every((value) => typeof value !== 'string' && value.kind === 'bound')
        && prototypeValueFacts(source, false) !== unknownValue;
    },
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
    admissionEffects: () => admissionEffects,
    globalWrites: () => globalWrites,
  };
}
