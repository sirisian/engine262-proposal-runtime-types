import {
  BigIntValue, BooleanValue, JSStringValue, NumberValue, ObjectValue, SymbolValue, Value,
  TypedNumberValue, TypedStringValue,
  type Descriptor, type PropertyKeyValue,
} from '../value.mts';
import { Q } from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyValidateHook, LookupClassType } from '../abstract-ops/runtime-types.mts';
import type { TypeRecord } from './records.mts';
import {
  anyType, builtinTypeRecord, libraryTypeRecord, makePrimitive, voidType, displayType, validateVectorType,
} from './records.mts';
import { CanonicalizeType, GetTypeObject, isTypeObject } from './intern.mts';
import { IsAssignable } from './relations.mts';
import {
  Call, Get, GetValue, HasProperty, IsCallable, R, ResolveBinding, SameValue, Throw,
} from '#self';

/**
 * proposal-runtime-types #sec-isoftype
 * Determines whether a value is a value of the type. Until the numeric value
 * types of a later milestone exist as distinct values, a Number within the
 * range of an integer type counts as a member; the divergence is deliberate
 * and temporary.
 */
// proposal-runtime-types M17: type parameter substitution. Instantiating a
// generic alias pushes a frame mapping each parameter name to its argument's
// record and evaluates the alias body; identical instantiations therefore
// produce the same record and intern to the same Type Object.
const typeParameterFrames: Map<string, TypeRecord>[] = [];

/**
 * proposal-runtime-types (Capability B): make a set of type-parameter bindings
 * active while some evaluation runs (a generic function call evaluates its
 * parameter types, body, and return type over its inferred bindings). Mirrors the
 * frame InstantiateGenericAlias pushes for an alias body.
 */
export function pushTypeParameterFrame(frame: Map<string, TypeRecord>): void {
  typeParameterFrames.push(frame);
}

export function popTypeParameterFrame(): void {
  typeParameterFrames.pop();
}

/**
 * proposal-runtime-types (Capability B): the Type Record bound to a type parameter
 * of the given name in the active frames, innermost first, or null if none. A
 * type parameter referenced as a builder-call argument (`joinResult(P, d)`)
 * resolves to its bound type through this, since it is not a value binding.
 */
export function lookupTypeParameter(name: string): TypeRecord | null {
  for (let i = typeParameterFrames.length - 1; i >= 0; i -= 1) {
    const bound = typeParameterFrames[i].get(name);
    if (bound !== undefined) {
      return bound;
    }
  }
  return null;
}

export function* InstantiateGenericAlias(declaration: ParseNode.TypeAliasDeclaration, argRecords: readonly TypeRecord[]): PlainEvaluator<TypeRecord> {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  if (params.length !== argRecords.length) {
    return Throw.TypeError('$1 is not a type', Value(declaration.BindingIdentifier.name));
  }
  const frame = new Map<string, TypeRecord>();
  params.forEach((p, i) => {
    frame.set((p as { BindingIdentifier: { name: string } }).BindingIdentifier.name, argRecords[i]);
  });
  typeParameterFrames.push(frame);
  try {
    return Q(yield* TypeNodeToTypeRecord(declaration.Type));
  } finally {
    typeParameterFrames.pop();
  }
}

/**
 * proposal-runtime-types (Capability B, spec sec-computed-constraints): infer the
 * bindings of a generic function's type parameters from the actual argument values
 * at a call. Parameters bind left to right; each parameter's constraint is
 * evaluated over the bindings so far (computed constraints), then the parameter is
 * inferred from the arguments and checked. Where a parameter's evaluated constraint
 * is a literal type or a union/tuple of literal types, the inferred binding is the
 * LITERAL type of the argument's value, not the widened base (spec line 928); this
 * is what the return-type transform reads back. Returns the frame of bindings.
 *
 * The inference matches a type parameter to a formal parameter whose annotation IS
 * that parameter: `x: T` infers T from x's argument, and a rest `...parts: S`
 * infers S as the tuple of the trailing arguments' (literal, under constraint)
 * types. A parameter with no inferable argument falls back to its default, if any.
 */
export function* InferGenericBindings(
  typeParameters: readonly ParseNode.TypeParameter[],
  formals: readonly ParseNode[],
  args: readonly Value[],
): PlainEvaluator<Map<string, TypeRecord>> {
  const frame = new Map<string, TypeRecord>();
  // Index the formal parameters: the ordinary ones by position, and the rest
  // element (if any) by the index at which trailing arguments begin.
  const ordinary: { name: string, annotationName: string | null }[] = [];
  let restName: string | null = null;
  let restAnnotationName: string | null = null;
  for (const p of formals as readonly ParseNode[]) {
    const node = p as { type?: string, BindingIdentifier?: { name: string }, TypeAnnotation?: ParseNode.TypeAnnotation | null, BindingRestElement?: { BindingIdentifier?: { name: string }, TypeAnnotation?: ParseNode.TypeAnnotation | null } };
    if (node.type === 'BindingRestElement') {
      const rest = node as { BindingIdentifier?: { name: string }, TypeAnnotation?: ParseNode.TypeAnnotation | null };
      restName = rest.BindingIdentifier?.name ?? null;
      restAnnotationName = annotationTypeName(rest.TypeAnnotation);
    } else {
      ordinary.push({ name: node.BindingIdentifier?.name ?? '', annotationName: annotationTypeName(node.TypeAnnotation) });
    }
  }

  pushTypeParameterFrame(frame);
  try {
    for (const tp of typeParameters) {
      const paramName = tp.BindingIdentifier.name;
      // Evaluate the constraint over the bindings so far (computed constraints may
      // read earlier parameters, which are already in `frame`).
      let constraint: TypeRecord | null = null;
      if (tp.TypeParameterConstraint) {
        constraint = Q(yield* TypeNodeToTypeRecord(tp.TypeParameterConstraint));
      }
      const literalRule = constraint !== null && constraintWantsLiteral(constraint);

      // Find an ordinary parameter annotated with exactly this type parameter.
      let bound: TypeRecord | null = null;
      const ordIndex = ordinary.findIndex((o) => o.annotationName === paramName);
      if (ordIndex >= 0 && ordIndex < args.length) {
        bound = literalRule ? literalTypeOf(args[ordIndex]) : RuntimeTypeOf(args[ordIndex]);
      } else if (restName !== null && restAnnotationName === paramName) {
        // `...parts: S` binds S to the tuple of the trailing arguments' types.
        const elements: { Type: TypeRecord, Rest: boolean, Initial: 'none' }[] = [];
        for (let i = ordinary.length; i < args.length; i += 1) {
          elements.push({ Type: literalRule ? elementLiteralTypeOf(args[i]) : RuntimeTypeOf(args[i]), Rest: false, Initial: 'none' });
        }
        bound = { Kind: 'tuple', Elements: elements };
      }

      if (bound === null && tp.TypeParameterDefault) {
        bound = Q(yield* TypeNodeToTypeRecord(tp.TypeParameterDefault));
      }
      if (bound === null) {
        // Nothing to infer from and no default: bind `any` so downstream
        // resolution does not throw on an unbound reference.
        bound = anyType;
      }
      // spec sec-computed-constraints: the binding is checked against its
      // evaluated constraint, as any binding is. A mismatched argument fails here
      // with the evaluated constraint available to the diagnostic. When the
      // literal rule inferred a tuple for an array constraint `[].<E>`, the check
      // is element-wise (each inferred element against E), since a fixed tuple of
      // the element type satisfies the array constraint.
      if (constraint !== null) {
        if (constraint.Kind === 'array' && bound.Kind === 'tuple') {
          for (const el of bound.Elements) {
            if (!IsAssignable(el.Type, constraint.Element)) {
              return Throw.TypeError('$1 is not assignable to $2', Value(displayType(el.Type)), Value(displayType(constraint.Element)));
            }
          }
        } else if (!IsAssignable(bound, constraint)) {
          return Throw.TypeError('$1 is not assignable to $2', Value(displayType(bound)), Value(displayType(constraint)));
        }
      }
      frame.set(paramName, bound);
    }
  } finally {
    popTypeParameterFrame();
  }
  return frame;
}

/** The type-parameter name a `: T` annotation names, or null if it is not a bare reference. */
function annotationTypeName(annotation: ParseNode.TypeAnnotation | null | undefined): string | null {
  if (!annotation) {
    return null;
  }
  const type = annotation.Type as { type?: string, TypeName?: { MemberNames?: readonly unknown[], IdentifierReference?: { name?: string } }, TypeArguments?: unknown };
  if (type.type === 'TypeReference' && type.TypeName && (type.TypeName.MemberNames?.length ?? 0) === 0 && !type.TypeArguments) {
    return type.TypeName.IdentifierReference?.name ?? null;
  }
  return null;
}

/** True when an evaluated constraint is a literal type, or a union/tuple of them, so the literal rule applies. */
function constraintWantsLiteral(t: TypeRecord): boolean {
  if (t.Kind === 'literal') {
    return true;
  }
  if (t.Kind === 'union') {
    return t.Members.length > 0 && t.Members.every((m) => m.Kind === 'literal');
  }
  if (t.Kind === 'tuple') {
    // `[].<string>` (a string array constraint) and a literal tuple both cue the
    // per-element literal binding of the trailing arguments.
    return true;
  }
  // A `string`/`number` array constraint written `[].<string>` reflects as an
  // array of that element; cue the literal rule so elements bind literally.
  if (t.Kind === 'array') {
    return true;
  }
  return false;
}

/** The literal type of a value (its value with its widened base), used for literal inference. */
function literalTypeOf(value: Value): TypeRecord {
  return { Kind: 'literal', Value: value, Base: RuntimeTypeOf(value) };
}

/** The literal type of a rest-argument element. */
function elementLiteralTypeOf(value: Value): TypeRecord {
  return literalTypeOf(value);
}

/**
 * proposal-runtime-types: the run-time type of a value. Until the numeric
 * value types exist as distinct values, a Number's type is `number`.
 */
export function RuntimeTypeOf(value: Value): TypeRecord {
  if (value instanceof TypedNumberValue) {
    return (value as TypedNumberValue).TypeRecord as TypeRecord;
  }
  // proposal-runtime-types (Capability B): a String value carrying an inferred
  // literal/refined type reports that type, not the widened `string`. Checked
  // before the JSStringValue case below, since TypedStringValue is a subclass.
  if (value instanceof TypedStringValue) {
    return (value as TypedStringValue).TypeRecord as TypeRecord;
  }
  if (value instanceof NumberValue) {
    return makePrimitive('number');
  }
  if (value instanceof JSStringValue) {
    return makePrimitive('string');
  }
  if (value instanceof BooleanValue) {
    return makePrimitive('boolean');
  }
  if (value instanceof BigIntValue) {
    return makePrimitive('bigint');
  }
  if (value instanceof SymbolValue) {
    return makePrimitive('symbol');
  }
  if (value instanceof ObjectValue) {
    return runtimeObjectType(value, new Set());
  }
  if (value === Value.undefined) {
    return voidType;
  }
  return { Kind: 'literal', Value: Value.null, Base: makePrimitive('object') };
}

/**
 * proposal-runtime-types #sec-runtimetypeof (Object case): the run-time type of an
 * Object. A Proxy constructed with a type argument carries a [[RuntimeType]] slot
 * and reports it; a class instance reports the ~nominal~ type of its class; every
 * other Object reports the structural ~object~ type describing its own enumerable
 * String-keyed properties and their types (spec: "the ~object~ Type Record whose
 * [[Properties]] describes the own properties of _value_ and their declared
 * types"). This is what lets `keyof` and `indexed` read a value's shape, so a
 * generic constrained by `keysOf(T)` can infer over the keys of a runtime object.
 *
 * `seen` breaks reference cycles: a property whose value is an Object already on
 * the path is given the `object` type rather than being expanded again.
 */
function runtimeObjectType(value: ObjectValue, seen: Set<ObjectValue>): TypeRecord {
  // A Proxy (or any Object) carrying an explicit runtime type reports it.
  const carried = (value as { RuntimeType?: TypeRecord }).RuntimeType;
  if (carried) {
    return carried;
  }
  // A class instance reports its class's nominal type, found by walking the
  // prototype chain to a constructor with an associated class Type Object.
  const nominal = classInstanceType(value);
  if (nominal) {
    return nominal;
  }
  // The empty object type (`object`) if there are no own properties to describe.
  const properties: { key: string, type: TypeRecord, optional: boolean, readonly: boolean }[] = [];
  seen.add(value);
  for (const [key, desc] of (value as { properties: Map<PropertyKeyValue, Descriptor> }).properties) {
    // Only own enumerable String-keyed data properties contribute; a Symbol key
    // has no place in the object type's String-keyed [[Properties]], and reading
    // an accessor would run user code, which RuntimeTypeOf must not do.
    if (!(key instanceof JSStringValue) || desc.Enumerable !== Value.true || desc.Value === undefined) {
      continue;
    }
    const propValue = desc.Value;
    const propType = propValue instanceof ObjectValue && seen.has(propValue)
      ? makeObjectType()
      : RuntimeTypeOf2(propValue, seen);
    properties.push({ key: key.stringValue(), type: propType, optional: false, readonly: desc.Writable === Value.false });
  }
  seen.delete(value);
  return { Kind: 'object', Properties: properties, IndexSignatures: [] };
}

/** The `object` type: an object type with no required properties. */
function makeObjectType(): TypeRecord {
  return { Kind: 'object', Properties: [], IndexSignatures: [] };
}

/**
 * proposal-runtime-types: RuntimeTypeOf threading the cycle-guard set, so a nested
 * Object property's type is computed with the outer objects on the path recorded.
 * Non-Object values ignore the set and go through the ordinary RuntimeTypeOf.
 */
function RuntimeTypeOf2(value: Value, seen: Set<ObjectValue>): TypeRecord {
  if (value instanceof ObjectValue) {
    return runtimeObjectType(value, seen);
  }
  return RuntimeTypeOf(value);
}

/**
 * proposal-runtime-types: the ~nominal~ type of the class an Object is an instance
 * of, or null if it is a plain Object. Walks the prototype chain synchronously and
 * returns the class Type Record of the first prototype whose constructor has an
 * associated class Type Object.
 */
function classInstanceType(value: ObjectValue): TypeRecord | null {
  let proto: Value = (value as { Prototype?: Value }).Prototype ?? Value.null;
  const guard = new Set<Value>();
  while (proto instanceof ObjectValue && !guard.has(proto)) {
    guard.add(proto);
    const ctorDesc = (proto as { properties: Map<PropertyKeyValue, Descriptor> }).properties.get(Value('constructor'));
    const ctor = ctorDesc?.Value;
    if (ctor instanceof ObjectValue) {
      const classType = LookupClassType(ctor);
      if (classType && isTypeObject(classType)) {
        return classType.TypeRecord;
      }
    }
    proto = (proto as { Prototype?: Value }).Prototype ?? Value.null;
  }
  return null;
}

/**
 * proposal-runtime-types #sec-default-values: DefaultValueOf.
 * The value a binding or field of type `t` holds before assignment, or undefined
 * (standing for the spec's ~none~) when `t` has no default. Callers distinguish
 * "no default" by receiving the JS `undefined` sentinel, never a Value.
 *
 * any -> undefined; a numeric type -> its 0; String -> ''; Boolean -> false;
 * bigint -> 0n; the null/undefined types -> null/undefined; a union -> null or
 * undefined only if it admits them; a dynamic array -> an empty array; a fixed
 * array/tuple -> filled with element defaults; otherwise none (symbol, object,
 * function, non-nullable unions, and value-type classes without a field default).
 */
export function DefaultValueOf(t: TypeRecord): Value | undefined {
  switch (t.Kind) {
    case 'any':
      return Value.undefined;
    case 'void':
      // The `undefined` type is represented as `void` here; its default is undefined.
      return Value.undefined;
    case 'primitive': {
      const name = t.Name;
      if (name === 'int' || name === 'uint' || name === 'float16' || name === 'float32' || name === 'float64' || name === 'number') {
        return new TypedNumberValue(0, t);
      }
      if (name === 'string') { return Value(''); }
      if (name === 'boolean') { return Value.false; }
      if (name === 'bigint') { return Value(0n); }
      // symbol has no meaningful zero
      return undefined;
    }
    case 'literal':
      // The one value of a literal type is its default.
      return t.Value as Value;
    case 'union': {
      // A union defaults to null or undefined only when it admits one.
      for (const m of t.Members) {
        if (m.Kind === 'literal' && (m.Value as Value) === Value.null) { return Value.null; }
      }
      for (const m of t.Members) {
        if (m.Kind === 'void') { return Value.undefined; }
      }
      return undefined;
    }
    default:
      // object, function, tuple, array, nominal, intersection, parameterized,
      // reference: no scalar default is materialized here. Arrays and value-type
      // aggregates get their zero-filled defaults through the memory-layout
      // extension; the core reports none so a binding of such a type without an
      // initializer is a type error rather than silently undefined.
      return undefined;
  }
}

export function* IsOfType(value: Value, t: TypeRecord): PlainEvaluator<boolean> {
  switch (t.Kind) {
    case 'any':
      return true;
    case 'void':
      return false;
    case 'union': {
      for (const m of t.Members) {
        if (Q(yield* IsOfType(value, m))) {
          return true;
        }
      }
      return false;
    }
    case 'intersection': {
      for (const m of t.Members) {
        if (!Q(yield* IsOfType(value, m))) {
          return false;
        }
      }
      return true;
    }
    case 'parameterized': {
      // #sec-isoftype: a value belongs to a parameterized type when it belongs
      // to the base and the meta type's validate judgment holds of the
      // metadata. The base's Type Object carries the hook.
      if (!Q(yield* IsOfType(value, t.Base))) {
        return false;
      }
      const baseObject = GetTypeObject(t.Base);
      const verdict = Q(yield* ApplyValidateHook(baseObject, value, t.Metadata));
      return verdict === undefined ? true : verdict;
    }
    case 'literal':
      return SameValue(value, t.Value);
    case 'primitive':
      return primitiveMembership(value, t.Name, t.Arguments);
    case 'array':
    case 'tuple': {
      if (!(value instanceof ObjectValue)) {
        return false;
      }
      const lenValue = Q(yield* Get(value, Value('length')));
      if (!(lenValue instanceof NumberValue)) {
        return false;
      }
      const len = R(lenValue);
      if (t.Kind === 'array') {
        if (t.Extent !== 'dynamic' && t.Extent !== len) {
          return false;
        }
        for (let i = 0; i < len; i += 1) {
          const el = Q(yield* Get(value, Value(String(i))));
          if (!Q(yield* IsOfType(el, t.Element))) {
            return false;
          }
        }
        return true;
      }
      // A [[Rest]] element receives its own position and every later one.
      const restIndex = t.Elements.findIndex((e) => e.Rest);
      if (restIndex === -1) {
        if (len !== t.Elements.length) {
          return false;
        }
      } else if (len < restIndex) {
        return false;
      }
      for (let i = 0; i < len; i += 1) {
        const element = restIndex !== -1 && i >= restIndex ? t.Elements[restIndex] : t.Elements[i];
        if (!element) {
          return false;
        }
        const el = Q(yield* Get(value, Value(String(i))));
        if (!Q(yield* IsOfType(el, element.Type))) {
          return false;
        }
      }
      return true;
    }
    case 'reference':
      return Q(yield* IsOfType(value, t.Target));
    case 'nominal': {
      if (t.EnumMembers) {
        return t.EnumMembers.some((m) => SameValue(value, m));
      }
      if (t.Structure) {
        return Q(yield* IsOfType(value, t.Structure));
      }
      // #sec-isoftype nominal: a class type's members are the instances whose
      // prototype chain reaches the constructor bound by [[Declaration]].
      if (t.Declaration.type === 'ClassDeclaration' || t.Declaration.type === 'ClassExpression') {
        if (!(value instanceof ObjectValue)) {
          return false;
        }
        let ctor: Value | null = (t.Constructor as Value | undefined) ?? null;
        if (!ctor) {
          // Fall back to a name lookup for records built without a constructor.
          const bi = (t.Declaration as { BindingIdentifier?: { name?: string } }).BindingIdentifier;
          if (!bi || !bi.name) {
            return false;
          }
          const ref = Q(yield* ResolveBinding(Value(bi.name)));
          ctor = Q(yield* GetValue(ref));
        }
        if (!(ctor instanceof ObjectValue)) {
          return false;
        }
        const protoValue = Q(yield* Get(ctor, Value('prototype')));
        if (!(protoValue instanceof ObjectValue)) {
          return false;
        }
        let proto = Q(yield* value.GetPrototypeOf());
        while (proto instanceof ObjectValue) {
          if (proto === protoValue) {
            return true;
          }
          proto = Q(yield* proto.GetPrototypeOf());
        }
        return false;
      }
      // proposal-runtime-types (README Global Objects): a library nominal named
      // for a global constructor (Error and its subclasses, Map, Set, Date, and
      // the rest) tests membership by the prototype chain of that global, the same
      // instanceof relation a class type uses. This is what lets `let e: Error`,
      // `catch (e: TypeError)`, and the other global-object types work.
      if (t.LibraryName) {
        if (!(value instanceof ObjectValue)) {
          return false;
        }
        const ref = Q(yield* ResolveBinding(Value(t.LibraryName)));
        const ctor = Q(yield* GetValue(ref));
        if (!(ctor instanceof ObjectValue)) {
          return false;
        }
        const protoValue = Q(yield* Get(ctor, Value('prototype')));
        if (!(protoValue instanceof ObjectValue)) {
          return false;
        }
        let proto = Q(yield* value.GetPrototypeOf());
        while (proto instanceof ObjectValue) {
          if (proto === protoValue) {
            return true;
          }
          proto = Q(yield* proto.GetPrototypeOf());
        }
        return false;
      }
      return false;
    }
    case 'object': {
      // #sec-isoftype: structural membership reads the value's properties.
      if (!(value instanceof ObjectValue)) {
        return false;
      }
      for (const p of t.Properties) {
        const key = Value(p.key);
        const present = Q(yield* HasProperty(value, key));
        if (present === Value.false) {
          if (!p.optional) {
            return false;
          }
          continue;
        }
        const pv = Q(yield* Get(value, key));
        if (!Q(yield* IsOfType(pv, p.type))) {
          return false;
        }
      }
      // Index signatures constrain every own enumerable key not already named.
      if (t.IndexSignatures.length > 0) {
        const named = new Set(t.Properties.map((p) => p.key));
        const keys = Q(yield* value.OwnPropertyKeys());
        for (const k of keys) {
          if (!(k instanceof JSStringValue) || named.has(k.stringValue())) {
            continue;
          }
          const desc = Q(yield* value.GetOwnProperty(k));
          if (desc === Value.undefined || (desc as { Enumerable?: Value }).Enumerable !== Value.true) {
            continue;
          }
          for (const ix of t.IndexSignatures) {
            if (Q(yield* IsOfType(k, ix.Key))) {
              const kv = Q(yield* Get(value, k));
              if (!Q(yield* IsOfType(kv, ix.Value))) {
                return false;
              }
            }
          }
        }
      }
      return true;
    }
    case 'function':
      // Signature membership needs typed functions; callability decides
      // until then.
      return IsCallable(value);
    default:
      return false;
  }
}

export function primitiveMembership(value: Value, name: string, args: readonly (TypeRecord | number)[]): boolean {
  switch (name) {
    case 'uint':
    case 'int':
    case 'float16':
    case 'float32':
    case 'float64': {
      // #sec-value-types: numeric value types have their own values; a plain
      // Number is not a member of a numeric value type, and a typed number is a
      // member only of its own type (R1 gave these values distinct identity).
      if (!(value instanceof TypedNumberValue)) {
        return false;
      }
      const r = (value as TypedNumberValue).TypeRecord as TypeRecord;
      return r.Kind === 'primitive' && r.Name === name
        && r.Arguments.length === args.length
        && r.Arguments.every((a, i) => a === args[i]);
    }
    case 'number':
      return value instanceof NumberValue && !(value instanceof TypedNumberValue);
    case 'string':
      return value instanceof JSStringValue;
    case 'boolean':
      return value instanceof BooleanValue;
    case 'bigint':
      return value instanceof BigIntValue;
    case 'symbol':
      return value instanceof SymbolValue;
    case 'object':
      return value instanceof ObjectValue;
    default:
      return false;
  }
}

function literalBase(kind: ParseNode.LiteralType['kind']): TypeRecord {
  switch (kind) {
    case 'number': return makePrimitive('number');
    case 'string': return makePrimitive('string');
    case 'boolean': return makePrimitive('boolean');
    case 'bigint': return makePrimitive('bigint');
    default: return anyType;
  }
}

function toNumericArgument(record: TypeRecord): TypeRecord | number {
  if (record.Kind === 'literal' && record.Value instanceof NumberValue) {
    return R(record.Value);
  }
  return record;
}

/**
 * Evaluates a Type parse node to a Type Record. Computed types, qualified
 * names, generic aliases, and the remaining forms arrive with the checker
 * milestone; they throw a TypeError for now.
 */
export function* TypeNodeToTypeRecord(node: ParseNode.Type): PlainEvaluator<TypeRecord> {
  switch (node.type) {
    case 'TypeReference': {
      if (node.TypeName.MemberNames.length > 0) {
        // A qualified type name accesses a member of a namespace-like type. The
        // reachable case today is an enum member, whose type is the literal
        // type of that member's value.
        const baseName = node.TypeName.IdentifierReference.name;
        const baseRef = Q(yield* ResolveBinding(Value(baseName)));
        let base = Q(yield* GetValue(baseRef));
        for (const part of node.TypeName.MemberNames) {
          if (!(base instanceof ObjectValue)) {
            return Throw.TypeError('$1 is not a type', Value(`${baseName}.${part.name}`));
          }
          base = Q(yield* Get(base, Value(part.name)));
        }
        // The accessed value becomes a literal type of its own base type.
        return { Kind: 'literal', Value: base, Base: RuntimeTypeOf(base) };
      }
      const name = node.TypeName.IdentifierReference.name;
      for (let i = typeParameterFrames.length - 1; i >= 0; i -= 1) {
        const bound = typeParameterFrames[i].get(name);
        if (bound) {
          return bound;
        }
      }
      const argRecords: TypeRecord[] = [];
      if (node.TypeArguments) {
        for (const argNode of node.TypeArguments.TypeArgumentList) {
          argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
        }
      }
      const builtin = builtinTypeRecord(name, argRecords.map(toNumericArgument));
      if (builtin) {
        // proposal-runtime-types (spec sec-vector-types): a `vector.<T, N>` is
        // well-formed only when T is a lane type and N a positive integer. A
        // malformed vector is a type error at the point its type is formed.
        const vectorProblem = validateVectorType(builtin);
        if (vectorProblem !== null) {
          return Throw.TypeError('$1', Value(vectorProblem));
        }
        return builtin;
      }
      // proposal-runtime-types: a library generic type (Promise, Record) resolves
      // to a nominal type carrying its arguments, distinguished by name. Bare
      // `Promise` is the same nominal with no arguments, so it reflects as the
      // base of an applied `Promise.<T>` and compares equal to it only when both
      // are unapplied.
      const library = libraryTypeRecord(name, argRecords);
      if (library) {
        return library;
      }
      // proposal-runtime-types: `undefined` in type position denotes the type of
      // the `undefined` value. RuntimeTypeOf(undefined) is `void`, so the
      // `undefined` type name resolves to the same `void` type, keeping the type
      // of a value and the type that names it in agreement (the name is otherwise
      // the global `undefined` value binding).
      if (name === 'undefined') {
        return voidType;
      }
      const ref = Q(yield* ResolveBinding(Value(name)));
      const value = Q(yield* GetValue(ref));
      // proposal-runtime-types: resolve the name to a base Type Record. The name
      // is either bound to a Type Object, or it is a class constructor whose
      // associated class type we look up. A generic type alias is expanded eagerly
      // here; every other nominal (class, interface, library) carries its type
      // arguments through the single attach point below, so a name that resolves
      // as a Type Object and a name that resolves as a constructor instantiate
      // consistently.
      let baseRecord: TypeRecord | null = null;
      if (isTypeObject(value)) {
        const record = value.TypeRecord;
        if (record.Kind === 'nominal' && record.Declaration.type === 'TypeAliasDeclaration' && (record.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
          return Q(yield* InstantiateGenericAlias(record.Declaration as ParseNode.TypeAliasDeclaration, argRecords));
        }
        baseRecord = record;
      } else if (value instanceof ObjectValue) {
        // proposal-runtime-types M21: a class name denotes its class type.
        const classType = LookupClassType(value);
        if (classType && isTypeObject(classType)) {
          baseRecord = classType.TypeRecord;
        }
      }
      if (baseRecord) {
        // proposal-runtime-types: a generic class/interface referenced with type
        // arguments is a nominal instantiation carrying those arguments (spec
        // ~nominal~ [[Arguments]]). Identity is the declaration plus the arguments
        // (folded into the intern key by orderKey), and reflection exposes them as
        // a `generic` view. Bare `T` and `T.<...>` are therefore distinct interned
        // types, and two `T.<A>` are one.
        if (baseRecord.Kind === 'nominal' && argRecords.length > 0) {
          return { ...baseRecord, Arguments: argRecords };
        }
        return baseRecord;
      }
      return Throw.TypeError('$1 is not a type', Value(name));
    }
    case 'ParenthesizedType':
      return Q(yield* TypeNodeToTypeRecord(node.Type));
    case 'PredefinedType':
      if (node.keyword === 'void') {
        return voidType;
      }
      return { Kind: 'literal', Value: Value.null, Base: makePrimitive('object') };
    case 'UnionType': {
      const Members: TypeRecord[] = [];
      for (const m of node.Types) {
        Members.push(Q(yield* TypeNodeToTypeRecord(m)));
      }
      return { Kind: 'union', Members };
    }
    case 'IntersectionType': {
      const Members: TypeRecord[] = [];
      for (const m of node.Types) {
        Members.push(Q(yield* TypeNodeToTypeRecord(m)));
      }
      return { Kind: 'intersection', Members };
    }
    case 'ArrayType': {
      const Element = node.TypeArguments && node.TypeArguments.TypeArgumentList.length > 0
        ? Q(yield* TypeNodeToTypeRecord(node.TypeArguments.TypeArgumentList[0]))
        : anyType;
      let Extent: number | 'dynamic' = 'dynamic';
      if (node.ArrayExtent) {
        if (node.ArrayExtent.type === 'NumericLiteral') {
          Extent = (node.ArrayExtent as { value: number }).value;
        } else {
          // A computed extent evaluates; #sec-compile-time-evaluability's
          // budget joins later.
          const ref = Q(yield* Evaluate(node.ArrayExtent));
          const v = Q(yield* GetValue(ref));
          if (!(v instanceof NumberValue) || !Number.isInteger(R(v)) || (R(v) as number) < 0) {
            return Throw.TypeError('$1 is not a type', v);
          }
          Extent = R(v) as number;
        }
      }
      return { Kind: 'array', Element, Extent };
    }
    case 'TupleType': {
      const Elements = [];
      for (const e of node.TupleElementList) {
        Elements.push({ Type: Q(yield* TypeNodeToTypeRecord(e.Type)), Rest: e.Rest, Initial: 'none' as const });
      }
      return { Kind: 'tuple', Elements };
    }
    case 'LiteralType': {
      const raw = node.negated && typeof node.value === 'number' ? -node.value : node.value;
      if (node.kind === 'imaginary') {
        return Throw.TypeError('$1 is not supported yet', Value('an imaginary literal type'));
      }
      return { Kind: 'literal', Value: Value(raw as never), Base: literalBase(node.kind) };
    }
    case 'ObjectType': {
      const Properties = [];
      const IndexSignatures = [];
      for (const member of node.TypeMemberList) {
        if (member.type === 'IndexSignature') {
          IndexSignatures.push({
            Key: Q(yield* TypeNodeToTypeRecord(member.KeyTypeAnnotation.Type)),
            Value: Q(yield* TypeNodeToTypeRecord(member.ValueTypeAnnotation.Type)),
          });
          continue;
        }
        const rawName = member.PropertyName as { name?: string, value?: string | number | bigint };
        // A numeric or string property name contributes its value; a numeric key
        // canonicalizes to its string form, as an object key does in JavaScript
        // (`{ 1: x }` has key `"1"`).
        const rawKey = rawName.name ?? rawName.value;
        const key = typeof rawKey === 'number' || typeof rawKey === 'bigint' ? String(rawKey) : rawKey;
        if (typeof key !== 'string') {
          return Throw.TypeError('$1 is not supported yet', Value('a computed member name'));
        }
        let type: TypeRecord;
        if (member.TypeAnnotation) {
          type = Q(yield* TypeNodeToTypeRecord(member.TypeAnnotation.Type));
        } else if (member.MethodSignature) {
          type = Q(yield* functionRecordFromSignature(member.MethodSignature.FunctionTypeParameterList, member.MethodSignature.TypeAnnotation));
        } else {
          type = anyType;
        }
        Properties.push({ key, type, optional: member.Optional, readonly: member.Readonly });
      }
      return { Kind: 'object', Properties, IndexSignatures };
    }
    case 'FunctionType':
      return Q(yield* functionRecordFromSignature(node.FunctionTypeParameterList, { Type: node.ReturnType } as ParseNode.TypeAnnotation));
    case 'ReferenceType': {
      // proposal-runtime-types (references extension; spec ~reference~ kind): a
      // `ref T` type is a reference to a storage location holding a T. Its Type
      // Record is { Kind: 'reference', Target: <T's record> }; interning and
      // reflection over the reference kind are already provided.
      const Target = Q(yield* TypeNodeToTypeRecord(node.Type));
      return { Kind: 'reference', Target };
    }
    case 'KeyOfType': {
      // proposal-runtime-types #sec-keyof: keyof denotes GetTypeObject of the
      // Type Record KeyTypesOf returns for the operand. It is a type error when
      // KeyTypesOf is empty (the operand has no keys).
      const operand = Q(yield* TypeNodeToTypeRecord(node.Type));
      const keys = KeyTypesOf(operand);
      if (keys === KEY_TYPES_EMPTY) {
        return Throw.TypeError('$1 is not supported yet', Value('keyof of a type with no keys'));
      }
      return keys;
    }
    case 'ComputedType': {
      // #sec-evaluatebuildercall: the callee evaluates and is called with the
      // evaluated arguments; the result must be a Type Object.
      const result = Q(yield* evaluateComputedType(node));
      if (isTypeObject(result)) {
        return result.TypeRecord;
      }
      return Throw.TypeError('$1 is not a type', result);
    }
    default:
      return Throw.TypeError('$1 is not supported yet', Value(`a type of kind ${node.type}`));
  }
}

/**
 * proposal-runtime-types #sec-keytypesof: the type of the keys of `t`, or the
 * sentinel `empty` where `t` has no keys. `keyof` denotes GetTypeObject of this
 * Record; it is a type error when this returns empty. These are also the rules
 * of the kit's `keysOf`, so operator and helper cannot drift.
 */
const KEY_TYPES_EMPTY = Symbol('empty');
export function KeyTypesOf(t: TypeRecord): TypeRecord | typeof KEY_TYPES_EMPTY {
  if (t.Kind === 'object') {
    const keys: TypeRecord[] = [];
    for (const p of t.Properties) {
      // The engine's object property keys are Strings; a literal key type has
      // the String type as its base. (Symbol keys are not yet representable in
      // object types, so no Symbol base arises here.)
      keys.push({ Kind: 'literal', Value: Value(p.key), Base: makePrimitive('string') });
    }
    for (const x of t.IndexSignatures) {
      keys.push(x.Key);
    }
    return CanonicalizeType({ Kind: 'union', Members: keys });
  }
  if (t.Kind === 'intersection') {
    const keys: TypeRecord[] = [];
    for (const m of t.Members) {
      const k = KeyTypesOf(m);
      if (k === KEY_TYPES_EMPTY) {
        return KEY_TYPES_EMPTY;
      }
      keys.push(k);
    }
    return CanonicalizeType({ Kind: 'union', Members: keys });
  }
  if (t.Kind === 'union') {
    if (t.Members.length === 0) {
      return t;
    }
    const first = KeyTypesOf(t.Members[0]);
    if (first === KEY_TYPES_EMPTY) {
      return KEY_TYPES_EMPTY;
    }
    // A union's keys are the keys common to every member: start from the first
    // member's keys and keep only those assignable to each subsequent member's.
    let kept: TypeRecord[] = first.Kind === 'union'
      ? [...(first as { Members: readonly TypeRecord[] }).Members]
      : [first];
    for (let i = 1; i < t.Members.length; i += 1) {
      const k = KeyTypesOf(t.Members[i]);
      if (k === KEY_TYPES_EMPTY) {
        return KEY_TYPES_EMPTY;
      }
      kept = kept.filter((e) => IsAssignable(e, k));
    }
    return CanonicalizeType({ Kind: 'union', Members: kept });
  }
  if (t.Kind === 'parameterized') {
    return KeyTypesOf(t.Base);
  }
  return KEY_TYPES_EMPTY;
}

/** Whether a mathematical value fits a numeric value type. */
export function fitsNumericType(v: number, name: string, args: readonly (TypeRecord | number)[]): boolean {
  if (name === 'uint' || name === 'int') {
    if (!Number.isInteger(v)) {
      return false;
    }
    const bits = typeof args[0] === 'number' ? args[0] : 0;
    return name === 'uint' ? v >= 0 && v < 2 ** bits : v >= -(2 ** (bits - 1)) && v < 2 ** (bits - 1);
  }
  return name === 'float16' || name === 'float32' || name === 'float64';
}

function* functionRecordFromSignature(params: readonly ParseNode.FunctionTypeParameter[], returnAnnotation: ParseNode.TypeAnnotation | null): PlainEvaluator<TypeRecord> {
  const Parameters: TypeRecord[] = [];
  let ThisType: TypeRecord | null = null;
  for (const p of params) {
    const annotation = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
    // A parameter in a function type is a type, optionally introduced by a name
    // and a colon: `(uint8) => uint8` stores the bare type in [[Type]], while
    // `(x: uint8) => uint8` stores it in a [[TypeAnnotation]] behind the name.
    // Read whichever the parser produced; a leading `this` parameter is handled
    // just below and is not an ordinary parameter.
    const bareType = (p as { Type?: ParseNode.Type | null }).Type;
    const t = annotation ?? (bareType ? ({ Type: bareType } as ParseNode.TypeAnnotation) : null);
    // A leading `this` parameter supplies the signature's this type and is not an
    // ordinary parameter.
    if ((p as { IsThis?: boolean }).IsThis) {
      if (t) {
        ThisType = Q(yield* TypeNodeToTypeRecord(t.Type));
      } else {
        ThisType = anyType;
      }
      continue;
    }
    let paramType: TypeRecord = anyType;
    if (t) {
      paramType = Q(yield* TypeNodeToTypeRecord(t.Type));
    }
    Parameters.push(paramType);
  }
  let Return: TypeRecord | null = null;
  if (returnAnnotation) {
    Return = Q(yield* TypeNodeToTypeRecord(returnAnnotation.Type));
  }
  return { Kind: 'function', Signatures: [{ Parameters, Return, ThisType }] };
}

function* evaluateComputedType(node: ParseNode.ComputedType): PlainEvaluator<Value> {
  let callee: Value;
  if (node.Callee.type === 'ComputedType') {
    callee = Q(yield* evaluateComputedType(node.Callee));
  } else {
    const ref = Q(yield* ResolveBinding(Value(node.Callee.TypeName.IdentifierReference.name)));
    let v = Q(yield* GetValue(ref));
    for (const part of node.Callee.TypeName.MemberNames) {
      v = Q(yield* Get(v as ObjectValue, Value(part.name)));
    }
    callee = v;
  }
  const args: Value[] = [];
  for (const a of node.Arguments) {
    if (a.type === 'AssignmentRestElement') {
      return Throw.TypeError('$1 is not supported yet', Value('a spread builder argument'));
    }
    if (a.type === 'NamedArgument') {
      return Throw.TypeError('$1 is not supported yet', Value('a named builder argument'));
    }
    // proposal-runtime-types (Capability B): a builder-call argument that is a
    // bare identifier naming a bound type parameter resolves to that parameter's
    // Type Object (it is a type, not a value binding). This is what lets a return
    // type like `joinResult(P, delimiter)` read the inferred `P` alongside the
    // ordinary value `delimiter`.
    const bareName = (a as { type?: string, name?: string }).type === 'IdentifierReference' ? (a as { name?: string }).name : undefined;
    if (bareName !== undefined) {
      const boundParam = lookupTypeParameter(bareName);
      if (boundParam !== null) {
        args.push(GetTypeObject(boundParam));
        continue;
      }
    }
    const ref = Q(yield* Evaluate(a));
    args.push(Q(yield* GetValue(ref)));
  }
  return Q(yield* Call(callee as never, Value.undefined, args));
}
