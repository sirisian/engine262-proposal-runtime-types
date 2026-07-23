import { JSStringValue, ObjectValue, Value, type Arguments } from '../value.mts';
import { Q } from '../completion.mts';
import { GetTypeObject, isTypeObject, type TypeObject } from '../type-system/intern.mts';
import { neverType } from '../type-system/records.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { IsAssignable } from '../type-system/relations.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type {
  IndexSignatureRecord, PropertyTypeRecord, SignatureRecord, TupleElementRecord, TypeRecord,
} from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Call,
  Construct,
  CreateArrayFromList,
  CreateListFromArrayLike,
  Descriptor,
  FromPropertyDescriptor,
  CreateDataProperty,
  Get,
  IsCallable,
  IsConstructor,
  LengthOfArrayLike,
  PrepareForTailCall,
  OrdinaryObjectCreate,
  R,
  Realm,
  Throw,
  ToNumber,
  ToPropertyDescriptor,
  ToPropertyKey,
  X,
  type FunctionObject,
  surroundingAgent,
} from '#self';

/** https://tc39.es/ecma262/#sec-reflect.apply */
function* Reflect_apply([target = Value.undefined, thisArgument = Value.undefined, argumentsList = Value.undefined]: Arguments) {
  // 1. If IsCallable(target) is false, throw a TypeError exception.
  if (!IsCallable(target)) {
    return Throw.TypeError('$1 is not a function', target);
  }
  // 2. Let args be ? CreateListFromArrayLike(argumentsList).
  const args = Q(yield* CreateListFromArrayLike(argumentsList));
  // 3. Perform PrepareForTailCall().
  PrepareForTailCall();
  // 4. Return ? Call(target, thisArgument, args).
  return Q(yield* Call(target, thisArgument, args));
}

/** https://tc39.es/ecma262/#sec-reflect.construct */
function* Reflect_construct([target = Value.undefined, argumentsList = Value.undefined, newTarget]: Arguments) {
  // 1. If IsConstructor(target) is false, throw a TypeError exception.
  if (!IsConstructor(target)) {
    return Throw.TypeError('$1 is not a constructor', target);
  }
  // 2. If newTarget is not present, set newTarget to target.
  if (newTarget === undefined) {
    newTarget = target;
  } else if (!IsConstructor(newTarget)) { // 3. Else if IsConstructor(newTarget) is false, throw a TypeError exception.
    return Throw.TypeError('$1 is not a constructor', newTarget);
  }
  // 4. Let args be ? CreateListFromArrayLike(argumentsList).
  const args = Q(yield* CreateListFromArrayLike(argumentsList));
  // 5. Return ? Construct(target, args, newTarget).
  return Q(yield* Construct(target, args, newTarget as FunctionObject));
}

/** https://tc39.es/ecma262/#sec-reflect.defineproperty */
function* Reflect_defineProperty([target = Value.undefined, propertyKey = Value.undefined, attributes = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Let desc be ? ToPropertyDescriptor(attributes).
  const desc = Q(yield* ToPropertyDescriptor(attributes));
  // 4. Return ? target.[[DefineOwnProperty]](key, desc).
  return Q(yield* target.DefineOwnProperty(key, desc));
}

/** https://tc39.es/ecma262/#sec-reflect.deleteproperty */
function* Reflect_deleteProperty([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Return ? target.[[Delete]](key).
  return Q(yield* target.Delete(key));
}

/** https://tc39.es/ecma262/#sec-reflect.get */
function* Reflect_get([target = Value.undefined, propertyKey = Value.undefined, receiver]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. If receiver is not present, then
  if (receiver === undefined) {
    // a. Set receiver to target.
    receiver = target;
  }
  // 4. Return ? target.[[Get]](key, receiver).
  return Q(yield* target.Get(key, receiver));
}

/** https://tc39.es/ecma262/#sec-reflect.getownpropertydescriptor */
function* Reflect_getOwnPropertyDescriptor([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Let desc be ? target.[[GetOwnProperty]](key).
  const desc = Q(yield* target.GetOwnProperty(key));
  // 4. Return FromPropertyDescriptor(desc).
  return FromPropertyDescriptor(desc);
}

/** https://tc39.es/ecma262/#sec-reflect.getprototypeof */
function* Reflect_getPrototypeOf([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[GetPrototypeOf]]().
  return Q(yield* target.GetPrototypeOf());
}

/** https://tc39.es/ecma262/#sec-reflect.has */
function* Reflect_has([target = Value.undefined, propertyKey = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. Return ? target.[[HasProperty]](key).
  return Q(yield* target.HasProperty(key));
}

/** https://tc39.es/ecma262/#sec-reflect.isextensible */
function* Reflect_isExtensible([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[IsExtensible]]().
  return Q(yield* target.IsExtensible());
}

/** https://tc39.es/ecma262/#sec-reflect.ownkeys */
function* Reflect_ownKeys([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let keys be ? target.[[OwnPropertyKeys]]().
  const keys = Q(yield* target.OwnPropertyKeys());
  // 3. Return CreateArrayFromList(keys).
  return CreateArrayFromList(keys);
}

/** https://tc39.es/ecma262/#sec-reflect.preventextensions */
function* Reflect_preventExtensions([target = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Return ? target.[[PreventExtensions]]().
  return Q(yield* target.PreventExtensions());
}

/** https://tc39.es/ecma262/#sec-reflect.set */
function* Reflect_set([target = Value.undefined, propertyKey = Value.undefined, V = Value.undefined, receiver]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. Let key be ? ToPropertyKey(propertyKey).
  const key = Q(yield* ToPropertyKey(propertyKey));
  // 3. If receiver is not present, then
  if (receiver === undefined) {
    receiver = target;
  }
  // 4. Return ? target.[[Set]](key, V, receiver).
  return Q(yield* target.Set(key, V, receiver));
}

/** https://tc39.es/ecma262/#sec-reflect.setprototypeof */
function* Reflect_setPrototypeOf([target = Value.undefined, proto = Value.undefined]: Arguments) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', target);
  }
  // 2. If Type(proto) is not Object and proto is not null, throw a TypeError exception.
  if (!(proto instanceof ObjectValue) && proto !== Value.null) {
    return Throw.TypeError('Object prototype must be an object or null');
  }
  // 3. Return ? target.[[SetPrototypeOf]](proto).
  return Q(yield* target.SetPrototypeOf(proto));
}

/** https://sirisian.github.io/ecmascript-types/#sec-reflect.typeof */
function* Reflect_typeOf([value = Value.undefined]: Arguments) {
  // proposal-runtime-types: the interned Type Object of the value's run-time type.
  return GetTypeObject(RuntimeTypeOf(value));
}

/**
 * proposal-runtime-types #sec-reflect-maketype: read a reflection-node object as
 * a description and produce the Type Record it describes. A Type Object anywhere
 * within the node contributes its [[TypeRecord]]; every node property that
 * denotes a type holds a Type Object, so this recurses by reading that object's
 * record. Canonicalization and interning happen at GetTypeObject in the caller,
 * so structurally equal descriptions produce the same Type Object (the round
 * trip makeType(getReflection(T)) === T).
 */
function* nodeToTypeRecord(node: Value): PlainEvaluator<TypeRecord> {
  if (isTypeObject(node)) {
    // A Type Object used where a node is expected contributes its record.
    return node.TypeRecord;
  }
  if (!(node instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a type node', node);
  }
  const obj = node;
  const kindValue = Q(yield* Get(obj, Value('kind')));
  if (!(kindValue instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a type node', node);
  }
  const kind = kindValue.stringValue();

  // Read a required type-valued property as a Type Record.
  function* typeProp(name: string): PlainEvaluator<TypeRecord> {
    const v = Q(yield* Get(obj, Value(name)));
    return Q(yield* nodeToTypeRecord(v));
  }
  // Read a List-valued property into a JS array of its element Values.
  function* listProp(name: string): PlainEvaluator<Value[]> {
    const v = Q(yield* Get(obj, Value(name)));
    if (!(v instanceof ObjectValue)) {
      return Throw.TypeError('$1 is not a list', v);
    }
    const arr = v;
    const len = Q(yield* LengthOfArrayLike(arr));
    const out: Value[] = [];
    for (let i = 0; i < len; i += 1) {
      out.push(Q(yield* Get(arr, Value(String(i)))));
    }
    return out;
  }

  switch (kind) {
    case 'primitive':
    case 'reference':
      // A named leaf or a ref borrow: its `type`/`target` Type Object carries the
      // record directly. (Generic decomposition is not reconstructed here; the
      // interned leaf is authoritative.)
      return Q(yield* typeProp(kind === 'primitive' ? 'type' : 'target'));
    case 'literal': {
      const value = Q(yield* Get(node, Value('value')));
      const base = Q(yield* typeProp('base'));
      return { Kind: 'literal', Value: value, Base: base };
    }
    case 'union': {
      const arms = Q(yield* listProp('arms'));
      const members: TypeRecord[] = [];
      for (const a of arms) {
        members.push(Q(yield* nodeToTypeRecord(a)));
      }
      return { Kind: 'union', Members: members };
    }
    case 'intersection': {
      const ms = Q(yield* listProp('members'));
      const members: TypeRecord[] = [];
      for (const m of ms) {
        members.push(Q(yield* nodeToTypeRecord(m)));
      }
      return { Kind: 'intersection', Members: members };
    }
    case 'tuple': {
      const elements = Q(yield* listProp('elements'));
      const out: TupleElementRecord[] = [];
      for (const el of elements) {
        if (!(el instanceof ObjectValue)) {
          return Throw.TypeError('$1 is not a tuple element', el);
        }
        const type = Q(yield* nodeToTypeRecord(Q(yield* Get(el, Value('type')))));
        const restV = Q(yield* Get(el, Value('rest')));
        out.push({ Type: type, Rest: restV === Value.true, Initial: 'none' });
      }
      return { Kind: 'tuple', Elements: out };
    }
    case 'array': {
      const element = Q(yield* typeProp('element'));
      const extentV = Q(yield* Get(node, Value('extent')));
      const Extent = extentV === Value.undefined ? 'dynamic' : R(Q(yield* ToNumber(extentV)));
      return { Kind: 'array', Element: element, Extent: Extent as number | 'dynamic' };
    }
    case 'generic': {
      // proposal-runtime-types: build a generic instantiation from its base and
      // arguments (the write half of the reflected `generic` view). The base must
      // be a nominal type (a library type such as Promise/Record, or a generic
      // class/interface); its arguments are replaced with the given ones.
      const baseRec = Q(yield* typeProp('base'));
      if (baseRec.Kind !== 'nominal') {
        return Throw.TypeError('$1 is not a generic type', Value('the base'));
      }
      const argsV = Q(yield* Get(node, Value('arguments')));
      const Arguments: (TypeRecord | number)[] = [];
      if (argsV instanceof ObjectValue) {
        const len = Q(yield* LengthOfArrayLike(argsV));
        for (let i = 0; i < len; i += 1) {
          const a = Q(yield* Get(argsV, Value(String(i))));
          if (a instanceof ObjectValue) {
            Arguments.push(Q(yield* nodeToTypeRecord(a)));
          } else {
            Arguments.push(R(Q(yield* ToNumber(a))));
          }
        }
      }
      return { ...baseRec, Arguments };
    }
    case 'object': {
      const props = Q(yield* listProp('properties'));
      const Properties: PropertyTypeRecord[] = [];
      for (const p of props) {
        if (!(p instanceof ObjectValue)) {
          return Throw.TypeError('$1 is not a property', p);
        }
        const nameV = Q(yield* Get(p, Value('name')));
        if (!(nameV instanceof JSStringValue)) {
          // Symbol-keyed properties are not yet representable in object records.
          return Throw.TypeError('$1 is not supported yet', Value('a symbol property key'));
        }
        const type = Q(yield* nodeToTypeRecord(Q(yield* Get(p, Value('type')))));
        const optionalV = Q(yield* Get(p, Value('optional')));
        const readonlyV = Q(yield* Get(p, Value('readonly')));
        Properties.push({ key: nameV.stringValue(), type, optional: optionalV === Value.true, readonly: readonlyV === Value.true });
      }
      const IndexSignatures: IndexSignatureRecord[] = [];
      const ixV = Q(yield* Get(node, Value('indexSignatures')));
      if (ixV instanceof ObjectValue) {
        const ixs = Q(yield* listProp('indexSignatures'));
        for (const ix of ixs) {
          if (!(ix instanceof ObjectValue)) {
            return Throw.TypeError('$1 is not an index signature', ix);
          }
          const Key = Q(yield* nodeToTypeRecord(Q(yield* Get(ix, Value('key')))));
          const ValueRec = Q(yield* nodeToTypeRecord(Q(yield* Get(ix, Value('value')))));
          IndexSignatures.push({ Key, Value: ValueRec });
        }
      }
      return { Kind: 'object', Properties, IndexSignatures };
    }
    case 'function': {
      const sigs = Q(yield* listProp('signatures'));
      const Signatures: SignatureRecord[] = [];
      for (const sig of sigs) {
        if (!(sig instanceof ObjectValue)) {
          return Throw.TypeError('$1 is not a signature', sig);
        }
        const paramsV = Q(yield* Get(sig, Value('parameters')));
        const Parameters: TypeRecord[] = [];
        if (paramsV instanceof ObjectValue) {
          const len = Q(yield* LengthOfArrayLike(paramsV));
          for (let i = 0; i < len; i += 1) {
            const p = Q(yield* Get(paramsV, Value(String(i))));
            if (!(p instanceof ObjectValue)) {
              return Throw.TypeError('$1 is not a parameter', p);
            }
            Parameters.push(Q(yield* nodeToTypeRecord(Q(yield* Get(p, Value('type'))))));
          }
        }
        const returnV = Q(yield* Get(sig, Value('return')));
        let Return: TypeRecord | null = null;
        if (returnV instanceof ObjectValue) {
          Return = Q(yield* nodeToTypeRecord(Q(yield* Get(returnV, Value('type')))));
        }
        // An optional `this` node on the signature supplies its [[ThisType]].
        const thisV = Q(yield* Get(sig, Value('this')));
        let ThisType: TypeRecord | null = null;
        if (thisV instanceof ObjectValue) {
          ThisType = Q(yield* nodeToTypeRecord(thisV));
        }
        Signatures.push({ Parameters, Return, ThisType });
      }
      return { Kind: 'function', Signatures };
    }
    default:
      return Throw.TypeError('$1 is not supported yet', Value(`a type node of kind ${kind}`));
  }
}

/**
 * proposal-runtime-types #sec-getreflection: build the reflection node object
 * that describes a Type Record. The node has a `kind` naming the record's Kind
 * and the further properties of the node-shape table; every property that
 * denotes a type holds a Type Object, so a walker recurses by reflecting it in
 * turn. This is the inverse of nodeToTypeRecord: makeType(getReflection(T)) is T.
 */
function recordToNode(t: TypeRecord, realm: Realm): ObjectValue {
  const node = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  const set = (key: string, value: Value): void => {
    X(CreateDataProperty(node, Value(key), value));
  };
  const typeObj = (r: TypeRecord): TypeObject => GetTypeObject(r, realm);
  const list = (rs: readonly TypeRecord[]): ObjectValue => CreateArrayFromList(rs.map(typeObj));

  switch (t.Kind) {
    case 'any':
    case 'void':
    case 'primitive':
    case 'nominal':
      // The named leaves share the "primitive" node; the payload is the interned
      // Type Object itself, so a leaf stays opaque to a walker.
      set('kind', Value('primitive'));
      set('type', typeObj(t));
      // proposal-runtime-types: a generic instantiation additionally exposes its
      // base (the bare declaration's type) and arguments, so a builder can read
      // `node.generic.base` and `node.generic.arguments` (spec ~nominal~
      // [[Arguments]]). The bare base is the same nominal with no arguments, so
      // `Promise` and the base of `Promise.<T>` are the same interned object.
      if (t.Kind === 'nominal' && t.Arguments.length > 0) {
        const nominalT = t;
        const genericView = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(genericView, Value('base'), typeObj({ ...nominalT, Arguments: [] })));
        const args = nominalT.Arguments.map((a) => (typeof a === 'number' ? Value(a) : typeObj(a)) as Value);
        X(CreateDataProperty(genericView, Value('arguments'), CreateArrayFromList(args)));
        set('generic', genericView);
      }
      break;
    case 'literal':
      set('kind', Value('literal'));
      set('value', t.Value);
      set('base', typeObj(t.Base));
      break;
    case 'parameterized':
      set('kind', Value('parameterized'));
      set('base', typeObj(t.Base));
      set('metadata', t.Metadata);
      break;
    case 'union':
      set('kind', Value('union'));
      set('arms', list(t.Members));
      break;
    case 'intersection':
      set('kind', Value('intersection'));
      set('members', list(t.Members));
      break;
    case 'tuple': {
      set('kind', Value('tuple'));
      const elements = t.Elements.map((e) => {
        const el = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(el, Value('type'), typeObj(e.Type)));
        X(CreateDataProperty(el, Value('rest'), e.Rest ? Value.true : Value.false));
        X(CreateDataProperty(el, Value('initial'), Value.undefined));
        return el as Value;
      });
      set('elements', CreateArrayFromList(elements));
      break;
    }
    case 'array':
      set('kind', Value('array'));
      set('element', typeObj(t.Element));
      set('extent', t.Extent === 'dynamic' ? Value.undefined : Value(t.Extent));
      break;
    case 'reference':
      set('kind', Value('reference'));
      set('target', typeObj(t.Target));
      break;
    case 'object': {
      set('kind', Value('object'));
      const properties = t.Properties.map((p) => {
        const pr = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(pr, Value('name'), Value(p.key)));
        X(CreateDataProperty(pr, Value('type'), typeObj(p.type)));
        X(CreateDataProperty(pr, Value('optional'), p.optional ? Value.true : Value.false));
        X(CreateDataProperty(pr, Value('readonly'), p.readonly ? Value.true : Value.false));
        return pr as Value;
      });
      set('properties', CreateArrayFromList(properties));
      const indexSignatures = t.IndexSignatures.map((ix) => {
        const ir = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(ir, Value('key'), typeObj(ix.Key)));
        X(CreateDataProperty(ir, Value('value'), typeObj(ix.Value)));
        return ir as Value;
      });
      set('indexSignatures', CreateArrayFromList(indexSignatures));
      break;
    }
    case 'function': {
      set('kind', Value('function'));
      const signatures = t.Signatures.map((sig) => {
        const sr = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        const params = sig.Parameters.map((pt, i) => {
          const p = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
          X(CreateDataProperty(p, Value('type'), typeObj(pt)));
          X(CreateDataProperty(p, Value('index'), Value(i)));
          return p as Value;
        });
        X(CreateDataProperty(sr, Value('parameters'), CreateArrayFromList(params)));
        const ret = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(ret, Value('type'), typeObj(sig.Return ?? { Kind: 'void' })));
        X(CreateDataProperty(sr, Value('return'), ret));
        // Emit a `this` node only where the signature declares a this type, so a
        // signature without one reflects with no `this` property (round-tripping
        // to [[ThisType]] null).
        if (sig.ThisType) {
          X(CreateDataProperty(sr, Value('this'), recordToNode(sig.ThisType, realm)));
        }
        return sr as Value;
      });
      set('signatures', CreateArrayFromList(signatures));
      break;
    }
    default:
      set('kind', Value('primitive'));
      set('type', typeObj(t));
  }
  return node;
}

function Reflect_getReflection([type = Value.undefined]: Arguments) {
  // proposal-runtime-types #sec-getreflection (the Reflect.Type context).
  if (!isTypeObject(type)) {
    return Throw.TypeError('$1 is not a type', type);
  }
  return recordToNode(type.TypeRecord, surroundingAgent.currentRealmRecord);
}

function* Reflect_makeType([node = Value.undefined]: Arguments): ValueEvaluator {
  // proposal-runtime-types #sec-reflect-maketype.
  const record = Q(yield* nodeToTypeRecord(node));
  // GetTypeObject canonicalizes and interns; canonicalization is where any
  // invalidity is caught, matching the equivalent source declaration.
  return GetTypeObject(record);
}

function Reflect_isAssignable([source = Value.undefined, target = Value.undefined]: Arguments) {
  // proposal-runtime-types #sec-reflect-isassignable: the checker's own
  // assignability judgment, exposed unchanged.
  if (!isTypeObject(source) || !isTypeObject(target)) {
    return Throw.TypeError('$1 is not a type', isTypeObject(source) ? target : source);
  }
  return IsAssignable(source.TypeRecord, target.TypeRecord) ? Value.true : Value.false;
}

export function bootstrapReflect(realmRec: Realm) {
  const reflect = bootstrapPrototype(realmRec, [
    ['apply', Reflect_apply, 3],
    ['construct', Reflect_construct, 2],
    ['defineProperty', Reflect_defineProperty, 3],
    ['deleteProperty', Reflect_deleteProperty, 2],
    ['get', Reflect_get, 2],
    ['getOwnPropertyDescriptor', Reflect_getOwnPropertyDescriptor, 2],
    ['getPrototypeOf', Reflect_getPrototypeOf, 1],
    ['has', Reflect_has, 2],
    ['isExtensible', Reflect_isExtensible, 1],
    ['ownKeys', Reflect_ownKeys, 1],
    ['preventExtensions', Reflect_preventExtensions, 1],
    ['set', Reflect_set, 3],
    ['setPrototypeOf', Reflect_setPrototypeOf, 2],
    // proposal-runtime-types
    ...(surroundingAgent.feature('runtime-types') ? [
      ['typeOf', Reflect_typeOf, 1] as [string, typeof Reflect_typeOf, number],
      ['getReflection', Reflect_getReflection, 1] as [string, typeof Reflect_getReflection, number],
      ['makeType', Reflect_makeType, 1] as [string, typeof Reflect_makeType, number],
      ['isAssignable', Reflect_isAssignable, 2] as [string, typeof Reflect_isAssignable, number],
    ] : []),
  ], realmRec.Intrinsics['%Object.prototype%'], 'Reflect');

  realmRec.Intrinsics['%Reflect%'] = reflect;
}

/**
 * proposal-runtime-types (spec, Reflect.never): a name for the empty union, so
 * that code need not spell it as a construction. It is the same object
 * `Reflect.makeType({ kind: 'union', arms: [] })` returns, because the empty
 * union is interned like every other type.
 *
 * Defined in its own pass rather than in the Reflect table, because a Type Object
 * needs %Type.prototype% and Reflect is bootstrapped before it.
 */
export function bootstrapReflectNever(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const reflect = realmRec.Intrinsics['%Reflect%'];
  X(reflect.DefineOwnProperty(Value('never'), Descriptor({
    Value: GetTypeObject(neverType, realmRec),
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
}
