import { Q, X, EnsureCompletion, isEvaluator } from '../completion.mts';
import { NumberValue, TypedNumberValue, isTypedNumber, JSStringValue, TypedStringValue, TypedString, Value, ObjectValue, BigIntValue, BooleanValue, type NativeSteps, type Arguments, type FunctionCallContext } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { displayType, builtinTypeRecord, type TypeRecord } from '../type-system/records.mts';
import { SameMetadata, SameType } from '../type-system/relations.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { isFloatTypeName } from '../type-system/numeric-signatures.mts';
import { fitsNumericType, IsOfType, TypeNodeToTypeRecord, InferGenericBindings } from '../type-system/runtime.mts';
import { describeParameters, minimumArity, resolveOverload, type OverloadSignature } from '../type-system/overloads.mts';
import {
  Call, R, Throw, ToNumber, ToString, ToBoolean, CreateBuiltinFunction, surroundingAgent, Get, IsArray, ArrayCreate, CreateDataPropertyOrThrow, OrdinaryObjectCreate, RegExpCreate,
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
export function* RequireType(value: Value, t: TypeRecord): ValueEvaluator {
  const ok = Q(yield* IsOfType(value, t));
  if (!ok) {
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  return value;
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
        return Q(yield* ToNumber(value));
      case 'boolean':
        return ToBoolean(value);
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
  const already = Q(yield* IsOfType(value, t));
  if (already) {
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
        return Q(yield* ToNumber(value));
      case 'boolean':
        return ToBoolean(value);
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
        return out;
      }
    }
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
  }
  return Q(yield* RequireType(value, t));
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
const metaKeyClaimsByAgent = new WeakMap<object, Map<string, object>>();

function claimsForAgent(): Map<string, object> {
  const agent = surroundingAgent as unknown as object;
  let claims = metaKeyClaimsByAgent.get(agent);
  if (!claims) {
    claims = new Map();
    metaKeyClaimsByAgent.set(agent, claims);
  }
  return claims;
}

/** Record a meta type's claim over a key. Returns the prior claimant, if any. */
export function ClaimMetaKey(key: string, typeObject: object): object | undefined {
  const claims = claimsForAgent();
  const existing = claims.get(key);
  if (existing !== undefined && existing !== typeObject) {
    return existing;
  }
  claims.set(key, typeObject);
  return undefined;
}

/** The meta type claiming a key, or *undefined* where none does. */
export function MetaTypeClaiming(key: string): object | undefined {
  return claimsForAgent().get(key);
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
  return Q(yield* Call(fn as never, Value.undefined, args.map((a) => MetadataAsObject(a))));
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
    // a meta type that does not admit the crossing refuses it.
    return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(to)));
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
function MetadataAsObject(metadata: Value): Value {
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
  return { Parameters: params, Function: fn };
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
