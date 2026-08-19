import {
  surroundingAgent, Descriptor, ObjectValue, JSStringValue, Value, wellKnownSymbols, type ObjectInternalMethods,
  NumberValue, UndefinedValue,
  BooleanValue,
  BigIntValue,
  TypedStringValue,
  isTypedNumber,
  Q, X, type ValueCompletion, type ValueEvaluator, type PlainEvaluator,
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
  IsArray,
  IsConstructor,
  OrdinaryDefineOwnProperty,
  OrdinaryGetOwnProperty,
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
import { isTypedArrayObject, RequireType } from '#self';

const InternalMethods = {
  /** https://tc39.es/ecma262/#sec-array-exotic-objects-defineownproperty-p-desc */
  * DefineOwnProperty(P, Desc): ValueEvaluator<BooleanValue> {
    const array = this;

    Assert(IsPropertyKey(P));
    // PLAN-tuple-stores.md phase 1. `Set` checks a store against the tuple's
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
    if (surroundingAgent.feature('runtime-types') && Desc.Value !== undefined && isArrayIndex(P)) {
      type PositionType = Parameters<typeof RequireType>[1];
      const typed = array as unknown as {
        TypedTuple?: { Positions: readonly PositionType[], Rest: PositionType | undefined },
        TypedElement?: PositionType,
      };
      const tuple = typed.TypedTuple;
      if (tuple !== undefined) {
        const position = Number((P as JSStringValue).stringValue());
        if (position < tuple.Positions.length) {
          Desc = Descriptor({ ...Desc, Value: Q(yield* RequireType(Desc.Value, tuple.Positions[position]!)) });
        } else if (tuple.Rest !== undefined) {
          Desc = Descriptor({ ...Desc, Value: Q(yield* RequireType(Desc.Value, tuple.Rest)) });
        } else {
          return Throw.TypeError('a tuple of $1 positions has no position at index $2', Value(String(tuple.Positions.length)), P);
        }
      } else if (typed.TypedElement !== undefined) {
        Desc = Descriptor({ ...Desc, Value: Q(yield* RequireType(Desc.Value, typed.TypedElement)) });
      }
    }
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
  const newLen = R(Q(yield* ToUint32(Desc.Value)));
  const numberLen = R(Q(yield* ToNumber(Desc.Value)));
  if (newLen !== numberLen) {
    return Throw.RangeError('Array length must be uint32.');
  }
  // proposal-runtime-types #sec-array-and-tuple-types: the length of a
  // FIXED-extent array is its type's extent, so assigning another is refused.
  // The store check above bounds the elements; this bounds the length itself,
  // which `push` and a direct `a.length = n` both reach.
  const extent = (array as { TypedExtent?: number }).TypedExtent;
  if (extent !== undefined && newLen !== extent) {
    return Throw.TypeError('a fixed-extent array cannot be grown');
  }
  // PLAN-tuple-stores.md phase 3. A tuple's ARITY is part of its type, as an
  // array's extent is, and a tuple carries its positions rather than a
  // [[TypedExtent]] - so `t.length = 1` on a `[uint8, string]` walked past the
  // check above and left the value outside the type it is declared to have.
  // The store rules already refuse a write past the arity; this is the same
  // rule reached through `length`, which is how the array case reaches it too.
  //
  // A rest collects any number of positions, so a length at or above the fixed
  // ones is within the type; without a rest the arity is exact.
  const tuple = (array as { TypedTuple?: { Positions: readonly unknown[], Rest: unknown } }).TypedTuple;
  if (tuple !== undefined) {
    const fixed = tuple.Positions.length;
    if (tuple.Rest === undefined ? newLen !== fixed : newLen < fixed) {
      return Throw.TypeError('a tuple of $1 positions cannot be given a length of $2', Value(String(fixed)), Value(String(newLen)));
    }
  }
  newLenDesc = Descriptor({ ...Desc, Value: F(newLen) });
  const oldLenDesc = OrdinaryGetOwnProperty(array, Value('length'));
  Assert(!(oldLenDesc instanceof UndefinedValue));
  Assert(IsDataDescriptor(oldLenDesc));
  Assert(oldLenDesc.Configurable === Value.false);
  const oldLen = R(oldLenDesc.Value as NumberValue);
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
    const deleteSucceeded = X(array.Delete(P));
    if (deleteSucceeded === Value.false) {
      newLenDesc = Descriptor({ ...newLenDesc, Value: F(R(X(ToUint32(P))) + 1) });
      if (newWritable === false) {
        newLenDesc = Descriptor({ ...newLenDesc, Writable: Value.false });
      }
      X(OrdinaryDefineOwnProperty(array, Value('length'), newLenDesc));
      return Value.false;
    }
  }
  if (newWritable === false) {
    const s = yield* OrdinaryDefineOwnProperty(array, Value('length'), Descriptor({ Writable: Value.false }));
    Assert(s === Value.true);
  }
  return Value.true;
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
