import { Q, X, EnsureCompletion, isEvaluator } from '../completion.mts';
import { NumberValue, TypedNumberValue, JSStringValue, TypedStringValue, TypedString, Value, ObjectValue, type NativeSteps, type Arguments, type FunctionCallContext } from '../value.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { displayType, builtinTypeRecord, type TypeRecord } from '../type-system/records.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { fitsNumericType, IsOfType, TypeNodeToTypeRecord, InferGenericBindings } from '../type-system/runtime.mts';
import { describeParameters, minimumArity, resolveOverload, type OverloadSignature } from '../type-system/overloads.mts';
import {
  Call, R, Throw, ToNumber, ToString, ToBoolean, CreateBuiltinFunction, surroundingAgent, Get, IsArray, ArrayCreate, CreateDataPropertyOrThrow,
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
