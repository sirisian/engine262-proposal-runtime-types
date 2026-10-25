import type { StoreAdmission } from '../type-system/store-admission.mts';
import { AdmitStoreValue, isArrayExoticObject } from '#self';
import { HasInheritedStorageDependents, PlanInheritedDefinition, PlanInheritedDeletion, PlanInheritedPrototypeChange, CommitInheritedStorageChanges } from '#self';
import type { ConstructionSelections } from '../type-system/result-dependencies.mts';
import {
  Descriptor,
  ObjectValue,
  SymbolValue, JSStringValue, UndefinedValue, NullValue,
  Value,
  BooleanValue,
  type PropertyKeyValue,
  type DescriptorInit,
  type CanBeNativeSteps,
} from '../value.mts';
import {
  Q, X,
} from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { DefaultValueOf, OrdinaryDataReadSupported } from '../type-system/runtime.mts';
import { SameType } from '../type-system/relations.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { RemoveArrayElementIdentity } from '../type-system/array-borrow.mts';
import {
  Assert,
  Call,
  CreateDataProperty,
  Get,
  GetFunctionRealm,
  IsAccessorDescriptor,
  IsCallable,
  IsDataDescriptor,
  IsExtensible,
  IsGenericDescriptor,
  IsPropertyKey,
  SameValue,
  MakeBasicObject,
  isArrayIndex,
  type FunctionObject,
  type Intrinsics,
} from './all.mts';
import {
  NormalCompletion, TransferResultDependency, RefreshNominalRestDependencies, PlanNominalPrototypeChange, CommitNominalPrototypeChange, ScalarRestDefinitionAllowed, CheckArrayDefinition, CreateBuiltinFunction, surroundingAgent, RequireType, LookupTypeDefault, Throw } from '#self';

export interface OrdinaryObject extends ObjectValue {
  Prototype: ObjectValue | NullValue;
  Extensible: BooleanValue;
}

export function isOrdinaryObject(value: Value): value is OrdinaryObject {
  return value instanceof ObjectValue
    && value.GetPrototypeOf === ObjectValue.prototype.GetPrototypeOf
    && value.SetPrototypeOf === ObjectValue.prototype.SetPrototypeOf
    && value.IsExtensible === ObjectValue.prototype.IsExtensible
    && value.PreventExtensions === ObjectValue.prototype.PreventExtensions
    && value.GetOwnProperty === ObjectValue.prototype.GetOwnProperty
    && value.DefineOwnProperty === ObjectValue.prototype.DefineOwnProperty
    && value.HasProperty === ObjectValue.prototype.HasProperty
    && value.Get === ObjectValue.prototype.Get
    && value.Set === ObjectValue.prototype.Set
    && value.Delete === ObjectValue.prototype.Delete
    && value.OwnPropertyKeys === ObjectValue.prototype.OwnPropertyKeys
    && 'Prototype' in value
    && 'Extensible' in value;
}

// TODO: ban other direct extension from ObjectValue in the linter
export type ExoticObject = ObjectValue;
// 9.1.1.1 OrdinaryGetPrototypeOf
export function OrdinaryGetPrototypeOf(O: OrdinaryObject) {
  return O.Prototype;
}

// 9.1.2.1 OrdinarySetPrototypeOf
export function OrdinarySetPrototypeOf(O: OrdinaryObject, V: ObjectValue | NullValue) {
  Assert(V instanceof ObjectValue || V instanceof NullValue);

  const current = O.Prototype;
  if (SameValue(V, current)) {
    return Value.true;
  }
  const extensible = O.Extensible;
  if (extensible === Value.false) {
    return Value.false;
  }
  let p = V;
  let done = false;
  while (done === false) {
    if (p instanceof NullValue) {
      done = true;
    } else if (SameValue(p, O)) {
      return Value.false;
    } else if (p.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf) {
      done = true;
    } else {
      p = (p as OrdinaryObject).Prototype;
    }
  }
  const changes = PlanNominalPrototypeChange(O, V);
  if (changes === false) return Value.false;
  const inherited = PlanInheritedPrototypeChange(O, V);
  if (inherited === false) return Value.false;
  O.Prototype = V;
  CommitNominalPrototypeChange(changes);
  CommitInheritedStorageChanges(inherited);
  return Value.true;
}

// 9.1.3.1 OrdinaryIsExtensible
export function OrdinaryIsExtensible(O: OrdinaryObject) {
  return O.Extensible;
}

// 9.1.4.1 OrdinaryPreventExtensions
export function OrdinaryPreventExtensions(O: OrdinaryObject) {
  O.Extensible = Value.false;
  return Value.true;
}

// 9.1.5.1 OrdinaryGetOwnProperty
export function OrdinaryGetOwnProperty(O: ObjectValue, P: PropertyKeyValue) {
  Assert(IsPropertyKey(P));

  if (!O.properties.has(P)) {
    return Value.undefined;
  }

  const D: Mutable<DescriptorInit> = {};

  const x = O.properties.get(P)!;

  if (IsDataDescriptor(x)) {
    D.Value = x.Value;
    D.Writable = x.Writable;
  } else if (IsAccessorDescriptor(x)) {
    D.Getter = x.Getter;
    D.Setter = x.Setter;
  }
  D.Enumerable = x.Enumerable;
  D.Configurable = x.Configurable;

  return TransferResultDependency(x, Descriptor(D));
}

// 9.1.6.1 OrdinaryDefineOwnProperty
export function* OrdinaryDefineOwnProperty(O: ObjectValue, P: PropertyKeyValue, Desc: Descriptor, choices?: ConstructionSelections, admission?: StoreAdmission): ValueEvaluator<BooleanValue> {
  // proposal-runtime-types (spec sec-object-types-semantics): a descriptor with a
  // declared type gives the property a type. A descriptor with a type and no value
  // takes the type's default; a descriptor with a type and a value has the value
  // checked against the type. The declared type is recorded on the object so a
  // later write is checked and a delete is refused. An instance of a non-dynamic
  // (sealed) typed class has a closed layout and cannot gain a typed own property.
  // This is on the ordinary [[DefineOwnProperty]], so both Object.defineProperty
  // and Reflect.defineProperty reach it.
  if (surroundingAgent.feature('runtime-types') && (Desc as { Type?: object }).Type !== undefined) {
    const typeObject = (Desc as { Type: object }).Type;
    const record = (typeObject as { TypeRecord: TypeRecord }).TypeRecord;
    const existing = (O as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> })
      .TypedProperties?.get(P instanceof JSStringValue ? P.stringValue() : P)?.TypeRecord;
    if (existing && !SameType(existing, record)) return Throw.TypeError('a definition cannot replace an existing property backing type');
    const builtBy = (O as { ConstructedBy?: readonly { SealInstances?: boolean }[] }).ConstructedBy;
    if (builtBy && builtBy.some((ctor) => ctor.SealInstances)) {
      return Throw.TypeError('a typed own property cannot be added to an instance of a non-dynamic typed class');
    }
    let applied = Desc;
    if (Desc.Value !== undefined) {
      // RequireType RETURNS the value of the type to be used: a plain 7
      // reaching a uint8 property becomes that property's uint8 value, and the
      // descriptor must carry the converted value rather than the raw one.
      const converted = Q(yield* RequireType(Desc.Value, record, undefined, choices));
      applied = Descriptor({ ...Desc, Value: converted });
    } else {
      let dflt = LookupTypeDefault(typeObject);
      if (dflt === undefined) {
        dflt = Q(yield* DefaultValueOf(record));
      }
      applied = Descriptor({ ...Desc, Value: dflt ?? Value.undefined });
    }
    const current = Q(yield* O.GetOwnProperty(P));
    const extensible = Q(yield* IsExtensible(O));
    Q(CheckArrayDefinition(O, P));
    if (!ScalarRestDefinitionAllowed(O, P, applied)) return Throw.TypeError('a property definition violates an ordered scalar rest guard');
    const result = ValidateAndApplyPropertyDescriptor(O, P, extensible, applied, current, record);
    if (result === Value.true) {
      const map = ((O as { TypedProperties?: Map<unknown, object> }).TypedProperties ??= new Map());
      map.set(P instanceof JSStringValue ? P.stringValue() : P, typeObject);
    }
    return result;
  }
  // The branch above handles a descriptor that
  // CARRIES a type - `defineProperty(o, "x", { type: T, value: v })` - and
  // records it. What no path consulted is the type a property ALREADY has when
  // the descriptor carries only a value, so a redefinition walked around the
  // check that an ordinary store makes. #table-check-sites lists this position
  // and names the operation: "a value crossing into a typed position through
  // reflection, including `Reflect.set` and `Reflect.defineProperty` ->
  // RequireType(_value_, _t_)". `Reflect.set` was wired; this was not, and the
  // comment above already states the invariant it missed - "the declared type is
  // recorded on the object so a later write is checked" - where a later WRITE
  // was and a later REDEFINITION was not.
  //
  // Only a data descriptor carrying a value is checked here. A generic
  // descriptor changing `enumerable` or `configurable` stores nothing, so there
  // is nothing to check; an ACCESSOR descriptor over a typed data property is
  // refused outright, because the property's declared type is a promise about
  // what reading it answers and a getter can answer anything - the same reason
  // #sec-object-types-semantics refuses deleting one.
  if (surroundingAgent.feature('runtime-types')) {
    const declared = (O as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> })
      .TypedProperties?.get(P instanceof JSStringValue ? P.stringValue() : P);
    if (declared !== undefined) {
      if (IsAccessorDescriptor(Desc)) {
        return Throw.TypeError('a property with a declared type cannot be redefined as an accessor');
      }
      if (Desc.Value !== undefined) {
        // RequireType returns the value OF THE TYPE to be used, so the
        // descriptor must carry what it returned rather than the raw value -
        // the same correction made to the typed branch above.
        const checked = Q(yield* AdmitStoreValue(O, P, Desc.Value, declared.TypeRecord, admission, choices));
        const converted = checked.value;
        const current = Q(yield* O.GetOwnProperty(P));
        const extensible = Q(yield* IsExtensible(O));
        const applied = Descriptor({ ...Desc, Value: converted });
        Q(CheckArrayDefinition(O, P));
        if (!ScalarRestDefinitionAllowed(O, P, applied)) return Throw.TypeError('a property definition violates an ordered scalar rest guard');
        return ValidateAndApplyPropertyDescriptor(O, P, extensible, applied, current, declared.TypeRecord);
      }
    }
  }
  const current = Q(yield* O.GetOwnProperty(P));
  const extensible = Q(yield* IsExtensible(O));
  Q(CheckArrayDefinition(O, P));
  if (!ScalarRestDefinitionAllowed(O, P, Desc)) return Throw.TypeError('a property definition violates an ordered scalar rest guard');
  return ValidateAndApplyPropertyDescriptor(O, P, extensible, Desc, current);
}

/** https://tc39.es/ecma262/#sec-iscompatiblepropertydescriptor */
export function IsCompatiblePropertyDescriptor(Extensible: BooleanValue, Desc: Descriptor, Current: UndefinedValue | Descriptor) {
  return ValidateAndApplyPropertyDescriptorUnobserved(Value.undefined, Value.undefined, Extensible, Desc, Current);
}

// 9.1.6.3 ValidateAndApplyPropertyDescriptor
export function ValidateAndApplyPropertyDescriptor(O: ObjectValue | UndefinedValue, P: PropertyKeyValue | UndefinedValue, extensible: BooleanValue, Desc: Descriptor, current: UndefinedValue | Descriptor, admitted?: TypeRecord) {
  const previous = O instanceof ObjectValue ? O.properties.get(P as PropertyKeyValue) : undefined;
  const watched = O instanceof ObjectValue && HasInheritedStorageDependents(O);
  if (watched) {
    const compatible = ValidateAndApplyPropertyDescriptorUnobserved(Value.undefined, P, extensible, Desc, current);
    if (compatible === Value.false) return compatible;
  }
  const inherited = watched ? PlanInheritedDefinition(O as ObjectValue, P as PropertyKeyValue, Desc, admitted) : [];
  if (inherited === false) return Throw.TypeError('a definition would invalidate an inherited storage contract');
  const result = ValidateAndApplyPropertyDescriptorUnobserved(O, P, extensible, Desc, current);
  if (result === Value.true) CommitInheritedStorageChanges(inherited);
  // Attribute-only changes preserve the stored contribution. An explicit value
  // write or accessor replacement supplies no old evidence, even for SameValue.
  if (result === Value.true && O instanceof ObjectValue) {
    const committed = O.properties.get(P as PropertyKeyValue);
    if (previous && committed && previous !== committed && Desc.Value === undefined
        && IsDataDescriptor(previous) && IsDataDescriptor(committed)) {
      TransferResultDependency(previous, committed);
    } else if (committed && Desc.Value !== undefined) {
      TransferResultDependency(Desc, committed);
    }
  }
  if (result === Value.true && O instanceof ObjectValue) RefreshNominalRestDependencies(O, P as PropertyKeyValue);
  return result;
}

function ValidateAndApplyPropertyDescriptorUnobserved(O: ObjectValue | UndefinedValue, P: PropertyKeyValue | UndefinedValue, extensible: BooleanValue, Desc: Descriptor, current: UndefinedValue | Descriptor) {
  Assert(O === Value.undefined || IsPropertyKey(P));

  if (current instanceof UndefinedValue) {
    if (extensible === Value.false) {
      return Value.false;
    }

    Assert(extensible === Value.true);

    if (IsGenericDescriptor(Desc) || IsDataDescriptor(Desc)) {
      if (!(O instanceof UndefinedValue)) {
        O.properties.set(P as PropertyKeyValue, Descriptor({
          Value: Desc.Value === undefined ? Value.undefined : Desc.Value,
          Writable: Desc.Writable === undefined ? Value.false : Desc.Writable,
          Enumerable: Desc.Enumerable === undefined ? Value.false : Desc.Enumerable,
          Configurable: Desc.Configurable === undefined ? Value.false : Desc.Configurable,
        }));
      }
    } else {
      Assert(IsAccessorDescriptor(Desc));
      if (!(O instanceof UndefinedValue)) {
        O.properties.set(P as PropertyKeyValue, Descriptor({
          Getter: Desc.Getter === undefined ? Value.undefined : Desc.Getter,
          Setter: Desc.Setter === undefined ? Value.undefined : Desc.Setter,
          Enumerable: Desc.Enumerable === undefined ? Value.false : Desc.Enumerable,
          Configurable: Desc.Configurable === undefined ? Value.false : Desc.Configurable,
        }));
      }
    }

    return Value.true;
  }

  if (Desc.everyFieldIsAbsent()) {
    return Value.true;
  }

  if ((current as Descriptor).Configurable === Value.false) {
    if (Desc.Configurable !== undefined && Desc.Configurable === Value.true) {
      return Value.false;
    }

    if (Desc.Enumerable !== undefined && Desc.Enumerable !== (current as Descriptor).Enumerable) {
      return Value.false;
    }
  }

  if (IsGenericDescriptor(Desc)) {
    // No further validation is required.
  } else if (IsDataDescriptor(current) !== IsDataDescriptor(Desc)) {
    if ((current as Descriptor).Configurable === Value.false) {
      return Value.false;
    }
    if (IsDataDescriptor(current)) {
      if (!(O instanceof UndefinedValue)) {
        const entry = { ...O.properties.get(P as PropertyKeyValue)! };
        entry.Value = undefined;
        entry.Writable = undefined;
        entry.Getter = Value.undefined;
        entry.Setter = Value.undefined;
        O.properties.set(P as PropertyKeyValue, Descriptor(entry));
      }
    } else {
      if (!(O instanceof UndefinedValue)) {
        const entry = { ...O.properties.get(P as PropertyKeyValue) };
        entry.Getter = undefined;
        entry.Setter = undefined;
        entry.Value = Value.undefined;
        entry.Writable = Value.false;
        O.properties.set(P as PropertyKeyValue, Descriptor(entry));
      }
    }
  } else if (IsDataDescriptor(current) && IsDataDescriptor(Desc)) {
    if (current.Configurable === Value.false && current.Writable === Value.false) {
      if (Desc.Writable !== undefined && Desc.Writable === Value.true) {
        return Value.false;
      }
      if (Desc.Value !== undefined && !SameValue(Desc.Value, current.Value)) {
        return Value.false;
      }
      return Value.true;
    }
  } else {
    Assert(IsAccessorDescriptor(current) && IsAccessorDescriptor(Desc));
    if (current.Configurable === Value.false) {
      if (Desc.Setter !== undefined && !SameValue(Desc.Setter, current.Setter)) {
        return Value.false;
      }
      if (Desc.Getter !== undefined && !SameValue(Desc.Getter, current.Getter)) {
        return Value.false;
      }
      return Value.true;
    }
  }

  if (!(O instanceof UndefinedValue)) {
    const target = { ...O.properties.get(P as PropertyKeyValue) };
    if (Desc.Value !== undefined) {
      target.Value = Desc.Value;
    }
    if (Desc.Writable !== undefined) {
      target.Writable = Desc.Writable;
    }
    if (Desc.Getter !== undefined) {
      target.Getter = Desc.Getter;
    }
    if (Desc.Setter !== undefined) {
      target.Setter = Desc.Setter;
    }
    if (Desc.Enumerable !== undefined) {
      target.Enumerable = Desc.Enumerable;
    }
    if (Desc.Configurable !== undefined) {
      target.Configurable = Desc.Configurable;
    }
    O.properties.set(P as PropertyKeyValue, Descriptor(target));
  }

  return Value.true;
}

// 9.1.7.1 OrdinaryHasProperty
export function* OrdinaryHasProperty(O: ObjectValue, P: PropertyKeyValue): ValueEvaluator<BooleanValue> {
  Assert(IsPropertyKey(P));

  const hasOwn = Q(yield* O.GetOwnProperty(P));
  if (!(hasOwn instanceof UndefinedValue)) {
    return Value.true;
  }
  const parent = Q(yield* O.GetPrototypeOf());
  if (!(parent instanceof NullValue)) {
    return Q(yield* parent.HasProperty(P));
  }
  return Value.false;
}

// 9.1.8.1
export function* OrdinaryGet(O: ObjectValue, P: PropertyKeyValue, Receiver: Value): ValueEvaluator {
  Assert(IsPropertyKey(P));

  const desc = Q(yield* O.GetOwnProperty(P));
  if (desc instanceof UndefinedValue) {
    const parent = Q(yield* O.GetPrototypeOf());
    if (parent instanceof NullValue) {
      return Value.undefined;
    }
    return yield* parent.Get(P, Receiver);
  }
  if (IsDataDescriptor(desc)) {
    return TransferResultDependency(desc, NormalCompletion(desc.Value));
  }
  Assert(IsAccessorDescriptor(desc));
  const getter = desc.Getter;
  if (getter instanceof UndefinedValue) {
    return Value.undefined;
  }
  return yield* Call(getter, Receiver);
}

// 9.1.9.1 OrdinarySet
export function* OrdinarySet(O: ObjectValue, P: PropertyKeyValue, V: Value, Receiver: Value, choices?: ConstructionSelections, admission?: StoreAdmission) {
  Assert(IsPropertyKey(P));
  if (!OrdinaryDataReadSupported(O)) admission = undefined;
  const ownDesc = Q(yield* O.GetOwnProperty(P));
  return yield* OrdinarySetWithOwnDescriptor(O, P, V, Receiver, ownDesc, choices, admission);
}

// 9.1.9.2 OrdinarySetWithOwnDescriptor
export function* OrdinarySetWithOwnDescriptor(O: ObjectValue, P: PropertyKeyValue, V: Value, Receiver: Value, ownDesc: Descriptor | UndefinedValue, choices?: ConstructionSelections, admission?: StoreAdmission): ValueEvaluator<BooleanValue> {
  Assert(IsPropertyKey(P));

  if (ownDesc instanceof UndefinedValue) {
    if (O.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf) admission = undefined;
    const parent = Q(yield* O.GetPrototypeOf());
    if (!(parent instanceof NullValue)) {
      // Only ordinary internal delegation carries successful admission. A Proxy
      // or other override may call user code even while selecting its method.
      if (parent.Set !== ObjectValue.prototype.Set) admission = undefined;
      return Q(yield* parent.Set(P, V, Receiver, choices, admission));
    }
    ownDesc = Descriptor({
      Value: Value.undefined,
      Writable: Value.true,
      Enumerable: Value.true,
      Configurable: Value.true,
    });
  }

  if (IsDataDescriptor(ownDesc)) {
    if (ownDesc.Writable !== undefined && ownDesc.Writable === Value.false) {
      return Value.false;
    }
    if (!(Receiver instanceof ObjectValue)) {
      return Value.false;
    }

    if (!OrdinaryDataReadSupported(Receiver)) admission = undefined;
    const existingDescriptor = Q(yield* Receiver.GetOwnProperty(P));
    if (Receiver.DefineOwnProperty !== ObjectValue.prototype.DefineOwnProperty
        && !isArrayExoticObject(Receiver)) admission = undefined;
    if (!(existingDescriptor instanceof UndefinedValue)) {
      if (IsAccessorDescriptor(existingDescriptor)) {
        return Value.false;
      }
      if (existingDescriptor.Writable === Value.false) {
        return Value.false;
      }
      const valueDesc = Descriptor({ Value: V });
      return Q(yield* Receiver.DefineOwnProperty(P, valueDesc, choices, admission));
    }
    // This is the ordinary CreateDataProperty descriptor, with the source
    // occurrence carried only through this internal definition.
    return yield* Receiver.DefineOwnProperty(P, Descriptor({
      Value: V, Writable: Value.true, Enumerable: Value.true, Configurable: Value.true,
    }), choices, admission);
  }

  Assert(IsAccessorDescriptor(ownDesc));
  const setter = ownDesc.Setter;
  if (setter === undefined || setter instanceof UndefinedValue) {
    return Value.false;
  }
  Q(yield* Call(setter, Receiver, [V]));
  return Value.true;
}

// 9.1.10.1 OrdinaryDelete
export function* OrdinaryDelete(O: ObjectValue, P: PropertyKeyValue): ValueEvaluator<BooleanValue> {
  Assert(IsPropertyKey(P));
  const desc = Q(yield* O.GetOwnProperty(P));
  if (desc instanceof UndefinedValue) {
    return Value.true;
  }
  if (desc.Configurable === Value.true) {
    const inherited = PlanInheritedDeletion(O, P);
    if (inherited === false) return Throw.TypeError('a deletion would invalidate an inherited storage contract');
    const typed = O as { TypedElement?: unknown, TypedTuple?: unknown };
    if (P instanceof JSStringValue && (typed.TypedElement !== undefined || typed.TypedTuple !== undefined)) {
      RemoveArrayElementIdentity(O, P.stringValue());
    }
    O.properties.delete(P);
    CommitInheritedStorageChanges(inherited);
    RefreshNominalRestDependencies(O, P as PropertyKeyValue);
    return Value.true;
  }
  return Value.false;
}

// 9.1.11.1
export function OrdinaryOwnPropertyKeys(O: ObjectValue) {
  const keys: PropertyKeyValue[] = [];

  // For each own property key P of O that is an array index, in ascending numeric index order, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (isArrayIndex(P)) {
      keys.push(P);
    }
  }
  keys.sort((a, b) => Number.parseInt((a as JSStringValue).stringValue(), 10) - Number.parseInt((b as JSStringValue).stringValue(), 10));

  // For each own property key P of O such that Type(P) is String and
  // P is not an array index, in ascending chronological order of property creation, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (P instanceof JSStringValue && isArrayIndex(P) === false) {
      keys.push(P);
    }
  }

  // For each own property key P of O such that Type(P) is Symbol,
  // in ascending chronological order of property creation, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (P instanceof SymbolValue) {
      keys.push(P);
    }
  }

  return keys;
}

/** https://tc39.es/ecma262/#sec-ordinaryobjectcreate */
export function OrdinaryObjectCreate<const T extends string>(proto: ObjectValue | NullValue, additionalInternalSlotsList?: readonly T[]) {
  Assert(!!proto);
  // 1. Let internalSlotsList be « [[Prototype]], [[Extensible]] ».
  const internalSlotsList: ['Prototype', 'Extensible', ...T[]] = ['Prototype', 'Extensible'];
  // 2. If additionalInternalSlotsList is present, append each of its elements to internalSlotsList.
  if (additionalInternalSlotsList !== undefined) {
    internalSlotsList.push(...additionalInternalSlotsList);
  }
  // 3. Let O be ! MakeBasicObject(internalSlotsList).
  const O = X(MakeBasicObject(internalSlotsList)) as OrdinaryObject;
  // 4. Set O.[[Prototype]] to proto.
  O.Prototype = proto;
  // 5. Return O.
  return O;
}

/** This is a helper function to define non-spec host objects. */
OrdinaryObjectCreate.from = (object: Record<string, Value | CanBeNativeSteps>, proto?: ObjectValue | NullValue) => {
  const O = OrdinaryObjectCreate(proto || surroundingAgent.intrinsic('%Object.prototype%'));
  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      const value = object[key];
      X(CreateDataProperty(O, Value(key), value instanceof Value ? value : CreateBuiltinFunction.from(value, key)));
    }
  }
  return O;
};

// 9.1.13 OrdinaryCreateFromConstructor
export function* OrdinaryCreateFromConstructor<const T extends string>(constructor: FunctionObject, intrinsicDefaultProto: keyof Intrinsics, internalSlotsList?: readonly T[]): ValueEvaluator<ObjectValue> {
  // Assert: intrinsicDefaultProto is a String value that is this specification's name of an intrinsic object.
  const proto = Q(yield* GetPrototypeFromConstructor(constructor, intrinsicDefaultProto));
  return OrdinaryObjectCreate(proto, internalSlotsList);
}

// 9.1.14 GetPrototypeFromConstructor
export function* GetPrototypeFromConstructor(constructor: FunctionObject, intrinsicDefaultProto: keyof Intrinsics): ValueEvaluator<ObjectValue> {
  // Assert: intrinsicDefaultProto is a String value that
  // is this specification's name of an intrinsic object.
  Assert(IsCallable(constructor));
  let proto = Q(yield* Get(constructor, Value('prototype')));
  if (!(proto instanceof ObjectValue)) {
    const realm = Q(GetFunctionRealm(constructor));
    proto = realm.Intrinsics[intrinsicDefaultProto];
  }
  return proto;
}
