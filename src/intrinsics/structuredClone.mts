import { Q, X, type ValueEvaluator } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  BigIntValue, BooleanValue, JSStringValue, NullValue, NumberValue, ObjectValue,
  SymbolValue, TypedNumberValue, UndefinedValue, Value, Descriptor, type Arguments,
} from '../value.mts';
import { CopyValueClassInstance, DeclaredReadonlyFieldsOf } from '../abstract-ops/testing-comparison.mts';
import { StampTypedArray } from '../abstract-ops/array-view.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { isDecimalObject } from './Decimal.mts';
import { isRationalObject } from './Rational.mts';
import { isComplexObject } from './Complex.mts';
import { isFloat128Object } from './Float128.mts';
import { isRangeObject } from './Range.mts';
import { IsComposite } from './Composite.mts';
import { isProxyExoticObject } from './Proxy.mts';
import { isDataViewObject } from './DataView.mts';
import { isTypedArrayObject } from './TypedArray.mts';
import { ErrorHostInternalSlots } from './Error.mts';
import {
  CreateBuiltinFunction, OrdinaryObjectCreate, CreateDataPropertyOrThrow, ArrayCreate, StringCreate,
  Get, Construct, Realm, surroundingAgent, Throw, ToString, F, R,
  isArrayExoticObject, isModuleNamespaceObject, isArrayBufferObject, IsDetachedBuffer, IsFixedLengthArrayBuffer,
  AllocateArrayBuffer, CopyDataBlockBytes, RegExpCreate, IsArrayBufferViewOutOfBounds, IsDataDescriptor,
  EnumerableOwnProperties, HasOwnProperty, SealTypedInstance,
  type FunctionObject, type ArrayBufferObject, type ResizableArrayBufferObject,
} from '#self';

/**
 * `structuredClone(value)` - a deep copy by value.
 *
 * Defined by HTML rather than by ECMAScript,
 * and implemented here because the proposal states a type for it
 * (`standardlibrary.md`: `function structuredClone<T>(value: T): T`) and a
 * signature is a claim that the function EXISTS. A type system that cannot say
 * what a structured clone returns has a hole where its users are - moving a
 * typed value across a boundary is the thing the identity signature is for.
 *
 * SCOPED to the ECMAScript-shaped subset of HTML's StructuredSerializeInternal
 * and StructuredDeserialize. Transferables, `SharedArrayBuffer`, `ImageData`
 * and platform objects mean nothing in a bare engine; what is here is what a
 * program can build out of this specification: primitives, the Boolean,
 * Number, BigInt and String objects, `Date`, `RegExp`, `ArrayBuffer` and its
 * views, `Map`, `Set`, `Error`, arrays, plain objects, and the proposal's own
 * typed values.
 *
 * A FUNCTION and a SYMBOL are not cloneable and are REFUSED, as is every
 * object HTML refuses: a Proxy, a module namespace, and a built-in whose state
 * the algorithm does not carry, such as a Promise or a WeakMap. HTML raises a
 * *DataCloneError*, which is a DOM exception this engine does not define, so a
 * *TypeError* is raised instead: refusing with an error a program can catch is
 * the behaviour that matters, and inventing a DOM exception hierarchy to carry
 * one name would be a larger change than this signature is worth. An embedder
 * that has `DOMException` should raise the specified error.
 *
 * Question AR, AR2: an instance of a TYPED class clones to an instance of its
 * class, as serialization.md states ("a typed class instance clones to an
 * instance of the same class with the same layout"): its fields are cloned by
 * this algorithm, its private fields are copied, no constructor runs, and it is
 * sealed as a constructed instance is. A typed class over a built-in clones the
 * built-in's part by HTML's step for that built-in, and fails where that step
 * fails. Any other object comes back as HTML says, so code that names no type
 * gets JavaScript's answer: an instance of an untyped class is a plain object.
 * The engine cloned every object as a plain one before, so a Date, a RegExp, an
 * Error, an ArrayBuffer, a typed array and a Boolean object all came back with
 * none of what made them one, and a typed class instance lost its class.
 */
function* StructuredClone([value = Value.undefined]: Arguments): ValueEvaluator {
  const memo = new Map<ObjectValue, Value>();
  return Q(yield* cloneValue(value, memo));
}

/** The kind of an object HTML's algorithm refuses, or undefined. */
function unclonableKind(value: ObjectValue): string | undefined {
  if (isProxyExoticObject(value)) return 'Proxy';
  if (isModuleNamespaceObject(value)) return 'module namespace object';
  const slots: readonly [string, string][] = [
    ['PromiseState', 'Promise'], ['WeakMapData', 'WeakMap'], ['WeakSetData', 'WeakSet'],
    ['WeakRefTarget', 'WeakRef'], ['CleanupCallback', 'FinalizationRegistry'], ['SymbolData', 'Symbol object'],
    ['GeneratorState', 'generator'], ['AsyncGeneratorState', 'generator'],
  ];
  return slots.find(([slot]) => slot in value)?.[1];
}

const ERROR_NAMES = ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError'];

function* cloneValue(value: Value, memo: Map<ObjectValue, Value>): ValueEvaluator {
  // A primitive is its own clone: it has no identity to duplicate. A
  // TypedNumberValue is one of these - the proposal's numeric value types carry
  // their type in the value, so cloning one needs nothing.
  if (value instanceof UndefinedValue || value instanceof NullValue
      || value instanceof BooleanValue || value instanceof NumberValue
      || value instanceof BigIntValue || value instanceof JSStringValue
      || value instanceof TypedNumberValue) {
    return value;
  }
  // #sec-value-types: a SYMBOL has identity and no serialization, so HTML
  // refuses it. So does a function, whose body cannot be carried across.
  if (value instanceof SymbolValue) {
    return Throw.TypeError('a $1 cannot be cloned', Value('symbol'));
  }
  if (!(value instanceof ObjectValue)) {
    return value;
  }
  if ('Call' in value) {
    return Throw.TypeError('a $1 cannot be cloned', Value('function'));
  }
  // The MEMO is what makes a cycle terminate and what preserves sharing: two
  // references to one object in the source are two references to one object in
  // the clone, which a naive recursion loses along with its termination.
  const seen = memo.get(value);
  if (seen !== undefined) {
    return seen;
  }
  // A value of a numeric family the engine holds as an object - a decimal, a
  // rational, a complex number, a `float128` - and a range are immutable
  // values, compared by what they hold, so the value is its own clone, as a
  // primitive is. A composite is re-interned on arrival (serialization.md),
  // which within one heap is the composite itself. Each came back as a plain
  // object, which is none of them.
  if (isDecimalObject(value) || isRationalObject(value) || isComplexObject(value)
      || isFloat128Object(value) || isRangeObject(value) || IsComposite(value)) {
    return value;
  }

  // A VALUE TYPE CLASS instance clones by the copy #sec-value-type-copying
  // already defines, which carries its type, its private state and its sealing.
  // Doing it any other way here would give a structured clone different
  // semantics from an assignment, for one kind of value, for no reason.
  const asValueClass = Q(yield* CopyValueClassInstance(value));
  if (asValueClass !== value) {
    memo.set(value, asValueClass);
    return asValueClass;
  }

  const refused = unclonableKind(value);
  if (refused !== undefined) {
    return Throw.TypeError('a $1 cannot be cloned', Value(refused));
  }

  const realm = surroundingAgent.currentRealmRecord;
  const builtBy = (value as unknown as { ConstructedBy?: readonly { TypedClass?: boolean, SealInstances?: boolean }[] }).ConstructedBy ?? [];
  const typed = surroundingAgent.feature('runtime-types') && builtBy.some((ctor) => ctor.TypedClass === true);
  // A typed instance keeps its class's prototype; anything else gets the
  // intrinsic one HTML's deserialization names.
  const ownPrototype = typed ? Q(yield* value.GetPrototypeOf()) : Value.null;
  const prototypeFor = (intrinsic: string): ObjectValue => (typed ? ownPrototype : realm.Intrinsics[intrinsic as '%Object.prototype%']) as ObjectValue;
  const withPrototype = (target: ObjectValue): ObjectValue => {
    if (typed) {
      (target as unknown as { Prototype: Value }).Prototype = ownPrototype;
    }
    return target;
  };
  const source = value as unknown as Record<string, unknown>;

  // THE BUILT-IN PART, by HTML's step for the built-in the object is.
  let target: ObjectValue;
  let deep: 'properties' | 'map' | 'set' | 'none' = 'none';
  if ('BooleanData' in value || 'NumberData' in value || 'BigIntData' in value || 'DateValue' in value) {
    const [slot, intrinsic] = 'BooleanData' in value ? ['BooleanData', '%Boolean.prototype%']
      : 'NumberData' in value ? ['NumberData', '%Number.prototype%']
        : 'BigIntData' in value ? ['BigIntData', '%BigInt.prototype%'] : ['DateValue', '%Date.prototype%'];
    target = OrdinaryObjectCreate(prototypeFor(intrinsic), [slot]);
    (target as unknown as Record<string, unknown>)[slot] = source[slot];
  } else if ('StringData' in value) {
    target = StringCreate(source.StringData as JSStringValue, prototypeFor('%String.prototype%'));
  } else if ('RegExpMatcher' in value) {
    // The pattern and the flags, and not `lastIndex`, which a new RegExp holds at 0.
    target = withPrototype(Q(yield* RegExpCreate(source.OriginalSource as Value, source.OriginalFlags as Value)));
  } else if (isArrayBufferObject(value)) {
    if (IsDetachedBuffer(value)) {
      return Throw.TypeError('a $1 cannot be cloned', Value('detached ArrayBuffer'));
    }
    const max = IsFixedLengthArrayBuffer(value) ? undefined : (value as ResizableArrayBufferObject).ArrayBufferMaxByteLength;
    const buffer = Q(yield* AllocateArrayBuffer(realm.Intrinsics['%ArrayBuffer%'] as FunctionObject, value.ArrayBufferByteLength, max));
    CopyDataBlockBytes(buffer.ArrayBufferData!, 0, value.ArrayBufferData!, 0, value.ArrayBufferByteLength);
    target = withPrototype(buffer);
  } else if (isTypedArrayObject(value) || isDataViewObject(value)) {
    if (IsArrayBufferViewOutOfBounds(value)) {
      return Throw.TypeError('a $1 cannot be cloned', Value('view out of bounds'));
    }
    // The buffer is cloned as a value of its own, so two views of one buffer
    // are two views of one clone.
    const buffer = Q(yield* cloneValue(value.ViewedArrayBuffer as ArrayBufferObject, memo));
    const offset = F(value.ByteOffset);
    if (isDataViewObject(value)) {
      const length = value.ByteLength === 'auto' ? [] : [F(value.ByteLength)];
      target = Q(yield* Construct(realm.Intrinsics['%DataView%'] as FunctionObject, [buffer, offset, ...length])) as ObjectValue;
    } else {
      const length = value.ArrayLength === 'auto' ? [] : [F(value.ArrayLength)];
      const constructor = realm.Intrinsics[`%${value.TypedArrayName.stringValue()}%` as '%Uint8Array%'] as FunctionObject;
      target = Q(yield* Construct(constructor, [buffer, offset, ...length])) as ObjectValue;
    }
    target = withPrototype(target);
  } else if ('MapData' in value) {
    target = OrdinaryObjectCreate(prototypeFor('%Map.prototype%'), ['MapData']);
    (target as unknown as { MapData: unknown[] }).MapData = [];
    deep = 'map';
  } else if ('SetData' in value) {
    target = OrdinaryObjectCreate(prototypeFor('%Set.prototype%'), ['SetData']);
    (target as unknown as { SetData: unknown[] }).SetData = [];
    deep = 'set';
  } else if ('ErrorData' in value) {
    // By its name, one HTML does not know becoming "Error", and its message
    // where the error holds one as data; the stack is carried as the engine
    // holds it.
    const name = Q(yield* Get(value, Value('name')));
    const known = name instanceof JSStringValue && ERROR_NAMES.includes(name.stringValue()) ? name.stringValue() : 'Error';
    const messageDesc = Q(yield* value.GetOwnProperty(Value('message')));
    const message = !(messageDesc instanceof UndefinedValue) && IsDataDescriptor(messageDesc)
      ? Q(yield* ToString(messageDesc.Value!)) : undefined;
    target = OrdinaryObjectCreate(prototypeFor(`%${known}.prototype%`), ['ErrorData', ...ErrorHostInternalSlots]);
    for (const slot of ErrorHostInternalSlots) {
      (target as unknown as Record<string, unknown>)[slot] = source[slot];
    }
    if (message !== undefined) {
      X(target.DefineOwnProperty(Value('message'), Descriptor({
        Value: message, Writable: Value.true, Enumerable: Value.false, Configurable: Value.true,
      })));
    }
  } else if (isArrayExoticObject(value)) {
    const length = Q(yield* value.GetOwnProperty(Value('length'))) as Descriptor;
    target = X(ArrayCreate(R(length.Value as NumberValue), prototypeFor('%Array.prototype%')));
    deep = 'properties';
  } else {
    target = OrdinaryObjectCreate(prototypeFor('%Object.prototype%'), []);
    deep = 'properties';
  }
  memo.set(value, target);

  if (deep === 'map') {
    const entries = (target as unknown as { MapData: { Key: Value | undefined, Value: Value | undefined }[] }).MapData;
    for (const entry of (value as unknown as { MapData: { Key: Value | undefined, Value: Value | undefined }[] }).MapData) {
      if (entry.Key === undefined) {
        continue;
      }
      entries.push({
        Key: Q(yield* cloneValue(entry.Key, memo)),
        Value: Q(yield* cloneValue(entry.Value ?? Value.undefined, memo)),
      });
    }
  } else if (deep === 'set') {
    const elements = (target as unknown as { SetData: (Value | undefined)[] }).SetData;
    for (const element of (value as unknown as { SetData: (Value | undefined)[] }).SetData) {
      if (element !== undefined) {
        elements.push(Q(yield* cloneValue(element, memo)));
      }
    }
  }

  if (typed) {
    Q(yield* cloneTypedInstanceState(value, target, memo));
    if (builtBy.some((ctor) => ctor.SealInstances === true)) {
      Q(yield* SealTypedInstance(target));
    }
    return target;
  }
  if (deep === 'properties') {
    // HTML's deep step: each own enumerable String-keyed property, read with
    // [[Get]], cloned, and defined on the clone. A hole of an array stays one.
    for (const key of Q(yield* EnumerableOwnProperties(value, 'key'))) {
      if (Q(yield* HasOwnProperty(value, key)) === Value.true) {
        const property = Q(yield* Get(value, key));
        X(CreateDataPropertyOrThrow(target, key, Q(yield* cloneValue(property, memo))));
      }
    }
    // An array that carries an element type keeps it, as the copies its own
    // methods make keep it: its elements are clones of values of that type.
    const storage = value as unknown as { TypedElement?: TypeRecord, TypedExtent?: number, TypedTuple?: unknown };
    if (storage.TypedElement !== undefined) {
      StampTypedArray(target, storage.TypedElement);
      if (typeof storage.TypedExtent === 'number') {
        (target as unknown as { TypedExtent?: number }).TypedExtent = storage.TypedExtent;
      }
    } else if (storage.TypedTuple !== undefined) {
      (target as unknown as { TypedTuple?: unknown }).TypedTuple = storage.TypedTuple;
    }
  }
  return target;
}

/**
 * What a typed instance carries beside its built-in part: the marks of its
 * class (the constructors that built it, its fields' types, the fields its
 * class declares `readonly`, a brand), its private fields, each copied, and
 * its own enumerable properties, which are its fields, each cloned. No
 * constructor runs, as none runs for a copy (#sec-value-type-copying).
 */
function* cloneTypedInstanceState(value: ObjectValue, target: ObjectValue, memo: Map<ObjectValue, Value>): PlainEvaluator<void> {
  const from = value as unknown as {
    ConstructedBy?: unknown[], TypedProperties?: Map<unknown, object>, ReadonlyFields?: Map<unknown, unknown>, BrandTypeRecord?: TypeRecord,
    PrivateElements?: { Key: unknown, Kind: string, Value?: Value }[],
  };
  const to = target as unknown as {
    ConstructedBy?: unknown[], TypedProperties?: Map<unknown, object>, ReadonlyFields?: Map<unknown, unknown>, PrivateElements: unknown[],
  };
  if (from.ConstructedBy !== undefined) {
    to.ConstructedBy = [...from.ConstructedBy];
  }
  if (from.TypedProperties !== undefined) {
    to.TypedProperties = new Map(from.TypedProperties);
  }
  const kept = DeclaredReadonlyFieldsOf(from.ReadonlyFields);
  if (kept !== undefined) {
    to.ReadonlyFields = kept;
  }
  if (from.BrandTypeRecord !== undefined) {
    Object.defineProperty(target, 'BrandTypeRecord', { value: from.BrandTypeRecord, enumerable: false, configurable: true });
  }
  // A private FIELD holds its own value, which is cloned; a private method or
  // accessor belongs to the class and is shared, as CopyValueClassInstance
  // shares it.
  for (const element of from.PrivateElements ?? []) {
    if (element.Kind === 'field') {
      const field = Object.assign(Object.create(Object.getPrototypeOf(element) as object), element);
      if (element.Value !== undefined) {
        field.Value = Q(yield* cloneValue(element.Value, memo));
      }
      to.PrivateElements.push(field);
    } else {
      to.PrivateElements.push(element);
    }
  }
  for (const key of Q(yield* value.OwnPropertyKeys())) {
    if (!(key instanceof JSStringValue) && !(key instanceof SymbolValue)) {
      continue;
    }
    const desc = Q(yield* value.GetOwnProperty(key));
    if (desc instanceof UndefinedValue || desc.Enumerable !== Value.true) {
      continue;
    }
    // The built-in part already holds it: an index of a String object or of
    // a typed array.
    if (!(Q(yield* target.GetOwnProperty(key)) instanceof UndefinedValue)) {
      continue;
    }
    const property = Q(yield* Get(value, key));
    X(target.DefineOwnProperty(key, Descriptor({
      Value: Q(yield* cloneValue(property, memo)),
      Writable: IsDataDescriptor(desc) ? desc.Writable ?? Value.true : Value.true,
      Enumerable: Value.true,
      Configurable: Value.true,
    })));
  }
  return undefined;
}

// The specification section, stated by hand. Every other built-in gets its
// `section` from a `#sec-...` anchor in its doc comment, which the build
// transform reads; this function is HTML's, and HTML's anchor is
// `#dom-structuredclone`, which the transform does not recognise. `Math.mts`
// sets the property the same way for its non-ECMA-262 functions.
(StructuredClone as unknown as { section?: string }).section = 'https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone';

export function bootstrapStructuredClone(realmRec: Realm) {
  realmRec.Intrinsics['%structuredClone%'] = CreateBuiltinFunction(
    StructuredClone, 1, Value('structuredClone'), [], realmRec,
  );
}
