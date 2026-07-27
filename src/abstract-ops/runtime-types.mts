import { Q, X, EnsureCompletion, isEvaluator } from '../completion.mts';
import { ConsumeEvaluationSteps, IsBudgetExhausted } from '../type-system/budget.mts';
import { NumberValue, SymbolValue, TypedNumberValue, isTypedNumber, JSStringValue, TypedStringValue, TypedString, Value, ObjectValue, BigIntValue, BooleanValue, type NativeSteps, type Arguments, type FunctionCallContext } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsCheckElided } from '../type-system/check.mts';
import { displayType, builtinTypeRecord, type TypeRecord, propertyKeyValue } from '../type-system/records.mts';
import { SameMetadata, SameType } from '../type-system/relations.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { isFloatTypeName } from '../type-system/numeric-signatures.mts';
import { fitsNumericType, IsOfType, TypeNodeToTypeRecord, InferGenericBindings } from '../type-system/runtime.mts';
import { describeParameters, minimumArity, resolveOverload, type OverloadSignature } from '../type-system/overloads.mts';
import {
  Call, R, Throw, ToNumber, ToString, ToBoolean, CreateBuiltinFunction, surroundingAgent, Get, HasProperty, Set as SetProperty, IsArray, ArrayCreate, CreateDataPropertyOrThrow, OrdinaryObjectCreate, RegExpCreate,
} from '#self';

/**
 * proposal-runtime-types: the run-time enforcement operations. RequireType is
 * the check inserted at the ~any~ boundary of the gradual system, and
 * ConvertValue is the conversion rule applied by `:=`.
 */

/**
 * proposal-runtime-types (Capability B): when a String value is given a literal
 * (or otherwise refined) string type at a typed boundary, carry that type on the
 * value so RuntimeTypeOf reports it rather than the widened `string`. Returns a
 * TypedStringValue carrying `t` when `t` narrows `string` and `value` is a plain
 * string; otherwise returns `value` unchanged. A value already carrying the same
 * type, or a non-string, is returned as-is.
 */
function carryStringType(value: Value, t: TypeRecord): Value {
  if (!(value instanceof JSStringValue) || value instanceof TypedStringValue) {
    return value;
  }
  // A literal type whose base is `string`, i.e. a specific string value's type.
  if (t.Kind === 'literal' && t.Value instanceof JSStringValue) {
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
export function* RequireType(value: Value, t: TypeRecord): ValueEvaluator {
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

export function* ConvertValue(value: Value, t: TypeRecord): ValueEvaluator {
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
      (value as { TypedElement?: TypeRecord }).TypedElement = t.Element;
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
      (value as { TypedCollection?: readonly (TypeRecord | number)[] }).TypedCollection = t.Arguments;
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
    if (!Q(yield* IsOfType(atBase, t))) {
      return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
    }
    return isTypedNumber(atBase) ? new TypedNumberValue(atBase.value, t) : atBase;
  }
  if (t.Kind === 'union') {
    for (const m of t.Members) {
      const attempt = EnsureCompletion(yield* ConvertValue(value, m));
      if (attempt.Type === 'normal') {
        return attempt.Value;
      }
    }
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  if (t.Kind === 'primitive') {
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
export function* CheckedConvertValue(value: Value, t: TypeRecord): ValueEvaluator {
  // The crossing between two parameterizations gates and scales here exactly as
  // at the cast: the checked rule differs from ConvertValue only in what a
  // LOSSY numeric conversion does, and a crossing is a conversion, not a loss.
  if (isTypedNumber(value) && (value.TypeRecord as TypeRecord).Kind === 'parameterized') {
    const carried = value.TypeRecord as TypeRecord & { Kind: 'parameterized' };
    if (t.Kind === 'parameterized' && SameType(carried.Base, t.Base) && !SameType(carried, t)) {
      return Q(yield* ConvertParameterization(value, carried, t));
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
      (value as { TypedElement?: TypeRecord }).TypedElement = t.Element;
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
      (value as { TypedCollection?: readonly (TypeRecord | number)[] }).TypedCollection = t.Arguments;
    }
    // proposal-runtime-types (Capability B): even when the value already
    // satisfies the type, a literal string type is carried on the value.
    return carryStringType(value, t);
  }
  if (t.Kind === 'union') {
    for (const m of t.Members) {
      const attempt = EnsureCompletion(yield* CheckedConvertValue(value, m));
      if (attempt.Type === 'normal') {
        return attempt.Value;
      }
    }
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  if (t.Kind === 'primitive') {
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
        if (!isNumberConversionSource(value)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return Q(yield* ToNumber(value));
      case 'boolean':
        return ToBoolean(value);
      case 'bigint': {
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
        if (Number.isFinite(math) && !Number.isFinite(converted)) {
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
        Q(yield* SetProperty(value, key, converted, Value.true));
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
  if (t.Kind === 'array') {
    // proposal-runtime-types (spec sec-contextual-types, README "Typed Array
    // Propagation"): a plain array in a `[].<T>` position propagates the element
    // type. Each element is converted to the element type by the same checked
    // conversion, so `let a: [].<uint8> = [1, 2, 3]` yields an array whose elements
    // are uint8 values and whose stores wrap. A fixed extent must match the length.
    if (value instanceof ObjectValue) {
      const isArr = Q(IsArray(value));
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
        (out as { TypedElement?: TypeRecord }).TypedElement = t.Element;
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
  (globalThis as { __k?: string[] }).__k?.push(`entered size=${tables.size}`);
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
  (globalThis as { __k?: string[] }).__k?.push(`lookup name=${name} op=${opText} tables=${[...tables.keys()].join(",")} hit=${!!tables.get(name)?.get(opText)}`);
  return tables.get(name)?.get(opText) ?? null;
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
export function MetaTypeGoverns(metadata: Value, metaType: object): boolean {
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
 * A meta type's own description of a portion, where it defines `describe`.
 * The clause asks for it in both failure messages, and the hook has been
 * declarable since cycle 37 with no consumer at all: the engine threw its
 * generic "$1 is not assignable to $2" and never called it (F62).
 */
export function* DescribePortion(metaType: object, portion: Value): PlainEvaluator<string | undefined> {
  if (metaHooks.get(metaType)?.get('describe') === undefined) {
    return undefined;
  }
  const described = Q(yield* ApplyMetaHook(metaType, 'describe', [portion]));
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

/**
 * The meta types governing a metadata value: one per own key, deduplicated. A key
 * no meta type claims is reported by the caller, since the specification places
 * that error at the parameterization rather than here.
 */
export function GoverningMetaTypes(metadata: Value): { types: object[], unclaimed: string[] } {
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
export function MetadataPortion(metadata: Value, metaType: object): Value {
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
  return Object.freeze(portion) as unknown as Value;
}

/** Apply a named hook of a meta type, or *undefined* where it defines none. */
export function* ApplyMetaHook(typeObject: object, name: string, args: readonly Value[]): PlainEvaluator<Value | undefined> {
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
  return Q(yield* Call(fn as never, Value.undefined, args.map((a) => MetadataAsObject(a))));
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
/** The membership judgment over a cast's result, which a cast does not bypass. */
export function* RequireTypeAfterCast(value: Value, t: TypeRecord): ValueEvaluator {
  const ok = Q(yield* IsOfType(value, t));
  if (ok) {
    return value;
  }
  return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
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
    const admits = Q(yield* ApplyMetaHook(metaType, 'subtype', [fp, tp]));
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
    ]));
    if (f !== undefined && f instanceof NumberValue) {
      factor *= R(f) as number;
    }
  }
  let converted = value;
  if (factor !== 1 && (converted instanceof NumberValue || isTypedNumber(converted))) {
    const scaled = (isTypedNumber(converted) ? converted.value : (R(converted as NumberValue) as number)) * factor;
    converted = new TypedNumberValue(wrapToType(scaled, to.Base), to.Base);
  }
  for (const metaType of quantizing) {
    const q = Q(yield* ApplyMetaHook(metaType, 'quantize', [
      converted,
      MetadataPortion(to.Metadata, metaType),
    ]));
    if (q !== undefined) {
      converted = q;
    }
  }
  // The result is a value of the target parameterization and CARRIES it, so a
  // chained crossing still has a `from` to gate on and `is` sees the
  // parameterization; membership treats the carried record as its base (the
  // branding rule), so the value is a value of the base everywhere the base is
  // asked for.
  if (converted instanceof NumberValue) {
    converted = new TypedNumberValue(R(converted) as number, to);
  } else if (isTypedNumber(converted)) {
    converted = new TypedNumberValue(converted.value, to);
  }
  return converted;
}

export function* ApplyValidateHook(typeObject: object, value: Value, metadata: Value): PlainEvaluator<boolean | undefined> {
  const fn = metaHooks.get(typeObject)?.get('validate');
  if (!fn) {
    return undefined;
  }
  const result = Q(yield* Call(fn as never, Value.undefined, [value, MetadataAsObject(metadata)]));
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
export function MetadataAsObject(metadata: Value): Value {
  if (metadata === null || typeof metadata !== 'object') {
    return metadata;
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
  if (!Array.isArray(metadata) && Object.getPrototypeOf(metadata) !== null) {
    return metadata;
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
interface AnnotatedFunction {
  readonly FormalParameters?: unknown;
  readonly ECMAScriptCode?: unknown;
}

function returnAnnotationOf(fn: AnnotatedFunction): ParseNode.TypeAnnotation | null | undefined {
  // The return annotation sits on the declaration, which is the code node's
  // parent (the body is the child that carries no annotation).
  const code = fn.ECMAScriptCode as { parent?: { TypeAnnotation?: ParseNode.TypeAnnotation | null } } | null | undefined;
  return code?.parent?.TypeAnnotation;
}

export function functionHasAnnotations(fn: AnnotatedFunction): boolean {
  if (returnAnnotationOf(fn)) {
    return true;
  }
  return ((fn.FormalParameters as readonly ParseNode[] | undefined) ?? []).some((p) => (p as { TypeAnnotation?: unknown }).TypeAnnotation);
}

/**
 * proposal-runtime-types (Capability B): the type parameters a generic function
 * declares, or null when it is not generic. Like the return annotation, they sit
 * on the declaration, the code node's parent.
 */
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
    const has = Q(yield* env.HasBinding(name));
    if (has === Value.false) {
      continue;
    }
    const current = Q(yield* env.GetBindingValue(name, Value.true));
    // proposal-runtime-types: an optional parameter whose argument was omitted
    // holds undefined and is not checked against its type (README "Optional
    // Parameters": `function f(a: uint32, b?: uint32)` may be called `f(1)`). A
    // provided argument, even to an optional parameter, is still enforced.
    if (sb.Optional && current === Value.undefined) {
      continue;
    }
    const converted = Q(yield* EnforceAnnotation(sb.TypeAnnotation, current));
    Q(yield* env.SetMutableBinding(name, converted, Value.false));
  }
  return undefined;
}

/** Applies the return annotation to a return value. */
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
  if ((fn as { IsPrimitiveOperator?: boolean }).IsPrimitiveOperator === true) {
    return value;
  }
  const annotation = returnAnnotationOf(fn);
  if (!annotation) {
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
export function* OverloadSignatureOf(fn: Value): PlainEvaluator<OverloadSignature> {
  const formals = ((fn as AnnotatedFunction).FormalParameters as readonly ParseNode[] | undefined) ?? [];
  // Resolve each parameter's annotation to a type record up front. describeParameters
  // wants a synchronous typeOf, so pre-resolve into a map keyed by node.
  const resolved = new Map<ParseNode, TypeRecord>();
  for (const p of formals) {
    const ann = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
    if (ann) {
      resolved.set(p, Q(yield* TypeNodeToTypeRecord(ann.Type)));
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
  return { Parameters: params, Function: fn, Untyped: untyped };
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
export function* MakeOverloadedFunction(name: JSStringValue, functions: readonly Value[]): ValueEvaluator {
  const signatures: OverloadSignature[] = [];
  for (const fn of functions) {
    signatures.push(Q(yield* OverloadSignatureOf(fn)));
  }
  let length = Infinity;
  for (const sig of signatures) {
    length = Math.min(length, minimumArity(sig.Parameters));
  }
  if (!Number.isFinite(length)) {
    length = 0;
  }
  const behaviour = function* overloadDispatch(args: readonly Value[], context: { thisValue: Value }): ValueEvaluator {
    const resolution = resolveOverload(signatures, args);
    if (resolution.Kind === 'none') {
      return Throw.TypeError('no overload of $1 matches these arguments', name);
    }
    if (resolution.Kind === 'ambiguous') {
      return Throw.TypeError('the call to $1 is ambiguous between overloads', name);
    }
    return EnsureCompletion(Q(yield* Call(resolution.Signature.Function, context.thisValue, args as Value[])));
  };
  const overloaded = CreateBuiltinFunction(behaviour as never, length, name, []);
  return overloaded;
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
