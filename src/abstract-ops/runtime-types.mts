import { Q, EnsureCompletion } from '../completion.mts';
import { NumberValue, TypedNumberValue, JSStringValue, TypedStringValue, TypedString, Value } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { fitsNumericType, IsOfType, TypeNodeToTypeRecord, InferGenericBindings } from '../type-system/runtime.mts';
import { Call, R, Throw, ToNumber, ToString, ToBoolean } from '#self';

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
export function* ConvertValue(value: Value, t: TypeRecord): ValueEvaluator {
  const already = Q(yield* IsOfType(value, t));
  if (already) {
    // proposal-runtime-types (Capability B): even when the value already
    // satisfies the type, a literal string type is carried on the value.
    return carryStringType(value, t);
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
        if (value instanceof NumberValue || value instanceof TypedNumberValue) {
          const n = Q(yield* ToNumber(value));
          return new TypedNumberValue(wrapToType(R(n) as number, t), t);
        }
        const n = Q(yield* ToNumber(value));
        if (!fitsNumericType(R(n) as number, t.Name, t.Arguments)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return new TypedNumberValue(R(n) as number, t);
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
        const n = Q(yield* ToNumber(value));
        if (!fitsNumericType(R(n) as number, t.Name, t.Arguments)) {
          return Throw.TypeError('$1 is not assignable to $2', value, Value(displayType(t)));
        }
        return new TypedNumberValue(R(n) as number, t);
      }
      default:
        break;
    }
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

// proposal-runtime-types M20 #sec-meta-hooks: the meta-type method hooks are
// user closures registered per Type Object. `validate` is the meta type's half
// of the validation judgment, consulted from the ~parameterized~ arm of
// IsOfType; the remaining hooks register here for their consumers.
const metaHooks = new WeakMap<object, Map<string, Value>>();

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

export function* ApplyValidateHook(typeObject: object, value: Value, metadata: Value): PlainEvaluator<boolean | undefined> {
  const fn = metaHooks.get(typeObject)?.get('validate');
  if (!fn) {
    return undefined;
  }
  const result = Q(yield* Call(fn as never, Value.undefined, [value, metadata]));
  return result === Value.true;
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
    const sb = p as { BindingIdentifier?: { name: string }, TypeAnnotation?: ParseNode.TypeAnnotation | null, Optional?: boolean };
    if (!sb.TypeAnnotation || !sb.BindingIdentifier) {
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
