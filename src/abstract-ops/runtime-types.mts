import { sourceTextOf } from '../parser/TokensOf.mts';
import { Q, X, EnsureCompletion, isEvaluator } from '../completion.mts';
// Placed with the other `./` imports and NOT after `../intrinsics/`, which
// `import-x/order` asks for and which `./all.mts` and `./array-view.mts` below
// already decline: moved there it forms a cycle through `array-view.mts` and
// `CopyValueClassInstance` is undefined at its use. The ordering rule and the
// module graph disagree, and the graph wins.
import { CopyValueClassInstance } from './testing-comparison.mts';
import { SoAStorageOf } from '../intrinsics/SoA.mts';
import { ConsumeEvaluationSteps, IsBudgetExhausted, EnterMetaHookEvaluation, ExitMetaHookEvaluation, BeginTypeEvaluation, EndTypeEvaluation } from '../type-system/budget.mts';
import { CanonicalizeType, GetTypeObject } from '../type-system/intern.mts';
import { Construct, IsCallable, IsConstructor, ToLength } from './all.mts';
import { TypedBooleanValue, TypedBoolean, TypedSymbolValue, TypedSymbol, TypedBigIntValue, TypedBigInt, NumberValue, SymbolValue, TypedNumberValue, isTypedNumber, JSStringValue, TypedStringValue, TypedString, Value, ObjectValue, BigIntValue, BooleanValue, type NativeSteps, type Arguments, type FunctionCallContext, Descriptor } from '../value.mts';
import { VectorValue } from '../value.mts';
import { isBitLaneType, vectorShape } from '../type-system/vector-ops.mts';
import { ArraySpanBackingOf, ArrayViewBackingOf, MakeArraySpan, StampTypedArray } from './array-view.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsCheckElided, PublishedReturnTypeOf } from '../type-system/check.mts';
import { generatorDeclaredType, anyType, displayType, builtinTypeRecord, type TypeRecord, type MetadataRecord, propertyKeyValue } from '../type-system/records.mts';
import { SameMetadata, SameType, COLLECTION_LIBRARY_NAMES } from '../type-system/relations.mts';
import { LayoutOf } from '../type-system/layout.mts';
import type { PrivateName } from '../value.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { isFloatTypeName, isIntegerTypeName } from '../type-system/numeric-signatures.mts';
import { fitsNumericType, IsOfType, RuntimeTypeOf, TypeNodeToTypeRecord, InferGenericBindings, pushTypeParameterFrame, popTypeParameterFrame } from '../type-system/runtime.mts';
import { currentContextualType } from '../type-system/runtime.mts';
import { describeParameters, minimumArity, resolveOverload, resolveOverloadByTypes, type OverloadParameter, type OverloadSignature } from '../type-system/overloads.mts';
import {
  wellKnownSymbols,
  Call, R, Throw, ToNumber, ToString, ToBoolean, CreateBuiltinFunction, ExecutionContext, surroundingAgent, Get, HasProperty, Set as SetProperty, IsArray, ArrayCreate, CreateDataPropertyOrThrow, OrdinaryObjectCreate, RegExpCreate, GetValue, Evaluate } from '#self';
import { CreateRangeObject, isRangeObject } from '../intrinsics/Range.mts';
import { isDecimalObject, DoubleFromDecimal } from '../intrinsics/Decimal.mts';
import { CreateComplexValue, isComplexObject } from '../intrinsics/Complex.mts';
import { Float128FromNumber, isFloat128Object } from '../intrinsics/Float128.mts';

/**
 * proposal-runtime-types: the run-time enforcement operations. RequireType is
 * the check inserted at the ~any~ boundary of the gradual system, and
 * ConvertValue is the conversion rule applied by `:=`.
 */

/**
 * The primitive a parameterization ultimately refines, looking through a literal
 * base and through nested parameterizations.
 *
 * PLAN-brand-layering-F.md T4. A carrier is chosen by the base's PRIMITIVE, and
 * a parameterization's base need not be one: `true.<{ brand }>` has a ~literal~
 * base, and `U.<{ brand }>` over an already-branded `U` has a ~parameterized~
 * one. Testing `Base.Kind === 'primitive'` directly missed both, so a branded
 * literal carried nothing and a nested brand carried its inner layer's record.
 */
function underlyingPrimitiveName(t: TypeRecord): string | undefined {
  let cur: TypeRecord = t;
  for (let depth = 0; depth < 16; depth += 1) {
    if (cur.Kind === 'primitive') {
      return cur.Name;
    }
    if (cur.Kind === 'literal' || cur.Kind === 'parameterized') {
      cur = cur.Base;
      continue;
    }
    // F179. An INTERSECTION of parameterizations over one base is itself a
    // refinement of that base, and a value crossing into it needs the base's
    // carrier - without this a layered String brand had nowhere to be recorded
    // and the boundary that declared it refused the value it had just made.
    if (cur.Kind === 'intersection' && cur.Members.length > 0
      && cur.Members.every((m) => m.Kind === 'parameterized')) {
      cur = cur.Members[0]!;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/**
 * proposal-runtime-types (Capability B): when a String value is given a literal
 * (or otherwise refined) string type at a typed boundary, carry that type on the
 * value so RuntimeTypeOf reports it rather than the widened `string`. Returns a
 * TypedStringValue carrying `t` when `t` narrows `string` and `value` is a plain
 * string; otherwise returns `value` unchanged. A value already carrying the same
 * type, or a non-string, is returned as-is.
 */
function carryStringType(value: Value, t: TypeRecord): Value {
  // PLAN-brand-layering-F.md F176. A BigInt has a carrier too -
  // `TypedBigIntValue`, recognised by `RuntimeTypeOf` already - and the crossing
  // was not using it, so a branded BigInt was a bare BigInt for the same reason
  // a branded String was. The same operation on the same shape of value.
  // And a Boolean. `ToBoolean` normalizes to the singleton, so a carried
  // boolean is truthy where it should be - the failure that ruled this out
  // before (F177) was at that funnel rather than here.
  if (value instanceof BooleanValue && !(value instanceof TypedBooleanValue)
    && (t.Kind === 'parameterized' || t.Kind === 'intersection')
    && underlyingPrimitiveName(t) === 'boolean') {
    return TypedBoolean(value.booleanValue(), t);
  }
  // A Symbol carries one too. Unlike a Boolean it has no singleton to fail to
  // be - every `Symbol()` is already a fresh object - so the carrier that broke
  // `boolean` (F177) is sound here.
  if (value instanceof SymbolValue && !(value instanceof TypedSymbolValue)
    && (t.Kind === 'parameterized' || t.Kind === 'intersection')
    && underlyingPrimitiveName(t) === 'symbol') {
    return TypedSymbol(value.Description, t);
  }
  if (value instanceof BigIntValue && !(value instanceof TypedBigIntValue)
    && (t.Kind === 'parameterized' || t.Kind === 'intersection')
    && underlyingPrimitiveName(t) === 'bigint') {
    return TypedBigInt(R(value) as bigint, t);
  }
  // A value already carrying a record is RE-STAMPED when the target is a
  // different type: a nested brand crosses a value that already carries its
  // inner layer, and returning it unchanged left it reporting the inner type.
  // Only an identical target is a no-op.
  if (!(value instanceof JSStringValue)) {
    return value;
  }
  if (value instanceof TypedStringValue
    && (value as { TypeRecord?: unknown }).TypeRecord === t) {
    return value;
  }
  // A literal type whose base is `string`, i.e. a specific string value's type.
  if (t.Kind === 'literal' && t.Value instanceof JSStringValue) {
    return TypedString(value.stringValue(), t);
  }
  // PLAN-brand-layering-F.md F172. A PARAMETERIZATION of `string` is a
  // refinement of it too, and the same carrier serves: a brand on a String had
  // nowhere to be recorded, so a branded string WAS a bare string, `IsOfType`
  // correctly answered false at every boundary that declared the brand, and a
  // value from the brand's own constructor could not be passed anywhere.
  //
  // The carrier already existed and this function already used it - for a
  // literal type only. Carrying a parameterization is the same operation on the
  // same value, and it makes the three non-carrying primitives carry.
  if ((t.Kind === 'parameterized' || t.Kind === 'intersection')
    && underlyingPrimitiveName(t) === 'string') {
    return TypedString(value.stringValue(), t);
  }
  return value;
}

/** #sec-requiretype */
/** The specification's last step of #sec-requiretype, and the last step of the
 * checked conversion: a value already of the type passes, anything else is a
 * TypeError. Kept private so that RequireType has exactly one meaning. */
function* requireMembership(value: Value, t: TypeRecord): ValueEvaluator {
  const ok = Q(yield* IsOfType(value, t));
  if (!ok) {
    // proposal-runtime-types #sec-vector-lanes: the broadcast. A value of the
    // lane type is not a MEMBER of the vector type - it converts to one - so
    // this path has to attempt the conversion rather than refuse. Without it
    // the annotation enforcement rejected `let b: float32x4 = s` before
    // CheckedConvertValue was ever reached.
    if (t.Kind === 'primitive' && t.Name === 'vector' && value.type !== 'Vector') {
      return Q(yield* CheckedConvertValue(value, t));
    }
    // proposal-runtime-types #sec-span-coercion, and here for the reason the
    // broadcast above is here: an owned array is not a MEMBER of `Span.<T>`,
    // it COERCES to one, exactly as the literal 5 is assignable to `uint8`
    // while `5 is uint8` is *false*. The coercion MATERIALIZES, so this is
    // where the window is built - membership having just answered no is
    // precisely the condition that means one is needed.
    if (t.Kind === 'nominal' && (t as { LibraryName?: string }).LibraryName === 'Span'
        && value instanceof ObjectValue
        && ArraySpanBackingOf(value as unknown as object) === undefined
        && ArrayViewBackingOf(value as unknown as object) === undefined) {
      // #sec-span-coercion: a window of T is a window over a run OF T, so the
      // elements have to be checked before one is built. A statically typed
      // source is caught by the checker, but anything reaching here as ~any~ -
      // a `Uint8Array`, a plain array, an object with a `length` - is not, and
      // without this every one of them coerced to `Span.<`ANY`>`.
      //
      // That was unsound rather than merely permissive: a `Uint8Array` became a
      // `Span.<uint32>` that answered *true* to `is`, and a store of 300
      // through it landed as 44, the underlying storage having wrapped it. The
      // window would have been promising an element type its storage does not
      // hold.
      // The ELEMENTS are checked, not "is this a dynamic array of T": that
      // question now answers *false* for a fixed array (#sec-array-and-tuple-
      // types), and a fixed array is exactly one of the things that must reach
      // a window. What a window promises is a run of T, and the extent is the
      // part it does not promise.
      const spanElement = (t as { Arguments?: readonly TypeRecord[] }).Arguments?.[0] as TypeRecord | undefined;
      if (spanElement !== undefined && spanElement.Kind !== 'any') {
        const lengthValue = Q(yield* Get(value, Value('length')));
        const count = R(Q(yield* ToLength(lengthValue)));
        for (let i = 0; i < count; i += 1) {
          const element = Q(yield* Get(value, Value(String(i))));
          if (!Q(yield* IsOfType(element, spanElement))) {
            return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
          }
        }
      }
      return Q(yield* ConvertValue(value, t));
    }
    // A value that IS already a window and did not satisfy the membership test
    // is a window of the WRONG element type, and there is no conversion for
    // that: a window does not own its storage, so it cannot restate what that
    // storage holds. It is refused here rather than falling through.
    //
    // Falling through was an infinite loop, not a wrong answer. The declared
    // conversion search re-entered the membership test, which re-entered the
    // search, and the stack overflowed inside the diagnostic being built for
    // the failure - which is why it read as a `displayType` bug.
    if (t.Kind === 'nominal' && (t as { LibraryName?: string }).LibraryName === 'Span'
        && value instanceof ObjectValue) {
      return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
    }
    // sec-user-defined-conversions form 1: "A constructor taking one parameter
    // of type S ... A converting constructor, so `let t: MyType = 1;` is legal
    // when MyType's constructor takes a float32."
    //
    // Beside the broadcast above, and for the same reason it sits here: a value
    // of the source type is not a MEMBER of the target - it CONVERTS to one - so
    // the path that has just failed membership is where the conversion belongs.
    // Reached only after IsOfType fails, which is the clause's ordering and the
    // ranking it needs: a value that already fits never routes through a user
    // conversion, so declaring a constructor changes no program that runs today.
    const constructed = Q(yield* ConstructThroughConvertingConstructor(value, t));
    if (constructed !== undefined) {
      return constructed;
    }
    // sec-user-defined-conversions form 2: `operator` T `()` declared on the
    // SOURCE class, converting the receiver. The same fallback position as the
    // converting constructor above and for the same reason - the value is not a
    // MEMBER of the target, it converts to one - so the two forms are two
    // candidate sources at one boundary rather than two boundaries.
    const viaOperator = Q(yield* ConvertThroughDeclaredOperator(value, t));
    if (viaOperator !== undefined) {
      return viaOperator;
    }
    // Form 3, declared on the TARGET and taking the value as a parameter.
    const viaInbound = Q(yield* ConvertThroughInboundOperator(value, t));
    if (viaInbound !== undefined) {
      return viaInbound;
    }
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  return value;
}

/**
 * #sec-requiretype: "It enforces the type _t_ on _value_ at a boundary,
 * RETURNING THE VALUE OF THE TYPE _t_ TO BE USED." The specification's steps
 * are: return the value where it is already of the type; convert it where the
 * target is numeric and the value is numeric, throwing a RangeError where that
 * conversion would wrap, truncate, or round to an infinity; convert it where
 * the target is `string` or `boolean`; and otherwise throw a TypeError.
 *
 * That is exactly CheckedConvertValue, which is why this operation delegates
 * rather than reimplementing. It did NOT until F51: this function was a bare
 * membership test, so the two sites wired to it - the typed-property store and
 * the typed defineProperty - refused `o.x = 7` for a uint8 property while the
 * binding boundary two lines away converted the same 7, and both sites
 * DISCARDED the return value the operation is defined to produce. One
 * operation at every boundary is the invariant here; the engine had two.
 */
/**
 * Give a collection its type arguments, refusing the entries it already holds
 * that do not fit.
 *
 * WHY VALIDATE RATHER THAN STAMP EARLIER. A collection built with a seed -
 * `new Set.<uint8>(["a"])` - had every seeded entry go unchecked, because the
 * stamp is applied to the RESULT of Construct and the constructor has already
 * consumed the seed by then. The obvious fix is to stamp first, and it is not
 * available: there is no object to stamp until the construction produces one,
 * so the type arguments would have to be threaded INTO construction through a
 * channel that does not exist.
 *
 * Validating on the way in reaches further than that fix would have. It also
 * covers the ANNOTATION path, `let s: Set.<uint8> = new Set(["a"])`, where the
 * construction carries no type arguments at all and there is nothing to thread;
 * and it gives the Phase 3 ADOPTION rule its missing half - a collection adopts
 * a target's arguments only where its contents support the claim, which is what
 * "adopting" ought to have meant.
 *
 * The rule stated once: a collection is of `Map.<K, V>` when every entry it
 * holds is, so acquiring the type is exactly the check that it already was.
 */
export function* StampTypedCollection(value: ObjectValue, args: readonly (TypeRecord | number)[]): PlainEvaluator<void> {
  const slots = value as unknown as Record<string, unknown>;
  const key = args[0];
  const second = args[1];
  const entries = (slots.MapData ?? slots.WeakMapData) as
    { Key?: Value, Value?: Value }[] | undefined;
  //
  // The CONVERTED value is written back, not merely checked. A boundary
  // converts, so `new Set.<uint8>([1])` must hold a `uint8` and not the Number
  // the literal arrived as - otherwise a seeded element and an added one would
  // differ, and `Reflect.typeOf([...s][0])` would answer `number` for the first
  // and `uint8` for the second. `add` and `set` already carry their values
  // through the conversion; this is the same step for the entries a constructor
  // put in.
  if (entries !== undefined) {
    for (const p of entries) {
      if (p.Key === undefined) {
        continue;
      }
      if (typeof key !== 'number') {
        p.Key = Q(yield* RequireIdentityType(p.Key, key as TypeRecord));
      }
      if (p.Value !== undefined && typeof second !== 'number') {
        p.Value = Q(yield* RequireType(p.Value, second as TypeRecord));
      }
    }
  } else {
    const elements = (slots.SetData ?? slots.WeakSetData) as (Value | undefined)[] | undefined;
    if (elements !== undefined && typeof key !== 'number') {
      for (let i = 0; i < elements.length; i += 1) {
        const e = elements[i];
        if (e !== undefined) {
          elements[i] = Q(yield* RequireIdentityType(e, key as TypeRecord));
        }
      }
    }
  }
  (value as { TypedCollection?: readonly (TypeRecord | number)[] }).TypedCollection = args;
}

/**
 * proposal-runtime-types #sec-collection-key-positions (OQ7): a KEY or ELEMENT
 * position CHECKS where a value position converts.
 *
 * `table-string-conversion-sources` admits a numeric or Boolean source at a
 * `string` target, converting with ToString, and argues the case: ToString is
 * total and lossless, so nothing is lost - `5` is `'5'` and reads back as `5`.
 * That reasoning is about a STORE, a slot holding one value. A key is a store
 * whose value is also an IDENTITY, and a conversion that loses nothing as a
 * value can still lose an identity by mapping two distinct sources onto one key:
 *
 *     const m = new Map.<string, uint8>();
 *     m.set(numberOne, 1); m.set("1", 2);   // one entry, not two
 *     const u = new Map();
 *     u.set(1, 1); u.set("1", 2);           // two entries
 *
 * So typing a collection MERGED two keys that were distinct - silently, and only
 * when both spellings happened to occur, which is a data-dependent failure that
 * survives every test exercising one of them.
 *
 * THE NUMERIC TARGET ALREADY HAS THIS PROPERTY, which makes this a consistency
 * fix rather than a new rule: RequireType admits an `any` numeric source only
 * where the target represents it exactly and raises a RangeError otherwise, so a
 * `Map.<uint8, V>` could never merge two keys. The `string` target is the one
 * boundary in the language admitting a conversion that does not preserve
 * identity, and it is the outlier.
 *
 * NARROW ON PURPOSE. Only the string conversion is withheld, and only at an
 * identity-bearing position. A value position keeps the conversion rule in full,
 * so `m.set("a", someNumber)` on a `Map.<string, uint8>` converts as it did.
 * Literal propagation is untouched, a literal taking the target's type rather
 * than converting to it.
 *
 * Every identity-bearing position routes through here - the four prototypes'
 * key and element arguments, and the constructor seed by way of
 * StampTypedCollection - because a rule enforced at some of them is a rule a
 * program can walk around. The seed was exactly that hole: `new Map.<string,
 * uint8>([[1, 2]])` bypassed the prototype path entirely.
 */
/**
 * proposal-runtime-types #value-type-class: "Instances of a value type class are
 * values ... and ASSIGNING ONE COPIES IT."
 *
 * WHERE THE COPY HAPPENS is the boundaries of #table-check-sites, which is to
 * say inside RequireType - a binding's initializer or assigned value, an
 * argument, a `return` operand, a store to a field or an array element, and a
 * value crossing in through reflection. That table is not chosen for
 * convenience: it is "where a value acquires a type it did not have", and a
 * value type acquiring its type IS the copy.
 *
 * The table's own note says why a value type class differs from an OBJECT type
 * here, which converts in place rather than copying: "an object may carry
 * properties the type does not declare and keeps them under width subtyping,
 * which a copy assembled from the declared members alone would discard." A value
 * type class has a layout and no undeclared properties, so nothing is discarded
 * and the reasoning that forbids copying there is absent here.
 *
 * WHAT IS NOT COVERED, and is filed rather than guessed: reading an element OUT
 * of an array, `const e = arr[0]`. Rust, C++ and C# all copy there and this does
 * not, because a read is not a boundary in #table-check-sites and copying at
 * every read would allocate on the hot path - `p.x` in a loop. The rule for it
 * has to be written before it can be implemented.
 *
 * NO USER CODE RUNS. #sec-typed-classes has a value type class be "a shape with
 * a zero, not an object with an invariant its constructor establishes", and the
 * threading clause states plainly that "a value type is copied by assignment,
 * and that copy is not atomic" - a description of a memcpy, not of a
 * constructor. The copy is field by field over the layout, which is the same
 * walk `sec-default-values` makes for a derived default.
 *
 * A `ref` does NOT come through here. A reference "reads and writes through to
 * the original rather than to a copy", which is the whole of the references
 * extension, and its parameters and returns take the location rather than the
 * value.
 */
export function* CopyValueTypeInstance(value: ObjectValue, t: TypeRecord): PlainEvaluator<ObjectValue> {
  const layout = LayoutOf(t) as { fields?: readonly { key: string | PrivateName, type: TypeRecord }[] } | null;
  if (layout?.fields === undefined) {
    return value;
  }
  const ctor = (t as { Constructor?: ObjectValue }).Constructor;
  const proto = ctor ? Q(yield* Get(ctor, Value('prototype'))) : Value.null;
  const copy = OrdinaryObjectCreate(proto instanceof ObjectValue ? proto : Value.null);
  const typed = new Map<unknown, { TypeRecord: TypeRecord }>();
  for (const field of layout.fields) {
    if (typeof field.key !== 'string') {
      continue;
    }
    const key = Value(field.key);
    let held = Q(yield* Get(value, key));
    // A nested value type field is itself a value, so it copies too - otherwise
    // the outer copy would share the inner instance and a write through one
    // would be visible through the other, which is the aliasing this exists to
    // prevent one level down.
    if (held instanceof ObjectValue && field.type.Kind === 'nominal' && LayoutOf(field.type) !== null) {
      held = Q(yield* CopyValueTypeInstance(held, field.type));
    }
    X(CreateDataPropertyOrThrow(copy, key, held));
    typed.set(field.key, { TypeRecord: field.type });
  }
  (copy as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
  // Sealed, as the original is. A value type class has a layout with no room for
  // a property it did not declare, so its instances are not extensible - and a
  // copy that forgot this would be a value of the type that accepts what the
  // type cannot hold. Caught by the zero-filled-defaults test, which asserts
  // `Object.isExtensible(d[0])` is *false* for an element of a `[2].<A>`; the
  // SoA gather already did the same for the same reason.
  X(copy.PreventExtensions());
  return copy;
}

export function* RequireIdentityType(value: Value, t: TypeRecord): ValueEvaluator {
  const target = t as { Kind?: string, Name?: string };
  if (target.Kind === 'primitive' && target.Name === 'string' && !(value instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  return Q(yield* RequireType(value, t));
}

export function* RequireType(value: Value, t: TypeRecord): ValueEvaluator {
  // proposal-runtime-types: an UNSUBSTITUTED generic parameter admits any
  // value. At the point a field of type `T` is defined, the application has
  // bound `T` - `new B.<uint8>()` means uint8 - and substituting that binding
  // is the specialization work. Until it exists, checking against the opaque
  // parameter refuses everything, which is stricter than correct rather than
  // looser: it rejects `class B<T> { v: T; }` at `new B.<uint8>()`, a
  // declaration the design's opening example depends on.
  if (t.Kind === 'parameter') {
    return value;
  }
  return Q(yield* CheckedConvertValue(value, t));
}

/** #sec-the-conversion-rule */
/**
 * proposal-runtime-types #sec-conversions: the numeric conversions are keyed on
 * NUMERIC families, so a numeric target has a conversion available only when the
 * value is itself numeric. Anything else is not a conversion this specification
 * describes, and reading a number out of it is a different operation with a
 * different name (`uint8.parse` for a string).
 */
function isNumericConversionSource(value: Value): boolean {
  return value instanceof NumberValue || value instanceof TypedNumberValue;
}

/**
 * proposal-runtime-types: which values convert to a `string`. The rule splits by
 * SOURCE rather than by primitiveness, because primitiveness is not what makes a
 * conversion safe here.
 *
 * A Number, a BigInt, and a Boolean each have exactly one canonical text, and
 * ToString of them is total and loses nothing: `5` is `'5'` and round-trips. That
 * is worth having implicitly, and it is why this is not simply the mirror of the
 * numeric rule (ToNumber of a string is partial and lossy, so it is refused; a
 * ToString of a number is neither).
 *
 * *undefined*, *null*, an object, and a Symbol are refused. They have no
 * canonical text, only a diagnostic one, and the results are the classic silent
 * failures: `'undefined'` reaching a user interface, `'[object Object]'`, and an
 * array quietly becoming its comma-joined elements. A program that wants those
 * writes `String(v)` and says so.
 */
function isStringConversionSource(value: Value): boolean {
  return value instanceof JSStringValue
    || value instanceof TypedStringValue
    || value instanceof NumberValue
    || value instanceof TypedNumberValue
    || value instanceof BigIntValue
    || value instanceof BooleanValue;
}

/**
 * proposal-runtime-types #table-implicit-conversions, the `any`-in-a-typed-
 * position row: "the value is checked at the boundary and, if it is a NUMERIC
 * VALUE the target represents exactly, converted; a value the target cannot
 * represent raises a *RangeError*, and one of the WRONG TYPE a *TypeError*."
 *
 * The engine called ToNumber unconditionally, so every value of the wrong type
 * reached a `number` position as whatever ToNumber makes of it: `"s"` as NaN,
 * *undefined* as NaN, an object as NaN, *null* as 0, `[]` as 0. Those are the
 * classic silent failures, and they are exactly what the `string` target is
 * gated against by isStringConversionSource - the same reasoning, at the target
 * that had no gate. A program that wants ToNumber's answer writes `Number(v)`
 * and says so.
 *
 * A typed numeric value passes: it IS a numeric value and `number` represents
 * it exactly, which is the clause's own condition. That is a conversion within
 * the numeric types rather than an admission of a foreign one.
 */
function isNumberConversionSource(value: Value): boolean {
  return value instanceof NumberValue || value instanceof TypedNumberValue;
}

/**
 * proposal-runtime-types #sec-primitiveconvert: what a `boolean` BOUNDARY
 * admits, which is a Boolean and nothing else.
 *
 * ToBoolean is total, which is the reason this reads as tempting and the reason
 * it is wrong: #sec-requiretype's own rule for the numeric targets is that
 * coercing first "would make an annotation a coercion rather than a check", and
 * that a conversion which "could not fail at all" lets "a missing field become
 * a NaN that surfaces far from the annotation that admitted it". At a `boolean`
 * target that failure is reachable twice over - a missing field became *false*,
 * and the string `'false'` became *true* - at the very position a program
 * annotated in order to catch it.
 *
 * A boundary is a STORE and not a question. `if (v)` interrogates a value in
 * place; a boundary mints a durable answer that no longer carries what it was
 * made from. A program that means the truthiness writes `Boolean(v)`, and a
 * CAST still converts: `v := boolean` is an explicit instruction, and
 * ConvertValue leaves it alone for the same reason it leaves `v := number`
 * alone.
 */
function isBooleanConversionSource(value: Value): boolean {
  return value instanceof BooleanValue;
}

/**
 * proposal-runtime-types #sec-union-boundary-selection: the member of a union a
 * value crosses into.
 *
 * Taking the first member that accepts made the choice depend on where a member
 * was WRITTEN, which a canonical union cannot express: CanonicalizeType orders
 * members and Type Objects are interned on the canonical record, so
 * `uint8 | uint32` and `uint32 | uint8` are the same type, and a boundary may
 * meet that type as a Type Object with no source spelling at all. The
 * observable cost was worse than the inconsistency: at `string | uint32` a
 * Number crossed into `string`, so the boundary silently textified it - the
 * failure the string rule's refuse-list exists to prevent, reachable through
 * nothing but member order.
 *
 * The rungs, in order:
 *   1. A member the value is ALREADY of, which crosses unchanged.
 *   2. A numeric member that represents the value exactly, narrowest first,
 *      with integers before floats for an integer-valued source.
 *   3. Any remaining member, which is where the canonical-text rung of the
 *      string rule and every non-numeric conversion land.
 *
 * _convert_ is the conversion the caller performs, so the checked and unchecked
 * boundaries share one selection rule rather than drifting apart.
 */
export function* ConvertValueToUnion(value: Value, t: TypeRecord & { Members: readonly TypeRecord[] }, convert: (v: Value, m: TypeRecord) => ValueEvaluator): ValueEvaluator {
  const members = t.Members;
  for (const m of members) {
    if (Q(yield* IsOfType(value, m))) {
      return value;
    }
  }
  const numericRank = (m: TypeRecord): number | null => {
    if (m.Kind !== 'primitive') {
      return null;
    }
    const name = m.Name;
    const bits = typeof m.Arguments[0] === 'number' ? m.Arguments[0] as number : null;
    if ((name === 'uint' || name === 'int') && bits !== null) {
      // An integer member of N bits ranks by width, signed after unsigned of the
      // same width so a non-negative value takes the tighter of the two.
      return bits * 2 + (name === 'int' ? 1 : 0);
    }
    if (name === 'float16') { return 200; }
    if (name === 'float32') { return 201; }
    if (name === 'float64' || name === 'number') { return 202; }
    if (name === 'float128') { return 203; }
    if (name === 'decimal32') { return 210; }
    if (name === 'decimal64') { return 211; }
    if (name === 'decimal128') { return 212; }
    return null;
  };
  const numericValue: number | bigint | null = value instanceof NumberValue
    ? value.numberValue()
    : (isTypedNumber(value) ? (value as TypedNumberValue).numberValue()
      : (value instanceof BigIntValue ? (value as BigIntValue).bigintValue() : null));
  if (numericValue !== null) {
    const exact = members
      .map((m) => ({ m, rank: numericRank(m) }))
      .filter((e): e is { m: TypeRecord & { Kind: 'primitive', Name: string, Arguments: readonly (TypeRecord | number)[] }, rank: number } => e.rank !== null
        && e.m.Kind === 'primitive'
        && fitsNumericType(numericValue, e.m.Name, e.m.Arguments))
      .sort((a, b) => a.rank - b.rank);
    for (const e of exact) {
      const attempt = EnsureCompletion(yield* convert(value, e.m));
      if (attempt.Type === 'normal') {
        return attempt.Value;
      }
    }
  }
  for (const m of members) {
    const attempt = EnsureCompletion(yield* convert(value, m));
    if (attempt.Type === 'normal') {
      return attempt.Value;
    }
  }
  return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
}

export function* ConvertValue(value: Value, t: TypeRecord): ValueEvaluator {
  // proposal-runtime-types #sec-span-coercion: a coercion to `Span.<T>`
  // MATERIALIZES. The window is a value distinct from the array coerced, so
  // that one static type does not stand for two different kinds of value —
  // which is the confusion the type exists to end. A window reaching a window
  // position is already one and is passed through.
  if (t.Kind === 'nominal' && (t as { LibraryName?: string }).LibraryName === 'Span'
      && value instanceof ObjectValue
      && ArraySpanBackingOf(value as unknown as object) === undefined
      && ArrayViewBackingOf(value as unknown as object) === undefined) {
    const element = (t as { Arguments?: readonly TypeRecord[] }).Arguments?.[0] ?? { Kind: 'any' as const };
    const lenValue = Q(yield* Get(value, Value('length')));
    const len = R(Q(yield* ToLength(lenValue)));
    return MakeArraySpan(element as TypeRecord, value, len);
  }
  // proposal-runtime-types (simd.md): a vector converts to another vector of the
  // same lane COUNT by converting each lane, which is the target's
  // `cvtdq2ps`/`scvtf`/`f32x4.convert_i32x4_s`. The scalar rule decides the
  // spelling: an implicit `const b: float32 = someInt32` is refused and
  // `(a := float32)` converts, so a vector does the same and no lane-type
  // conversion happens silently.
  //
  // The lane count must match. Changing it is packing or unpacking - a
  // different instruction with a different result shape - and is not this.
  if (value.type === 'Vector' && t.Kind === 'primitive' && t.Name === 'vector' && t.Arguments.length === 2) {
    const fromShape = vectorShape(value as VectorValue);
    const toLane = t.Arguments[0] as TypeRecord;
    const toCount = t.Arguments[1];
    if (fromShape && typeof toCount === 'number' && toCount === fromShape.laneCount
        && !SameType(fromShape.laneType, toLane)
        && toLane.Kind === 'primitive' && toLane.Name !== 'vector'
        && !isBitLaneType(fromShape.laneType)) {
      const converted: Value[] = [];
      for (let i = 0; i < fromShape.laneCount; i += 1) {
        converted.push(Q(yield* ConvertValue((value as VectorValue).lanes[i] as Value, toLane)) as Value);
      }
      return new VectorValue(converted, t);
    }
  }

  // proposal-runtime-types (PLAN-decimal.md stage F): a DECIMAL out to a binary
  // float or a Number is the ordinary direction of loss - the nearest double to
  // the decimal's value - and needs no rule of its own, unlike the direction in.
  //
  // The asymmetry is the point. Binary to decimal had to CHOOSE a cohort member
  // and the choice is visible; decimal to binary has one answer and rounds to
  // it, as every narrowing conversion does.
  if (surroundingAgent.feature('runtime-types') && isDecimalObject(value)) {
    if (t.Kind === 'primitive' && (t.Name === 'float64' || t.Name === 'float32' || t.Name === 'float16' || t.Name === 'number')) {
      const asNumber = Value(DoubleFromDecimal(value));
      if (t.Name === 'number') {
        return asNumber;
      }
      return Q(yield* ConvertValue(asNumber, t));
    }
  }
  // #sec-parameterized-types: the crossing between two parameterizations of one
  // base is ConvertParameterization, which each meta type gates independently —
  // and it must be consulted BEFORE the value-level membership shortcut below,
  // because `is` is deliberately provenance-blind (a raw value the validation
  // judgment admits IS of the target), while the crossing is exactly the
  // provenance question: `Kilometer` to `Velocity` refuses on `subtype` and
  // `Kilometer` to `Meter` scales by the factor, even though `validate` would
  // wave the raw value through either. Shedding a parameterization UPWARD to
  // its base needs no gate at all, since a parameterized type is a subtype of
  // its base, which is the branding rule.
  // PLAN-brand-layering-F.md phase 2. THE CONSTRUCTION BOUNDARY for a layered
  // brand.
  //
  // `ConvertValue` had no ~intersection~ case, so calling `(Email & Verified)(x)`
  // fell past every branch. The only intersection handling lives in
  // `CheckedConvertValue`, which is the MEMBERSHIP path - and membership is what
  // a brand's absent `validate` is designed to refuse, so routing a crossing
  // through it refused every value. That is PLAN-brand.md OQ1 one level up: the
  // rule about BARE values applied at the boundary that exists to let a value
  // stop being bare.
  //
  // Crossing each member in turn is what an intersection means here - "a value
  // belongs to it if it belongs to every member" - and each member's crossing is
  // already written, in the ~parameterized~ arm below.
  //
  // GUARDED to an intersection whose members are ALL parameterizations of ONE
  // base. An intersection of an object type and a brand has no single value to
  // cross, and keeps refusing: there is nothing for `{ a: uint8 } & Email` to do
  // with a String. The guard is what keeps this rule definable rather than a
  // special case that happens to work for brands.
  if (t.Kind === 'intersection' && t.Members.length > 0
    && t.Members.every((m) => m.Kind === 'parameterized')
    && t.Members.every((m) => SameType(
      (m as TypeRecord & { Kind: 'parameterized' }).Base,
      (t.Members[0] as TypeRecord & { Kind: 'parameterized' }).Base,
    ))) {
    // PLAN-brand-layering-F.md F179. Cross from the BASE once, run every
    // member's judgments over the result, then stamp the INTERSECTION.
    //
    // Threading the value through each member in turn was the first shape and
    // it is wrong twice over. The value ends up carrying the LAST member's
    // record rather than the intersection's - `typeOf(EV(x)) === EV` was false,
    // it was a `V` - and on a base whose values carry their type, member 2
    // receives a value already stamped as member 1 and refuses it: crossing
    // `A & B` reported "a meta type does not admit converting A to B".
    //
    // A crossing is from a BARE value, and an intersection of parameterizations
    // over one base has exactly one bare form: the base's. So the base is
    // crossed once, each member's `validate` is consulted over that result -
    // which is what makes `(E & Pattern)` still validate - and the value is
    // stamped with `t` rather than with any member.
    const base = (t.Members[0] as TypeRecord & { Kind: 'parameterized' }).Base;
    const atBase = Q(yield* ConvertValue(value, base));
    for (const m of t.Members) {
      const mp = m as TypeRecord & { Kind: 'parameterized' };
      const { types: governing } = GoverningMetaTypes(mp.Metadata);
      for (const metaType of governing) {
        if (!MetaTypeGoverns(mp.Metadata, metaType)) {
          continue;
        }
        const verdict = Q(yield* ApplyValidateHook(
          metaType, atBase, MetadataPortion(mp.Metadata, metaType), mp.Base,
        ));
        if (verdict === false) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
      }
    }
    if (isTypedNumber(atBase)) {
      return new TypedNumberValue(atBase.value, t);
    }
    if (atBase instanceof ObjectValue) {
      Object.defineProperty(atBase, 'BrandTypeRecord', {
        value: t, enumerable: false, configurable: true,
      });
      return atBase;
    }
    return carryStringType(atBase, t);
  }
  if (isTypedNumber(value) && (value.TypeRecord as TypeRecord).Kind === 'parameterized') {
    const carried = value.TypeRecord as TypeRecord & { Kind: 'parameterized' };
    if (t.Kind === 'parameterized' && SameType(carried.Base, t.Base) && !SameType(carried, t)) {
      return Q(yield* ConvertParameterization(value, carried, t));
    }
    if (t.Kind !== 'parameterized' && SameType(carried.Base, t)) {
      // "A parameterized type is a subtype of its base, so the brand is shed
      // freely on the way up." No meta type gates this direction.
      return new TypedNumberValue(value.value, t);
    }
  }
  // A collection with NO type arguments adopts the target's, at the boundary,
  // before membership is asked.
  //
  // This is the conversion an annotation means: `let m: Map.<string, uint8> =
  // new Map()` takes a fresh untyped Map and makes it a typed one, exactly as
  // `let a: [].<uint8> = []` does for the empty array a few lines below. It has
  // to happen HERE rather than in the `already` branch, because membership on a
  // collection specialization now compares the type arguments against the stamp
  // (#sec-issubtype, D12) - so an unstamped Map is NOT a `Map.<string, uint8>`,
  // and asking first would refuse the annotation that was about to give it one.
  //
  // The previous arrangement leaned on membership being the bare prototype
  // walk: any Map passed, the branch below stamped it, and the looseness was
  // load-bearing. That is also why `new Map() is Map.<string, uint8>` answered
  // *true* - one test doing duty for two different questions, "is this value
  // already of type T" at a boundary and "does this value claim to be T" for
  // `is`. Splitting them is what D12 is.
  //
  // Only an UNSTAMPED collection is adopted. One already carrying arguments
  // keeps them and is judged against the target on their merits, so
  // `let m: Map.<string, uint8> = someMapOfStrings` is refused rather than
  // silently re-stamped into a claim its contents do not support.
  if (t.Kind === 'nominal' && t.Arguments.length > 0 && value instanceof ObjectValue
      && COLLECTION_LIBRARY_NAMES.has(t.LibraryName ?? '')
      && (value as { TypedCollection?: readonly unknown[] }).TypedCollection === undefined) {
    const bare = { ...t, Arguments: [] } as unknown as TypeRecord;
    if (Q(yield* IsOfType(value, bare))) {
      Q(yield* StampTypedCollection(value, t.Arguments));
    }
  }
  const already = Q(yield* IsOfType(value, t));
  if (already) {
    // An array that is ALREADY of the type still has to carry its element type,
    // or the store check has nothing to read. This matters most for the EMPTY
    // array, which satisfies any element type vacuously and so always took this
    // shortcut: `let a: [].<uint8> = []` produced an array with no element
    // type, so `a.push(65)` stored a plain Number and the typed surface
    // silently switched off for the most common way to build an array (F71).
    // The same shape as F38's crossing, swallowed by the same provenance-blind
    // shortcut.
    if (t.Kind === 'array' && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
      StampTypedArray(value as ObjectValue, t.Element);
      if (t.Extent !== 'dynamic') {
        (value as { TypedExtent?: number }).TypedExtent = t.Extent as number;
      }
    }
    // A typed COLLECTION needs the same stamp for the same reason, and needs it
    // more: an array acquires its element type from the conversion that builds
    // it, but `new Set()` is a CONSTRUCTION rather than a conversion, so
    // nothing ever gave a `Set.<uint8>` its type. Its membership test is the
    // prototype chain, which any Set passes, so this shortcut returned it
    // unstamped and every method went unchecked - `s.add(300)` was accepted and
    // stored a plain Number (F72).
    if (t.Kind === 'nominal' && t.Arguments.length > 0 && value instanceof ObjectValue
        && (t.LibraryName === 'Set' || t.LibraryName === 'Map'
          || t.LibraryName === 'WeakSet' || t.LibraryName === 'WeakMap')) {
      Q(yield* StampTypedCollection(value, t.Arguments));
    }
    // #value-type-class: "assigning one copies it". The value already satisfies
    // the type, and for a value type that is exactly when the copy is taken -
    // a boundary is "where a value acquires a type it did not have", and a
    // value type acquiring its type IS the copy. See CopyValueTypeInstance for
    // why this is the right set of sites and what it does not cover.
    if (t.Kind === 'nominal' && t.EnumMembers === undefined && value instanceof ObjectValue
        && LayoutOf(t) !== null) {
      return Q(yield* CopyValueTypeInstance(value, t));
    }
    // proposal-runtime-types (Capability B): even when the value already
    // satisfies the type, a literal string type is carried on the value.
    return carryStringType(value, t);
  }
  if (t.Kind === 'parameterized') {
    // "The base is not a subtype of the parameterization, so the way down is a
    // crossing: calling the Type Object, as `UserId(7)`, is the construction
    // boundary, and the metadata's validation judgment runs there." A meta type
    // that defines no `validate` therefore admits nothing here, which is what
    // makes a brand reachable only by construction.
    const atBase = Q(yield* ConvertValue(value, t.Base));
    // PLAN-brand.md OQ1. The gate was `IsOfType(atBase, t)`, and IsOfType
    // answers *false* for a meta type defining no `validate` - THAT BEING THE
    // BRAND RULE. So the rule about BARE values was applied at the boundary
    // that exists to let a value stop being bare, and a brand refused its own
    // construction: `UserId(7)` threw with the same diagnostic as
    // `let x: UserId = 7`. B11 held and B5 did not, which is not a brand but a
    // type nothing can inhabit.
    //
    // The same correction was already made for the CAST path, and
    // RequireTypeAfterCast records it: "a meta type offering no judgment now
    // admits, rather than refusing on the strength of a rule about BARE values
    // that a cast result is no longer one of." A construction result is no
    // longer one either. So the boundary runs the DEFINED judgments and treats
    // an absent one as nothing to check - a pattern still validates here, a
    // brand admits, and that asymmetry is what makes the two spellings mean
    // different things.
    const { types: governing } = GoverningMetaTypes(t.Metadata);
    for (const metaType of governing) {
      if (!MetaTypeGoverns(t.Metadata, metaType)) {
        continue;
      }
      const verdict = Q(yield* ApplyValidateHook(metaType, atBase, MetadataPortion(t.Metadata, metaType), t.Base));
      if (verdict === false) {
        return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
      }
    }
    // PLAN-brand-layering-F.md F172. THE CROSSING STAMPS THE VALUE, and it stamped
  // only a typed number - every other value came back unchanged, so a branded
  // String was a bare String and `IsOfType(bare, E)` correctly answered false at
  // every boundary that declared the brand. A value from the brand's own
  // constructor could not be passed anywhere: the crossing produced something
  // the receiving boundary could not recognise.
  //
  // A String has a carrier - `TypedStringValue`, which `carryStringType` already
  // uses for a literal string type - so the fix is to use it here for a
  // parameterization of `string` as well.
  if (isTypedNumber(atBase)) {
    return new TypedNumberValue(atBase.value, t);
  }
  // T3. An object or array carries the brand as a mark, read back by
  // `CarriedTypeRecordOf` and `RuntimeTypeOf`.
  if (atBase instanceof ObjectValue) {
    Object.defineProperty(atBase, 'BrandTypeRecord', {
      value: t, enumerable: false, configurable: true,
    });
    return atBase;
  }
  return carryStringType(atBase, t);
  }
  if (t.Kind === 'union') {
    return yield* ConvertValueToUnion(value, t, ConvertValue);
  }
  if (t.Kind === 'primitive') {
    // proposal-runtime-types #sec-binary-floating-point-types: a float128's
    // values are the format's, and every binary64 value is one of them - the
    // format is strictly wider in both significand and exponent - so a Number
    // converts into it EXACTLY and needs no rounding mode. The reverse rounds,
    // which is what makes float128 the wider type rather than a relabelling of
    // a double.
    if (t.Name === 'float128') {
      if (isFloat128Object(value)) {
        return value;
      }
      if (value instanceof NumberValue) {
        // numberValue() rather than R(): R answers the MATHEMATICAL value, in
        // which negative zero does not exist. IEEE 754 distinguishes the two
        // zeroes, so reading through R would lose one of the format's values.
        return Float128FromNumber(value.numberValue(), surroundingAgent.currentRealmRecord);
      }
      if (isTypedNumber(value)) {
        return Float128FromNumber(value.numberValue(), surroundingAgent.currentRealmRecord);
      }
    }
    // proposal-runtime-types #sec-complex-numbers: "`complex64` and
    // `complex128` convert to and from `complex` explicitly and not
    // implicitly, exactly as `float32` and `float64` convert to and from
    // `number`, and the treatment of a value outside the component type's
    // range is [the same clause]'s as it is for that component."
    //
    // So the conversion is componentwise and delegates: each part crosses
    // the boundary of the COMPONENT type, which is what makes a complex64's
    // parts float32s and gives an out-of-range part the float rule rather
    // than a rule of its own.
    // proposal-runtime-types #sec-literal-propagation: a numeric literal in a
    // complex position takes the complex type, "with the literal as its real
    // component and zero as its imaginary one", so `let r: complex = 5` is
    // `complex(5, 0)`. The literal's representability is the COMPONENT type's,
    // which the delegation below gives for free: a literal no `float32` can
    // hold is no `complex64` either.
    //
    // A real VALUE still does not convert on its own - that is the same
    // no-implicit-widening rule that holds between any two numeric types - so
    // this reaches only where a literal is being placed.
    if (t.Name === 'complex' && !isComplexObject(value)
        && (value instanceof NumberValue || isTypedNumber(value))) {
      const component = (t.Arguments[0] as TypeRecord | undefined) ?? builtinTypeRecord('number', []) as TypeRecord;
      const lifted = Q(yield* CheckedConvertValue(value, component));
      const liftedPart = isTypedNumber(lifted) ? lifted.numberValue() : Number(R(lifted as NumberValue));
      return CreateComplexValue(liftedPart, 0, component, surroundingAgent.currentRealmRecord);
    }
    if (t.Name === 'complex' && isComplexObject(value)) {
      const component = (t.Arguments[0] as TypeRecord | undefined) ?? builtinTypeRecord('number', []) as TypeRecord;
      const re = Q(yield* CheckedConvertValue(Value(value.ComplexReal), component));
      const im = Q(yield* CheckedConvertValue(Value(value.ComplexImaginary), component));
      // The converted part is a value OF the component type, so a float32
      // component comes back as a typed number rather than a plain one; both
      // read as Numbers here, which is how the pair carries its parts.
      const partOf = (v: Value) => (isTypedNumber(v) ? v.numberValue() : Number(R(v as NumberValue)));
      return CreateComplexValue(partOf(re), partOf(im), component, surroundingAgent.currentRealmRecord);
    }
    switch (t.Name) {
      case 'string':
        // Split by source rather than by primitiveness: a Number, a BigInt, and a
        // Boolean each have one canonical text and lose nothing, while *undefined*,
        // *null*, an object, and a Symbol have only a diagnostic text and produce
        // the classic silent failures. A program that wants those writes String(v).
        if (!isStringConversionSource(value)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return Q(yield* ToString(value));
      case 'number':
        // NOT gated here, deliberately. A cast is not a boundary: `v := number`
        // is an explicit conversion the program wrote and asked for, and it
        // wraps and truncates where the annotated binding throws. The gate
        // below is the BOUNDARY's, which is what #table-implicit-conversions'
        // `any`-in-a-typed-position row governs.
        return Q(yield* ToNumber(value));
      case 'boolean':
        return ToBoolean(value);
      case 'bigint': {
        // An integral Number is exactly a BigInt, so it converts. This is what
        // lets typed code write `65` where a `bigint` is wanted rather than
        // `65n`: the suffix exists because BigInt predates a type system that
        // could take a literal's type from its context (F66). The cast rule
        // truncates toward zero, as the other integer targets do.
        if (value instanceof NumberValue) {
          return Value(BigInt(Math.trunc(R(value) as number)));
        }
        break;
      }
      case 'uint':
      case 'int':
      case 'float16':
      case 'float32':
      case 'float64': {
        // proposal-runtime-types #sec-conversions: an explicit conversion (the
        // `:=` operator and the `T(v)` call form) discards information. When the
        // source is a numeric value it truncates, wraps, or rounds as the target
        // requires and does not fail merely because information is lost, so
        // `uint8(300)` is 44. The conversion table is keyed on numeric families,
        // so a non-numeric source (a String, an object) is not a family the wrap
        // covers and takes the checked path, which throws when it cannot fit.
        // #sec-requiretype: "If _t_ is a numeric type and RuntimeTypeOf(_value_)
        // is a numeric type", convert, "except that a conversion that would
        // wrap, truncate toward zero, or round a finite value to an infinity
        // instead yields ~unrepresentable~" and throws a RangeError. A BigInt is
        // a numeric type - #sec-numeric-types defines Number and BigInt that way
        // and this proposal's families join them - so it converts to an integer
        // type, exactly where the width admits the value.
        //
        // This is the only spelling that expresses a wide value in an UNTYPED
        // position, which is the position the `n` suffix exists for.
        if (value instanceof BigIntValue && isIntegerTypeName(t.Name)) {
          const exact = R(value) as bigint;
          if (!fitsNumericType(exact, t.Name, t.Arguments)) {
            return Throw.RangeError('$1 is not in the range of $2', value, Value(displayType(t)));
          }
          const bits = typeof t.Arguments[0] === 'number' ? t.Arguments[0] : 0;
          // Narrower than 54 bits keeps the Number representation, so the two
          // carriers stay exactly where the rest of the engine expects them.
          return new TypedNumberValue(bits > 53 ? exact : Number(exact), t);
        }
        if (value instanceof BigIntValue && isFloatTypeName(t.Name)) {
          // #sec-conversions: a BigInt is a numeric family, and the float rule
          // is the one that has an answer for it — round to the width, overflow
          // to an infinity. (An INTEGER target stays refused below: exactness at
          // the wide widths is the pinned prerequisite, F11's third divergence.)
          const payload = Number(R(value) as bigint);
          return new TypedNumberValue(wrapToType(payload, t), t);
        }
        if (isNumericConversionSource(value)) {
          const n = Q(yield* ToNumber(value));
          // The payload stored on a typed value is the NUMBER, not its
          // mathematical value: R maps a negative zero to positive zero, which is
          // right for arithmetic over the reals and wrong for a value that has to
          // be handed back as it was given. A float type has a signed zero and the
          // specification makes the distinction observable through SameValue.
          const payload = n.numberValue(); // eslint-disable-line @engine262/mathematical-value -- the stored payload is the Number, and R would normalize a negative zero away
          return new TypedNumberValue(wrapToType(payload, t), t);
        }
        // A cast means "discard information from a numeric value", so a source
        // that is not numeric has no cast to perform. Reading a number out of a
        // string is a PARSE, a different operation with its own name and its own
        // two failures, and the Parsing clause says so: a string is deliberately
        // not a conversion source for a numeric type.
        if (value instanceof JSStringValue || value instanceof TypedStringValue) {
          return Throw.TypeError('a string is not a conversion source for $1; use its parse or tryParse', Value(displayType(t)));
        }
        return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
      }
      default:
        break;
    }
  }
  return Q(yield* RequireType(value, t));
}

/** Enforces a binding's TypeAnnotation, if any, at initialization. */
export function* EnforceAnnotation(annotation: ParseNode.TypeAnnotation | null | undefined, value: Value): ValueEvaluator {
  if (!annotation) {
    return value;
  }
  // #sec-check-elision: the checker proved this boundary cannot fail and cannot
  // convert, so the check is not inserted (F81). The value is returned as it
  // stands, which is what the boundary would have done anyway - the difference
  // is that no user code runs, which is how the elision is observable at all.
  if (IsCheckElided(annotation)) {
    // ISSUES-found-while-writing-examples.md I1. The elision returns the value
    // AS IT STANDS, and for an array that is not the same value the boundary
    // would have produced: the conversion is also where an array acquires its
    // [[TypedElement]], so eliding it left `let b: [].<uint8> = [(1 := uint8)]`
    // holding an array with NO element type - the store check had nothing to
    // read, `b[0] = "no"` was accepted, and the capacity surface was absent.
    //
    // Only this literal form was affected, which is why it read as a missing
    // surface rather than a hole: `[1]` and `[1, 2]` are not already of the
    // type, so their conversion runs and stamps. `[(1 := uint8)]` IS already of
    // it, the checker proves the boundary cannot fail, and the elision skips
    // the stamp along with the check.
    //
    // #sec-elision-stability is the rule this breaks: eliding a check must not
    // change what a value IS. So the stamp is applied here rather than the
    // elision being abandoned - the check really is unnecessary, and only its
    // side effect was load-bearing.
    // Only where the array carries NO element type yet. Re-stamping would
    // destroy the one it has, and the wider-view case is exactly where that
    // bites: `const b: [].<any> = a` for a `[].<uint8>` is the same object seen
    // through a wider reference, and overwriting its element type with `any`
    // let `b[0] = 300` through - the store check reads the type the VALUE
    // carries, which is the whole of why the covariance is sound.
    const elided = Q(yield* TypeNodeToTypeRecord(annotation.Type));
    const unstamped = (value as { TypedElement?: unknown }).TypedElement === undefined;
    if (unstamped && elided.Kind === 'array' && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
      // The same store, on the ELIDED path. A DYNAMIC `[].<P>` annotation
      // reaches `StampTypedArray` from here rather than through
      // `CheckedConvertValue`, so the copy has to be said twice - the third
      // near-identical array branch this rule has needed.
      //
      // #sec-elision-stability is the argument, and it is the one the stamp
      // beside this already rests on: eliding a check must not change what a
      // value IS, and an array whose elements alias their sources is a different
      // value from one whose elements are copies.
      const elidedLength = R(Q(yield* ToNumber(Q(yield* Get(value, Value('length')))))) as number;
      for (let i = 0; i < elidedLength; i += 1) {
        const key = Value(String(i));
        const element = Q(yield* Get(value, key));
        const copied = CopyValueClassInstance(element);
        if (copied !== element) {
          X(value.DefineOwnProperty(key, Descriptor({
            Value: copied, Writable: Value.true, Enumerable: Value.true, Configurable: Value.true,
          })));
        }
      }
      StampTypedArray(value, elided.Element);
      if (elided.Extent !== 'dynamic') {
        (value as { TypedExtent?: number }).TypedExtent = elided.Extent as number;
      }
    }
    return value;
  }
  // #sec-contextual-types: the binding boundary applies the CHECKED conversion
  // rule. An in-range Number becomes the annotated numeric value type's value; a
  // value of the `any` type that does not fit throws rather than silently
  // wrapping, since nothing in the source said to discard information (a cast
  // does; that is ConvertValue). An out-of-range literal is already an Early
  // Error caught by the checker before this runs.
  const record = Q(yield* TypeNodeToTypeRecord(annotation.Type));
  return Q(yield* CheckedConvertValue(value, record));
}

/**
 * proposal-runtime-types #sec-the-conversion-rule (RequireType): the checked
 * conversion used at a typed boundary. Identical to ConvertValue except that a
 * numeric conversion which would wrap, truncate, or round to an infinity throws
 * (a RangeError in the spec) rather than discarding information.
 */
/**
 * proposal-runtime-types #sec-type-annotations: "the ELEMENT TYPE of a rest is
 * the [[Element]] of an ~array~ type and the union of the [[Type]] fields of a
 * ~tuple~ type's elements". A rest's own [[Type]] is the type of what it
 * COLLECTS, so converting a position against it compared one value to the whole
 * collection.
 */
function restElementType(collected: TypeRecord): TypeRecord {
  if (collected.Kind === 'array') {
    return collected.Element;
  }
  if (collected.Kind === 'tuple') {
    const members = collected.Elements.map((e) => e.Type);
    return members.length === 1
      ? members[0]!
      : CanonicalizeType({ Kind: 'union', Members: members } as TypeRecord);
  }
  return collected;
}

/**
 * sec-user-defined-conversions, form 1. Returns the constructed value, or
 * ~undefined~ where the target declares no converting constructor, so the caller
 * reports exactly as it did before.
 */
function* ConstructThroughConvertingConstructor(value: Value, t: TypeRecord): PlainEvaluator<Value | undefined> {
  if (t.Kind !== 'nominal') {
    return undefined;
  }
  const ctor = (t as unknown as { Constructor?: Value }).Constructor;
  if (!ctor || !IsConstructor(ctor)) {
    return undefined;
  }
  // One parameter EXACTLY: the clause says a constructor "taking one parameter",
  // and a constructor of two is reached through target-typed construction.
  const fn = ctor as unknown as { FormalParameters?: readonly unknown[] };
  if ((fn.FormalParameters?.length ?? -1) !== 1) {
    return undefined;
  }
  return Q(yield* Construct(ctor as never, [value]));
}

/**
 * sec-user-defined-conversions, form 2. Keyed by the target's display, which
 * ClassDefinitionEvaluation derives the same way from the declaration's type
 * node, so both sides agree without sharing a record.
 */
/**
 * sec-user-defined-conversions, form 3: `operator T(value: S)` declared on the
 * TARGET, "the form a type declares when its constructor is already spoken for".
 * Reached from the target's prototype rather than the source value's, because
 * that is where the declaration lives.
 */
function* ConvertThroughInboundOperator(value: Value, t: TypeRecord): PlainEvaluator<Value | undefined> {
  if (t.Kind !== 'nominal') {
    return undefined;
  }
  // A nominal's [[Constructor]] is absent for a type with no class behind it -
  // an intrinsic interface such as `ClassMetadata` - and `Get` asserts on a
  // non-object, so the guard is the object test and not merely presence.
  const ctor = (t as unknown as { Constructor?: Value }).Constructor;
  if (!(ctor instanceof ObjectValue)) {
    return undefined;
  }
  const proto = Q(yield* Get(ctor, Value('prototype')));
  if (!(proto instanceof ObjectValue)) {
    return undefined;
  }
  // The table directly, not LookupClassOperator: that walks from a VALUE's
  // prototype, so handing it the prototype itself would start one link too high
  // and miss the class that declares the conversion.
  const fn = classOperatorTables.get(proto as object)?.get('convert-from');
  if (!fn || !IsCallable(fn)) {
    return undefined;
  }
  return Q(yield* Call(fn, Value.undefined, [value]));
}

function* ConvertThroughDeclaredOperator(value: Value, t: TypeRecord): PlainEvaluator<Value | undefined> {
  const fn = LookupClassOperator(value, `convert ${displayType(t)}`);
  if (!fn || !IsCallable(fn)) {
    return undefined;
  }
  return Q(yield* Call(fn, value, []));
}

export function* CheckedConvertValue(value: Value, t: TypeRecord): ValueEvaluator {
  // sec-user-defined-conversions form 2, tried FIRST because the paths below
  // fork by target kind: a primitive target reaches its own switch and refuses
  // an object there, never arriving at the membership fallback where the
  // converting constructor sits. Hoisting the lookup covers every target kind at
  // one site.
  //
  // Precise despite being first: the table is consulted for `convert <target>`
  // on the SOURCE value's own class, so it can only fire where that class
  // declared exactly this conversion, and a value that already fits never gets
  // here because the caller checks membership before converting.
  const declared = Q(yield* ConvertThroughDeclaredOperator(value, t));
  if (declared !== undefined) {
    return declared;
  }
  // proposal-runtime-types #sec-literal-propagation: a numeric literal in a
  // complex position takes the complex type, "with the literal as its real
  // component and zero as its imaginary one". This is the ASSIGNMENT boundary,
  // where a declaration's initializer arrives; the explicit `:=` path carries
  // the same lift of its own.
  //
  // The literal's representability is the component type's, delegated below, so
  // a literal no `float32` holds is no `complex64` either. A real VALUE reaches
  // an operator rather than this boundary, and is refused there.
  if (t.Kind === 'primitive' && t.Name === 'complex' && !isComplexObject(value)
      && (value instanceof NumberValue || isTypedNumber(value))) {
    const component = (t.Arguments[0] as TypeRecord | undefined) ?? builtinTypeRecord('number', []) as TypeRecord;
    const lifted = Q(yield* CheckedConvertValue(value, component));
    const liftedPart = isTypedNumber(lifted) ? lifted.numberValue() : Number(R(lifted as NumberValue));
    return CreateComplexValue(liftedPart, 0, component, surroundingAgent.currentRealmRecord);
  }
  // proposal-runtime-types #sec-threading-shared-modifier: "The modifier is
  // therefore not observable in the value; it is observable in where the value is
  // kept and in what may be assumed about it between two reads." So a boundary
  // enforcing `shared T` enforces T: publishing a value into shared storage is
  // the same check and the SAME CONVERSION as storing it in unmarked storage of
  // that type, and a value read back out is a value of T.
  //
  // The unwrap belongs here rather than in RequireType because this is the
  // operation every enforcement path reaches, and because the conversion is the
  // part that matters: without it a `shared uint32` annotation fell through to
  // the final membership step with a plain Number in hand, and a plain Number is
  // not a MEMBER of uint32 - it converts to one. So `let a: shared uint32 = 5`
  // was rejected while `let a: uint32 = 5` was accepted, which no rule of the
  // clause asks for.
  if (t.Kind === 'shared') {
    return Q(yield* CheckedConvertValue(value, t.Target));
  }
  // proposal-runtime-types #sec-vector-lanes: "`vector.<T, N>` declares a cast
  // operator from T, so a value of the lane type converts to a vector by
  // filling every lane with it." The broadcast is one of the user-defined casts
  // rather than a rule of its own, which is why it is answered here and not in
  // the subtype relation - a `float32` is not a `float32x4`, it converts to one.
  //
  // The refusal the clause states follows from the same rule: a value whose
  // type is not the lane type does not convert, so a `float32` reaches
  // `float32x4` and not `float64x2`, and a design wanting the second casts to
  // `float64` first.
  // proposal-runtime-types #sec-vector-comparisons: the WIDE MASK. The clause
  // gives a comparison three result forms chosen by the expected type, and
  // names the wide mask as "a vector of the boolean type of the same width as
  // the compared element, so a `float32x4` comparison yields a `boolean32x4` of
  // lanes all-set or all-clear".
  //
  // A compact mask converts to it: each lane becomes a bit vector of the target
  // width, all-set where the bit was 1. This is the CONVERSION half of the
  // clause's rule - the selection half needs return-type overloading, which
  // this engine does not have - so an annotated binding reaches the wide mask
  // while an unannotated expression still yields the compact one.
  if (value.type === 'Vector' && t.Kind === 'primitive' && t.Name === 'vector' && t.Arguments.length === 2) {
    const fromShape = vectorShape(value as VectorValue);
    const toLane = t.Arguments[0] as TypeRecord;
    const toCount = t.Arguments[1];
    if (fromShape && isBitLaneType(fromShape.laneType) && typeof toCount === 'number'
        && toCount === fromShape.laneCount && !isBitLaneType(toLane)
        && toLane.Kind === 'primitive' && toLane.Name === 'vector') {
      const innerCount = (toLane as { Arguments: readonly unknown[] }).Arguments[1];
      const innerLane = (toLane as { Arguments: readonly unknown[] }).Arguments[0] as TypeRecord;
      if (typeof innerCount === 'number' && isBitLaneType(innerLane)) {
        const wide: Value[] = [];
        for (let i = 0; i < fromShape.laneCount; i += 1) {
          const set = ((value as VectorValue).lanes[i] as { numberValue?(): number }).numberValue?.() === 1;
          const bits: Value[] = [];
          for (let b = 0; b < innerCount; b += 1) {
            bits.push(Q(yield* CheckedConvertValue(Value(set ? 1 : 0), innerLane)) as Value);
          }
          wide.push(new VectorValue(bits, toLane));
        }
        return new VectorValue(wide, t);
      }
    }
  }
  // The reverse of the bit-vector conversion: "a value of the vector type
  // converted to an integer type gives the integer whose bit i is lane i"
  // (#sec-vector-lanes). Stated in each direction by the clause and needed in
  // each, since a bit vector is a bitfield a program reads back as a number.
  if (value.type === 'Vector' && t.Kind === 'primitive' && t.Name !== 'vector') {
    const shape = vectorShape(value as VectorValue);
    if (shape && isBitLaneType(shape.laneType)) {
      let bits = 0;
      for (let i = 0; i < shape.laneCount; i += 1) {
        const lane = (value as VectorValue).lanes[i] as { numberValue?(): number };
        if (lane?.numberValue?.() === 1) {
          // eslint-disable-next-line no-bitwise
          bits |= (1 << i);
        }
      }
      return Q(yield* CheckedConvertValue(Value(bits >>> 0), t));
    }
  }
  if (t.Kind === 'primitive' && t.Name === 'vector' && t.Arguments.length === 2) {
    const laneType = t.Arguments[0] as TypeRecord;
    const laneCount = t.Arguments[1];
    // proposal-runtime-types #sec-vector-lanes: the bit-vector conversion.
    // "Lane i of a `vector.<uint.<1>, N>` is bit i of an N-bit integer, counting
    // from the least significant", and the conversion is that correspondence
    // read in each direction. An integer converted to the vector gives the
    // vector whose lane i is bit i of the value.
    //
    // It is answered before the broadcast because it is the more specific rule:
    // a `uint.<1>` IS a lane type, so `boolean8 = 2` would otherwise broadcast
    // 2 into every lane rather than reading its bits - and 2 is not even a
    // value of `uint.<1>`, so it would then be refused.
    if (typeof laneCount === 'number' && value.type !== 'Vector' && isBitLaneType(laneType)) {
      const asNumber = (value as { numberValue?(): number }).numberValue?.();
      if (typeof asNumber === 'number' && Number.isInteger(asNumber) && asNumber >= 0) {
        const lanes: Value[] = [];
        for (let i = 0; i < laneCount; i += 1) {
          // eslint-disable-next-line no-bitwise
          lanes.push(Q(yield* CheckedConvertValue(Value((asNumber >>> i) & 1), laneType)) as Value);
        }
        return new VectorValue(lanes, t);
      }
    }
    if (typeof laneCount === 'number' && value.type !== 'Vector') {
      // The lane value is CONVERTED, not merely tested. A plain Number is not a
      // member of `float32` - it becomes one - so testing membership here left
      // the branch un-taken, the conversion fell through to the general rule,
      // and that asked to convert to the vector type again: the loop.
      //
      // Converting once and reusing the result also gives the broadcast its
      // meaning, since every lane must hold the same value of the lane type
      // rather than N separately-converted copies.
      const lane = Q(yield* CheckedConvertValue(value, laneType));
      const lanes: Value[] = [];
      for (let i = 0; i < laneCount; i += 1) {
        lanes.push(lane);
      }
      return new VectorValue(lanes, t);
    }
  }
  // The crossing between two parameterizations gates and scales here exactly as
  // at the cast: the checked rule differs from ConvertValue only in what a
  // LOSSY numeric conversion does, and a crossing is a conversion, not a loss.
  if (isTypedNumber(value) && (value.TypeRecord as TypeRecord).Kind === 'parameterized') {
    const carried = value.TypeRecord as TypeRecord & { Kind: 'parameterized' };
    if (t.Kind === 'parameterized' && SameType(carried.Base, t.Base) && !SameType(carried, t)) {
      return Q(yield* ConvertParameterization(value, carried, t));
    }
    if (t.Kind === 'parameterized' && SameType(carried, t)) {
      // Already at the target, so there is nothing to cross. ConvertParameterization
      // reaches the same answer the long way - every meta type's `subtype` holds
      // of a portion and itself, so each "admits the crossing, and requires
      // nothing of the value" - but falling through to the cast branch below
      // would APPLY the cast operator a second time to a value that has already
      // crossed. Harmless for the identity body the design writes and not for a
      // body that computes, and PLAN-parameterized-defaults.md phase 4 made it
      // reachable: a default now arrives at its annotation already stamped.
      return value;
    }
    if (t.Kind !== 'parameterized' && SameType(carried.Base, t)) {
      return new TypedNumberValue(value.value, t);
    }
  }
  // #sec-primitive-operator-blocks: a BARE value reaching a parameterization
  // crosses through an implicit cast where the primitive declares one. This is
  // ConvertParameterization's second arm from the outside - the value carries
  // nothing of the meta types the target constrains, and the cast supplies what
  // it lacks - and "its absence is why such a boundary is otherwise a type
  // error". Tried before the membership test, since a bare value that already
  // satisfies the target needs no cast and one that does not would otherwise be
  // refused here.
  if (surroundingAgent.feature('runtime-types') && t.Kind === 'parameterized') {
    const cast = Q(yield* ApplyImplicitCast(value, t));
    if (cast !== undefined) {
      // The cast's result crosses the boundary as any other value does, so a
      // `validate` hook still runs over it: a cast is a way IN, not a way past.
      return Q(yield* RequireTypeAfterCast(cast, t));
    }
  }
  // proposal-runtime-types #sec-array-and-tuple-types: a tuple whose trailing
  // positions carry defaults admits a SHORTER value, so membership calls such a
  // value already of the type - and returning it unchanged would skip filling
  // the defaults it was admitted without. The conversion below is what supplies
  // them, so the shortcut steps aside for exactly that case.
  //
  // Only HERE, in the converting operation. RequireType checks and never
  // converts, so the same guard there sent a value it should have accepted down
  // a path that rebuilds one - which is what 481 failing tests were saying.
  let shortOfADefault = false;
  if (t.Kind === 'tuple' && t.Elements.some((e) => e.Initial !== 'none')
      && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
    const lengthNow = R(Q(yield* ToNumber(Q(yield* Get(value, Value('length'))))) as NumberValue);
    shortOfADefault = lengthNow < t.Elements.length;
  }
  // The same adoption as at the other boundary above, and for the same reason:
  // membership on a collection specialization compares the type arguments
  // against the stamp (D12), so an unstamped collection has to acquire the
  // target's arguments BEFORE it is asked whether it has them. This is the
  // annotation path - `let m: Map.<string, uint8> = new Map()` - and it is the
  // one a program actually writes; the site above is reached by a different
  // caller, and patching only one of the two left every annotation refused.
  if (t.Kind === 'nominal' && t.Arguments.length > 0 && value instanceof ObjectValue
      && COLLECTION_LIBRARY_NAMES.has(t.LibraryName ?? '')
      && (value as { TypedCollection?: readonly unknown[] }).TypedCollection === undefined) {
    const bare = { ...t, Arguments: [] } as unknown as TypeRecord;
    if (Q(yield* IsOfType(value, bare))) {
      Q(yield* StampTypedCollection(value, t.Arguments));
    }
  }
  const already = !shortOfADefault && Q(yield* IsOfType(value, t));
  if (already) {
    // An array that is ALREADY of the type still has to carry its element type,
    // or the store check has nothing to read. This matters most for the EMPTY
    // array, which satisfies any element type vacuously and so always took this
    // shortcut: `let a: [].<uint8> = []` produced an array with no element
    // type, so `a.push(65)` stored a plain Number and the typed surface
    // silently switched off for the most common way to build an array (F71).
    // The same shape as F38's crossing, swallowed by the same provenance-blind
    // shortcut.
    if (t.Kind === 'array' && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
      // #sec-value-type-copying names "storing into ... an array element" a COPY
      // position, and a typed array literal IS that store:
      // `const _arr_: [1].<P> = [_a_]` and `_arr_[0] = _a_` are one operation
      // written two ways, and without this they disagreed.
      //
      // Reached where the elements ALREADY satisfy the element type, which a
      // value type class instance always does - so `[_a_]` comes here every time
      // while `[new P()]` needs no copy anyway. The clause's elision covers "an
      // object-literal CONVERSION", a literal BECOMING a value type, not a
      // literal whose ELEMENTS are value type instances.
      //
      // Written with `DefineOwnProperty` and NOT through `Set`: a `Set` on an
      // array re-enters this conversion and overflows the stack. The property
      // already exists and only its value changes, so defining it is both
      // correct and the only form that terminates.
      const literalLength = R(Q(yield* ToNumber(Q(yield* Get(value, Value('length')))))) as number;
      for (let i = 0; i < literalLength; i += 1) {
        const key = Value(String(i));
        const element = Q(yield* Get(value, key));
        const copied = CopyValueClassInstance(element);
        if (copied !== element) {
          X((value as ObjectValue).DefineOwnProperty(key, Descriptor({
            Value: copied, Writable: Value.true, Enumerable: Value.true, Configurable: Value.true,
          })));
        }
      }
      StampTypedArray(value as ObjectValue, t.Element);
      if (t.Extent !== 'dynamic') {
        (value as { TypedExtent?: number }).TypedExtent = t.Extent as number;
      }
    }
    // A TUPLE needs it for the same reason, and was missing for the same reason
    // the empty array was: the conversion below builds a fresh array and stamps
    // its positions there, so a tuple whose elements needed converting was
    // checked ever after and one that ALREADY satisfied its type was not.
    //
    //   const x = (1 := uint8);
    //   let a: [uint8, uint8] = [x, x];   // took this shortcut, unstamped
    //   a[0] = "bad";                     // accepted - a String in a uint8 slot
    //   let b: [uint8, uint8] = [1, 2];   // converted, stamped
    //   b[0] = "bad";                     // refused, as both should be
    //
    // The ARITY was stamped either way, which is what made this hard to see: the
    // tuple carried half its type, refusing a `push` while accepting a store.
    if (t.Kind === 'tuple' && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
      const rest = t.Elements.find((e) => e.Rest);
      (value as { TypedTuple?: { Positions: readonly TypeRecord[], Rest: TypeRecord | undefined } }).TypedTuple = {
        Positions: t.Elements.filter((e) => !e.Rest).map((e) => e.Type),
        Rest: rest !== undefined ? restElementType(rest.Type) : undefined,
      };
    }
    // A typed COLLECTION needs the same stamp for the same reason, and needs it
    // more: an array acquires its element type from the conversion that builds
    // it, but `new Set()` is a CONSTRUCTION rather than a conversion, so
    // nothing ever gave a `Set.<uint8>` its type. Its membership test is the
    // prototype chain, which any Set passes, so this shortcut returned it
    // unstamped and every method went unchecked - `s.add(300)` was accepted and
    // stored a plain Number (F72).
    if (t.Kind === 'nominal' && t.Arguments.length > 0 && value instanceof ObjectValue
        && (t.LibraryName === 'Set' || t.LibraryName === 'Map'
          || t.LibraryName === 'WeakSet' || t.LibraryName === 'WeakMap')) {
      Q(yield* StampTypedCollection(value, t.Arguments));
    }
    // #value-type-class: "assigning one copies it". The value already satisfies
    // the type, and for a value type that is exactly when the copy is taken -
    // a boundary is "where a value acquires a type it did not have", and a
    // value type acquiring its type IS the copy. See CopyValueTypeInstance for
    // why this is the right set of sites and what it does not cover.
    if (t.Kind === 'nominal' && t.EnumMembers === undefined && value instanceof ObjectValue
        && LayoutOf(t) !== null) {
      return Q(yield* CopyValueTypeInstance(value, t));
    }
    // proposal-runtime-types (Capability B): even when the value already
    // satisfies the type, a literal string type is carried on the value.
    return carryStringType(value, t);
  }
  if (t.Kind === 'union') {
    return yield* ConvertValueToUnion(value, t, CheckedConvertValue);
  }
  // sec-type-membership: "A value belongs to an intersection if it belongs to
  // EVERY member" - the opposite quantifier to the union above, which is why the
  // two cannot share a loop.
  //
  // There was no branch at all, so an intersection record fell past every case to
  // the terminal refusal below and NO value could satisfy one:
  // `type C = A & B; let c: C = { a: 1, b: 2 }` was a TypeError.
  //
  // Threading the result through each member is safe because conversion to an
  // object type coerces IN PLACE and returns the same object - measured:
  // `let x: A = raw` gives `x === raw` with `x.a` now a `uint8`. So each member
  // contributes its own coercion and the value's identity is preserved, which is
  // what an intersection of object types should mean. A member that refuses
  // makes the whole intersection refuse, carrying that member's error rather
  // than a generic one, since it says which half was not satisfied.
  if (t.Kind === 'intersection') {
    let current = value;
    for (const m of t.Members) {
      // Q would propagate the MEMBER's own error, which names the member and
      // not the intersection it came from - so `A & B` reported only that the
      // value did not fit `B`, leaving the reader to work out where `B` came
      // from. The loop knows which member rejected, so it says both.
      const attempt = EnsureCompletion(yield* CheckedConvertValue(current, m));
      if (attempt.Type !== 'normal') {
        return Throw.TypeError(
          '$1 is not assignable to $2: it does not satisfy $3',
          value,
          Value(displayType(t)),
          Value(displayType(m)),
        );
      }
      current = attempt.Value;
    }
    return current;
  }
  if (t.Kind === 'primitive') {
    switch (t.Name) {
      // proposal-runtime-types #sec-binary-floating-point-types: every binary64
      // value is exactly a binary128 value - the format is strictly wider in
      // both significand and exponent - so a Number crosses this boundary
      // WITHOUT ROUNDING, and a float128 arriving at its own type is already
      // one. What rounds is the other direction.
      case 'float128': {
        if (isFloat128Object(value)) {
          return value;
        }
        if (value instanceof NumberValue) {
          // numberValue() rather than R(): R answers the MATHEMATICAL value, in
          // which negative zero does not exist - it maps -0 to 0 deliberately.
          // IEEE 754 distinguishes the two zeroes and so does SameValue, so a
          // format that reads its input through R cannot represent one of its
          // own values.
          return Float128FromNumber(value.numberValue(), surroundingAgent.currentRealmRecord);
        }
        if (isTypedNumber(value)) {
          return Float128FromNumber(value.numberValue(), surroundingAgent.currentRealmRecord);
        }
        return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
      }
      case 'string':
        // Split by source rather than by primitiveness: a Number, a BigInt, and a
        // Boolean each have one canonical text and lose nothing, while *undefined*,
        // *null*, an object, and a Symbol have only a diagnostic text and produce
        // the classic silent failures. A program that wants those writes String(v).
        if (!isStringConversionSource(value)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return Q(yield* ToString(value));
      case 'number':
        if (!isNumberConversionSource(value)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return Q(yield* ToNumber(value));
      case 'boolean':
        if (!isBooleanConversionSource(value)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return ToBoolean(value);
      case 'bigint': {
        // The other direction of the same rule: an integer type's values ARE
        // mathematical integers, so every one of them is a BigInt exactly, and
        // #sec-requiretype converts between two numeric types. A wide type
        // carries its value as a BigInt already; a narrow one carries a Number
        // that is an integer by construction.
        if (isTypedNumber(value)) {
          const record = value.TypeRecord as TypeRecord;
          if (record.Kind === 'primitive' && isIntegerTypeName(record.Name)) {
            return Value(value.bigintValue());
          }
        }
        // The checked rule for the same source: exact where the Number is an
        // integer, a RangeError where it is not, since a BigInt has no
        // fraction to round into (F66).
        if (value instanceof NumberValue) {
          const bn = R(value) as number;
          // Beyond 2**53 a Number no longer distinguishes adjacent integers, so
          // converting one would report a value the source may never have
          // written (F67). Refuse rather than guess.
          if (!Number.isSafeInteger(bn)) {
            return Throw.RangeError('$1 is not in the range of $2', value, Value(displayType(t)));
          }
          return Value(BigInt(bn));
        }
        break;
      }
      case 'uint':
      case 'int':
      case 'float16':
      case 'float32':
      case 'float64': {
        // #sec-requiretype separates the two ways a checked conversion fails, and
        // they are different errors. Step 2 applies only when the value is ITSELF
        // numeric: a conversion is available and the only question is one of
        // RANGE, so an unrepresentable value is a RangeError. Step 3 is everything
        // else, where there is no numeric conversion to attempt at all, and that
        // is a TypeError raised before any coercion is tried.
        //
        // Reaching for ToNumber first, as this once did, made the annotation a
        // coercion rather than a check: it accepted a string, a Boolean, *null*,
        // and any object with a `valueOf`, and at a float width it could not even
        // fail, so a missing field became a NaN that surfaced somewhere else.
        if (value instanceof BigIntValue && isFloatTypeName(t.Name)) {
          // The checked rule: a conversion that would round throws rather than
          // discarding, so a BigInt is admitted exactly where the float width
          // represents it exactly.
          const payload = Number(R(value) as bigint);
          const rounded = wrapToType(payload, t);
          if (!Number.isFinite(rounded) || BigInt(rounded) !== (R(value) as bigint)) {
            return Throw.RangeError('$1 is not in the range of $2', value, Value(displayType(t)));
          }
          return new TypedNumberValue(rounded, t);
        }
        if (!isNumericConversionSource(value)) {
          if (value instanceof JSStringValue || value instanceof TypedStringValue) {
            return Throw.TypeError('a string is not a conversion source for $1; use its parse or tryParse', Value(displayType(t)));
          }
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        const sourceIsNumeric = true;
        const n = Q(yield* ToNumber(value));
        const math = R(n) as number;
        // The range check asks a question about the mathematical value, where a
        // signed zero is immaterial; the payload keeps the Number as given.
        if (!fitsNumericType(math, t.Name, t.Arguments)) {
          return sourceIsNumeric
            ? Throw.RangeError('$1 is not in the range of $2', value, Value(displayType(t)))
            : Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        const payload = n.numberValue(); // eslint-disable-line @engine262/mathematical-value -- the stored payload is the Number, and R would normalize a negative zero away
        const converted = wrapToType(payload, t);
        // A float width rounds, and rounding a FINITE value to an infinity loses
        // the value rather than approximating it, which #sec-requiretype calls
        // unrepresentable. (This is the checked boundary; a Math function's
        // declared return applies float arithmetic's own rule and does overflow
        // to an infinity, which is the same checked-versus-cheap split the
        // operators have.)
        // A BigInt result is the exact value of a wide integer type and is
        // finite by construction; `Number.isFinite` answers *false* for one, so
        // testing it without this read a successful conversion as an overflow.
        if (typeof converted !== 'bigint' && Number.isFinite(math) && !Number.isFinite(converted)) {
          return sourceIsNumeric
            ? Throw.RangeError('$1 is not in the range of $2', value, Value(displayType(t)))
            : Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return new TypedNumberValue(converted, t);
      }
      default:
        break;
    }
  }
  // An INTERFACE reaches here as a ~nominal~ whose [[Structure]] is the object
  // record, since its identity is its declaration and its shape is structural.
  // Both spell the same boundary, so both take the same conversion; without
  // this an interface-annotated binding failed where the equivalent object type
  // succeeded, which is a distinction neither the design nor the specification
  // draws.
  const objectShape = t.Kind === 'object'
    ? t
    : (t.Kind === 'nominal' && t.Structure !== undefined && t.Structure.Kind === 'object' ? t.Structure : null);
  if (objectShape !== null && value instanceof ObjectValue && Q(IsArray(value)) === Value.false) {
    // proposal-runtime-types #table-check-sites: "a boundary is where a value
    // acquires a type it did not have". An object type's boundary TESTED
    // membership where it had to CONVERT, so a plain object never satisfied a
    // type with a value-type member - `let o: { x: uint8 } = { x: 5 }` threw,
    // because the literal's `5` is a Number and nothing made it a uint8, while
    // `{ x: number }` passed. That made object types with numeric members close
    // to unusable. It is F71's shape at a second boundary: a conversion that
    // stops at the surface.
    //
    // CONVERTED IN PLACE, which is where this parts company with the array
    // arm above, and the reason is width subtyping. The array arm builds a new
    // array from indices 0..len-1, which is total: an array has nothing else.
    // An object may carry properties the type does not declare and legitimately
    // keeps them (`let o: { x: uint8 } = objWithMore`), so building a new object
    // from the declared members alone would DISCARD them. Converting in place
    // keeps the identity, the prototype, and the undeclared properties, and the
    // declared members become values of their declared types - which is what
    // the sentence above asks a boundary to do.
    for (const prop of objectShape.Properties) {
      const key = propertyKeyValue(prop.key);
      const has = Q(yield* HasProperty(value, key));
      if (has === Value.false) {
        if (prop.optional) {
          continue;
        }
        return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
      }
      const current = Q(yield* Get(value, key));
      const converted = Q(yield* CheckedConvertValue(current, prop.type));
      if (converted !== current) {
        // PLAN-in-place-conversion-non-writable.md phase 1, W1. CONVERTING IN
        // PLACE ASSUMES THE PROPERTY CAN BE WRITTEN, and nothing checked.
        //
        // The write faulted for any member that is not writable and holds a
        // value needing conversion - a frozen object, an accessor with no
        // setter, a `writable: false` descriptor - and the fault was
        // `Cannot set property "n" on [object Object]`: a property-assignment
        // error standing in for a type judgment, naming neither the type nor
        // the reason, and reaching the program at run time.
        //
        // It struck at EVERY object boundary (parameter, `let`, return, a
        // nested member, an array element) and it reached a COMPOSITE, which is
        // frozen from its creation (#sec-composite-types), so
        // `Composite.<{ n: number }>` could not be narrowed to `{ n: uint32 }`.
        //
        // Refusing is W1, chosen over copying (W3) because the callee receives
        // the SAME object today - `f(o) === o` answers *true* - and undeclared
        // properties survive the crossing; a copy would break the first and
        // make sharing depend on the argument's property descriptors.
        //
        // `Set` with *false* answers whether the write SUCCEEDED rather than
        // throwing, so the refusal is decided by trying it on the value itself.
        // That is exact where a descriptor walk would not be: the property may
        // be inherited, and `Map.prototype.size` is an accessor two links up.
        const wrote = Q(yield* SetProperty(value, key, converted, Value.false));
        if (wrote === Value.false) {
          return Throw.TypeError(
            '$1 cannot be converted to $2 in place, because it is not writable',
            key,
            Value(displayType(prop.type)),
          );
        }
      }
    }
    // A property the type admits through an INDEX SIGNATURE crosses the same
    // boundary as a declared one. #sec-literal-freshness speaks of a property
    // the expected type "neither declares nor admits through an index
    // signature", so an admitted one is as much a member of the shape as a
    // declared one - and it needs converting for the same reason the declared
    // ones do: the loop above stopped at the DECLARED members, so a literal
    // `{ x: 1, other: 2 }` at `{ x: uint8, [string]: uint8 }` left `other` a
    // plain Number and then failed the membership test that follows, refusing a
    // literal the clause admits.
    if (objectShape.IndexSignatures.length > 0) {
      const declared = new Set(objectShape.Properties.map((prop) => {
        const k = propertyKeyValue(prop.key);
        return k instanceof JSStringValue ? k.stringValue() : k;
      }));
      for (const own of Q(yield* value.OwnPropertyKeys())) {
        if (!(own instanceof JSStringValue) || declared.has(own.stringValue())) {
          continue;
        }
        let signature;
        for (const ix of objectShape.IndexSignatures) {
          if (Q(yield* IsOfType(own, ix.Key))) {
            signature = ix;
            break;
          }
        }
        if (signature === undefined) {
          continue;
        }
        const current = Q(yield* Get(value, own));
        const converted = Q(yield* CheckedConvertValue(current, signature.Value));
        if (converted !== current) {
          Q(yield* SetProperty(value, own, converted, Value.true));
        }
      }
    }
    // #table-check-sites, row "a value stored to a property or field of
    // declared type t": the store check reads the type off the object, so the
    // object must carry it. Without this the members were converted once at the
    // boundary and every later store went unchecked - the same defect the array
    // element type had before F49/F51.
    const typed = (value as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties
      ?? new Map<unknown, { TypeRecord: TypeRecord }>();
    for (const prop of objectShape.Properties) {
      if (!typed.has(prop.key)) {
        typed.set(prop.key, { TypeRecord: prop.type });
      }
    }
    (value as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
    // FALL THROUGH to the membership check rather than returning here. The
    // members are now of their declared types, which is what this arm exists to
    // do, but a type may have more to say than its members: a dependent record
    // has a `where` predicate, a nominal has index signatures, and an interface
    // has both. Returning the value directly skipped every one of them - six
    // tests across five files caught it, which is what those tests are for.
    return Q(yield* requireMembership(value, t));
  }
  // proposal-runtime-types #sec-array-and-tuple-types: a plain array in a TUPLE
  // position converts POSITION-WISE, as one in an array position converts
  // element-wise. Only the array form converted, so a tuple of value types
  // could not be written from a literal at all - `const a: [uint8] = [1]` was
  // refused where `const a: [1].<uint8> = [1]` was accepted, and the design's
  // "a tuple of value types is itself a value type laid out contiguously" had
  // no way to be built.
  //
  // A boundary converts everywhere in this proposal except a `ref` binding,
  // which checks and never converts because converting a borrow would rewrite
  // the caller's storage. A tuple literal builds a NEW array, so there is no
  // aliased storage to protect and the array rule applies unchanged.
  if (t.Kind === 'tuple' && value instanceof ObjectValue && Q(IsArray(value)) === Value.true) {
    const lenValue = Q(yield* Get(value, Value('length')));
    const len = R(Q(yield* ToNumber(lenValue))) as number;
    const elements = t.Elements;
    const rest = elements.find((e) => e.Rest);
    const fixedCount = elements.filter((e) => !e.Rest).length;
    // #sec-array-and-tuple-types: a trailing position with a default may be
    // omitted, which is what lets a shorter array satisfy a longer tuple. The
    // floor is therefore the count of positions carrying NEITHER a rest nor a
    // default, and the supplied length may fall anywhere from there to the
    // position count.
    const requiredCount = elements.filter((e) => !e.Rest && e.Initial === 'none').length;
    if (len < requiredCount || (rest === undefined && len > fixedCount)) {
      return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
    }
    // An unsupplied position takes its default, converted to that position's
    // type as a supplied value would be.
    const filled = Math.max(len, rest === undefined ? fixedCount : len);
    const out = X(ArrayCreate(filled));
    for (let i = 0; i < filled; i += 1) {
      if (i >= len) {
        const declaredDefault = elements[i]!.Initial;
        if (declaredDefault === 'none') {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        const convertedDefault = Q(yield* CheckedConvertValue(declaredDefault, elements[i]!.Type));
        X(CreateDataPropertyOrThrow(out, Value(String(i)), convertedDefault));
        continue;
      }
      // A position past the declared ones belongs to the rest, whose [[Type]]
      // is the type of what it collects.
      const declared = i < elements.length && !elements[i]!.Rest
        ? elements[i]!.Type
        : (rest !== undefined ? restElementType(rest.Type) : undefined);
      const el = Q(yield* Get(value, Value(String(i))));
      const converted = declared === undefined ? el : Q(yield* CheckedConvertValue(el, declared));
      X(CreateDataPropertyOrThrow(out, Value(String(i)), converted));
    }
    // #sec-array-defaults-and-stores: "A store to an element of an array of
    // element type _t_ checks the value against _t_." A tuple has a type PER
    // POSITION rather than one element type, and nothing recorded them, so a
    // tuple's positions were checked when it was built and never again:
    // `let t: [uint8, string] = [1, 's']; t[0] = 'wrong';` was accepted.
    //
    // The record travels with the ARRAY, as an array's [[TypedElement]] does,
    // which is what makes the store check independent of the view a write
    // arrives through. That matters because #sec-issubtype makes a tuple
    // covariant position-wise, so a narrow tuple may be seen as a wider one and
    // the boundary between them may be ELIDED (#sec-check-elision) - the two
    // views are then the same object, and only a mark on the object itself can
    // refuse a store that the narrow view forbids.
    // The positions are resolved here rather than at the store: value.mts holds
    // the store check and has no business unwrapping a rest element's collected
    // type, and resolving once per boundary is cheaper than once per write.
    (out as { TypedTuple?: { Positions: readonly TypeRecord[], Rest: TypeRecord | undefined } }).TypedTuple = {
      Positions: elements.filter((e) => !e.Rest).map((e) => e.Type),
      Rest: rest !== undefined ? restElementType(rest.Type) : undefined,
    };
    return out;
  }
  if (t.Kind === 'array') {
    // proposal-runtime-types soa.md: "`SoA.<T>` and `[].<T>` are DISTINCT TYPES
    // WITH DISTINCT LAYOUTS, and NEITHER IS ASSIGNABLE TO THE OTHER. Conversion
    // is explicit and copies." The other direction is already an early error;
    // this one was not, because an SoA is an ordinary object and nothing here
    // asked whether it was one. Refused explicitly rather than by falling
    // through to a membership test that would report something less useful.
    if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue
        && SoAStorageOf(value as unknown as object) !== undefined) {
      return Throw.TypeError('an SoA is not assignable to $1; convert with toArray()', Value(displayType(t)));
    }
    // proposal-runtime-types (spec sec-contextual-types, README "Typed Array
    // Propagation"): a plain array in a `[].<T>` position propagates the element
    // type. Each element is converted to the element type by the same checked
    // conversion, so `let a: [].<uint8> = [1, 2, 3]` yields an array whose elements
    // are uint8 values and whose stores wrap. A fixed extent must match the length.
    if (value instanceof ObjectValue) {
      const isArr = Q(IsArray(value));
      // proposal-runtime-types: propagation is for an array that has NO element
      // type - a literal, or a plain array reaching here as `~any~`. An array
      // that already has one and still failed the membership test above means
      // the two types genuinely disagree, and rebuilding it silently answers a
      // disagreement with a COPY.
      //
      // The case that reached here was a fixed array against a dynamic target,
      // and it reached here BECAUSE #sec-array-and-tuple-types made membership
      // answer *false* for that pair: the early return stopped firing, so an
      // already-typed array fell into the branch meant for literals. Assignment
      // aliases everywhere else, including through `~any~` and including fixed
      // to fixed, so this one case silently allocated and disconnected - and
      // `b === a` was the only way to find out which had happened.
      const alreadyTyped = (value as unknown as { TypedElement?: unknown }).TypedElement !== undefined;
      if (isArr === Value.true && alreadyTyped) {
        return Throw.TypeError('$1 is not assignable to $2; use a spread to copy it', value, Value(displayType(t)));
      }
      if (isArr === Value.true) {
        const lenValue = Q(yield* Get(value, Value('length')));
        const len = R(Q(yield* ToNumber(lenValue))) as number;
        if (t.Extent !== 'dynamic' && t.Extent !== len) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        const out = X(ArrayCreate(len));
        for (let i = 0; i < len; i += 1) {
          const el = Q(yield* Get(value, Value(String(i))));
          const converted = Q(yield* CheckedConvertValue(el, t.Element));
          X(CreateDataPropertyOrThrow(out, Value(String(i)), converted));
        }
        // #table-check-sites, row "a value stored to an element of an array of
        // element type t": the store check reads the element type off the
        // array, so the array must carry it. Without this the elements were
        // converted once at the boundary and every later store went unchecked,
        // so a `[].<uint8>` accepted a string and degraded to plain Numbers as
        // it was written to (F49, F51).
        // proposal-runtime-types #sec-array-and-tuple-types: a FIXED extent is
        // part of the type, so the array carries it as it carries the element
        // type. Without it the extent was dropped at the boundary and nothing
        // enforced it afterwards: a `[4].<float32>` accepted `push`, a `length`
        // assignment, and a store past the end, growing a type whose extent the
        // layout rules and the array views both treat as a compile-time
        // constant.
        StampTypedArray(out as ObjectValue, t.Element);
        if (t.Extent !== 'dynamic') {
          (out as { TypedExtent?: number }).TypedExtent = t.Extent as number;
        }
        return out;
      }
    }
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  // The specification's final step: a target this rule has no conversion for
  // admits only a value already of the type, and otherwise is a TypeError.
  // (This must NOT call RequireType, which delegates here - F51.)
  return Q(yield* requireMembership(value, t));
}

export function* IsOfTypeNode(value: Value, node: ParseNode.Type): PlainEvaluator<boolean> {
  const record = Q(yield* TypeNodeToTypeRecord(node));
  return Q(yield* IsOfType(value, record));
}

// proposal-runtime-types M11: class operator tables. Operators registered at
// class definition are keyed by the prototype object, and binary evaluation
// consults the table before the numeric machinery, only when the left operand
// is an Object, keeping the untyped path unaffected.
const classOperatorTables = new WeakMap<object, Map<string, Value>>();

export function RegisterClassOperator(proto: Value, opText: string, fn: Value): void {
  let table = classOperatorTables.get(proto as object);
  if (!table) {
    table = new Map();
    classOperatorTables.set(proto as object, table);
  }
  table.set(opText, fn);
}

/**
 * proposal-runtime-types #sec-primitive-operator-blocks: the operators a
 * `primitive` block declares, keyed by the primitive the block names and then
 * by the operator. A class operator table is keyed by a PROTOTYPE, which a
 * primitive has no useful equivalent of, so this is its own table - the two
 * declaration forms "differ only in what the receiver is", and the receiver is
 * what the key has to be.
 *
 * The declaration was PARSED AND DISCARDED before this: `primitive float64 {
 * ... }` evaluated to *undefined* and registered nothing, so a program could
 * declare an operator, get no error, and get no behaviour either - the worst of
 * the three outcomes.
 */
interface PrimitiveOperatorEntry {
  readonly fn: Value,
  readonly parameterType: TypeRecord | null,
  readonly deferred?: DeferredOperatorTypes,
}

const primitiveOperatorTables = new WeakMap<object, Map<string, Map<string, PrimitiveOperatorEntry>>>();

function primitiveTablesForAgent(): Map<string, Map<string, PrimitiveOperatorEntry>> {
  const agent = surroundingAgent as unknown as object;
  let table = primitiveOperatorTables.get(agent);
  if (!table) {
    table = new Map();
    primitiveOperatorTables.set(agent, table);
  }
  return table;
}

/**
 * proposal-runtime-types #sec-primitive-operator-blocks: a PARAMETERIZED block,
 * `primitive` _T_ _P_ `{` ... `}`, "declares operators on _T_ FOR EACH
 * PARAMETERIZATION ITS PARAMETERS ADMIT". Its parameter stands for the
 * receiver's metadata, so neither the operand type nor the return type can be
 * resolved at declaration - `float64.<D>` names a D that does not exist until
 * an invocation supplies one.
 *
 * So a parameterized block registers its NODES and the environment they were
 * written in, and the dispatch resolves them with the parameter bound. That is
 * the one place this proposal resolves a type at use rather than at
 * declaration, and it is not the F51 mistake: F51 was about resolving a name
 * that was already fixed, while this is a parameter whose value IS the
 * invocation.
 */
export interface DeferredOperatorTypes {
  readonly parameterNames: readonly string[];
  /** The OPERATOR's own type parameters, which name the argument's metadata. */
  readonly operatorParameterNames?: readonly string[];
  readonly parameterConstraints?: readonly unknown[];
  readonly parameterTypeNode: unknown;
  readonly returnTypeNode: unknown;
}

export function RegisterPrimitiveOperator(typeName: string, opText: string, fn: Value, parameterType: TypeRecord | null, deferred?: DeferredOperatorTypes): void {
  const tables = primitiveTablesForAgent();
  let ops = tables.get(typeName);
  if (!ops) {
    ops = new Map();
    tables.set(typeName, ops);
  }
  ops.set(opText, { fn, parameterType, deferred });
}

/**
 * The operator a `primitive` block declares for this value, or *null*.
 *
 * The receiver's primitive is read from the value: a typed numeric value names
 * its own base, and a plain Number is `number`, which is the declaration the
 * design uses to close the scalar-on-the-left case (F4) - `2 * v` dispatches
 * because the LEFT operand is a number and `number` declares the operator.
 */
/**
 * #sec-primitive-operator-blocks: "An operator body evaluates on raw values: no
 * operator declared by any block is re-entered within one, so `return this +
 * rhs;` inside `operator+` is the primitive addition rather than itself."
 *
 * Without this the first `primitive number { operator *(rhs: V) }` written
 * turned every multiplication inside any operator body into a dispatch, so a
 * class operator whose body multiplied two plain numbers called the block and
 * failed on its parameter type. The clause states the rule in the sentence
 * above; the counter is how it is kept.
 */
let operatorBodyDepth = 0;

export function EnterOperatorBody(): void {
  operatorBodyDepth += 1;
}

export function LeaveOperatorBody(): void {
  operatorBodyDepth -= 1;
}

export function IsInsideOperatorBody(): boolean {
  return operatorBodyDepth > 0;
}

export function LookupPrimitiveOperator(value: Value, opText: string): PrimitiveOperatorEntry | null {
  if (operatorBodyDepth > 0) {
    return null;
  }
  const tables = primitiveTablesForAgent();
  if (tables.size === 0) {
    return null;
  }
  let name: string | null = null;
  if (isTypedNumber(value)) {
    const record = (value as TypedNumberValue).TypeRecord as TypeRecord;
    const base = record.Kind === 'parameterized' ? record.Base : record;
    if (base.Kind === 'primitive') {
      name = base.Arguments && base.Arguments.length > 0
        ? `${base.Name}${base.Arguments[0]}`
        : base.Name;
    }
  } else if (value instanceof NumberValue) {
    name = 'number';
  }
  if (name === null) {
    return null;
  }
  return tables.get(name)?.get(opText) ?? null;
}

/**
 * The conversion a class declares to a TUPLE type, or *null* where it declares
 * none.
 *
 * sec-user-defined-conversions: "a conversion to a tuple type is what makes a
 * class destructurable". Destructuring has no target type to look one up by -
 * it is defined over the ITERATION protocol, and a destructuring pattern cannot
 * be annotated - so the table is searched for a conversion whose target renders
 * as a tuple rather than being asked for a named one.
 *
 * A tuple's display begins with `[` and is not an array's `[].<T>` or `[3].<T>`,
 * which is what distinguishes the two here.
 */
/**
 * The value an array destructuring should iterate: the result of a declared
 * tuple conversion where the value is not otherwise iterable, else the value
 * unchanged.
 *
 * Returning the value unchanged on every other path is what keeps this
 * invisible to programs that work today - an iterable object, a string, an
 * array, and a class with neither an iterator nor a conversion all pass
 * straight through and reach the same `GetIterator` they always did, including
 * its error.
 */
export function* ApplyTupleConversionForDestructuring(value: Value): PlainEvaluator<Value> {
  
  if (!(value instanceof ObjectValue)) {
    return value;
  }
  // Iteration wins: a class declaring both keeps its iterator. Asked before the
  // conversion rather than after, so this changes behaviour only where
  // `GetIterator` would throw.
  const iteratorFn = Q(yield* Get(value, wellKnownSymbols.iterator));
  if (iteratorFn !== Value.undefined && iteratorFn !== Value.null) {
    return value;
  }
  const fn = LookupTupleConversion(value);
  if (!fn || !IsCallable(fn)) {
    return value;
  }
  return Q(yield* Call(fn, value, []));
}

export function LookupTupleConversion(value: Value): Value | null {
  let proto: unknown = (value as { Prototype?: unknown }).Prototype;
  while (proto && proto instanceof Object && !(proto as { type?: string, constructor: unknown } instanceof Array)) {
    const table = classOperatorTables.get(proto as object);
    if (table) {
      for (const [key, fn] of table) {
        if (key.startsWith('convert [') && !key.startsWith('convert [].<') && !/^convert \[\d+\]\.</.test(key)) {
          return fn;
        }
      }
    }
    proto = (proto as { Prototype?: unknown }).Prototype;
  }
  return null;
}

export function LookupClassOperator(value: Value, opText: string): Value | null {
  let proto: unknown = (value as { Prototype?: unknown }).Prototype;
  while (proto && proto instanceof Object && !(proto as { type?: string, constructor: unknown } instanceof Array)) {
    const table = classOperatorTables.get(proto as object);
    const fn = table?.get(opText);
    if (fn) {
      return fn;
    }
    proto = (proto as { Prototype?: unknown }).Prototype;
  }
  return null;
}

/**
 * ToIndexType ( _value_ ) - #sec-toindextype.
 *
 * "It checks that _value_ is a count and answers its mathematical value.
 *  1. If _value_ is not a value of the index type, throw a *TypeError*
 *     exception.
 *  1. Return the mathematical value of _value_."
 *
 * ISSUES-found-while-writing-examples.md I2. A COUNT is CHECKED rather than
 * coerced, and the clause gives the reason: "`length` and `capacity` READ at the
 * index type, so a count that could be written as a String and silently
 * converted would make the operations that accept a count disagree with the
 * ones that report one - `a.reserve(\"4\")` would be accepted while `a.length`
 * could never be a String."
 *
 * `reserve` and `Span.<T>` used `ToLength`, which coerces: through an
 * `any`-typed value they accepted a String, a negative, and a fraction, all
 * silently. `withCapacity` had the check written inline, with a comment saying
 * both clauses now say ToIndexType - so the operation existed in three
 * different states across three call sites, which is what this replaces.
 */
export function* ToIndexType(value: Value): PlainEvaluator<number> {
  if (!isTypedNumber(value) && !(value instanceof NumberValue)) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value('the index type'));
  }
  const n = Number(Q(yield* ToNumber(value)).numberValue());
  // A count is a non-negative INTEGER. `ToLength` clamped both of these away -
  // a negative became 0 and a fraction was truncated - so `reserve(-1)` and
  // `reserve(2.5)` were accepted as `reserve(0)` and `reserve(2)`.
  if (!Number.isInteger(n) || n < 0) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value('the index type'));
  }
  return n;
}

/**
 * proposal-runtime-types (operatoroverloading.md): operator dispatch keys on the
 * LEFT operand, so a class operator declared by the value on the RIGHT is never
 * reached when the left operand is not an Object. The design closes this with a
 * `primitive` block on the number type, which belongs to the primitive metadata
 * extension and is not implemented. Until it is, such an expression falls through
 * to the ordinary coercion path and quietly produces a value the program did not
 * ask for: a NaN for most operators, a concatenated String for `+`, and, where the
 * class also has a `valueOf`, a plain Number in place of the instance the operator
 * would have returned. Reporting it is better than any of those, so the binary
 * evaluation sites consult this and throw.
 *
 * A String on the left is deliberately excluded: concatenation and string
 * comparison are the defined meanings there and a program may well want them.
 */
export function RightOperandDeclaresOperator(lval: Value, rval: Value, opText: string): boolean {
  return surroundingAgent.feature('runtime-types')
    && !(lval instanceof ObjectValue)
    && !(lval instanceof JSStringValue)
    && rval instanceof ObjectValue
    && LookupClassOperator(rval, opText) !== null;
}

// proposal-runtime-types M13 #sec-meta-hooks: the `default` hook. A meta
// declaration registers the type's default, and an annotated binding without
// an initializer takes it. The method hooks (subtype, validate, narrow,
// conversionFactor) parse and are name-checked; their judgments join later.
const typeDefaults = new WeakMap<object, Value>();

export function RegisterTypeDefault(typeObject: object, value: Value): void {
  typeDefaults.set(typeObject, value);
}

export function LookupTypeDefault(typeObject: object): Value | undefined {
  return typeDefaults.get(typeObject);
}

/**
 * sec-metadataportion, step 1's prerequisite: the snapshot of a meta type's
 * `default`, taken ONCE at declaration, in the host metadata-record shape
 * MetadataObjectFromType produces (frozen, null-prototype, engine Values at
 * the leaves, nested records and lists recursed), so a later structural
 * comparison of a portion against it cannot be defeated by a shape mismatch.
 * A getter on the default object therefore runs at declaration and never
 * again, and MetadataPortion stays synchronous, which its callers require.
 * Symbol-keyed properties are skipped (the plan's C8 pin), and a RegExp
 * default would snapshot by its own enumerable keys rather than as the
 * pattern form, pinned beside StringPattern (F27).
 */
export function* SnapshotMetadataValue(value: Value): PlainEvaluator<Value> {
  if (!(value instanceof ObjectValue)) {
    return value;
  }
  // table-metadata-values: a RANGE and a PATTERN are carried structurally, as
  // endpoints-and-bounds and as source-and-flags. Walking own enumerable keys
  // cannot see either - a range's endpoints are internal slots behind prototype
  // accessors, and a RegExp's source likewise - so a default holding one
  // snapshotted as an EMPTY record and the meta type was then rejected for a
  // default that "must be a value of its constraint shape". Carrying them here
  // in the same markers `metadataValueFromType` produces is what lets
  // MetadataAsObject rebuild them and the membership judgment see a real value.
  if (isRangeObject(value)) {
    const marker: Record<string, unknown> = Object.create(null);
    marker.__range = true;
    marker.start = value.RangeStart;
    marker.end = value.RangeEnd;
    marker.startBound = value.RangeStartBound;
    marker.endBound = value.RangeEndBound;
    return Object.freeze(marker) as unknown as Value;
  }
  const asRegExp = value as { OriginalSource?: JSStringValue, OriginalFlags?: JSStringValue };
  if (asRegExp.OriginalSource !== undefined && asRegExp.OriginalFlags !== undefined) {
    const marker: Record<string, unknown> = Object.create(null);
    marker.__pattern = true;
    marker.source = asRegExp.OriginalSource.stringValue();
    marker.flags = asRegExp.OriginalFlags.stringValue();
    return Object.freeze(marker) as unknown as Value;
  }
  const isList = Q(IsArray(value)) === Value.true;
  const out: unknown[] | Record<string, unknown> = isList ? [] : Object.create(null);
  const keys = Q(yield* value.OwnPropertyKeys());
  for (const key of keys) {
    if (!(key instanceof JSStringValue)) {
      continue;
    }
    const desc = Q(yield* value.GetOwnProperty(key)) as { Enumerable?: unknown };
    if (!desc || desc.Enumerable !== Value.true) {
      continue;
    }
    const snapped = Q(yield* SnapshotMetadataValue(Q(yield* Get(value, key))));
    if (isList) {
      (out as unknown[]).push(snapped);
    } else {
      (out as Record<string, unknown>)[key.stringValue()] = snapped;
    }
  }
  return Object.freeze(out) as unknown as Value;
}

const metaDefaultSnapshots = new WeakMap<object, Value>();

/** The declaration-time snapshot of a meta type's `default` (the plan's Phase 1). */
export function RegisterMetaDefaultSnapshot(typeObject: object, snapshot: Value): void {
  metaDefaultSnapshots.set(typeObject, snapshot);
}

export function LookupMetaDefaultSnapshot(typeObject: object): Value | undefined {
  return metaDefaultSnapshots.get(typeObject);
}

const EMPTY_METADATA_RECORD: Value = Object.freeze(Object.create(null)) as unknown as Value;

/**
 * The participation rule's predicate (METADATA-PROTOCOL-PLAN.md section 2): a
 * meta type GOVERNS a metadata value when MetadataPortion of it differs from
 * the meta type's `default`, compared STRUCTURALLY via SameMetadata; identity
 * cannot be meant, since MetadataPortion returns a fresh copy every call, so
 * an identity test would make every meta type participate always and a brand
 * refuse its own default. A meta type with no snapshot claims no keys, so its
 * portion is always empty and it governs nothing, which the empty record makes
 * literal.
 */
export function MetaTypeGoverns(metadata: MetadataRecord, metaType: object): boolean {
  const snapshot = LookupMetaDefaultSnapshot(metaType) ?? EMPTY_METADATA_RECORD;
  return !SameMetadata(MetadataPortion(metadata, metaType), snapshot);
}

// proposal-runtime-types M20 #sec-meta-hooks: the meta-type method hooks are
// user closures registered per Type Object. `validate` is the meta type's half
// of the validation judgment, consulted from the ~parameterized~ arm of
// IsOfType; the remaining hooks register here for their consumers.
const metaHooks = new WeakMap<object, Map<string, Value>>();

/**
 * Whether any meta hooks are registered against a type object. The
 * unclaimed-key adjudication uses this for the BASE-FORM WAIVER (the plan's
 * C9, F44): a meta registered against the base itself receives the whole
 * metadata, so it speaks for every key of a parameterization of that base,
 * and without the waiver the unclaimed-key sentence would outlaw the very
 * route the judgment's base fallback consults. The base-form route is an
 * engine affordance the specification does not yet describe; this predicate
 * is part of that same pin.
 */
export function HasMetaHooks(typeObject: object): boolean {
  return metaHooks.has(typeObject);
}

/**
 * proposal-runtime-types (spec, the metadata protocol): "A meta type claims the
 * property keys of its constraint shape. Claiming is global and flat: it is an
 * early error, reported at the second MetaDeclaration rather than at any use, for
 * two meta types to claim one key. A metadata object whose own key no meta type
 * claims is a type error at the parameterization that writes it."
 *
 * This registry is that claim. It is what selects a GOVERNING meta type for a
 * metadata value: a parameterization's metadata carries keys, each key is claimed
 * by at most one meta type, and that meta type's hooks judge the parameterization.
 * Without it a hook could only be declared against the BASE, which is not what the
 * design writes: `meta Dimensions { ... }` is declared against the metadata type
 * and is meant to govern every `float32.<{ m, s }>` that uses those keys.
 *
 * "Global" is the specification's word about the KEY SPACE, not about process
 * lifetime: two meta types may not claim one key within a program. The registry is
 * therefore held per agent, so that one agent's declarations cannot decide another
 * agent's judgments. Holding it in a module-level Map instead made a claim outlive
 * the program that wrote it, which showed up immediately as one test's meta type
 * governing the next test's parameterization.
 */
const metaKeyClaimsByAgent = new WeakMap<object, Map<string | SymbolValue, object>>();

function claimsForAgent(): Map<string | SymbolValue, object> {
  const agent = surroundingAgent as unknown as object;
  let claims = metaKeyClaimsByAgent.get(agent);
  if (!claims) {
    claims = new Map();
    metaKeyClaimsByAgent.set(agent, claims);
  }
  return claims;
}

/** Record a meta type's claim over a key. Returns the prior claimant, if any. */
export function ClaimMetaKey(key: string | SymbolValue, typeObject: object): object | undefined {
  const claims = claimsForAgent();
  const existing = claims.get(key);
  if (existing !== undefined && existing !== typeObject) {
    return existing;
  }
  claims.set(key, typeObject);
  return undefined;
}

/** The meta type claiming a key, or *undefined* where none does. */
export function MetaTypeClaiming(key: string | SymbolValue): object | undefined {
  return claimsForAgent().get(key);
}

const metaTypeNames = new WeakMap<object, string>();

/**
 * The declared NAME of a meta type. #sec-primitive-metadata requires the
 * TypeError of a refused crossing to "name _M_", and nothing recorded the name
 * to give (F62).
 */
export function RegisterMetaTypeName(typeObject: object, name: string): void {
  metaTypeNames.set(typeObject, name);
}

export function LookupMetaTypeName(typeObject: object): string | undefined {
  return metaTypeNames.get(typeObject);
}

/**
 * The NAME of a meta type's type parameter, where it declares one.
 *
 * PLAN-hook-parameter-binding.md phase 3. A type-parameter frame maps a NAME to
 * a record, so binding the parameter at a hook invocation needs the name the
 * declaration wrote - and nothing kept it. #sec-meta-declarations: the parameter
 * "is bound to the base at each parameterization the meta type governs … the
 * name of what the base IS".
 *
 * Registered beside the meta type's own name, for the same reason: both are
 * facts about the declaration that an invocation far away needs.
 */
const metaTypeParameterNames = new WeakMap<object, string>();

export function RegisterMetaTypeParameterName(typeObject: object, name: string): void {
  metaTypeParameterNames.set(typeObject, name);
}

export function LookupMetaTypeParameterName(typeObject: object): string | undefined {
  return metaTypeParameterNames.get(typeObject);
}

/**
 * A meta type's own description of a portion, where it defines `describe`.
 * The clause asks for it in both failure messages, and the hook has been
 * declarable since cycle 37 with no consumer at all: the engine threw its
 * generic "$1 is not assignable to $2" and never called it (F62).
 */
export function* DescribePortion(metaType: object, portion: MetadataRecord): PlainEvaluator<string | undefined> {
  if (metaHooks.get(metaType)?.get('describe') === undefined) {
    return undefined;
  }
  // No crossing is in progress - this builds a message about one - so there is
  // no base to bind and an annotation naming the parameter admits.
  const described = Q(yield* ApplyMetaHook(metaType, 'describe', [portion], undefined));
  return described instanceof JSStringValue ? described.stringValue() : undefined;
}

export function RegisterMetaHook(typeObject: object, name: string, fn: Value): void {
  let table = metaHooks.get(typeObject);
  if (!table) {
    table = new Map();
    metaHooks.set(typeObject, table);
  }
  table.set(name, fn);
}

export function LookupMetaHook(typeObject: object, name: string): Value | undefined {
  return metaHooks.get(typeObject)?.get(name);
}

/** The metadata of a type carrying none: the empty record. */
const EMPTY_METADATA = Object.freeze(Object.create(null) as Record<string, never>) as MetadataRecord;

/**
 * The meta types governing a metadata value: one per own key, deduplicated. A key
 * no meta type claims is reported by the caller, since the specification places
 * that error at the parameterization rather than here.
 */
export function GoverningMetaTypes(metadata: MetadataRecord): { types: object[], unclaimed: string[] } {
  const types: object[] = [];
  const unclaimed: string[] = [];
  if (!metadata || typeof metadata !== 'object') {
    return { types, unclaimed };
  }
  const claims = claimsForAgent();
  for (const key of Object.keys(metadata as unknown as Record<string, unknown>)) {
    const claimant = claims.get(key);
    if (claimant === undefined) {
      unclaimed.push(key);
    } else if (!types.includes(claimant)) {
      types.push(claimant);
    }
  }
  return { types, unclaimed };
}

/**
 * #sec-primitive-metadata: MetadataPortion(_m_, _M_), the part of a metadata
 * value that a meta type governs, being its own keys that _M_ claims. Every
 * judgment of the protocol is stated over portions rather than over whole
 * metadata, because a metadata value may be governed by several meta types at
 * once and each must see only what it claims.
 */
export function MetadataPortion(metadata: MetadataRecord, metaType: object): MetadataRecord {
  // sec-metadataportion, as written: start from a copy of the meta type's
  // `default` and overwrite with the metadata's own claimed keys, so every
  // judgment of the protocol sees a COMPLETE portion. The missing completion
  // was the plan's C2, a live defect: a { min, max } meta type parameterized
  // as `<{ min: 0 }>` handed `validate` a portion whose `max` was undefined,
  // and the units suite noticed nothing because undefined === undefined is
  // the right verdict for the wrong reason. A meta type with no snapshot
  // (declared over a non-object shape, or never declared) starts empty, the
  // old behaviour, right for a type that claims no keys.
  const portion: Record<string, unknown> = Object.create(null);
  const snapshot = metaDefaultSnapshots.get(metaType);
  if (snapshot && typeof snapshot === 'object') {
    for (const [key, v] of Object.entries(snapshot as unknown as Record<string, unknown>)) {
      portion[key] = v;
    }
  }
  if (metadata && typeof metadata === 'object') {
    for (const [key, v] of Object.entries(metadata as unknown as Record<string, unknown>)) {
      if (MetaTypeClaiming(key) === metaType) {
        portion[key] = v;
      }
    }
  }
  return Object.freeze(portion) as unknown as MetadataRecord;
}

/** Apply a named hook of a meta type, or *undefined* where it defines none. */
/**
 * PLAN-metadata-typing.md F159. `args` admits a `MetadataRecord` as well as a
 * `Value` because a hook's arguments ARE metadata portions at four of the five
 * call shapes, and the conversion to an ECMAScript object happens below, at the
 * `Call` - not at the callers.
 *
 * F160 is why this is the widening rather than a conversion at each site: OQ4
 * decided "convert at the call sites", the callers duly wrapped their arguments
 * in `MetadataAsObject`, and it changed nothing, because this function was
 * already mapping it over every argument. A mutation test caught the redundancy.
 * Widening here says what is true - a hook argument may be either form, and
 * this is the one place that reconciles them.
 */
export function* ApplyMetaHook(typeObject: object, name: string, args: readonly (Value | MetadataRecord)[], base: TypeRecord | undefined): PlainEvaluator<Value | undefined> {
  const fn = metaHooks.get(typeObject)?.get(name);
  if (!fn) {
    return undefined;
  }
  // #sec-evaluation-budget: this is where the type machinery runs USER CODE,
  // so it is where the meter belongs. Once the enclosing top-level type
  // evaluation is exhausted the hook is not called at all - the evaluation is
  // abandoned, and calling on would be running code the budget already
  // refused.
  if (IsBudgetExhausted()) {
    return undefined;
  }
  ConsumeEvaluationSteps(1);
  // PLAN-hook-parameter-binding.md phase 1. A hook may annotate its parameters
  // with the meta type's type parameter, and #sec-meta-declarations says what
  // that parameter is: "bound to the base at each parameterization the meta type
  // governs … the name of what the base IS". So it is bound HERE, per
  // invocation, from the base the caller is deciding about - not at the
  // declaration, where the base is not yet known.
  //
  // The frame is pushed around the Call rather than inside the hook because
  // EvaluateBody pushes one only from the FUNCTION's own type parameters
  // (InferGenericCallBindings), and a hook function has none - the parameter
  // belongs to the |MetaDeclaration|. currentTypeParameterFrame flattens the
  // whole stack, so a frame pushed here is visible to EnforceParameterTypes
  // inside the call.
  //
  // Where the caller has no base - `describe` building a diagnostic, with no
  // crossing in progress - nothing is pushed and the annotation fails to
  // resolve, which ADMITS. That is what the parameter distribution already does
  // with an out-of-scope substitution, and a `describe` that threw would turn a
  // vague diagnostic into none.
  const parameterName = base === undefined ? undefined : LookupMetaTypeParameterName(typeObject);
  if (parameterName !== undefined && base !== undefined) {
    pushTypeParameterFrame(new Map([[parameterName, base]]));
  }
  try {
    // PLAN-crossing-budget.md phase 1. The charge above is one step per hook
    // CALL; this marks the span in which the ordinary evaluator charges per
    // NODE, so a hook that loops is bounded by the work it does rather than by
    // returning to be charged again.
    // PLAN-crossing-budget.md phase 2. The meter needs a FRAME to charge, and a
    // crossing from an unconstrained value opens none - measured `open=false`
    // there, where a constrained crossing measured `open=true`. So the two
    // failing probes had two different causes: one unmetered span, one absent
    // frame.
    //
    // BeginTypeEvaluation joins an enclosing frame rather than opening a new
    // one, so a hook reached from the checking pass or from an alias
    // instantiation still shares ONE budget - which is the property
    // `runtime.mts` already relies on for recursion.
    BeginTypeEvaluation();
    // The subject the diagnostic will name: the meta type's declared name where
    // one is registered, and the hook that was running. #sec-evaluation-budget
    // forbids an evaluation "no diagnostic names".
    EnterMetaHookEvaluation(`${LookupMetaTypeName(typeObject) ?? 'a meta type'}'s ${name} hook`);
    try {
      return Q(yield* Call(fn as never, Value.undefined, args.map((a) => MetadataAsObject(a))));
    } finally {
      ExitMetaHookEvaluation();
      EndTypeEvaluation();
    }
  } finally {
    if (parameterName !== undefined && base !== undefined) {
      popTypeParameterFrame();
    }
  }
}

/**
 * proposal-runtime-types #sec-primitive-operator-blocks: the IMPLICIT CAST
 * operator, "written as an operator whose name is a parameterization of the
 * primitive, which supplies the conversion ... from the bare primitive into a
 * parameterization".
 *
 * Keyed by the primitive the block names. A block may declare several, one per
 * parameterization it can produce, and the boundary picks the ones it needs:
 * "At a boundary, one is invoked FOR EACH META TYPE the required metadata
 * constrains and the supplied value's does not, and its absence is why such a
 * boundary is otherwise a type error."
 *
 * That sentence is the whole feature. `const v: Velocity = 10` is a type error
 * today not because 10 is unfit but because nothing supplies the crossing from
 * a bare `number` into the dimensions meta type; a cast declared on `number` is
 * what supplies it.
 */
interface PrimitiveCast {
  readonly target: TypeRecord;
  readonly fn: Value;
}

const primitiveCasts = new WeakMap<object, Map<string, PrimitiveCast[]>>();

function castsForAgent(): Map<string, PrimitiveCast[]> {
  const agent = surroundingAgent as unknown as object;
  let table = primitiveCasts.get(agent);
  if (!table) {
    table = new Map();
    primitiveCasts.set(agent, table);
  }
  return table;
}

export function RegisterPrimitiveCast(typeName: string, target: TypeRecord, fn: Value): void {
  const table = castsForAgent();
  const list = table.get(typeName) ?? [];
  list.push({ target, fn });
  table.set(typeName, list);
}

/** The casts a primitive declares, in declaration order. */
export function PrimitiveCastsFor(typeName: string): readonly PrimitiveCast[] {
  return castsForAgent().get(typeName) ?? [];
}

/**
 * The crossing from a BARE primitive value into a parameterization, which is
 * ConvertParameterization's second arm seen from the outside: the value carries
 * nothing of the meta types the target constrains, and a cast supplies what it
 * lacks. Returns *undefined* where no cast applies, so the caller reports the
 * ordinary type error and nothing about an undeclared crossing changes.
 */
export function* ApplyImplicitCast(value: Value, t: TypeRecord): PlainEvaluator<Value | undefined> {
  // The raw-body rule reaches the CAST too, and not only the binary operators:
  // a cast body returning `this` has its return checked against the cast's own
  // target, which would invoke the cast it is defining. Suppressing it here is
  // what makes the body see a raw value, exactly as the clause says.
  if (IsInsideOperatorBody()) {
    return undefined;
  }
  if (t.Kind !== 'parameterized' || !isTypedNumber(value) && !(value instanceof NumberValue)) {
    return undefined;
  }
  const base = t.Base;
  if (base.Kind !== 'primitive') {
    return undefined;
  }
  const name = base.Arguments && base.Arguments.length > 0
    ? `${base.Name}${base.Arguments[0]}`
    : base.Name;
  // A bare Number is spelled `number`; a typed value names its own base.
  const declaredOn = value instanceof NumberValue ? ['number', name] : [name];
  for (const key of declaredOn) {
    for (const cast of PrimitiveCastsFor(key)) {
      // The cast is chosen by whether it produces the metadata the target
      // requires. Where a target constrains several meta types and several
      // casts apply, each runs in declaration order and the last result stands,
      // which is the clause's "one is invoked for each meta type" read
      // literally: a cast supplies its own meta type's portion.
      if (SameType(cast.target, t)) {
        // "An operator body evaluates on RAW VALUES: no operator declared by
        // any block is re-entered within one." A cast body returning `this`
        // returns the bare value, and checking that return against the cast's
        // own target would re-enter the crossing it is defining - which is the
        // failure the rule exists to prevent, and which showed up immediately
        // as the body's return boundary refusing the value.
        //
        // So the body computes the raw value and the DECLARED TARGET says what
        // it becomes: the result is stamped with the target's type rather than
        // checked against it. That is the clause's division of labour - a cast
        // "supplies the conversion", it does not perform a check.
        EnterOperatorBody();
        let raw;
        try {
          raw = Q(yield* Call(cast.fn as never, value, []));
        } finally {
          LeaveOperatorBody();
        }
        // A cast body is ordinary code, so in sloppy mode its `this` is the
        // BOXED value and `return this;` - the usual whole body - hands back a
        // Number wrapper rather than a Number. Unwrapping it here is what lets
        // the plainest cast anyone will write work; a body that computes
        // returns a primitive and takes the branch above.
        const unwrapped = raw instanceof ObjectValue && 'NumberData' in raw
          ? (raw as unknown as { NumberData: Value }).NumberData
          : raw;
        if (isTypedNumber(unwrapped)) {
          return new TypedNumberValue(unwrapped.value, t);
        }
        if (unwrapped instanceof NumberValue) {
          return new TypedNumberValue(R(unwrapped) as number, t);
        }
        return unwrapped;
      }
    }
  }
  return undefined;
}

/**
 * #sec-primitive-metadata: ConvertParameterization. The crossing between two
 * parameterizations of one base.
 *
 * Each meta type gates the crossing independently, and the clause gives exactly
 * two ways through: `subtype` admits it, or the value carries nothing of that
 * meta type and a cast supplies what it lacks. `Meter` reaches `Kilometer` by the
 * first, the exponents agreeing and only the ratio differing; a bare value
 * reaches a bounds meta type only by the second, which is where a bound is
 * actually enforced, since `subtype` cannot prove an unconstrained value
 * non-negative.
 *
 * NOTE that `subtype` IS callable here, unlike from IsSubtype. A conversion is
 * already an effectful operation, so running a hook inside it costs nothing
 * structurally; it is the synchronous subtype RELATION that cannot call one.
 */
/**
 * The check a cast's result still faces, which a cast does not bypass.
 *
 * PLAN-parameterized-defaults.md phase 1. This asked MEMBERSHIP, and membership
 * is the wrong question here by exactly one arm. #sec-primitive-metadata's
 * ConvertParameterization runs, at its second way through, only
 * "If _M_ defines `validate` and it does not hold of _v_ and _tp_, throw" - the
 * hook, CONDITIONED ON DEFINEDNESS. IsOfType answers *false* for a meta type
 * that defines none, because that is the brand rule, "which is what makes a
 * brand a brand" - so asking membership here re-applied the very gate the cast
 * had just satisfied, and refused the crossing the clause sanctions:
 * `const v: Velocity = 10;` "compiles exactly where `number` declares a cast
 * into the dimensions meta type", and the design's `Dimensions` declares no
 * `validate` at all ("dimensions constrain type compatibility, not value
 * ranges"). The engine's own fixture hid this by giving its meta type a
 * `validate` returning *true*, which the design's does not have.
 *
 * The intent the old comment recorded is right and is kept: a cast is a way IN,
 * not a way past. `validate` still judges the result, which is where a bound is
 * enforced - a cast into a bounds meta type still refuses an out-of-range
 * value. What changed is that a meta type offering no judgment now admits,
 * rather than refusing on the strength of a rule about BARE values that a cast
 * result is no longer one of.
 */
export function* RequireTypeAfterCast(value: Value, t: TypeRecord): ValueEvaluator {
  if (t.Kind !== 'parameterized') {
    const ok = Q(yield* IsOfType(value, t));
    return ok ? value : Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  // The value must still be one of the BASE: a cast supplies metadata, not a
  // different primitive.
  if (!Q(yield* IsOfType(value, t.Base))) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  const { types: governing } = GoverningMetaTypes(t.Metadata);
  for (const metaType of governing) {
    if (!MetaTypeGoverns(t.Metadata, metaType)) {
      // The judgment's sit-out: a portion equal to the default constrains
      // nothing, so the meta type takes no part in the crossing either.
      continue;
    }
    const verdict = Q(yield* ApplyValidateHook(metaType, value, MetadataPortion(t.Metadata, metaType), t.Base));
    // *undefined* is "this meta type defines no `validate`", which the clause's
    // step reads as nothing to check rather than as a refusal.
    if (verdict === false) {
      const named = LookupMetaTypeName(metaType) ?? 'a meta type';
      const described = Q(yield* DescribePortion(metaType, MetadataPortion(t.Metadata, metaType)));
      if (described !== undefined) {
        return Throw.TypeError('$1 does not admit $2', Value(named), Value(described));
      }
      return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
    }
  }
  // A hook declared against the BASE judges the whole metadata, as it does in
  // IsOfType's parameterized arm.
  const baseVerdict = Q(yield* ApplyValidateHook(GetTypeObject(t.Base), value, t.Metadata, t.Base));
  if (baseVerdict === false) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  return value;
}

/**
 * The crossing of a value carrying NO metadata into a parameterization, which
 * is the algorithm of #sec-metadata-conversion applied with a _from_ whose
 * every portion is its meta type's `default`.
 *
 * PLAN-parameterized-defaults.md phase 4 needs it separately from
 * CheckedConvertValue. That operation is a BOUNDARY, and a boundary reached at
 * run time admits a value that is already of the target
 * (#table-check-sites defers to RequireType, which is membership), so a bare
 * zero passes it wherever `validate` says the zero is in range - with or
 * without a cast. A DEFAULT is not a boundary crossing of a value the program
 * produced; it is the clause's own ConvertParameterization call, and the clause
 * offers "exactly two ways through: `subtype` admits it, or the value carries
 * nothing of that meta type and a cast supplies what it lacks". Membership is
 * not among them, which is what makes `let w: T;` and `let w: T = 0;` agree.
 */
export function* CrossBareValueIntoParameterization(value: Value, t: TypeRecord & { Kind: 'parameterized' }): ValueEvaluator {
  // The second way through, tried first because it is the one that can supply
  // what the value lacks; RequireTypeAfterCast then runs `validate` over the
  // result, which is what the cast costs.
  const cast = Q(yield* ApplyImplicitCast(value, t));
  if (cast !== undefined) {
    return Q(yield* RequireTypeAfterCast(cast, t));
  }
  // The first way: every meta type the target constrains must admit the
  // crossing from its own `default`, which is the portion a value carrying
  // nothing has. MetadataPortion of *undefined* is that copy of the default.
  const { types: governing } = GoverningMetaTypes(t.Metadata);
  for (const metaType of governing) {
    if (!MetaTypeGoverns(t.Metadata, metaType)) {
      continue;
    }
    // "No metadata" is the EMPTY RECORD. `Value.undefined` spelled it only
    // because the parameter was `Value` and the body tests
    // `typeof metadata !== 'object'`; both mean absence, and this one says so
    // in the slot's own language.
    const fp = MetadataPortion(EMPTY_METADATA, metaType);
    const tp = MetadataPortion(t.Metadata, metaType);
    const admits = Q(yield* ApplyMetaHook(metaType, 'subtype', [fp, tp], t.Base));
    if (admits !== Value.true) {
      const named = LookupMetaTypeName(metaType) ?? 'a meta type';
      const described = Q(yield* DescribePortion(metaType, tp));
      if (described !== undefined) {
        return Throw.TypeError('$1 does not admit $2', Value(named), Value(described));
      }
      return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
    }
  }
  // Every meta type admitted, so the value has crossed and is AT the target -
  // which this engine says by carrying the record, as ApplyImplicitCast does
  // for the other way through. Returning it unstamped left the caller holding a
  // bare zero that its own annotation then refused, which is the very shape of
  // failure D22 records.
  if (isTypedNumber(value)) {
    return new TypedNumberValue(value.value, t);
  }
  if (value instanceof NumberValue) {
    return new TypedNumberValue(R(value) as number, t);
  }
  return value;
}

export function* ConvertParameterization(value: Value, from: TypeRecord, to: TypeRecord): ValueEvaluator {
  if (from.Kind !== 'parameterized' || to.Kind !== 'parameterized') {
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(to)));
  }
  const governing = new Set<object>([
    ...GoverningMetaTypes(from.Metadata).types,
    ...GoverningMetaTypes(to.Metadata).types,
  ]);
  // The participation rule (the plan's section 2, replacing the former
  // all-declared quantifier, its C1): a meta type takes part in the crossing
  // when it GOVERNS either side, its portion differing structurally from its
  // default. `quantize` keys on the TARGET alone, since it maps a value onto
  // the representation the target's constraint requires and a default
  // constraint requires nothing. With completion in place only a meta type
  // with a written claimed key can govern, so the key union above stays the
  // iteration and these are filters, provably equivalent to the rule.
  const participating = [...governing].filter((m) => MetaTypeGoverns(from.Metadata, m) || MetaTypeGoverns(to.Metadata, m));
  const quantizing = [...governing].filter((m) => MetaTypeGoverns(to.Metadata, m));
  for (const metaType of participating) {
    const fp = MetadataPortion(from.Metadata, metaType);
    const tp = MetadataPortion(to.Metadata, metaType);
    const admits = Q(yield* ApplyMetaHook(metaType, 'subtype', [fp, tp], to.Base));
    if (admits === Value.true) {
      continue;
    }
    // The clause's second way through is an implicit cast operator declared on
    // the base, which this engine has no declaration form for yet. Until it does,
    // a meta type that does not admit the crossing refuses it - and the message
    // "names _M_ and, where _M_ defines `describe`, its descriptions of _fp_
    // and _tp_", which is the difference between a units error that says what
    // it means and one that dumps a record (F62).
    const named = LookupMetaTypeName(metaType) ?? 'a meta type';
    const fd = Q(yield* DescribePortion(metaType, fp));
    const td = Q(yield* DescribePortion(metaType, tp));
    if (fd !== undefined && td !== undefined) {
      return Throw.TypeError('$1 does not admit converting $2 to $3', Value(named), Value(fd), Value(td));
    }
    return Throw.TypeError('$1 does not admit converting $2 to $3', Value(named), Value(displayType(from)), Value(displayType(to)));
  }
  // The factor is the product over every meta type that defines one, so two
  // independent scalings compose rather than one winning.
  let factor = 1;
  for (const metaType of participating) {
    const f = Q(yield* ApplyMetaHook(metaType, 'conversionFactor', [
      MetadataPortion(from.Metadata, metaType),
      MetadataPortion(to.Metadata, metaType),
    ], to.Base));
    if (f !== undefined && f instanceof NumberValue) {
      factor *= R(f) as number;
    }
  }
  let converted = value;
  if (factor !== 1 && (converted instanceof NumberValue || isTypedNumber(converted))) {
    // A conversion factor is a ratio and the scaling is floating by nature, so
    // the payload is read as a Number here even for a wide integer type.
    const scaled = (isTypedNumber(converted) ? converted.numberValue() : (R(converted as NumberValue) as number)) * factor;
    converted = new TypedNumberValue(wrapToType(scaled, to.Base), to.Base);
  }
  for (const metaType of quantizing) {
    const q = Q(yield* ApplyMetaHook(metaType, 'quantize', [
      converted,
      MetadataPortion(to.Metadata, metaType),
    ], to.Base));
    if (q !== undefined) {
      converted = q;
    }
  }
  // A portion the TARGET does not constrain is carried through the source meta
  // type's `rescale` with the conversion's factor, and DROPPED where the meta
  // type defines none.
  //
  // The conversion site needs its own rule and had none. The merge rule beside
  // it contributes a default for an unmentioned meta type because "carrying the
  // receiver's other portions through instead would silently keep a bound the
  // operation may have invalidated" - but that reasons about an operation that
  // computes a NEW quantity. A conversion RE-EXPRESSES the same one: 5 km is
  // 5000 m, and a bound of `0..=10` kilometres is `0..=10000` metres, so the
  // constraint is not invalidated but translated. `rescale` is the hook written
  // to translate it.
  //
  // Absence means "cannot say", not "unchanged": carrying a bound through
  // unscaled would keep `0..=10` on a value that is now 5000, which `validate`
  // then rejects for a constraint the program never wrote. A meta type whose
  // constraint IS factor-invariant, like a non-zero flag, says so by defining
  // `rescale` as the identity.
  // PLAN-metadata-typing.md F157. Annotated as the slot's own type, not
  // `Value`: this local is compared against `to.Metadata` by IDENTITY below, to
  // ask whether the rescale loop replaced it. An over-narrow annotation made
  // that comparison span two types and reported as TS2367, "comparison appears
  // to be unintentional" - a false alarm from the annotation, not a defect in
  // the comparison, which is exactly the check it looks like.
  let targetMetadata: MetadataRecord = to.Metadata;
  if (factor !== 1) {
    const carriedOver: Record<string, unknown> = Object.create(null);
    const source = to.Metadata as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      carriedOver[key] = source[key];
    }
    let carriedAny = false;
    for (const metaType of GoverningMetaTypes(from.Metadata).types) {
      if (MetaTypeGoverns(to.Metadata, metaType)) {
        continue; // the target constrains it; the target's portion wins
      }
      if (LookupMetaHook(metaType, 'rescale') === undefined) {
        continue; // declined to say, so the portion is dropped
      }
      const rescaled = Q(yield* ApplyMetaHook(metaType, 'rescale', [
        MetadataPortion(from.Metadata, metaType), Value(factor),
      ], to.Base));
      const snap = EnsureCompletion(yield* SnapshotMetadataValue(rescaled as Value));
      if (snap.Type !== 'normal') {
        continue;
      }
      const portion = snap.Value as unknown as Record<string, unknown>;
      if (portion && typeof portion === 'object') {
        for (const key of Object.keys(portion)) {
          carriedOver[key] = portion[key];
          carriedAny = true;
        }
      }
    }
    if (carriedAny) {
      targetMetadata = Object.freeze(carriedOver) as unknown as MetadataRecord;
    }
  }
  const carriedType = targetMetadata === to.Metadata
    ? to
    : { Kind: 'parameterized', Base: to.Base, Metadata: targetMetadata } as unknown as typeof to;
  // The result is a value of the target parameterization and CARRIES it, so a
  // chained crossing still has a `from` to gate on and `is` sees the
  // parameterization; membership treats the carried record as its base (the
  // branding rule), so the value is a value of the base everywhere the base is
  // asked for.
  if (converted instanceof NumberValue) {
    converted = new TypedNumberValue(R(converted) as number, carriedType);
  } else if (isTypedNumber(converted)) {
    converted = new TypedNumberValue(converted.value, carriedType);
  }
  return converted;
}

/**
 * PLAN-hook-parameter-binding.md phase 0. This looked the hook up itself and
 * called it, so a hook was invoked from TWO operations rather than one - and
 * `validate` is among the hooks most likely to carry an annotation, so anything
 * placed in ApplyMetaHook missed exactly the hook a reader would test with.
 *
 * It also missed the EVALUATION BUDGET. ApplyMetaHook meters it, with a comment
 * saying why - "this is where the type machinery runs USER CODE, so it is where
 * the meter belongs" - and this path had neither the exhaustion check nor the
 * step consumption, so a `validate` hook ran unmetered. Delegating closes that
 * as a side effect rather than as a second change.
 *
 * What stays here is the only thing that differed: the return conversion, since
 * `validate` answers a Boolean where the other hooks answer a Value.
 */
export function* ApplyValidateHook(typeObject: object, value: Value, metadata: MetadataRecord, base: TypeRecord | undefined): PlainEvaluator<boolean | undefined> {
  // PLAN-metadata-typing.md OQ4, CORRECTED. `ApplyMetaHook` already maps
  // `MetadataAsObject` over every argument at its `Call` (see above), so
  // converting here as well would be a second, redundant conversion. The cast
  // is what the site actually needs: `ApplyMetaHook` takes `readonly Value[]`
  // because it serves every hook, most of which never see metadata, and the
  // record becomes an object inside it.
  //
  // The plan's OQ4 chose "convert at the call sites" over "widen the shared
  // signature", having found `MetadataAsObject` and read it as a converter the
  // CALLERS should apply. It is one the callee already applies. A mutation test
  // caught it: removing the call-site conversion changed nothing, because the
  // conversion downstream was doing the work.
  const result = Q(yield* ApplyMetaHook(typeObject, 'validate', [value, metadata as unknown as Value], base));
  if (result === undefined) {
    return undefined;
  }
  return result === Value.true;
}

/**
 * proposal-runtime-types: a parameterization's metadata is STORED as a host
 * record, a frozen null-prototype object whose values are ECMAScript values, so
 * that SameMetadata can compare two parameterizations structurally without
 * allocating an object or running user code on an interning path.
 *
 * A hook is user code and must receive an ECMAScript object instead. Handing it
 * the host record put a non-Value into an argument list, which failed Call's own
 * assertion and brought the engine down rather than throwing: `(1 := float32) is
 * float32.<{ a: 1 }>` with a `validate` hook declared crashed the host. The
 * conversion belongs here, at the one boundary where the record reaches a
 * program, and not in the storage, which the comparison path depends on.
 */
export function MetadataAsObject(metadata: Value | MetadataRecord): Value {
  if (metadata === null || typeof metadata !== 'object') {
    return metadata as Value;
  }
  // An engine Value is a host object too, so the two are told apart by shape
  // rather than by typeof: a nested metadata record is built with a null
  // prototype and a list is a real Array, and everything else reaching here is
  // already a Value and is handed over untouched. Recursing into a Value instead
  // would rebuild it out of its own internal fields.
  // table-metadata-values: a pattern is carried as source and flags, and a hook
  // that reads one is handed a RegExp built from those. Materializing here, at
  // the one boundary where metadata reaches a program, is what keeps the carried
  // form structural and therefore comparable. The test precedes the shape guard
  // below because a pattern IS one of the host records that guard lets through.
  const pattern = metadata as unknown as { __pattern?: boolean, source?: string, flags?: string };
  if (pattern.__pattern === true) {
    return X(RegExpCreate(Value(pattern.source ?? ''), Value(pattern.flags ?? '')));
  }
  // table-metadata-values: a range is carried as its endpoints and their bounds,
  // and a hook that reads one is handed a Range built from those. Materialized
  // here for the same reason a pattern is: the carried form stays structural, so
  // one range written in two modules is one type, while a hook still receives a
  // value with the operations `RangeBounds` gives it.
  const range = metadata as unknown as {
    __range?: boolean, start?: NumberValue, end?: NumberValue,
    startBound?: 'closed' | 'open', endBound?: 'closed' | 'open',
  };
  if (range.__range === true) {
    return CreateRangeObject(range.start, range.end, range.startBound, range.endBound, surroundingAgent.currentRealmRecord);
  }
  if (!Array.isArray(metadata) && Object.getPrototypeOf(metadata) !== null) {
    // Already a Value - an engine object is a host object too, so the guard
    // above tells them apart by prototype rather than by typeof.
    return metadata as Value;
  }
  // A metadata value nests (table-metadata-values), so the conversion must too.
  // Converting only the top level left host records and host arrays sitting in
  // the properties, and the first thing a hook did with one, even `typeof`,
  // reached a value the engine has no case for.
  if (Array.isArray(metadata)) {
    const arr = X(ArrayCreate(metadata.length));
    for (let i = 0; i < metadata.length; i += 1) {
      X(CreateDataPropertyOrThrow(arr, Value(String(i)), MetadataAsObject(metadata[i] as Value)));
    }
    return arr;
  }
  const obj = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
  for (const [key, v] of Object.entries(metadata as unknown as Record<string, Value>)) {
    X(CreateDataPropertyOrThrow(obj, Value(key), MetadataAsObject(v)));
  }
  return obj;
}

// proposal-runtime-types M19: parameter and return boundaries. Both read the
// annotations off the function's code node and are complete no-ops when none
// are present, so an unannotated function keeps its exact behaviour and cost.
export interface AnnotatedFunction {
  readonly FormalParameters?: unknown;
  readonly ECMAScriptCode?: unknown;
}

function returnAnnotationOf(fn: AnnotatedFunction): ParseNode.TypeAnnotation | null | undefined {
  // The return annotation sits on the declaration, which is the code node's
  // parent (the body is the child that carries no annotation).
  const code = fn.ECMAScriptCode as { parent?: { TypeAnnotation?: ParseNode.TypeAnnotation | null } } | null | undefined;
  return code?.parent?.TypeAnnotation;
}

/**
 * Checks a yielded value against the enclosing generator's declared YIELD type.
 *
 * PLAN-async-generator-types.md phase 3. `sec-function-annotations`: "a
 * generator's annotation types the values the iterator YIELDS". Nothing checked
 * them - `function* g(): uint8 { yield 'nope'; }` ran and `.next().value` was
 * the String.
 *
 * The declared type is read from the RUNNING function rather than passed in,
 * because a `yield` is an expression and has no other route to its generator.
 * `generatorDeclaredType` turns the annotation into `Generator.<Y, R, N>` -
 * that mapping already existed - and _Y_ is the first argument.
 */
export function* EnforceYieldType(value: Value, isAsync: boolean): ValueEvaluator {
  const fn = surroundingAgent.runningExecutionContext.Function;
  if (!fn) {
    return value;
  }
  const annotation = returnAnnotationOf(fn as unknown as AnnotatedFunction);
  if (!annotation) {
    return value;
  }
  const declared = Q(yield* TypeNodeToTypeRecord(annotation.Type));
  // The async flag matters: `generatorDeclaredType` builds `AsyncGenerator` for
  // an async generator and `Generator` otherwise, and passing the wrong one
  // finds no _Y_ - which silently skipped the check for `async function*`.
  const asGenerator = generatorDeclaredType(declared, isAsync);
  const Y = (asGenerator as { Arguments?: readonly TypeRecord[] })?.Arguments?.[0];
  if (!Y) {
    return value;
  }
  return Q(yield* RequireType(value, Y));
}

export function functionHasAnnotations(fn: AnnotatedFunction): boolean {
  if (returnAnnotationOf(fn)) {
    return true;
  }
  // A PUBLISHED inferred return type is a boundary as much as a written one
  // (#sec-inferred-return-types), and this predicate is what decides whether a
  // function's body is evaluated with boundaries at all. A function whose only
  // type is inferred has no annotation to find, so without this it took the
  // fast path and its return was never checked - which is the difference
  // between publishing a type and publishing a claim.
  const code = fn.ECMAScriptCode as { parent?: object } | null | undefined;
  if (code?.parent && PublishedReturnTypeOf(code.parent)) {
    return true;
  }
  return ((fn.FormalParameters as readonly ParseNode[] | undefined) ?? []).some((p) => (p as { TypeAnnotation?: unknown }).TypeAnnotation);
}

/**
 * proposal-runtime-types (Capability B): the type parameters a generic function
 * declares, or null when it is not generic. Like the return annotation, they sit
 * on the declaration, the code node's parent.
 */
/**
 * The `where` clauses of a function's declaration, which
 * #sec-function-declarations places "between its return annotation and its
 * body" and #sec-where-clauses has checked "at each specialization once its
 * parameters are bound".
 */
export function functionWhereClauses(fn: AnnotatedFunction): readonly ParseNode[] | null {
  const code = fn.ECMAScriptCode as { parent?: { WhereClauses?: readonly ParseNode[] | null } } | null | undefined;
  const list = code?.parent?.WhereClauses;
  return list && list.length > 0 ? list : null;
}

export function functionTypeParameters(fn: AnnotatedFunction): readonly ParseNode.TypeParameter[] | null {
  const code = fn.ECMAScriptCode as { parent?: { TypeParameters?: { TypeParameterList?: readonly ParseNode.TypeParameter[] } | null } } | null | undefined;
  const list = code?.parent?.TypeParameters?.TypeParameterList;
  return list && list.length > 0 ? list : null;
}

/**
 * proposal-runtime-types (Capability B): whether a generic function's type
 * parameters can be inferred and, if so, the frame of bindings inferred from the
 * call arguments. A non-generic function returns null; the caller then does not
 * push a frame.
 */
export function* InferGenericCallBindings(fn: AnnotatedFunction, args: readonly (Value | undefined)[]): PlainEvaluator<Map<string, TypeRecord> | null> {
  const typeParameters = functionTypeParameters(fn);
  if (!typeParameters) {
    // proposal-runtime-types: a METHOD of a generic class has no type
    // parameters of its own and its signature names the CLASS's, so `m(v: T)`
    // resolved to nothing at the call and reported "T is not defined".
    //
    // Two things this has to get right, both learned by getting them wrong.
    // The walk stops at a CLASS: walking to any enclosing declaration carrying
    // type parameters caught a parameterized `primitive` block's operators and
    // broke operator declaration per parameterization. And each parameter binds
    // to `any` rather than to an opaque parameter record: at the call the
    // parameter HAS a binding, and substituting it is the specialization work -
    // an opaque parameter would resolve the name and then refuse every
    // argument, which is stricter than correct rather than looser.
    const owner = enclosingClassTypeParameters(fn.ECMAScriptCode as ParseNode | undefined);
    if (owner && owner.length > 0) {
      const frame = new Map<string, TypeRecord>();
      for (const tp of owner) {
        const name = (tp as unknown as { BindingIdentifier?: { name: string } }).BindingIdentifier?.name;
        if (name) {
          frame.set(name, anyType);
        }
      }
      return frame;
    }
    return null;
  }
  const formals = (fn.FormalParameters as readonly ParseNode[] | undefined) ?? [];
  return Q(yield* InferGenericBindings(typeParameters, formals, args.map((a) => a ?? Value.undefined)));
}

/** Converts each annotated parameter's bound value in place at entry. */
export function* EnforceParameterTypes(fn: AnnotatedFunction, env: { HasBinding(n: Value): PlainEvaluator<import('../value.mts').BooleanValue>, GetBindingValue(n: Value, s: import('../value.mts').BooleanValue): ValueEvaluator, SetMutableBinding(n: Value, v: Value, s: import('../value.mts').BooleanValue): PlainEvaluator }): PlainEvaluator {
  for (const p of (fn.FormalParameters as readonly ParseNode[] | undefined) ?? []) {
    // A rest element binds the collected trailing arguments as an array. Its
    // annotation is an array type describing the element type; checking each
    // element is the array-value runtime deferred to the memory-layout extension,
    // so the rest binding passes through here rather than being converted (which
    // would fail on the array type). Ordinary parameters below are enforced.
    if ((p as { type?: string }).type === 'BindingRestElement') {
      continue;
    }
    const sb = p as { BindingIdentifier?: { name: string }, TypeAnnotation?: ParseNode.TypeAnnotation | null, Optional?: boolean, Ref?: boolean };
    if (!sb.TypeAnnotation || !sb.BindingIdentifier) {
      continue;
    }
    // proposal-runtime-types (references extension): a ref parameter borrows
    // the caller's storage location, and its annotation was already checked
    // against the referent at binding, without conversion. Converting here
    // would write a changed value back through the borrow into the caller's
    // storage, which a borrow must never do.
    if (sb.Ref === true) {
      continue;
    }
    const name = Value(sb.BindingIdentifier.name);
    // A NON-SIMPLE parameter list - one with a default, a rest element, or a
    // destructuring pattern - binds its parameters in a separate parameter
    // environment, and FunctionDeclarationInstantiation then makes the
    // VariableEnvironment a NEW record whose outer is that one. An environment
    // record's HasBinding is not recursive, so asking the variable environment
    // found nothing and every parameter of such a function was skipped
    // SILENTLY: `f(0.1)` converted for `f(x: float32)` and did not for
    // `f(x: float32 = 0.1)`, and the same held for rest and pattern parameters.
    //
    // So walk outward for the record that actually holds the binding, which is
    // the variable environment itself when the list is simple.
    let holder: typeof env | undefined = env;
    while (holder) {
      if (Q(yield* holder.HasBinding(name)) === Value.true) {
        break;
      }
      holder = (holder as unknown as { OuterEnv?: typeof env }).OuterEnv;
    }
    if (!holder) {
      continue;
    }
    const current = Q(yield* holder.GetBindingValue(name, Value.true));
    // proposal-runtime-types: an optional parameter whose argument was omitted
    // holds undefined and is not checked against its type (README "Optional
    // Parameters": `function f(a: uint32, b?: uint32)` may be called `f(1)`). A
    // provided argument, even to an optional parameter, is still enforced.
    if (sb.Optional && current === Value.undefined) {
      continue;
    }
    const converted = Q(yield* EnforceAnnotation(sb.TypeAnnotation, current));
    Q(yield* holder.SetMutableBinding(name, converted, Value.false));
  }
  return undefined;
}

/** Applies the return annotation to a return value. */
/**
 * The value a contract's `return` denotes, for the innermost evaluation.
 *
 * PLAN-where-on-methods.md D1. #sec-checked-contracts: a contract "is VERIFIED:
 * at every concrete evaluation of the builder, once [it] has a result, each
 * clause is evaluated with `return` bound to it". The binding is a stack rather
 * than a field on the function, because a clause may CALL the builder - or
 * another one - while being checked, and the inner evaluation's `return` must
 * not displace the outer's.
 */
const contractReturnValues: Value[] = [];

export function CurrentContractReturn(): Value | undefined {
  return contractReturnValues.length === 0 ? undefined : contractReturnValues[contractReturnValues.length - 1];
}

export function PushContractReturn(value: Value): void {
  contractReturnValues.push(value);
}

export function PopContractReturn(): void {
  contractReturnValues.pop();
}

/**
 * The VERIFIED half of a checked contract.
 *
 * PLAN-where-on-methods.md D1. #sec-checked-contracts: "at every concrete
 * evaluation of the builder, once [it] has a result, each clause is evaluated
 * with `return` bound to it, and a clause that is falsy is a type error naming
 * the builder, the arguments it was given, and the clause. A contract is never
 * trusted."
 *
 * Only clauses that NAME `return` are contracts. A `where` over generic
 * parameters alone is the compile-time bound, already checked at the
 * application, and evaluating it again here would run it twice and report the
 * second failure at the wrong site.
 */
function safeDisplay(v: Value): string {
  try {
    if (v === Value.undefined || v === Value.null) {
      return String(v === Value.null ? 'null' : 'undefined');
    }
    const s2 = (v as { stringValue?: () => string }).stringValue?.();
    if (typeof s2 === 'string') {
      return JSON.stringify(s2);
    }
    const n = (v as { numberValue?: () => number }).numberValue?.();
    if (typeof n === 'number') {
      return String(n);
    }
    const t = (v as { value?: unknown }).value;
    return t === undefined ? 'a value' : String(t);
  } catch {
    return 'a value';
  }
}

/** The clause AS WRITTEN, which is the third thing the diagnostic must name. */
function clauseSourceText(clause: object): string | undefined {
  try {
    const text = sourceTextOf(clause as never);
    return typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The FACTS a builder's contract states about a deferred call of it.
 *
 * #sec-checked-contracts, the ASSUMED half: "before specialization, where the
 * application is deferred and no result exists, the checker takes each clause as
 * a known fact about the ~application~ Type Record."
 *
 * Only one clause shape carries an edge - `Reflect.isAssignable(X, return)`,
 * which states `X <: thisApplication`, the LOWER bound a generic body producing
 * the result needs (`typeprogramming.md` §6.2: "Direction is everything here,
 * and it is easy to get backwards"). A clause asserting a kind carries none and
 * yields no fact; it is verified at each evaluation instead.
 *
 * `resolveArgument` maps a clause's argument expression to a Type Record where
 * it can; the caller supplies it, because what a name means differs between the
 * checker and the evaluator.
 */
export function ContractFactsOf(
  fn: object,
  resolveArgument: (node: object) => TypeRecord | undefined,
): readonly { readonly LowerBound?: TypeRecord }[] {
  // A function OBJECT carries its clauses at `ECMAScriptCode.parent`; a
  // DECLARATION NODE carries them directly. The checker only ever has the node -
  // it never touches the realm's global - so both routes are read here rather
  // than making the caller know which it holds.
  const clauses = functionWhereClauses(fn as never)
    ?? (fn as { WhereClauses?: readonly ParseNode[] | null }).WhereClauses
    ?? null;
  if (!clauses || clauses.length === 0) {
    return [];
  }
  const facts: { readonly LowerBound?: TypeRecord }[] = [];
  for (const clause of clauses) {
    const predicate = (clause as unknown as { RefinementPredicate?: object }).RefinementPredicate;
    const call = predicate as {
      type?: string,
      CallExpression?: { MemberExpression?: unknown },
      Arguments?: readonly object[],
    } | undefined;
    if (!call || call.type !== 'CallExpression' || !Array.isArray(call.Arguments)
        || call.Arguments.length !== 2) {
      continue;
    }
    if (!calleeIsReflectIsAssignable(call)) {
      continue;
    }
    const [source, target] = call.Arguments as readonly object[];
    // The edge points from the FIRST argument to `return`, and only where the
    // second IS `return`: `isAssignable(X, return)` is a lower bound, while
    // `isAssignable(return, X)` is an upper one and is not read here.
    if ((target as { type?: string })?.type !== 'ContractReturn') {
      continue;
    }
    const lower = resolveArgument(source);
    if (lower) {
      facts.push({ LowerBound: lower });
    }
  }
  return facts;
}

function calleeIsReflectIsAssignable(call: object): boolean {
  const text = (() => {
    try {
      return sourceTextOf(call as never) ?? '';
    } catch {
      return '';
    }
  })();
  return /\bReflect\s*\.\s*isAssignable\s*\(/.test(text);
}

export function* VerifyContracts(fn: object, result: Value, args: readonly Value[] = []): ValueEvaluator {
  const clauses = functionWhereClauses(fn as never);
  if (!clauses || clauses.length === 0) {
    return Value.undefined;
  }
  for (const clause of clauses) {
    const predicate = (clause as unknown as { RefinementPredicate?: object }).RefinementPredicate;
    if (!predicate || !mentionsContractReturn(predicate)) {
      continue;
    }
    PushContractReturn(result);
    let verdict;
    try {
      verdict = Q(yield* GetValue(Q(yield* Evaluate(predicate as never))));
    } finally {
      PopContractReturn();
    }
    if (verdict === Value.false || verdict === Value.undefined || verdict === Value.null) {
      // #sec-checked-contracts: "a clause that is falsy is a type error naming
      // THE BUILDER, THE ARGUMENTS IT WAS GIVEN, AND THE CLAUSE" - three things,
      // and a different requirement from the generic bound's, which is "reported
      // against the clause's source". Reusing the bound's message named none of
      // them.
      const name = (fn as { properties?: Map<unknown, { Value?: Value }> }).properties === undefined
        ? 'the builder' : 'the builder';
      const declared = (fn as { ECMAScriptCode?: { parent?: { BindingIdentifier?: { name?: string } } } })
        .ECMAScriptCode?.parent?.BindingIdentifier?.name;
      const shown = args.length === 0 ? '()' : `(${args.map((a) => safeDisplay(a)).join(', ')})`;
      return Throw.TypeError(
        'the contract of $1 is not satisfied by $2: $3',
        Value(declared ?? name),
        Value(shown),
        Value(clauseSourceText(clause as object) ?? 'the clause'),
      );
    }
  }
  return Value.undefined;
}

function mentionsContractReturn(node: object, seen = new Set<object>()): boolean {
  if (!node || typeof node !== 'object' || seen.has(node)) {
    return false;
  }
  seen.add(node);
  if ((node as { type?: string }).type === 'ContractReturn') {
    return true;
  }
  // Own enumerable keys only, and read through a guard: a Parse Node carries
  // accessors - `source` among them - that throw when read outside the context
  // that defined them, and Object.values reads every one.
  for (const key of Object.keys(node)) {
    let value;
    try {
      value = (node as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.some((v) => mentionsContractReturn(v as object, seen))) {
        return true;
      }
    } else if (value && typeof value === 'object' && mentionsContractReturn(value as object, seen)) {
      return true;
    }
  }
  return false;
}

export function* EnforceReturnType(fn: AnnotatedFunction, value: Value): ValueEvaluator {
  // An IMPLICIT CAST's declared type names what its result BECOMES, not a
  // boundary its body must already satisfy: the body computes a raw value -
  // `return this;` is the whole of the usual one - and the crossing is what the
  // cast supplies. Enforcing the annotation here would make the body's return
  // re-enter the very conversion it defines, which is the raw-body rule's
  // subject: "an operator body evaluates on raw values".
  // #sec-primitive-operator-blocks: "The metadata of a result comes from the
  // RETURN TYPE ANNOTATIONS ALONE." So an operator declared by a primitive
  // block - a cast or an ordinary operator - has an annotation that says what
  // its result CARRIES, not a boundary its body must satisfy. The body
  // evaluates on raw values, which is the raw-body rule, and the dispatch
  // stamps the result with the annotation's type afterwards.
  //
  // Enforcing it here fails twice over: it re-enters the crossing a cast
  // defines, and for a PARAMETERIZED block it resolves the block's type
  // parameter outside the frame that binds it, so `float64.<D>` raises
  // "D is not defined" from inside the body of the operator that declared it.
  // The narrower IsImplicitCast test this replaces covered only the first.
  if ((fn as { IsPrimitiveOperator?: boolean }).IsPrimitiveOperator === true) {
    return value;
  }
  const annotation = returnAnnotationOf(fn);
  if (!annotation) {
    // #sec-inferred-return-types: a function that declares no return type may
    // PUBLISH one, and the check-site table treats the two alike. Without this
    // the published type is a claim nothing verifies: the checker hands it to
    // every caller and no boundary ever tests that the value leaving the
    // function is of it.
    const code = fn.ECMAScriptCode as { parent?: object } | null | undefined;
    const published = code?.parent ? PublishedReturnTypeOf(code.parent) : undefined;
    if (published && published.Kind !== 'void') {
      // `void` is vacuous here for the reason #sec-void-type gives for a
      // declared one: it constrains the consumer, not the value leaving.
      return Q(yield* CheckedConvertValue(value, published));
    }
    return value;
  }
  // proposal-runtime-types #sec-void-type: "A call of a function whose return
  // type is `void` evaluates to *undefined*, as a call of a function with no
  // `return` statement does today. The `void` type is the statement that a
  // program must not depend on that result, not a claim that no result exists."
  // A `void` annotation therefore constrains the CONSUMER (no binding may hold
  // the result), not the value leaving the function: checking *undefined*
  // against a type with no values made `function f(): void { return; }` a
  // TypeError while the identical `function f(): void { }` passed, which is the
  // same function written two ways.
  const annotationRecord = Q(yield* TypeNodeToTypeRecord(annotation.Type));
  if (annotationRecord.Kind === 'void') {
    return value;
  }
  return Q(yield* EnforceAnnotation(annotation, value));
}

/**
 * proposal-runtime-types (standardlibrary.md and temporal.md): the runtime half
 * of a typed signature on a built-in function. Where a built-in's signature gives
 * it a value-type return, this wraps its native steps so the result is carried at
 * that value type, through the same checked conversion a typed binding uses (so
 * `Temporal.Instant.compare` returns an int32 rather than a plain number). With
 * the feature off, or when the type name does not resolve, the wrapper returns the
 * built-in's own result unchanged, so a program that does not use the type system
 * sees the built-in exactly as before. This covers a fixed value-type return only;
 * the generic, element-type-flowing signatures of standardlibrary.md (a mapped
 * result's element type, a callback's inferred parameter) are compile-time and are
 * not part of this.
 */
export function withValueTypeReturn(steps: NativeSteps, typeName: string): NativeSteps {
  const wrapped: NativeSteps = function* withValueTypeReturn(this: ThisParameterType<NativeSteps>, args: Arguments, context: FunctionCallContext) {
    let result = steps.call(this, args, context);
    if (isEvaluator(result)) {
      result = yield* result;
    }
    if (!surroundingAgent.feature('runtime-types')) {
      return result;
    }
    const record = builtinTypeRecord(typeName);
    if (record === null) {
      return result;
    }
    const value = Q(result);
    if (!value) {
      return value;
    }
    return Q(yield* CheckedConvertValue(value, record));
  };
  return wrapped;
}

// proposal-runtime-types M21: class Type Objects. Each class constructor is
// associated at definition with the interned nominal Type Object of its class
// type; a type reference to the class name resolves to it, and membership uses
// the stored constructor directly.
/**
 * proposal-runtime-types #sec-enums: the enum an identity-compared value has
 * been claimed by, as its enumerator.
 *
 * A symbol, a class instance, and a function are compared by IDENTITY, so an
 * enumerator of an enum over one of them IS the value the program wrote - which
 * is what keeps `A.X === k`, `A.X.v`, and `A.X instanceof K` true, and is also
 * why the enum cannot be carried ON the value: one object, two enums, one slot.
 * Wrapping would carry it at the cost of every one of those three.
 *
 * So the claim is recorded here instead, outside the value, and a value may be
 * claimed by at most one enum - see the refusal at the declaration. Without that
 * rule `Reflect.typeOf` would have no single answer for a doubly-claimed value,
 * which #sec-value-types requires it to have.
 */
/**
 * The table lives on the AGENT - see Agent.enumeratorClaims for the scope and
 * why it is that one. It was a module-level table here, which made it per
 * PROCESS: a claim on a value the engine shares across realms, a well-known
 * symbol being the reachable case, refused the same declaration in every other
 * realm and agent, so two unrelated embeddings interfered.
 */
function claimTable(): WeakMap<object, unknown> | undefined {
  // RuntimeTypeOf is reachable from host code, where there may be no agent yet.
  // "Unclaimed" is the answer then, rather than a throw.
  return surroundingAgent?.enumeratorClaims;
}

/**
 * Records _t_ as the enum of _value_, and returns the enum that already claimed
 * it, if any. Re-claiming for the SAME enum is not a conflict: two enumerators
 * of one declaration may share a value, as they already may for any other
 * underlying type.
 */
export function ClaimEnumerator(value: Value, t: TypeRecord): TypeRecord | undefined {
  const table = claimTable();
  if (table === undefined) {
    return undefined;
  }
  const key = value as unknown as object;
  const existing = table.get(key);
  if (existing !== undefined) {
    return existing as TypeRecord;
  }
  table.set(key, t);
  return undefined;
}

/** The enum that claimed _value_ as an enumerator, or undefined. */
export function RegisteredEnumOf(value: Value): TypeRecord | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const table = claimTable();
  return table?.get(value as unknown as object) as TypeRecord | undefined;
}

const classTypeObjects = new WeakMap<object, Value>();

export function AssociateClassType(ctor: object, typeObject: Value): void {
  classTypeObjects.set(ctor, typeObject);
}

export function LookupClassType(ctor: object): Value | undefined {
  return classTypeObjects.get(ctor);
}

/**
 * Builds the signature of one concrete function declaration for overload
 * resolution: its parameter descriptions, with each annotated type resolved now
 * (annotation evaluation is deferred, so it is done here at declaration time and
 * the resolved types are read synchronously at each call). The rest/optional/
 * default arity is read from the parameter nodes.
 */
export function* OverloadSignatureOf(fn: Value, resolveAnnotations = true): PlainEvaluator<OverloadSignature> {
  const formals = ((fn as AnnotatedFunction).FormalParameters as readonly ParseNode[] | undefined) ?? [];
  // Resolve each parameter's annotation to a type record up front. describeParameters
  // wants a synchronous typeOf, so pre-resolve into a map keyed by node.
  //
  // With _resolveAnnotations_ false the annotations are recorded but NOT
  // resolved: the caller wants only what the parameter nodes say - arity, rest,
  // and optional, all syntactic - and resolving reads type bindings that are not
  // initialized yet. See MakeOverloadedFunction.
  const resolved = new Map<ParseNode, TypeRecord>();
  for (const p of formals) {
    const ann = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
    if (ann) {
      if (resolveAnnotations) {
        resolved.set(p, Q(yield* TypeNodeToTypeRecord(ann.Type)));
      } else {
        resolved.set(p, { Kind: 'any' } as TypeRecord);
      }
    }
  }
  const params = describeParameters(formals, (annotation) => {
    for (const [node, rec] of resolved) {
      if ((node as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation === annotation) {
        return rec;
      }
    }
    return resolved.values().next().value ?? ({ Kind: 'any' } as TypeRecord);
  });
  // [[Untyped]]: no parameter annotation and no return annotation anywhere.
  const untyped = resolved.size === 0
    && !((fn as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation);
  // #sec-overloading-on-return-type: the signature carries its return type so
  // the resolver can FILTER on it after ranking. The function's own
  // TypeAnnotation is its return annotation - the same one `untyped` above
  // consults to decide whether the signature is a catch-all.
  // Through returnAnnotationOf, which reaches it via ECMAScriptCode.parent. The
  // annotation is on the function's PARSE NODE and not on the function object -
  // reading `fn.TypeAnnotation` finds nothing, which is why the first attempt
  // at this produced signatures with no return type at all.
  let returnAnnotation: ReturnType<typeof returnAnnotationOf> | null = null;
  if (resolveAnnotations) {
    returnAnnotation = returnAnnotationOf(fn as AnnotatedFunction);
  }
  let ReturnType: TypeRecord | undefined;
  if (returnAnnotation) {
    // Resolved directly rather than looked up in `resolved`, which is keyed on
    // the FORMALS alone - the return annotation is never in it, so the lookup
    // this replaced could not have found anything.
    ReturnType = Q(yield* TypeNodeToTypeRecord(returnAnnotation.Type));
  }
  return {
    Parameters: params, Function: fn, Untyped: untyped, ReturnType,
  };
}

/**
 * Given the concrete function objects declared under one name, in declaration
 * order, returns a single function object that performs overload resolution at the
 * call site. Its `length` is the smallest minimum arity among the signatures and
 * its `name` is the shared name; a call resolves the arguments to one signature
 * and calls that signature's function, throwing a TypeError where no signature is
 * viable or more than one is equally best. Because the result is an ordinary
 * function object, `call`, `apply`, and `bind` route through the same resolution.
 */
interface DeclaringContext {
  readonly LexicalEnvironment: unknown;
  readonly VariableEnvironment: unknown;
  readonly PrivateEnvironment: unknown;
  readonly Realm: unknown;
  readonly ScriptOrModule: unknown;
}

interface OverloadSlots {
  OverloadSignatures?: readonly OverloadSignature[];
  OverloadFunctions?: readonly Value[];
  OverloadContext?: DeclaringContext;
}

/**
 * The signatures of an overloaded function, resolved on FIRST USE and against
 * the environment the declarations were written in.
 *
 * Resolving at hoist time - which is where this used to happen - reads a `type`,
 * `interface`, or `enum` binding while it is still in the temporal dead zone,
 * since hoisting runs before any statement that initializes one. Every
 * user-declared type but a class was therefore unusable in an overloaded
 * signature, a class surviving only because its annotation resolves through
 * LookupClassType rather than through the binding.
 *
 * Deferring alone is not enough: the dispatcher is a BUILTIN, and a builtin has
 * no lexical environment for a named type to resolve against - the same thing
 * F51 recorded for a default constructor's field types. So the declaring
 * context is captured when the overloaded function is made and pushed around the
 * resolution, which makes a name resolve exactly as it would have where it was
 * written, only later. The result is cached: the types a signature names do not
 * change.
 */
export function* SignaturesOf(overloaded: Value): PlainEvaluator<readonly OverloadSignature[]> {
  const slots = overloaded as unknown as OverloadSlots;
  if (slots.OverloadSignatures) {
    return slots.OverloadSignatures;
  }
  const declaring = slots.OverloadContext;
  const context = new ExecutionContext();
  context.Function = Value.null;
  context.Realm = declaring?.Realm as never;
  context.ScriptOrModule = declaring?.ScriptOrModule as never;
  context.LexicalEnvironment = declaring?.LexicalEnvironment as never;
  context.VariableEnvironment = declaring?.VariableEnvironment as never;
  context.PrivateEnvironment = declaring?.PrivateEnvironment as never;
  surroundingAgent.executionContextStack.push(context);
  try {
    const built: OverloadSignature[] = [];
    for (const fn of slots.OverloadFunctions ?? []) {
      built.push(Q(yield* OverloadSignatureOf(fn)));
    }
    slots.OverloadSignatures = built;
    return built;
  } finally {
    surroundingAgent.executionContextStack.pop(context);
  }
}

export function* MakeOverloadedFunction(name: JSStringValue, functions: readonly Value[]): ValueEvaluator {
  // Only the parameter NODES are read here: `length` is the smallest arity among
  // the signatures, and arity, rest, and optional are syntactic. The types wait
  // for SignaturesOf, which resolves them against the context captured below.
  let length = Infinity;
  for (const fn of functions) {
    const shape = Q(yield* OverloadSignatureOf(fn, false));
    length = Math.min(length, minimumArity(shape.Parameters));
  }
  const declaringContext = surroundingAgent.runningExecutionContext;
  const declaring: DeclaringContext = {
    LexicalEnvironment: declaringContext.LexicalEnvironment,
    VariableEnvironment: declaringContext.VariableEnvironment,
    PrivateEnvironment: declaringContext.PrivateEnvironment,
    Realm: declaringContext.Realm,
    ScriptOrModule: declaringContext.ScriptOrModule,
  };
  if (!Number.isFinite(length)) {
    length = 0;
  }
  const behaviour = function* overloadDispatch(args: readonly Value[], context: { thisValue: Value }): ValueEvaluator {
    // #sec-overloading-on-return-type: the contextual type filters what ranking
    // left tied. It is read here rather than passed down from the binding,
    // because a binding boundary sees the RESULT - by then the overload has
    // been chosen and the wrong one may already have run.
    const signatures = Q(yield* SignaturesOf(overloaded));
    const resolution = resolveOverload(signatures, args, currentContextualType());
    if (resolution.Kind === 'none') {
      return Throw.TypeError('no overload of $1 matches these arguments', name);
    }
    if (resolution.Kind === 'ambiguous') {
          return Throw.TypeError('the call to $1 is ambiguous between overloads', name);
    }
    return EnsureCompletion(Q(yield* Call(resolution.Signature.Function, context.thisValue, args as Value[])));
  };
  const overloaded = CreateBuiltinFunction(behaviour as never, length, name, []);
  // The signatures are readable from the dispatcher, because a DECORATION binds
  // its context to each candidate's LAST PARAMETER and so has to see them
  // before resolution rather than after (DecoratorArgumentPlacement below).
  const slots = overloaded as unknown as OverloadSlots;
  slots.OverloadFunctions = functions;
  slots.OverloadContext = declaring;
  return overloaded;
}

/**
 * proposal-runtime-types #sec-decorator-application: the argument list a
 * DECORATION calls its decorator with, for one candidate signature.
 *
 * A decoration does not append its context to the arguments; it binds the
 * context to the signature's LAST PARAMETER - "a decorator is an ordinary
 * function whose LAST PARAMETER is annotated with a reflection context" - and
 * the written arguments fill from the front. A parameter left between them
 * takes its own default, which is what makes the clause's preference rule
 * sayable at all: "a signature taking the context alone is PREFERRED over one
 * whose remaining parameters are SATISFIED BY DEFAULTS" describes a signature
 * that is a candidate for a bare `@f` while having parameters before the
 * context.
 *
 * A REST parameter in last position absorbs the context as its final element,
 * which is the same rule read on a signature whose last parameter happens to
 * take many: `@f(1, 2)` on `f(...all)` gives `[1, 2, context]`, and `@f` on
 * `f(n = 5, ...rest)` gives `n` its default and `rest` the context alone.
 *
 * Returns the placed arguments and how many defaults it had to reach past, or
 * null where the signature cannot take this decoration at all - a gap it would
 * have to leave at a parameter with no default.
 */
export function DecoratorArgumentPlacement(parameters: readonly OverloadParameter[], written: readonly Value[], context: Value): { Arguments: Value[], Gaps: readonly number[] } | null {
  const last = parameters.length - 1;
  // Where the context lands: the last parameter's position, or - for a rest -
  // one past the arguments already written into it.
  const restLast = last >= 0 && parameters[last]!.Rest;
  const contextAt = restLast
    ? Math.max(written.length, last)
    : Math.max(written.length, last < 0 ? 0 : last);
  const args: Value[] = [];
  const gaps: number[] = [];
  for (let i = 0; i < contextAt; i += 1) {
    if (i < written.length) {
      args.push(written[i]!);
      continue;
    }
    // A gap. Only a parameter that can supply its own value may be skipped, and
    // the argument passed for it is `undefined` - which is what makes the
    // callee's own default run, exactly as `f(undefined)` does in an ordinary
    // call. The positions are carried so the type judgment below can tell a gap
    // from a written `undefined`.
    const p = parameters[i];
    if (!p || !p.Optional) {
      return null;
    }
    gaps.push(i);
    args.push(Value.undefined);
  }
  args.push(context);
  return { Arguments: args, Gaps: gaps };
}

/**
 * proposal-runtime-types #sec-decorator-application: call a decorator with the
 * written arguments and the context, selecting among the decorator's
 * declarations "the way any call does" but with the context bound to each
 * candidate's last parameter first.
 *
 * The ranking is the clause's own, and it is why this cannot simply hand a flat
 * argument list to the ordinary dispatcher: FEWER DEFAULTS WINS, so a signature
 * taking the context alone beats one that reaches past a default to it, and two
 * signatures reaching past the same number of defaults are AMBIGUOUS - "two
 * signatures satisfied only by defaults is a TypeError at the decorated
 * declaration". Within one number of defaults the ordinary tier ranking decides,
 * so the type rules stay in one place (F53).
 */
export function* CallDecorator(fn: Value, written: readonly Value[], context: Value): ValueEvaluator {
  const declared = (fn as unknown as OverloadSlots).OverloadFunctions !== undefined;
  let signatures: readonly OverloadSignature[];
  if (declared) {
    signatures = Q(yield* SignaturesOf(fn));
  } else {
    signatures = [Q(yield* OverloadSignatureOf(fn))];
  }
  const placed: { sig: OverloadSignature, args: Value[], defaulted: number }[] = [];
  for (const sig of signatures) {
    // An untyped signature has nothing to place against and nothing to judge:
    // it is the catch-all, and it takes the flat list.
    const placement = sig.Untyped
      ? { Arguments: [...written, context], Gaps: [] as readonly number[] }
      : DecoratorArgumentPlacement(sig.Parameters, written, context);
    if (!placement) {
      continue;
    }
    if (!sig.Untyped) {
      // Judged over TYPES rather than values, because a gap has no value to
      // type: a position the callee's own default will fill is satisfied by
      // construction, so it contributes the PARAMETER'S type. Typing the gap as
      // `undefined` instead would make every defaulted signature non-viable,
      // which is the whole case this cycle exists to admit.
      const argumentTypes = placement.Arguments.map((value, i) => (
        placement.Gaps.includes(i) ? (sig.Parameters[i]?.Type ?? ({ Kind: 'any' } as TypeRecord)) : RuntimeTypeOf(value)
      ));
      if (resolveOverloadByTypes([sig], argumentTypes).Kind !== 'resolved') {
        continue;
      }
    }
    placed.push({ sig, args: placement.Arguments, defaulted: placement.Gaps.length });
  }
  if (placed.length === 0) {
    // No candidate: fall back to the flat call so that the ordinary machinery
    // reports the mismatch in its own words, and so that a callee this
    // operation cannot describe (a builtin, a bound function) still runs.
    return EnsureCompletion(Q(yield* Call(fn, Value.undefined, [...written, context] as Value[])));
  }
  let best = placed[0]!;
  for (const candidate of placed) {
    if (candidate.defaulted < best.defaulted) {
      best = candidate;
    }
  }
  const tied = placed.filter((c) => c.defaulted === best.defaulted);
  if (tied.length > 1) {
    return Throw.TypeError('the call is ambiguous between two declared signatures');
  }
  const target = declared ? best.sig.Function : fn;
  return EnsureCompletion(Q(yield* Call(target, Value.undefined, best.args)));
}

/**
 * A function-like declaration whose name may be one of several overloads.
 */
interface OverloadableDeclaration { readonly type: string; }

/**
 * From a list of declarations, the names that have more than one plain function
 * declaration (`function f`), each typed, in declaration order. These are the
 * names that resolve to an overloaded function; a name with a single declaration,
 * or whose declarations are generators or async functions, is left to bind
 * ordinarily. Returns a Map from name to the declarations in source order.
 */
export function collectOverloadGroups(declarations: readonly OverloadableDeclaration[], boundName: (d: OverloadableDeclaration) => string): Map<string, OverloadableDeclaration[]> {
  const byName = new Map<string, OverloadableDeclaration[]>();
  for (const d of declarations) {
    if (d.type !== 'FunctionDeclaration') {
      continue;
    }
    const name = boundName(d);
    const list = byName.get(name);
    if (list) {
      list.push(d);
    } else {
      byName.set(name, [d]);
    }
  }
  for (const [name, list] of [...byName]) {
    if (list.length < 2) {
      byName.delete(name);
    }
  }
  return byName;
}

/**
 * A comparable map key for a field's property key. A String key uses its string
 * value and a Symbol key uses the Symbol itself, so a readonly field is found by
 * the same key whether it is written as a String or a Symbol.
 */
export function readonlyFieldKey(key: import('../value.mts').PropertyKeyValue): unknown {
  return key instanceof JSStringValue ? key.stringValue() : key;
}

/**
 * Whether a write of property `key` on `receiver` is a forbidden assignment to a
 * `readonly` field. A readonly field, recorded on the instance with the
 * constructor that declares it (spec sec-typed-classes), may be assigned only in
 * its own initializer and in a body of that declaring constructor. The write is
 * permitted exactly when the function currently running is the declaring
 * constructor, so an assignment from a method the constructor calls, from a
 * subclass, through a reference, or through reflection is forbidden. Returns true
 * when the write must be rejected.
 */
export function IsForbiddenReadonlyWrite(receiver: Value, key: import('../value.mts').PropertyKeyValue): boolean {
  const map = (receiver as { ReadonlyFields?: Map<unknown, unknown> }).ReadonlyFields;
  if (map === undefined) {
    return false;
  }
  const declaringConstructor = map.get(readonlyFieldKey(key));
  if (declaringConstructor === undefined) {
    return false;
  }
  const running = surroundingAgent.executionContextStack.at(-1)?.Function;
  return running !== declaringConstructor;
}

/**
 * proposal-runtime-types #sec-primitive-operator-blocks: "the portions the
 * matching return types evaluate to are merged into one flat metadata object,
 * EACH META TYPE CONTRIBUTING ITS `default` WHERE NO MATCHING DEFINITION
 * MENTIONS IT."
 *
 * That last clause is the whole of why a merge exists rather than a
 * pass-through. A block constrained by one meta type speaks only for that meta
 * type; every other governing meta type falls back to its default, "which is
 * the correct answer for a constraint that the operation does not preserve".
 * Carrying the receiver's other portions through instead would silently keep a
 * bound the operation may have invalidated.
 */
export function MergeOperatorResultMetadata(
  contributed: readonly { metaType: object, portion: MetadataRecord }[],
  governing: readonly object[],
): MetadataRecord {
  const merged: Record<string, unknown> = Object.create(null);
  const said = new Set<object>();
  for (const { metaType, portion } of contributed) {
    said.add(metaType);
    if (portion && typeof portion === 'object') {
      for (const key of Object.keys(portion as unknown as Record<string, unknown>)) {
        merged[key] = (portion as unknown as Record<string, unknown>)[key];
      }
    }
  }
  for (const metaType of governing) {
    if (said.has(metaType)) {
      continue;
    }
    const dflt = LookupMetaDefaultSnapshot(metaType);
    if (dflt && typeof dflt === 'object') {
      for (const key of Object.keys(dflt as unknown as Record<string, unknown>)) {
        merged[key] = (dflt as unknown as Record<string, unknown>)[key];
      }
    }
  }
  return Object.freeze(merged) as unknown as MetadataRecord;
}

/**
 * The meta type a block parameter's constraint names, or *undefined* where the
 * constraint is not a meta type. A meta type is identified by its interned Type
 * Object, which is what the claim registry and the hooks are keyed on.
 */
export function MetaTypeForConstraint(constraint: TypeRecord): object | undefined {
  const typeObject = GetTypeObject(constraint) as unknown as object;
  return LookupMetaTypeName(typeObject) === undefined ? undefined : typeObject;
}


/**
 * The type parameters of the nearest enclosing CLASS, or undefined.
 *
 * Stops at a class deliberately. Any declaration may carry type parameters -
 * a `primitive` block's operators among them - and binding those would change
 * what an operator declaration means.
 */
function enclosingClassTypeParameters(node: ParseNode | undefined): readonly ParseNode[] | undefined {
  let n = node;
  while (n) {
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
      return (n as unknown as { TypeParameters?: { TypeParameterList?: readonly ParseNode[] } })
        .TypeParameters?.TypeParameterList;
    }
    n = (n as unknown as { parent?: ParseNode }).parent;
  }
  return undefined;
}

/**
 * The parameter types of a callee that has exactly one signature, or null.
 *
 * proposal-runtime-types #sec-overloading-on-return-type: an argument position
 * takes its contextual type from the callee's parameter. Where the callee is
 * itself overloaded there is no single parameter to take it from, and the
 * clause resolves that circularity by REJECTING rather than guessing - so this
 * answers null and the inner call reports its own ambiguity.
 */
export function* soleSignatureParameterTypes(func: Value): PlainEvaluator<(TypeRecord | null)[] | null> {
  // Only the COUNT is wanted here - "sole" means one declaration - and that is
  // the number of functions the overload group was made from, which is known
  // without resolving any annotation.
  const overloadFns = (func as unknown as OverloadSlots).OverloadFunctions;
  if (overloadFns && overloadFns.length !== 1) {
    return null;
  }
  const formals = ((func as AnnotatedFunction).FormalParameters as readonly ParseNode[] | undefined);
  if (!formals || formals.length === 0) {
    return null;
  }
  const types: (TypeRecord | null)[] = [];
  for (const p of formals) {
    const ann = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
    if (!ann) {
      types.push(null);
      continue;
    }
    // Resolved WITHOUT propagating a failure. A generic function's parameter
    // annotation names a type parameter that is not bound until the call binds
    // it, so resolving `T` here reports "T is not defined" - and that error
    // must not escape, because this operation is offering a contextual type and
    // not checking anything. A first attempt let it propagate and turned every
    // generic call into an error.
    const attempted = EnsureCompletion(yield* TypeNodeToTypeRecord(ann.Type));
    if (attempted.Type !== 'normal') {
      types.push(null);
      continue;
    }
    const record = attempted.Value as TypeRecord;
    // Only a CONCRETE parameter type supplies a contextual type. A type
    // PARAMETER is what a generic call is about to infer, and offering it as
    // context changes what the inference sees - a first attempt at this pushed
    // every parameter type and broke ten generic-inference tests. A parameter
    // whose type is still open contributes nothing, which is the same answer
    // the circularity rule gives for an overloaded callee: no context rather
    // than a guessed one.
    types.push(record.Kind === 'parameter' ? null : record);
  }
  return types;
}

/**
 * The Type Record of a function's return annotation, or null where it has none
 * or the annotation cannot be resolved yet.
 *
 * proposal-runtime-types #sec-overloading-on-return-type: a `return` position
 * requires the enclosing function's return type, so this is what a body's
 * contextual type is. It answers null rather than failing for the reason the
 * argument position does - offering a contextual type is not checking one, and
 * a generic function's annotation names a parameter that is not bound yet.
 */
export function* returnTypeRecordOf(fn: Value): PlainEvaluator<TypeRecord | null> {
  const annotation = returnAnnotationOf(fn as AnnotatedFunction);
  if (!annotation) {
    // A CONCISE arrow body never produces a `return` completion, so the return
    // boundary of one is not EnforceReturnType but the contextual type pushed
    // around its body - which is read from here. A published inferred type has
    // to be visible at this point too, or `() => f()` enforces nothing while
    // `() => { return f(); }` enforces, which is the same function written two
    // ways (#sec-inferred-return-types).
    const code = (fn as AnnotatedFunction).ECMAScriptCode as { parent?: object } | null | undefined;
    const published = code?.parent ? PublishedReturnTypeOf(code.parent) : undefined;
    return published && published.Kind !== 'void' && published.Kind !== 'parameter' ? published : null;
  }
  const attempted = EnsureCompletion(yield* TypeNodeToTypeRecord(annotation.Type));
  if (attempted.Type !== 'normal') {
    return null;
  }
  const record = attempted.Value as TypeRecord;
  return record.Kind === 'parameter' ? null : record;
}
