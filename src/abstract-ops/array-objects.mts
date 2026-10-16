import { TupleBackingLength, TupleStorageTypeAt, TupleResizePreserves, TupleLengthRange, type TupleStorageShape } from '../type-system/tuple-storage.mts';
import { DefaultValueOf } from '../type-system/runtime.mts';
import type { ThrowCompletion } from '../completion.mts';
import {
  surroundingAgent, Descriptor, ObjectValue, JSStringValue, Value, wellKnownSymbols, type ObjectInternalMethods,
  NumberValue, UndefinedValue,
  BooleanValue,
  BigIntValue,
  TypedStringValue,
  isTypedNumber,
  Q, X, type ValueCompletion, type ValueEvaluator, type PlainEvaluator,
  AbruptCompletion,
  type Mutable, type YieldEvaluator,
  IsLessThan,
  Assert,
  Call,
  Construct,
  CreateArrayFromList,
  CreateIteratorFromClosure,
  Get,
  GetFunctionRealm,
  IsDataDescriptor,
  IsAccessorDescriptor,
  Set,
  DeletePropertyOrThrow,
  IsArray,
  IsConstructor,
  OrdinaryDefineOwnProperty,
  OrdinaryGetOwnProperty,
  IsCompatiblePropertyDescriptor,
  ValidateAndApplyPropertyDescriptor,
  CopyValueClassInstance,
  LengthOfArrayLike,
  MakeBasicObject,
  SameValue,
  ToBoolean,
  LookupClassOperator,
  ToNumber,
  ToString,
  ToUint32,
  IsPropertyKey,
  isArrayIndex,
  isNonNegativeInteger,
  F, R,
  type OrdinaryObject,
  type FunctionObject,
  type GeneratorObject,
  MakeTypedArrayWithBufferWitnessRecord,
  IsTypedArrayOutOfBounds,
  TypedArrayLength,
  CreateIteratorResultObject,
  GeneratorYield,
  Throw,
} from '#self';
import { isTypedArrayObject, RequireType, INDEX_TYPE } from '#self';

const InternalMethods = {
  /** https://tc39.es/ecma262/#sec-array-exotic-objects-defineownproperty-p-desc */
  * DefineOwnProperty(P, Desc): ValueEvaluator<BooleanValue> {
    const array = this;

    Assert(IsPropertyKey(P));
    const scoped = insertionWrites.get(array);
    const insertion = scoped && scoped.context === surroundingAgent.executionContextStack.at(-1) && scoped.key === P
      ? scoped.plan : undefined;
    if (insertion) Q(CheckArrayInsertion(insertion));
    const removalScope = removalWrites.get(array);
    const removal = removalScope && removalScope.context === surroundingAgent.executionContextStack.at(-1) && removalScope.key === P
      ? removalScope.plan : undefined;
    if (removal) Q(CheckArrayRemoval(removal));
    const admission = admissionWrites.get(array);
    const admissionCheck = admission && admission.context === surroundingAgent.executionContextStack.at(-1) && admission.key === P
      ? admission.check : undefined;
    if (admissionCheck) Q(admissionCheck());
    // `Set` checks a store against the tuple's
    // position type or the array's element type; a REDEFINITION reached
    // neither, so `Object.defineProperty(a, 0, { value: "no" })` put a String
    // in a slot declared `uint8`, and `Reflect.defineProperty` did the same.
    // Both are spellings #table-check-sites names - "a value crossing into a
    // typed position through reflection, including `Reflect.set` and
    // `Reflect.defineProperty`" - and only the first was wired.
    //
    // The rules are `Set`'s, so the shape is `Set`'s: a tuple position takes
    // its own type, a position the rest collects takes the rest's, a position
    // beyond the arity is not a position, and a typed array's element takes the
    // element type. RequireType returns the value OF THE TYPE, so the descriptor
    // carries what it returned - a plain 7 redefining a `uint8` element becomes
    // that element's uint8, exactly as the store makes it.
    if (surroundingAgent.feature('runtime-types') && isArrayIndex(P)) {
      type PositionType = Parameters<typeof RequireType>[1];
      const typed = array as unknown as {
        TypedTuple?: TupleStorageShape,
        TypedElement?: PositionType,
      };
      const extent = (array as { TypedExtent?: number }).TypedExtent;
      if (extent !== undefined && Number((P as JSStringValue).stringValue()) >= extent) {
        return Throw.TypeError('a fixed-extent array cannot be grown');
      }
      const tuple = typed.TypedTuple;
      if (tuple !== undefined) {
        const position = Number((P as JSStringValue).stringValue());
        const length = TupleBackingLength(array);
        const nextLength = Math.max(length, position + 1);
        const target = TupleStorageTypeAt(tuple, position, nextLength);
        if (!target || !TupleResizePreserves(tuple, length, nextLength)) {
          return Throw.TypeError('a tuple definition cannot change a surviving position contract');
        }
        if (Desc.Value !== undefined) Desc = Descriptor({ ...Desc, Value: Q(yield* RequireType(Desc.Value, target)) });
      } else if (typed.TypedElement !== undefined && Desc.Value !== undefined) {
        Desc = Descriptor({ ...Desc, Value: Q(yield* RequireType(Desc.Value, typed.TypedElement)) });
      }
    }
    // Conversion can reenter before this definition reaches its ordinary write.
    // Revalidate even if the callback has now created the destination itself.
    if (insertion) Q(CheckArrayInsertion(insertion));
    if (removal) Q(CheckArrayRemoval(removal));
    if (admissionCheck) Q(admissionCheck());
    if (P instanceof JSStringValue && P.stringValue() === 'length') {
      return Q(yield* ArraySetLength(array, Desc));
    } else if (isArrayIndex(P)) {
      let lengthDesc = OrdinaryGetOwnProperty(array, Value('length'));
      Assert(!(lengthDesc instanceof UndefinedValue));
      Assert(IsDataDescriptor(lengthDesc));
      Assert(lengthDesc.Configurable === Value.false);
      const length = lengthDesc.Value;
      Assert(length instanceof NumberValue && isNonNegativeInteger(R(length)));
      const index = X(ToUint32(P));
      if (R(index) >= R(length) && lengthDesc.Writable === Value.false) {
        return Value.false;
      }
      if (surroundingAgent.feature('runtime-types') && HasTypedArrayBacking(array)
          && R(index) < R(length) && OrdinaryGetOwnProperty(array, P) === Value.undefined) {
        if (IsAccessorDescriptor(Desc)) return Throw.TypeError('a new typed array position requires a data value');
        if (Desc.Value === undefined) {
          if (array.Extensible === Value.false) return Value.false;
          const backing = array as ArrayBacking;
          const { TypedTuple: tuple, TypedElement: element, TypedExtent: extent } = backing;
          const target = tuple ? TupleStorageTypeAt(tuple, R(index), R(length)) : element;
          Assert(target !== undefined);
          const value = Q(yield* DefaultValueOf(target));
          if (value === undefined) return Throw.TypeError('a new array position has no default value');
          const copy = CopyValueClassInstance(value);
          if (TupleBackingLength(array) !== R(length) || backing.TypedTuple !== tuple
              || backing.TypedElement !== element || backing.TypedExtent !== extent
              || OrdinaryGetOwnProperty(array, P) !== Value.undefined) {
            return Throw.TypeError('array backing changed during element initialization');
          }
          Desc = Descriptor({ ...Desc, Value: copy });
        }
      }
      if (surroundingAgent.feature('runtime-types') && HasTypedArrayBacking(array) && R(index) >= R(length)) {
        if (IsAccessorDescriptor(Desc)) return Throw.TypeError('a new typed array position requires a data value');
        if (insertion) {
          if (array.Extensible === Value.false) return Value.false;
          insertion.values.set(R(index), Desc);
          return Value.true;
        }
        return yield* GrowInitializedArray(array, R(length), R(index) + 1,
          Descriptor({ Value: F(R(index) + 1) }), new Map([[R(index), Desc]]));
      }
      let succeeded = X(OrdinaryDefineOwnProperty(array, P, Desc));
      if (succeeded === Value.false) {
        return Value.false;
      }
      if (R(index) >= R(length)) {
        lengthDesc = Descriptor({ ...lengthDesc, Value: F(R(index) + 1) });
        succeeded = X(OrdinaryDefineOwnProperty(array, Value('length'), lengthDesc));
        Assert(succeeded === Value.true);
      }
      return Value.true;
    }
    return yield* OrdinaryDefineOwnProperty(array, P, Desc);
  },

  * Delete(P): ValueEvaluator<BooleanValue> {
    if (surroundingAgent.feature('runtime-types') && isArrayIndex(P)) {
      const backing = this as ArrayBacking;
      const index = Number((P as JSStringValue).stringValue());
      const bound = backing.TypedExtent ?? (backing.TypedTuple ? TupleLengthRange(backing.TypedTuple).max : Infinity);
      if (HasTypedArrayBacking(this) && index < bound) {
        return Throw.TypeError('$1 is a typed element and cannot be deleted', P);
      }
    }
    return yield* ObjectValue.prototype.Delete.call(this, P);
  },
} satisfies Partial<ObjectInternalMethods<OrdinaryObject>>;

export { InternalMethods as ArrayExoticObjectInternalMethods };

export function isArrayExoticObject(O: Value) {
  return O instanceof ObjectValue && O.DefineOwnProperty === InternalMethods.DefineOwnProperty;
}

/** https://tc39.es/ecma262/#sec-arraycreate */
export function ArrayCreate(length: number, proto?: ObjectValue): ValueCompletion<OrdinaryObject> {
  Assert(isNonNegativeInteger(length));
  if (Object.is(length, -0)) {
    length = +0;
  }
  if (length > (2 ** 32) - 1) {
    return Throw.RangeError('Array length too big.');
  }
  if (proto === undefined) {
    proto = surroundingAgent.intrinsic('%Array.prototype%');
  }
  const array = X(MakeBasicObject(['Prototype', 'Extensible'])) as Mutable<OrdinaryObject>;
  array.Prototype = proto;
  array.DefineOwnProperty = InternalMethods.DefineOwnProperty;
  array.Delete = InternalMethods.Delete;

  X(OrdinaryDefineOwnProperty(array, Value('length'), Descriptor({
    Value: F(length),
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));

  return array;
}

/** https://tc39.es/ecma262/#sec-arrayspeciescreate */
export function* ArraySpeciesCreate(originalArray: ObjectValue, length: number): ValueEvaluator<ObjectValue> {
  Assert(typeof length === 'number' && Number.isInteger(length) && length >= 0);
  if (Object.is(length, -0)) {
    length = +0;
  }
  const isArray = Q(IsArray(originalArray));
  if (isArray === Value.false) {
    return Q(ArrayCreate(length));
  }
  let constructor = Q(yield* Get(originalArray, Value('constructor')));
  if (IsConstructor(constructor)) {
    const thisRealm = surroundingAgent.currentRealmRecord;
    const constructorRealm = Q(GetFunctionRealm(constructor));
    if (thisRealm !== constructorRealm) {
      if (SameValue(constructor, constructorRealm.Intrinsics['%Array%'])) {
        constructor = Value.undefined;
      }
    }
  }
  if (constructor instanceof ObjectValue) {
    constructor = Q(yield* Get(constructor, wellKnownSymbols.species));
    if (constructor === Value.null) {
      constructor = Value.undefined;
    }
  }
  if (constructor === Value.undefined) {
    return Q(ArrayCreate(length));
  }
  if (!IsConstructor(constructor)) {
    return Throw.TypeError('$1 is not a constructor', constructor);
  }
  return Q(yield* Construct(constructor, [F(length)]));
}

/** https://tc39.es/ecma262/#sec-arraysetlength */
export function* ArraySetLength(array: OrdinaryObject, Desc: Descriptor): ValueEvaluator<BooleanValue> {
  if (Desc.Value === undefined) {
    return yield* OrdinaryDefineOwnProperty(array, Value('length'), Desc);
  }
  let newLenDesc = Desc;
  const typed = array as { TypedElement?: unknown, TypedTuple?: unknown };
  let newLen: number;
  if (surroundingAgent.feature('runtime-types') && (typed.TypedElement !== undefined || typed.TypedTuple !== undefined)) {
    // A dynamic value crosses the same count boundary as a statically typed
    // length assignment. Preserve the array representation's current limit.
    const count = Q(yield* RequireType(Desc.Value, INDEX_TYPE));
    newLen = R(Q(yield* ToNumber(count)));
    if (newLen > 2 ** 32 - 1) return Throw.RangeError('Array length too big.');
  } else {
    newLen = R(Q(yield* ToUint32(Desc.Value)));
    const numberLen = R(Q(yield* ToNumber(Desc.Value)));
    if (newLen !== numberLen) return Throw.RangeError('Array length must be uint32.');
  }
  // proposal-runtime-types #sec-array-and-tuple-types: the length of a
  // FIXED-extent array is its type's extent, so assigning another is refused.
  // The store check above bounds the elements; this bounds the length itself,
  // which `push` and a direct `a.length = n` both reach.
  const extent = (array as { TypedExtent?: number }).TypedExtent;
  if (extent !== undefined && newLen !== extent) {
    return Throw.TypeError('a fixed-extent array cannot be grown');
  }
  // Suffix positions are anchored at the end. Resizing must preserve the
  // declared contract of every surviving index, including any live reference.
  const tuple = (array as { TypedTuple?: TupleStorageShape }).TypedTuple;
  if (tuple !== undefined && !TupleResizePreserves(tuple, TupleBackingLength(array), newLen)) {
    return Throw.TypeError('a tuple length change cannot change a surviving position contract');
  }
  newLenDesc = Descriptor({ ...Desc, Value: F(newLen) });
  const oldLenDesc = OrdinaryGetOwnProperty(array, Value('length'));
  Assert(!(oldLenDesc instanceof UndefinedValue));
  Assert(IsDataDescriptor(oldLenDesc));
  Assert(oldLenDesc.Configurable === Value.false);
  const oldLen = R(oldLenDesc.Value as NumberValue);
  if (newLen > oldLen && surroundingAgent.feature('runtime-types')
      && (typed.TypedElement !== undefined || tuple !== undefined)) {
    return yield* GrowInitializedArray(array, oldLen, newLen, newLenDesc);
  }
  if (newLen >= oldLen) {
    return yield* OrdinaryDefineOwnProperty(array, Value('length'), newLenDesc);
  }
  if (oldLenDesc.Writable === Value.false) {
    return Value.false;
  }
  let newWritable;
  if (newLenDesc.Writable === undefined || newLenDesc.Writable === Value.true) {
    newWritable = true;
  } else {
    newWritable = false;
    newLenDesc = Descriptor({ ...newLenDesc, Writable: Value.true });
  }
  const succeeded = X(OrdinaryDefineOwnProperty(array, Value('length'), newLenDesc));
  if (succeeded === Value.false) {
    return Value.false;
  }
  const keys: JSStringValue[] = [];
  array.properties.forEach((_value, key) => {
    if (isArrayIndex(key) && Number((key as JSStringValue).stringValue()) >= newLen) {
      keys.push(key as JSStringValue);
    }
  });
  keys.sort((a, b) => Number(b.stringValue()) - Number(a.stringValue()));
  for (const P of keys) {
    // These positions leave the published extent. Bypass only the Array's
    // direct-delete refusal; retain ordinary descriptor and identity handling.
    const deleteSucceeded = yield* ObjectValue.prototype.Delete.call(array, P);
    if (deleteSucceeded === Value.false || deleteSucceeded instanceof AbruptCompletion) {
      newLenDesc = Descriptor({ ...newLenDesc, Value: F(R(X(ToUint32(P))) + 1) });
      if (newWritable === false) {
        newLenDesc = Descriptor({ ...newLenDesc, Writable: Value.false });
      }
      X(OrdinaryDefineOwnProperty(array, Value('length'), newLenDesc));
      return deleteSucceeded;
    }
  }
  if (newWritable === false) {
    const s = yield* OrdinaryDefineOwnProperty(array, Value('length'), Descriptor({ Writable: Value.false }));
    Assert(s === Value.true);
  }
  return Value.true;
}

/** Prepare defaults before publishing an explicit typed length increase. */
function* GrowInitializedArray(array: OrdinaryObject, oldLen: number, newLen: number, desc: Descriptor,
  supplied: ReadonlyMap<number, Descriptor> = new Map()): ValueEvaluator<BooleanValue> {
  const backing = array as OrdinaryObject & {
    TypedElement?: Parameters<typeof DefaultValueOf>[0],
    TypedTuple?: TupleStorageShape,
    TypedExtent?: number,
    TypedCapacity?: number,
    TypedGeneration?: number,
  };
  const element = backing.TypedElement;
  const tuple = backing.TypedTuple;
  const extent = backing.TypedExtent;
  const lengthKey = Value('length');
  let current = OrdinaryGetOwnProperty(array, lengthKey);
  if (array.Extensible === Value.false
      || IsCompatiblePropertyDescriptor(array.Extensible, desc, current) === Value.false) {
    return Value.false;
  }
  const values: Descriptor[] = [];
  for (let index = oldLen; index < newLen; index += 1) {
    const suppliedDescriptor = supplied.get(index);
    let value = suppliedDescriptor?.Value;
    if (value === undefined) {
      const target = tuple === undefined ? element : TupleStorageTypeAt(tuple, index, newLen);
      Assert(target !== undefined);
      value = Q(yield* DefaultValueOf(target));
      if (value === undefined) return Throw.TypeError('a new array position has no default value');
      value = CopyValueClassInstance(value);
    }
    values.push(Descriptor(suppliedDescriptor === undefined
      ? { Value: value, Writable: Value.true, Enumerable: Value.true, Configurable: Value.true }
      : { ...suppliedDescriptor, Value: value }));
    // Defaults can call metadata code. A plan is not permission to overwrite
    // an independent resize or newly acquired backing contract.
    if (TupleBackingLength(array) !== oldLen || backing.TypedElement !== element
        || backing.TypedTuple !== tuple || backing.TypedExtent !== extent) {
      return Throw.TypeError('array backing changed during length initialization');
    }
  }
  current = OrdinaryGetOwnProperty(array, lengthKey);
  if (array.Extensible === Value.false
      || IsCompatiblePropertyDescriptor(array.Extensible, desc, current) === Value.false) {
    return Value.false;
  }
  // No user code runs between this revalidation and publication. Define own
  // data slots directly, without inherited setters or a second conversion.
  for (let offset = 0; offset < values.length; offset += 1) {
    const success = ValidateAndApplyPropertyDescriptor(array, Value(String(oldLen + offset)), array.Extensible, values[offset]!, Value.undefined);
    Assert(success === Value.true);
  }
  const success = ValidateAndApplyPropertyDescriptor(array, lengthKey, array.Extensible, desc, current);
  Assert(success === Value.true);
  const capacity = Math.max(backing.TypedCapacity ?? 0, oldLen);
  if (newLen > capacity) {
    backing.TypedCapacity = Math.max(newLen, capacity * 2, 4);
    backing.TypedGeneration = (backing.TypedGeneration ?? 0) + 1;
  }
  return Value.true;
}

type ArrayBacking = OrdinaryObject & {
  TypedElement?: Parameters<typeof DefaultValueOf>[0], TypedTuple?: TupleStorageShape, TypedExtent?: number,
};

function HasTypedArrayBacking(array: ObjectValue): boolean {
  const backing = array as ArrayBacking;
  return backing.TypedElement !== undefined || backing.TypedTuple !== undefined;
}

export type ArrayInsertionPlan = {
  object: ArrayBacking, oldLength: number, length: number,
  element: ArrayBacking['TypedElement'], tuple: ArrayBacking['TypedTuple'], extent: number | undefined,
  values: Map<number, Descriptor>,
};

const insertionWrites = new WeakMap<ObjectValue, {
  plan: ArrayInsertionPlan, key: JSStringValue, context: unknown,
}>();

/** Only growing owned typed Array mutations need a private tail. */
export function BeginArrayInsertion(object: ObjectValue, length: number): ArrayInsertionPlan | undefined {
  if (!surroundingAgent.feature('runtime-types') || !isArrayExoticObject(object) || !HasTypedArrayBacking(object)) return undefined;
  const oldLength = TupleBackingLength(object);
  if (length <= oldLength) return undefined;
  const backing = object as ArrayBacking;
  return { object: backing, oldLength, length, element: backing.TypedElement,
    tuple: backing.TypedTuple, extent: backing.TypedExtent, values: new Map() };
}

function CheckArrayInsertion(plan: ArrayInsertionPlan): ThrowCompletion | undefined {
  const { object } = plan;
  if (TupleBackingLength(object) !== plan.oldLength || object.TypedElement !== plan.element
      || object.TypedTuple !== plan.tuple || object.TypedExtent !== plan.extent) {
    return Throw.TypeError('array backing changed during insertion');
  }
  return undefined;
}

/** Keep Set's lookup, conversion and setter effects. Only this intrinsic write,
 * in this execution context, can stage its eventual own data definition. A
 * callback's independent writes run in their own context and publish normally. */
export function* SetArrayInsertion(object: ObjectValue, key: JSStringValue, value: Value,
  plan: ArrayInsertionPlan | undefined): ValueEvaluator<BooleanValue> {
  if (!plan) return yield* Set(object, key, value, Value.true);
  Q(CheckArrayInsertion(plan));
  const previous = insertionWrites.get(object);
  insertionWrites.set(object, { plan, key, context: surroundingAgent.executionContextStack.at(-1) });
  try {
    const result = Q(yield* Set(object, key, value, Value.true));
    Q(CheckArrayInsertion(plan));
    return result;
  } finally {
    if (previous) insertionWrites.set(object, previous);
    else insertionWrites.delete(object);
  }
}

export function* FinishArrayInsertion(object: ObjectValue, length: number,
  plan: ArrayInsertionPlan | undefined): ValueEvaluator<BooleanValue> {
  if (!plan) return yield* Set(object, Value('length'), F(length), Value.true);
  Q(CheckArrayInsertion(plan));
  if (length > 2 ** 32 - 1) return Throw.RangeError('Array length too big.');
  const succeeded = Q(yield* GrowInitializedArray(plan.object, plan.oldLength, length,
    Descriptor({ Value: F(length) }), plan.values));
  if (succeeded === Value.false) return Throw.TypeError('array insertion cannot publish its initialized tail');
  return succeeded;
}

export type ArrayRemovalPlan = Omit<ArrayInsertionPlan, 'values'>;
const removalWrites = new WeakMap<ObjectValue, {
  plan: ArrayRemovalPlan, key: JSStringValue, context: unknown,
}>();

/** Removing intrinsic tails remain present until the final length operation.
 * Existing-position writes and independent callbacks still happen normally. */
export function BeginArrayRemoval(object: ObjectValue, length: number): ArrayRemovalPlan | undefined {
  if (!surroundingAgent.feature('runtime-types') || !isArrayExoticObject(object) || !HasTypedArrayBacking(object)) return undefined;
  const oldLength = TupleBackingLength(object);
  if (length >= oldLength) return undefined;
  const backing = object as ArrayBacking;
  return { object: backing, oldLength, length, element: backing.TypedElement,
    tuple: backing.TypedTuple, extent: backing.TypedExtent };
}

function CheckArrayRemoval(plan: ArrayRemovalPlan): ThrowCompletion | undefined {
  const { object } = plan;
  if (TupleBackingLength(object) !== plan.oldLength || object.TypedElement !== plan.element
      || object.TypedTuple !== plan.tuple || object.TypedExtent !== plan.extent) {
    return Throw.TypeError('array backing changed during removal');
  }
  return undefined;
}

export function* SetArrayRemoval(object: ObjectValue, key: JSStringValue, value: Value,
  plan: ArrayRemovalPlan | undefined): ValueEvaluator<BooleanValue> {
  if (!plan) return yield* Set(object, key, value, Value.true);
  Q(CheckArrayRemoval(plan));
  const previous = removalWrites.get(object);
  removalWrites.set(object, { plan, key, context: surroundingAgent.executionContextStack.at(-1) });
  try {
    const result = Q(yield* Set(object, key, value, Value.true));
    Q(CheckArrayRemoval(plan));
    return result;
  } finally {
    if (previous) removalWrites.set(object, previous);
    else removalWrites.delete(object);
  }
}

export function* DeleteArrayRemoval(object: ObjectValue, key: JSStringValue,
  plan: ArrayRemovalPlan | undefined): ValueEvaluator<BooleanValue> {
  if (!plan) return yield* DeletePropertyOrThrow(object, key);
  Q(CheckArrayRemoval(plan));
  const index = Number(key.stringValue());
  if (index < plan.length || index >= plan.oldLength) return yield* DeletePropertyOrThrow(object, key);
  // An independently acquired required object property still protects this
  // location even though the Array operation would remove its indexed role.
  if ((object as { TypedProperties?: Map<unknown, unknown> }).TypedProperties?.has(key.stringValue())) {
    return Throw.TypeError('$1 is a typed property and cannot be deleted', key);
  }
  const desc = OrdinaryGetOwnProperty(plan.object, key);
  if (!(desc instanceof UndefinedValue) && desc.Configurable === Value.false) {
    return Throw.TypeError('array removal cannot delete a nonconfigurable element');
  }
  // Preflight at the ordinary deletion step, but neither remove the location
  // nor invalidate references until length truncation actually succeeds.
  return Value.true;
}

export function* FinishArrayRemoval(object: ObjectValue, length: number,
  plan: ArrayRemovalPlan | undefined): ValueEvaluator<BooleanValue> {
  if (plan) Q(CheckArrayRemoval(plan));
  return yield* Set(object, Value('length'), F(length), Value.true);
}

const admissionWrites = new WeakMap<ObjectValue, {
  key: JSStringValue, context: unknown, check: () => ThrowCompletion | undefined,
}>();

/** Guard only the admission's own definition after any Set conversion effects.
 * Independent callback writes retain their ordinary execution context. */
export function* SetArrayAdmission(object: ObjectValue, key: JSStringValue, value: Value,
  check: () => ThrowCompletion | undefined): ValueEvaluator<BooleanValue> {
  Q(check());
  const previous = admissionWrites.get(object);
  admissionWrites.set(object, { key, check, context: surroundingAgent.executionContextStack.at(-1) });
  try {
    return yield* Set(object, key, value, Value.false);
  } finally {
    if (previous) admissionWrites.set(object, previous);
    else admissionWrites.delete(object);
  }
}

/** https://tc39.es/ecma262/#sec-isconcatspreadable */
export function* IsConcatSpreadable(O: Value): ValueEvaluator<BooleanValue> {
  if (!(O instanceof ObjectValue)) {
    return Value.false;
  }
  const spreadable = Q(yield* Get(O, wellKnownSymbols.isConcatSpreadable));
  if (spreadable !== Value.undefined) {
    return ToBoolean(spreadable);
  }
  return Q(IsArray(O));
}

/** https://tc39.es/ecma262/#sec-comparearrayelements */
/**
 * The order two values carry by their own type, or ~undefined~ where they carry
 * none and the caller should fall back to the String comparison.
 *
 * A two-way question asked twice rather than a three-way comparison: a sort only
 * needs to know which of two elements precedes the other, and deriving
 * "less, equal, or greater" from a user's `operator <` would call it twice per
 * comparison to no purpose.
 */
/**
 * Whether a typed number's declared type is a 64-bit integral one, whose values
 * a double cannot tell apart above 2**53.
 */
function isWideIntegral(v: Value): boolean {
  if (!isTypedNumber(v)) {
    return false;
  }
  const t = (v as { TypeRecord?: { Kind?: string, Name?: string, Arguments?: readonly unknown[] } }).TypeRecord;
  if (!t || t.Kind !== 'primitive' || (t.Name !== 'int' && t.Name !== 'uint')) {
    return false;
  }
  return t.Arguments?.[0] === 64;
}

function* OrderedComparison(x: Value, y: Value): PlainEvaluator<number | undefined> {
  // Both must be typed, and to the SAME type: comparing a `uint8` against a
  // string has no order of its own and belongs on the String path.
  if (isTypedNumber(x) && isTypedNumber(y)) {
    const a = x.numberValue();
    const b = y.numberValue();
    // A 64-bit integral type holds values a double cannot distinguish:
    // `9007199254740993` and `...992` are exact in the record and equal as
    // Numbers, so comparing as Numbers left them in their original order. The
    // type carries more precision than a Number comparison respects, so ask the
    // TYPE rather than the JavaScript representation.
    if (isWideIntegral(x) || isWideIntegral(y)) {
      // `numberValue()` narrows to a double, which is exactly the information
      // being lost - `9007199254740993` and `...992` are the same double. The
      // record's own `value` keeps the exact magnitude, which is why `String(x)`
      // prints it correctly, so compare from there.
      const ra = (x as { value?: number | bigint }).value ?? a;
      const rb = (y as { value?: number | bigint }).value ?? b;
      const ba = typeof ra === 'bigint' ? ra : BigInt(Math.trunc(Number(ra)));
      const bb = typeof rb === 'bigint' ? rb : BigInt(Math.trunc(Number(rb)));
      return ba < bb ? -1 : (ba > bb ? 1 : 0);
    }
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      // Compared AS BigInts. Converting to Number to compare would change the
      // ORDER above 2**53, not merely lose precision.
      const ba = BigInt(a);
      const bb = BigInt(b);
      return ba < bb ? -1 : (ba > bb ? 1 : 0);
    }
    const na = Number(a);
    const nb = Number(b);
    // NaN last and -0 before +0, matching %TypedArray%.prototype.sort so that an
    // array and the corresponding TypedArray agree.
    if (Number.isNaN(na)) {
      return Number.isNaN(nb) ? 0 : 1;
    }
    if (Number.isNaN(nb)) {
      return -1;
    }
    if (na < nb) {
      return -1;
    }
    if (na > nb) {
      return 1;
    }
    if (Object.is(na, -0) && Object.is(nb, 0)) {
      return -1;
    }
    if (Object.is(na, 0) && Object.is(nb, -0)) {
      return 1;
    }
    return 0;
  }
  if (x instanceof BigIntValue && y instanceof BigIntValue) {
    const a = x.bigintValue();
    const bv = y.bigintValue();
    return a < bv ? -1 : (a > bv ? 1 : 0);
  }
  // sec-ordered-element-types: an enum orders by the rule its underlying type
  // carries - a `string` underlying type by DECLARATION POSITION rather than
  // alphabetically. The enumerator is a TypedStringValue holding its record, so
  // the ordinal is its position in [[EnumMembers]].
  //
  // Both must be enumerators of the SAME enum: two enums, or an enumerator
  // against a bare string, have no single declaration order to consult.
  if (x instanceof TypedStringValue && y instanceof TypedStringValue) {
    const t = x.TypeRecord as { EnumMembers?: readonly Value[] } | undefined;
    if (t && t === (y.TypeRecord as unknown) && t.EnumMembers) {
      const xi = t.EnumMembers.findIndex((m) => SameValue(m, x));
      const yi = t.EnumMembers.findIndex((m) => SameValue(m, y));
      if (xi >= 0 && yi >= 0) {
        return xi - yi;
      }
    }
    return undefined;
  }
  if (x instanceof BooleanValue && y instanceof BooleanValue) {
    const a = x.booleanValue() ? 1 : 0;
    const bv = y.booleanValue() ? 1 : 0;
    return a - bv;
  }
  // sec-ordered-element-types: a class declaring `operator <` orders by it. The
  // operator is a USER function, so this arm is why the helper is a generator -
  // an earlier note claimed the comparison could not yield, which was wrong:
  // `CompareArrayElements` is itself a generator and already calls the
  // caller-supplied comparator the same way.
  //
  // Asked twice, `x < y` then `y < x`, because a sort needs to distinguish
  // less from equal and `<` answers only one bit. Two calls per comparison is
  // the cost of ordering by a declared `<`, and it is what the author asked for
  // by declaring it.
  if (x instanceof ObjectValue && y instanceof ObjectValue) {
    const lessFn = LookupClassOperator(x, '<');
    if (!lessFn || LookupClassOperator(y, '<') !== lessFn) {
      // Both operands must reach the SAME declared operator: two unrelated
      // classes have no shared order to consult.
      return undefined;
    }
    const xLessY = ToBoolean(Q(yield* Call(lessFn as Value, x, [y]))) === Value.true;
    if (xLessY) {
      return -1;
    }
    const yLessX = ToBoolean(Q(yield* Call(lessFn as Value, y, [x]))) === Value.true;
    return yLessX ? 1 : 0;
  }
  return undefined;
}

export function* CompareArrayElements(x: Value, y: Value, comparefn: FunctionObject | UndefinedValue): ValueEvaluator<NumberValue> {
  // 1. If x and y are both undefined, return +0𝔽.
  if (x === Value.undefined && y === Value.undefined) {
    return F(+0);
  }
  // 2. If x is undefined, return 1𝔽.
  if (x === Value.undefined) {
    return F(1);
  }
  // 3. If y is undefined, return -1𝔽.
  if (y === Value.undefined) {
    return F(-1);
  }
  // 4. If comparefn is not undefined, then
  if (comparefn !== Value.undefined) {
    // a. Let v be ? ToNumber(? Call(comparefn, undefined, « x, y »)).
    const v = Q(yield* ToNumber(Q(yield* Call(comparefn, Value.undefined, [x, y]))));
    // b. If v is NaN, return +0𝔽.
    if (v.isNaN()) {
      return F(+0);
    }
    // c. Return v.
    return v;
  }
  // proposal-runtime-types sec-ordered-element-types: where the elements carry a
  // type that has an order of its own, that order is used rather than the String
  // comparison below - so `[].<uint8>` sorts as `Uint8Array` does instead of as
  // text, where `[10, 9, 1]` gave `1,10,9`.
  //
  // Sited HERE rather than in `sort` because `sort` and `toSorted` both route
  // through this operation, so one change covers both and a third entry point
  // would inherit it.
  //
  // The values are inspected rather than the array's element type: a comparison
  // receives two elements and nothing else, and a typed element carries its type
  // with it. That also means a mixed or untyped array falls through untouched.
  const ordered = Q(yield* OrderedComparison(x, y));
  if (ordered !== undefined) {
    return F(ordered);
  }
  // 5. Let xString be ? ToString(x).
  const xString = Q(yield* ToString(x));
  // 6. Let yString be ? ToString(y).
  const yString = Q(yield* ToString(y));
  // 7. Let xSmaller be the result of performing Abstract Relational Comparison xString < yString.
  const xSmaller = yield* IsLessThan(xString, yString);
  // 8. If xSmaller is true, return -1𝔽.
  if (xSmaller === Value.true) {
    return F(-1);
  }
  // 9. Let ySmaller be the result of performing Abstract Relational Comparison yString < xString.
  const ySmaller = yield* IsLessThan(yString, xString);
  // 10. If ySmaller is true, return 1𝔽.
  if (ySmaller === Value.true) {
    return F(1);
  }
  // 11. Return +0𝔽.
  return F(+0);
}

/** https://tc39.es/ecma262/#sec-createarrayiterator */
export function CreateArrayIterator(array: ObjectValue, kind: 'key+value' | 'key' | 'value'): ValueCompletion<GeneratorObject> {
  // 3. Let closure be a new Abstract Closure with no parameters that captures kind and array and performs the following steps when called:
  const closure = function* closure(): YieldEvaluator {
    // a. Let index be 0.
    let index = 0;
    // b. Repeat,
    while (true) {
      let len;
      let result;
      // i. If array has a [[TypedArrayName]] internal slot, then
      if (isTypedArrayObject(array)) {
        const taRecord = MakeTypedArrayWithBufferWitnessRecord(array, 'seq-cst');
        if (IsTypedArrayOutOfBounds(taRecord)) {
          return Throw.TypeError('TypedArray out of bounds');
        }
        // 2. Let len be array.[[ArrayLength]].
        len = TypedArrayLength(taRecord);
      } else { // ii. Else,
        // 1. Let len be ? LengthOfArrayLike(array).
        len = Q(yield* LengthOfArrayLike(array));
      }
      // iii. If index ≥ len, return undefined.
      if (index >= len) {
        // NON_SPEC
        generator.HostCapturedValues = undefined;
        return Value.undefined;
      }
      const indexNumber = F(index);
      // iv. If kind is key,
      if (kind === 'key') {
        result = indexNumber;
      } else { // v. Else,
        // 1. Let elementKey be ! ToString(indexNumber).
        const elementKey = X(ToString(indexNumber));
        // 2. Let elementValue be ? Get(array, elementKey).
        const elementValue = Q(yield* Get(array, elementKey));
        // 3. If kind is value, perform ? Yield(elementValue).
        if (kind === 'value') {
          result = elementValue;
        } else { // 4. Else,
          // a. Assert: kind is key+value.
          Assert(kind === 'key+value');
          // b. Perform ? Yield(! CreateArrayFromList(« 𝔽(index), elementValue »)).
          result = CreateArrayFromList([indexNumber, elementValue]);
        }
      }
      Q(yield* GeneratorYield(CreateIteratorResultObject(result, Value.false)));
      // vi. Set index to index + 1.
      index += 1;
    }
  };
  // 4. Return CreateIteratorFromClosure(closure, "%ArrayIteratorPrototype%", %ArrayIteratorPrototype%).
  const generator = CreateIteratorFromClosure(closure, Value('%ArrayIteratorPrototype%'), surroundingAgent.intrinsic('%ArrayIteratorPrototype%'), ['HostCapturedValues'], [array]);
  return generator;
}
