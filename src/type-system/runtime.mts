import { OutOfRange } from '../utils/language.mts';
import { StampTypedArray } from '../abstract-ops/array-view.mts';
import { isRangeShapeName, rangeMatchesBoundArguments, rangeShapeMatches } from './range-bounds-match.mts';
import { SoAStorageOf } from '../intrinsics/SoA.mts';
import { ArraySpanBackingOf, ArrayViewBackingOf } from '../abstract-ops/array-view.mts';
import {
  BigIntValue, BooleanValue, JSStringValue, NumberValue, ObjectValue, SymbolValue, Value,
  TypedNumberValue, TypedStringValue, TypedBigIntValue, ReferenceValue, isTypedNumber, unwrapToNumber,
  type Descriptor, type PropertyKeyValue,
} from '../value.mts';
import { VectorValue } from '../value.mts';
import { CreateDecimalValue, isDecimalObject } from '../intrinsics/Decimal.mts';
import { CreateComplexValue, isComplexObject } from '../intrinsics/Complex.mts';
import { CreateFloat128Value, isFloat128Object } from '../intrinsics/Float128.mts';
import { CreateRationalValue } from '../intrinsics/Rational.mts';
import { Q, X } from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { ArrayCreate, CreateDataPropertyOrThrow, OrdinaryObjectCreate } from '../abstract-ops/all.mts';
import { EnsureCompletion } from '../completion.mts';
import { isArrayExoticObject } from '../abstract-ops/array-objects.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyValidateHook, CheckedConvertValue, CrossBareValueIntoParameterization, GoverningMetaTypes, LookupClassType, MetaTypeGoverns, MetadataPortion, RegisteredEnumOf } from '../abstract-ops/runtime-types.mts';
import { CompositeTypeRecordOf } from '../intrinsics/Composite.mts';
import type { ParameterRecord, TypeRecord } from './records.mts';
import {
  ConsumeEvaluationSteps, IsBudgetExhausted, BeginTypeEvaluation, EndTypeEvaluation,
} from './budget.mts';
import { SequenceAssignment } from './sequence-assignment.mts';
import { IsSharableValueType } from './layout.mts';
import { restElementType, UnderlyingOf } from './records.mts';
import {
  iterationInterfaceRecord, identityRecord, getParsedIdentityDeclaration,
} from './iteration-types.mts';
import {
  anyType, builtinTypeRecord, badKindedArgument, libraryTypeRecord, makePrimitive, voidType, displayType, validateVectorType, namedNumericLiteralRecord, propertyKeyValue, parameter } from './records.mts';
import { CanonicalizeType, GetTypeObject, isTypeObject } from './intern.mts';
import { beginResolvingAlias, endResolvingAlias, resolvingAlias, tieAliasKnot } from './resolving-aliases.mts';
import { ReflectionContextRecordOf } from './reflection-contexts.mts';
import { IsAssignable } from './relations.mts';
import { SelfThisTypeRecord } from './check.mts';
import { SameType } from './relations.mts';
import { IsSubtype } from './relations.mts';
import {
  Call, Get, GetValue, HasProperty, IsCallable, OrdinaryFunctionCreate, R, ResolveBinding, SameValue, surroundingAgent, Throw, ToBoolean,
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
 * proposal-runtime-types #sec-overloading-on-return-type: the contextual type
 * of a call is "the type its position requires", and the resolver needs it
 * WHILE the call is evaluated rather than after - by the time a binding
 * boundary converts the result, the overload has already been chosen.
 *
 * A stack rather than a single value, because an initializer may contain
 * another call: `const a: string = f(g())` gives `f` the string context and
 * `g` whatever `f`'s parameter says, and the inner one must not see the outer's.
 * Modelled on typeParameterFrames above, which solves the same shape of
 * problem for generic parameters.
 */
const contextualTypes: (TypeRecord | null)[] = [];

/** Bracket an evaluation whose position requires _t_, or nothing where it does not. */
export function pushContextualType(t: TypeRecord | null): void {
  contextualTypes.push(t);
}

export function popContextualType(): void {
  contextualTypes.pop();
}

/** The type the innermost bracketed position requires, or undefined. */
export function currentContextualType(): TypeRecord | undefined {
  const top = contextualTypes[contextualTypes.length - 1];
  return top ?? undefined;
}

/**
 * proposal-runtime-types: make a set of type-parameter bindings
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
 * proposal-runtime-types #sec-generics: the bindings currently in scope, or
 * undefined where none are.
 *
 * A specialized declaration's parameters are in scope "within the body and
 * signatures of its declaration", and a body runs long after the declaration
 * was evaluated - so a function created while a specialization's frame is
 * active captures it here and pushes it again at each call. That is what
 * carries `W` into a method body rather than only into the heritage clause.
 */
/**
 * proposal-runtime-types #sec-generics: the bindings a declaration takes when
 * it is used with NO argument list, or undefined where it needs one.
 *
 * A declaration every one of whose parameters has a default has a meaning
 * without arguments - `class C<T = uint8>` used as `new C()`, and `type A<T =
 * uint8>` used as `A`. One parameter without a default is enough to need an
 * application, since nothing would bind it.
 *
 * Each default resolves with the bindings made so far in scope, so a later
 * default may name an earlier parameter.
 */
export function* AllDefaultsFrame(declaration: unknown): PlainEvaluator<Map<string, TypeRecord> | undefined> {
  const params = (declaration as { TypeParameters?: { TypeParameterList?: readonly ParseNode.TypeParameter[] } | null })
    ?.TypeParameters?.TypeParameterList;
  if (!params || params.length === 0) {
    return undefined;
  }
  if (!params.every((p) => (p as unknown as { TypeParameterDefault?: unknown }).TypeParameterDefault)) {
    return undefined;
  }
  const frame = new Map<string, TypeRecord>();
  for (const p of params) {
    const name = p.BindingIdentifier?.name;
    pushTypeParameterFrame(frame);
    let record;
    try {
      record = Q(yield* TypeNodeToTypeRecord((p as unknown as { TypeParameterDefault: ParseNode.Type }).TypeParameterDefault));
    } finally {
      popTypeParameterFrame();
    }
    if (name) {
      frame.set(name, record);
    }
  }
  return frame;
}

export function currentTypeParameterFrame(): Map<string, TypeRecord> | undefined {
  if (typeParameterFrames.length === 0) {
    return undefined;
  }
  // Flattened innermost-last, so a nested specialization shadows an outer one.
  const merged = new Map<string, TypeRecord>();
  for (const frame of typeParameterFrames) {
    for (const [name, record] of frame) {
      merged.set(name, record);
    }
  }
  return merged;
}

/**
 * proposal-runtime-types: the Type Record bound to a type parameter
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

/**
 * Orders type arguments by the parameters they name.
 *
 * sec-type-expressions: "Each parameter takes, in order: its positional argument
 * where one was supplied, otherwise the named argument bearing its name,
 * otherwise its TypeParameterDefault."
 *
 * Returns a list in PARAMETER order with a hole where nothing was supplied, so
 * the existing default-filling loop below sees exactly the shape it already
 * handles - a shorter list, filled from the left. An application with no named
 * argument returns the list unchanged and takes the same path it does today,
 * which is the point: the cost of the feature falls only on those using it.
 */
function* OrderNamedTypeArguments(
  params: readonly ParseNode.TypeParameter[],
  argRecords: readonly TypeRecord[],
  argNames: readonly (string | undefined)[],
  typeName: string,
): PlainEvaluator<readonly TypeRecord[]> {
  if (!argNames.some((n) => n !== undefined)) {
    return argRecords;
  }
  // Positional arguments are exactly the leading ones; a positional after a
  // named one is refused, so a positional argument's meaning never depends on
  // the names used after it.
  const firstNamed = argNames.findIndex((n) => n !== undefined);
  for (let i = firstNamed; i < argNames.length; i += 1) {
    if (argNames[i] === undefined) {
      return Throw.TypeError('a positional type argument cannot follow a named one in $1', Value(typeName));
    }
  }
  const filled: (TypeRecord | undefined)[] = params.map((_, i) => (i < firstNamed ? argRecords[i] : undefined));
  for (let i = firstNamed; i < argNames.length; i += 1) {
    const name = argNames[i]!;
    const at = params.findIndex((p) => p.BindingIdentifier?.name === name);
    if (at === -1) {
      // Refused rather than ignored: a name matching nothing would otherwise be
      // discarded and the parameter would take its default, so a misspelling
      // would change what the program means without a diagnostic. This also
      // carries the array forms, which take type arguments and declare no
      // parameters at all, so there is no name for one to match.
      return Throw.TypeError('$1 does not name a type parameter of $2', Value(name), Value(typeName));
    }
    if (filled[at] !== undefined) {
      return Throw.TypeError('the type parameter $1 of $2 is supplied twice', Value(name), Value(typeName));
    }
    filled[at] = argRecords[i];
  }
  // Trim to the last supplied parameter: the loop below fills the rest from
  // their defaults, and a hole before a supplied one is a parameter with no
  // argument and no default, which that loop already reports.
  let last = -1;
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] !== undefined) {
      last = i;
    }
  }
  const ordered: TypeRecord[] = [];
  for (let i = 0; i <= last; i += 1) {
    const r = filled[i];
    if (r === undefined) {
      const missing = params[i]?.BindingIdentifier?.name ?? String(i);
      if (!(params[i] as unknown as { TypeParameterDefault?: unknown }).TypeParameterDefault) {
        return Throw.TypeError('the type parameter $1 of $2 has no argument and no default', Value(missing), Value(typeName));
      }
      // A default is a TypeParameterDefault node whose type may sit under `Type`
      // or be the node itself, depending on the production - reaching for the
      // wrong one throws before the type is ever resolved.
      const def = (params[i] as unknown as { TypeParameterDefault?: { Type?: ParseNode.Type } }).TypeParameterDefault!;
      ordered.push(Q(yield* TypeNodeToTypeRecord((def.Type ?? def) as ParseNode.Type)));
      continue;
    }
    ordered.push(r);
  }
  return ordered;
}

export function* InstantiateGenericAlias(declaration: ParseNode.TypeAliasDeclaration, argRecords: readonly TypeRecord[]): PlainEvaluator<TypeRecord> {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  // #sec-generics: a trailing parameter with a DEFAULT may be omitted, so an
  // alias may be written with fewer arguments than parameters - and with none
  // at all where every parameter has one, which is what makes a bare `A` a type
  // for `type A<T = uint8> = [].<T>`. Each omitted parameter takes its default,
  // resolved with the bindings made so far so that a later default may name an
  // earlier parameter.
  const firstDefault = params.findIndex((p) => (p as unknown as { TypeParameterDefault?: unknown }).TypeParameterDefault);
  const leastArgs = firstDefault === -1 ? params.length : firstDefault;
  if (argRecords.length < leastArgs || argRecords.length > params.length) {
    return Throw.TypeError('$1 is not a type', Value(declaration.BindingIdentifier.name));
  }
  if (argRecords.length < params.length) {
    const filled = [...argRecords];
    const frame = new Map<string, TypeRecord>();
    for (let i = 0; i < params.length; i += 1) {
      const name = params[i]!.BindingIdentifier?.name;
      if (i >= filled.length) {
        pushTypeParameterFrame(frame);
        try {
          filled.push(Q(yield* TypeNodeToTypeRecord((params[i] as unknown as { TypeParameterDefault: ParseNode.Type }).TypeParameterDefault)));
        } finally {
          popTypeParameterFrame();
        }
      }
      if (name) {
        frame.set(name, filled[i]!);
      }
    }
    argRecords = filled;
  }
  // proposal-runtime-types #sec-evaluation-budget: instantiating an alias is
  // type-level evaluation and must be metered. Without this a self-referential
  // alias - `type R<T> = R.<T>` - recursed until the HOST stack overflowed,
  // which is not an engine262 completion at all: no program could observe it
  // and the diagnostic the clause requires never appeared. The clause says
  // exhaustion is "not an abrupt completion the evaluated code can observe" and
  // that the evaluation is "abandoned"; a stack overflow is neither.
  // The budget is opened here when nothing has opened one. check-pass brackets
  // the CHECKING pass, and a `const` annotation is resolved at run time on a
  // path that never entered it - so ConsumeEvaluationSteps found no frame and
  // silently returned, which is why metering alone did not stop the recursion.
  // BeginTypeEvaluation joins an enclosing frame when there is one, so opening
  // it here does not reset a budget that is already running.
  // The budget frame must SPAN the recursive instantiation, not just the check
  // before it. Opening and closing it around the check alone let each level
  // open a fresh frame, so every recursion started from zero steps and the
  // stack overflowed exactly as before. BeginTypeEvaluation joins an enclosing
  // frame rather than opening a new one, which is what makes the span work.
  BeginTypeEvaluation();
  try {
    ConsumeEvaluationSteps(1);
    if (IsBudgetExhausted()) {
      return Throw.TypeError(
        'the type evaluation budget was exhausted at $1',
        Value(declaration.BindingIdentifier.name),
      );
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
  } finally {
    EndTypeEvaluation();
  }
}

/**
 * proposal-runtime-types (spec sec-computed-constraints): infer the
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
        // #sec-type-parameters: a VALUE parameter's argument "is a value of the
        // named type", and a default is an argument like any other - so `H:
        // uint32 = 2` binds a `uint32` and not the plain number it was spelled
        // as. Both halves of the literal move: its VALUE becomes one of the
        // constraint's, and its BASE becomes the constraint, without which the
        // check below refused a default against its own declared constraint.
        if (bound.Kind === 'literal' && constraint !== null && constraint.Kind === 'primitive') {
          const converted = EnsureCompletion(yield* ConvertValue(bound.Value, constraint));
          if (converted.Type === 'normal') {
            bound = { ...bound, Value: converted.Value as Value, Base: constraint } as never;
          }
        }
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
/**
 * proposal-runtime-types: the Type Record a VALUE carries, or undefined where it
 * carries none.
 *
 * Several value forms record the type they were produced at - a typed number, a
 * typed string, a typed bigint, a vector, and a decimal that is an enumerator -
 * and both RuntimeTypeOf and the enum membership test have to read the same set.
 * Reading them in two places is what let the two answers drift apart: an
 * enumerator of a numeric enum reported its enum while every other kind reported
 * its underlying type, and membership fell back to comparing CONTENT, so one
 * declaration's value satisfied another's enum.
 *
 * The carriers are named rather than duck-typed on the [[TypeRecord]] slot. A
 * TYPE OBJECT carries that slot too - it is how a Type Object holds the type it
 * denotes - so a slot test makes `Reflect.typeOf` of a Type Object answer with
 * the type it denotes instead of with Type. That is the same trap that made a
 * qualified `Color.Red` resolve to the whole enum, and it is worth stating twice.
 */
export function CarriedTypeRecordOf(value: unknown): TypeRecord | undefined {
  if (value instanceof TypedNumberValue || value instanceof TypedStringValue
      || value instanceof TypedBigIntValue || (value as Value)?.type === 'Vector') {
    return (value as { TypeRecord?: unknown }).TypeRecord as TypeRecord | undefined;
  }
  if (isDecimalObject(value as Value)) {
    return (value as unknown as { TypeRecord?: unknown }).TypeRecord as TypeRecord | undefined;
  }
  return undefined;
}

/**
 * A type name resolved as strict code resolves an identifier.
 *
 * ResolveBinding defaults `strict` to *false*, and a Module Environment Record
 * asserts that a read of it is strict - module code always is. Every resolution
 * below is the engine looking up a name a TYPE mentions (an alias, a library
 * name, a base, a meta declaration's shape), which is not a program's read at
 * all and carries no sloppy-mode meaning; resolving it non-strict brought the
 * HOST down on `type X = number; let d: X;` inside a module, an Assert failure
 * rather than a thrown error. The only observable difference strictness makes
 * to a resolution is for an unresolvable name, which throws a ReferenceError
 * either way once the reference is read.
 */
export function ResolveTypeName(name: JSStringValue) {
  return ResolveBinding(name, undefined, true);
}

export function RuntimeTypeOf(value: Value): TypeRecord {
  // proposal-runtime-types #sec-span-type: a WINDOW carries the Type Record it
  // was built at, for the reason a vector does - the type is not recoverable
  // from the value.
  //
  // A window has no own properties beyond the indices it reports, and it is not
  // an Array exotic, so inference read a SHAPE off it and produced the literal
  // type of `{}`. `f<T extends []>(window)` then failed its own bound while
  // `window is []` answered *true*, which is the two answers disagreeing that
  // #sec-instanceof-for-type-objects exists to prevent.
  if (value instanceof ObjectValue) {
    const spanBacking = ArraySpanBackingOf(value as unknown as object);
    if (spanBacking !== undefined) {
      return libraryTypeRecord('Span', [spanBacking.Element])!;
    }
    const viewBacking = ArrayViewBackingOf(value as unknown as object);
    if (viewBacking !== undefined) {
      return libraryTypeRecord('Span', [viewBacking.Element])!;
    }
  }
  // proposal-runtime-types #sec-vector-types: a vector carries the Type Record
  // it was built at, so its runtime type is read rather than inferred - the
  // same as a TypedNumberValue, and for the same reason: the lane type and
  // count are not recoverable from the lanes alone, since `float32x4(1,2,3,4)`
  // and `int32x4(1,2,3,4)` hold equal lane values. It is answered first because
  // a vector is a primitive here, and the branches below narrow past it.
  if (value.type === 'Vector') {
    return (value as VectorValue).TypeRecord as TypeRecord;
  }
  // proposal-runtime-types #sec-decorator-application: a reflection object
  // REPORTS the context it reflects, which is what lets `@f`, `@f(0)` and
  // `@f('a')` "select among them the way any call does" - the ordinary overload
  // machinery types each argument through here. Only objects this engine BUILT
  // as reflections are stamped; a hand-made object still satisfies the context
  // structurally but reports the shape it has.
  if (value instanceof ObjectValue) {
    const reflected = ReflectionContextRecordOf(value);
    if (reflected) {
      return reflected;
    }
    // proposal-runtime-types `sec-composite-types`: "`Reflect.typeOf` on a
    // composite returns the Type Object of its [[RuntimeType]], the same object
    // either spelling denotes" - so a composite reports its interned structural
    // composite type rather than the ordinary object shape it would otherwise
    // derive.
    const composite = CompositeTypeRecordOf(value);
    if (composite) {
      return composite;
    }
  }
  if (value instanceof ReferenceValue) {
    // proposal-runtime-types (references extension): a reference value never
    // reaches a type query; every read that could carry one dereferences first.
    throw OutOfRange.nonExhaustive(value);
  }
  // proposal-runtime-types: every value form that RECORDS the type it was
  // produced at is read through one accessor, so this and the enum membership
  // test cannot answer differently. Reading them separately is what let an
  // enumerator of a numeric enum report its enum while every other kind
  // reported its underlying type.
  const carried = CarriedTypeRecordOf(value);
  if (carried !== undefined) {
    return carried;
  }
  // #sec-enums: a value of an identity-compared underlying type carries its enum
  // OUTSIDE itself, since the enumerator is the value the program wrote. Read
  // after the reflection-context and composite arms above - a reflection object
  // is not an enumerator - and before the ordinary object type below.
  const claimed = RegisteredEnumOf(value);
  if (claimed !== undefined) {
    return claimed;
  }
  if (value instanceof TypedNumberValue) {
    return (value as TypedNumberValue).TypeRecord as TypeRecord;
  }
  // proposal-runtime-types: a String value carrying an inferred
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
  // proposal-runtime-types #sec-null-and-undefined-types: "These are the types
  // RuntimeTypeOf reports for *null* and *undefined*" - the `undefined` type,
  // not ~void~. Reporting ~void~ made a value whose runtime type is T fail to be
  // assignable to T, since no value is a value of the `void` type.
  if (value === Value.undefined) {
    return makePrimitive('undefined');
  }
  return makePrimitive('null');
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
/**
 * The ~array~ Type Record for an Array, or null where the value is not one.
 *
 * The union stops at `any`: once an element admits everything there is nothing
 * a further element could add, which also bounds the walk over a large array
 * whose elements vary.
 */
function runtimeArrayType(value: ObjectValue, seen: Set<ObjectValue>): TypeRecord | null {
  if (!isArrayExoticObject(value)) {
    return null;
  }
  const stamped = (value as { TypedElement?: TypeRecord, TypedExtent?: number });
  if (stamped.TypedElement !== undefined) {
    return {
      Kind: 'array',
      Element: stamped.TypedElement,
      Extent: stamped.TypedExtent ?? 'dynamic',
    } as TypeRecord;
  }
  const lengthValue = (value as { properties?: Map<PropertyKeyValue, Descriptor> })
    .properties?.get(Value('length'))?.Value;
  const length = lengthValue instanceof NumberValue ? Number(lengthValue.numberValue()) : 0; // eslint-disable-line @engine262/mathematical-value -- an Array length, not a mathematical value in the spec sense
  const members: TypeRecord[] = [];
  for (let i = 0; i < length; i += 1) {
    const element = (value as { properties: Map<PropertyKeyValue, Descriptor> })
      .properties.get(Value(String(i)))?.Value;
    // A hole, or an element on the cycle already being described, admits
    // anything as far as this type is concerned.
    const elementType = element === undefined
      ? anyType
      : (element instanceof ObjectValue && seen.has(element) ? anyType : RuntimeTypeOf2(element, seen));
    if (elementType.Kind === 'primitive' && elementType.Name === 'any') {
      return { Kind: 'array', Element: anyType, Extent: 'dynamic' } as TypeRecord;
    }
    if (!members.some((m) => SameType(m, elementType))) {
      members.push(elementType);
    }
  }
  const Element = members.length === 0
    ? anyType
    : (members.length === 1 ? members[0]! : CanonicalizeType({ Kind: 'union', Members: members } as TypeRecord));
  return { Kind: 'array', Element, Extent: 'dynamic' } as TypeRecord;
}

function runtimeObjectType(value: ObjectValue, seen: Set<ObjectValue>): TypeRecord {
  // A Proxy (or any Object) carrying an explicit runtime type reports it.
  const carried = (value as { RuntimeType?: TypeRecord }).RuntimeType;
  if (carried) {
    return carried;
  }
  // proposal-runtime-types #sec-runtimetypeof: an Array reports an ~array~ Type
  // Record, not the ~object~ Type Record describing its indices as properties.
  //
  // Membership walks a value's elements (#sec-array-membership), so `['a'] is
  // [].<string>` is true - but everything that RANKS types instead of walking
  // values went through here and saw an object type, which no array type
  // relates to. Overload resolution is the visible case: with `f(x:
  // [].<int32>)` and `f(s: [].<string>)` declared, NO argument could select
  // either, however it was written, because the comparison was between an
  // object type and an array type. Generic inference and `Reflect.typeOf` read
  // the same answer.
  //
  // A typed array reports the type it carries; an untyped one reports the
  // element type its contents support, which is the union of their types and is
  // exactly what membership asks of every element.
  const arrayType = runtimeArrayType(value, seen);
  if (arrayType) {
    return arrayType;
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
export function* DefaultValueOf(t: TypeRecord): PlainEvaluator<Value | undefined> {
  switch (t.Kind) {
    case 'parameter':
      // A generic parameter has no default, because nothing is known about what
      // an application will bind. Returning undefined here is what leaves an
      // uninitialized field of a parameter type alone, the same as a type with
      // no default - without it the field was checked against the parameter and
      // "undefined is not assignable to parameter" was reported for a
      // declaration a concrete type accepts.
      return undefined;
    case 'any':
      return Value.undefined;
    case 'void':
      return Value.undefined;
    case 'primitive': {
      // #sec-null-and-undefined-types: each is the type of its one value, so
      // that value is its default. They were literal types before, and the
      // ~literal~ case below answered for them; naming them as the clause does
      // moved them here.
      if ((t as { Name?: string }).Name === 'null') {
        return Value.null;
      }
      if ((t as { Name?: string }).Name === 'undefined') {
        return Value.undefined;
      }
      const name = t.Name;
      if (name === 'number') {
        // PLAN-parameterized-defaults.md phase 2. `number` was stamped here
        // alongside the value types, and it is the one name in that list whose
        // values are NOT the stamped ones: primitiveMembership answers
        // `value instanceof NumberValue && !(value instanceof TypedNumberValue)`
        // for it, because #sec-value-types gives the value types their own
        // values and "a plain Number is not a member of a numeric value type".
        // So the default of `number` was not a member of `number`, and the
        // contradiction surfaced one level up: DefaultValueOf's ~parameterized~
        // arm asks IsOfType(_d_, _t_), whose base check refused the stamped
        // zero, so `number.<{ ... }>` had NO default while the identical
        // `float64.<{ ... }>` had one. (Measured: `inBase= false` over `number`
        // against `inBase= true` over float64.)
        //
        // #sec-defaultvalueof step 2 is "if _t_ is a numeric type, return the
        // value of _t_ representing 0", and #sec-value-types is explicit that
        // ECMAScript "defines Number and BigInt that way" ALREADY, the new
        // types being numeric "in that sense". The value of the Number type
        // representing 0 is the Number +0. `bigint` below was always plain for
        // the same reason; `number` is now consistent with it.
        return Value(+0);
      }
      if (name === 'int' || name === 'uint' || name === 'float16' || name === 'float32' || name === 'float64') {
        return new TypedNumberValue(0, t);
      }
      if (name === 'string') {
 return Value(''); 
}
      if (name === 'boolean') {
 return Value.false; 
}
      if (name === 'bigint') {
 return Value(0n); 
}
      // #sec-defaultvalueof step 2 is "if _t_ is a numeric type, return the
      // value of _t_ representing 0", and the numeric types are broader than
      // the widths above: "Each integer, binary floating-point, DECIMAL
      // floating-point, rational, complex, and VECTOR type is a numeric type in
      // that sense."
      if (name === 'decimal32' || name === 'decimal64' || name === 'decimal128') {
        // Significand 0 at exponent 0, which is the cohort member `0` rather
        // than `0.00`: #sec-decimal-floating-point-types remembers precision, so
        // the zero has to be a particular member and the natural one is the
        // shortest. The record is carried so the value is of THIS width rather
        // than of a bare decimal.
        const width = name === 'decimal32' ? 32 : name === 'decimal64' ? 64 : 128;
        return CreateDecimalValue(0n, 0, width, surroundingAgent.currentRealmRecord, t);
      }
      if (name === 'complex') {
        // #sec-defaultvalueof: "If _t_ is a numeric type, return the value of
        // _t_ representing 0", and a complex type is a numeric type
        // (#sec-numeric-types-of-this-proposal names the complex family). Its
        // zero is the pair of its component's zeros - the row D20 had to leave
        // open, since the type objects did not exist to default.
        const component = (t.Arguments[0] as TypeRecord | undefined) ?? makePrimitive('number');
        return CreateComplexValue(0, 0, component, surroundingAgent.currentRealmRecord);
      }
      if (name === 'vector') {
        // "an array or an aggregate whose storage is zero-filled" - a vector's
        // storage is its lanes, so its zero is the zero of the lane type in
        // every lane. The bit-vector masks need no separate branch: `boolean8`
        // is a vector of `uint.<1>` with eight lanes, so the lane zero is the
        // integer zero and the result is the all-false mask `boolean8(0)`
        // builds.
        const laneType = t.Arguments[0] as TypeRecord | undefined;
        const laneCount = t.Arguments[1];
        if (!laneType || typeof laneCount !== 'number') {
          return undefined;
        }
        const lanes: Value[] = [];
        for (let i = 0; i < laneCount; i += 1) {
          // A lane is a value type and could be shared, but this is written as
          // the array and tuple cases above are so that a reader does not have
          // to work out why one aggregate differs.
          const lane = Q(yield* DefaultValueOf(laneType));
          if (lane === undefined) {
            return undefined;
          }
          lanes.push(lane);
        }
        return new VectorValue(lanes, t);
      }
      // #sec-defaultvalueof: "If _t_ is a numeric type, return the value of _t_
      // representing 0." float128 has values now, so it has a zero like every
      // other numeric type.
      if (name === 'float128') {
        return CreateFloat128Value(0n, 0, surroundingAgent.currentRealmRecord);
      }
      // `symbol` has no meaningful zero, which is a fact about the type rather
      // than about this engine.
      return undefined;
    }
    case 'literal':
      // The one value of a literal type is its default.
      return t.Value as Value;
    case 'union': {
      // A union defaults to null or undefined only when it admits one. Both are
      // now PRIMITIVE types named for their value (#sec-null-and-undefined-types),
      // so the member is recognized by name; the literal and ~void~ forms are
      // still accepted, since a union may be built from either.
      for (const m of t.Members) {
        if ((m.Kind === 'literal' && (m.Value as Value) === Value.null)
            || (m.Kind === 'primitive' && (m as { Name?: string }).Name === 'null')) {
          return Value.null;
        }
      }
      for (const m of t.Members) {
        if (m.Kind === 'void'
            || (m.Kind === 'primitive' && (m as { Name?: string }).Name === 'undefined')) {
          return Value.undefined;
        }
      }
      return undefined;
    }
    case 'array': {
      // #sec-defaultvalueof: a DYNAMIC extent defaults to a new empty array of
      // the type, and a FIXED one to an array of that many copies of the
      // element's default, or ~none~ where the element has none. "Every default
      // above is a zero: ... an array or an aggregate whose storage is
      // zero-filled", and the clause is explicit that zero-filling is part of
      // the semantics rather than an optimization - the reason given is
      // security, since an allocation exposing a previous one's bytes leaks
      // whatever was there.
      const out = X(ArrayCreate(0));
      StampTypedArray(out as ObjectValue, t.Element);
      if (t.Extent === 'dynamic') {
        return out;
      }
      if (typeof t.Extent !== 'number') {
        return undefined;
      }
      const element = Q(yield* DefaultValueOf(t.Element));
      if (element === undefined) {
        return undefined;
      }
      for (let i = 0; i < t.Extent; i += 1) {
        // Each element is its own instance, not the same one shared: a class
        // default is an object, and `d[0].a = 1` must not be visible at `d[1]`.
        const each = Q(yield* DefaultValueOf(t.Element));
        if (each === undefined) {
          return undefined;
        }
        X(CreateDataPropertyOrThrow(out, Value(String(i)), each));
      }
      return out;
    }
    case 'tuple': {
      // #sec-defaultvalueof: "For each element _e_ of _t_.[[Elements]], do: if
      // _e_.[[Rest]] is *false* and _e_.[[Initial]] is ~none~ and
      // DefaultValueOf(_e_.[[Type]]) is ~none~, return ~none~. Return a new
      // tuple of the type _t_ whose elements are, for each element ... whose
      // [[Rest]] is *false* and in order, its [[Initial]] where that is not
      // ~none~ and the default value of its [[Type]] otherwise."
      //
      // A rest position contributes nothing: it is empty by default, which is
      // why the clause walks only the [[Rest]]-false elements.
      const positions = t.Elements.filter((e) => !e.Rest);
      const out = X(ArrayCreate(positions.length));
      for (let i = 0; i < positions.length; i += 1) {
        const e = positions[i]!;
        // Each position is allocated on its own rather than sharing one
        // instance, for the reason the fixed-extent array above gives: a class
        // default is an object, and `d[0].a = 1` must not be visible at `d[1]`.
        let value;
        if (e.Initial === 'none') {
          value = Q(yield* DefaultValueOf(e.Type));
        } else {
          // The [[Initial]] is the initializer's value as written, not yet of
          // the position's type, so it is converted here exactly as the
          // boundary of #sec-array-defaults-and-stores converts a supplied one.
          value = Q(yield* CheckedConvertValue(e.Initial, e.Type));
        }
        if (value === undefined) {
          // A position with neither an initial nor a defaulting type: the
          // tuple has no default, and the refusal is the whole tuple's.
          return undefined;
        }
        X(CreateDataPropertyOrThrow(out, Value(String(i)), value));
      }
      return out;
    }
    case 'parameterized': {
      // #sec-defaultvalueof, the ~parameterized~ step: "Let _d_ be
      // DefaultValueOf(_t_.[[Base]]) ... Let _e_ be a new empty Object, which is
      // the metadata of a value of _t_.[[Base]] that carries none. Let
      // _crossed_ be Completion(ConvertParameterization(_d_, _e_,
      // _t_.[[Metadata]])). If _crossed_ is an abrupt completion, return
      // ~none~. Return _crossed_.[[Value]]."
      //
      // PLAN-parameterized-defaults.md phase 4. This tested MEMBERSHIP, which
      // secured the operation's contract but answered a different question than
      // the declaration beside it: `let w: T;` succeeded where `let w: T = 0;`
      // failed, because a bare zero is a MEMBER of a parameterization whose
      // `validate` admits it while CROSSING into one still wants a cast. The
      // clause now says the default is the base's zero having crossed, so the
      // two spellings of one declaration agree - and a brand keeps a zero
      // exactly where its base declares the cast that lets one in, which is
      // what keeps a unit type zero-fillable and `let d: [10].<A>;` working for
      // a class holding one.
      //
      // CrossBareValueIntoParameterization is this engine's spelling of the
      // clause's call: its ConvertParameterization takes two parameterized
      // records, and the bare-value case wants a _from_ whose every portion is
      // its meta type's `default`. It is deliberately NOT CheckedConvertValue,
      // which is a boundary and admits whatever is already a member - so a bare
      // zero would pass it with no cast declared, and the two spellings of one
      // declaration would go on disagreeing.
      const d = Q(yield* DefaultValueOf(t.Base));
      if (d === undefined) {
        return undefined;
      }
      const crossed = EnsureCompletion(yield* CrossBareValueIntoParameterization(d, t));
      if (crossed.Type === 'throw') {
        // "If _crossed_ is an abrupt completion, return ~none~": a type whose
        // zero cannot cross has no default, and the caller reports THAT - a
        // declaration needing an initializer - rather than the crossing's own
        // error, which names a boundary the program never wrote.
        return undefined;
      }
      return crossed.Value;
    }
    case 'nominal': {
      // #sec-rational-types is a numeric type too, but it resolves through the
      // library type names rather than as a ~primitive~ record, so its zero is
      // answered here rather than beside the decimals. Zero is 0/1, which is
      // what canonicalization gives any zero numerator.
      if ((t as { LibraryName?: string }).LibraryName === 'rational') {
        return CreateRationalValue(0n, 1n, surroundingAgent.currentRealmRecord);
      }
      // #sec-defaultvalueof: "If _t_ denotes a value type class, return the
      // instance of _t_ each of whose fields holds the default of the field's
      // type, or ~none~ if any field's type has no default."
      //
      // The instance comes into existence WITHOUT its constructor running,
      // which #sec-typed-classes endorses rather than tolerates: "a value type
      // class is a shape with a zero, not an object with an invariant its
      // constructor establishes", and a class that needs its constructor states
      // that by holding a field whose type has no default, which makes this
      // return ~none~ and the declaration a type error.
      //
      // Field-wise regardless of LAYOUT: a class holding a `string` field has
      // no layout and still has a default, so this reads the field list rather
      // than the layout walk's result.
      const constructor = t.Constructor as {
        Fields?: readonly { Name?: unknown, TypeObject?: { TypeRecord?: TypeRecord } }[],
        prototypeForDefault?: unknown,
      } | undefined;
      if (!constructor || !Array.isArray(constructor.Fields)) {
        return undefined;
      }
      const proto = (constructor as unknown as { properties?: Map<unknown, { Value?: Value }> })
        .properties?.get(Value('prototype'))?.Value;
      const instance = OrdinaryObjectCreate(proto instanceof ObjectValue ? proto : Value.null);
      const typed = new Map<unknown, { TypeRecord: TypeRecord }>();
      for (const field of constructor.Fields) {
        const record = field.TypeObject?.TypeRecord;
        const name = field.Name as { stringValue?: () => string } | undefined;
        if (!record || typeof name?.stringValue !== 'function') {
          // An untyped field has no declared default to fill.
          return undefined;
        }
        const value = Q(yield* DefaultValueOf(record));
        if (value === undefined) {
          return undefined;
        }
        X(CreateDataPropertyOrThrow(instance, Value(name.stringValue()), value));
        typed.set(name.stringValue(), { TypeRecord: record });
      }
      // The instance carries its field types, so a store into a defaulted
      // instance is checked exactly as one into a constructed instance is.
      (instance as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
      X(instance.PreventExtensions());
      return instance;
    }
    default:
      // object, function, tuple, intersection, parameterized, reference: no
      // default is materialized here, so a binding of such a type without an
      // initializer is a type error rather than silently undefined.
      return undefined;
  }
}

/**
 * proposal-runtime-types (dependentrecordtypes.md): a `where` clause is a
 * predicate over a value, evaluated at a typed boundary with `this` bound to the
 * value. The design describes the predicate as a function value, and it is
 * realized as one here: the predicate expression becomes the body of a
 * non-lexical-this function, so calling that function with the value as the
 * this-argument evaluates the predicate against the value. This reuses the same
 * machinery a class field initializer uses to evaluate an expression with `this`
 * bound to the instance.
 */
function* EvaluatePredicateExpression(expression: ParseNode.AssignmentExpressionOrHigher, value: Value): PlainEvaluator<Value> {
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  const fn = X(OrdinaryFunctionCreate(
    surroundingAgent.intrinsic('%Function.prototype%'),
    '',
    [] as unknown as ParseNode.FormalParameters,
    expression as unknown as ParseNode.AsyncConciseBody,
    'non-lexical-this',
    scope,
    privateScope,
  ));
  // Evaluating an expression body asserts a class-field initializer name is
  // present. A dummy satisfies it; it is read only when the body is an anonymous
  // function definition, which a boolean predicate is not.
  (fn as { ClassFieldInitializerName: Value }).ClassFieldInitializerName = Value('');
  return Q(yield* Call(fn, value, []));
}

/**
 * A `RefinementPredicate` is either a boolean expression or an
 * `if (test) { ... } else { ... }` over further predicates. The conditional is
 * control flow: its test selects the branch to check, and an `if` with no `else`
 * imposes no constraint when the test is false.
 */
function* EvaluateRefinementPredicate(predicate: ParseNode.RefinementPredicate, value: Value): PlainEvaluator<boolean> {
  if (predicate.type === 'ConditionalRefinement') {
    const testResult = Q(yield* EvaluatePredicateExpression(predicate.Test, value));
    const testHolds = ToBoolean(testResult) === Value.true;
    if (testHolds) {
      return Q(yield* EvaluateRefinementPredicate(predicate.Consequent, value));
    }
    if (predicate.Alternate) {
      return Q(yield* EvaluateRefinementPredicate(predicate.Alternate, value));
    }
    return true;
  }
  const result = Q(yield* EvaluatePredicateExpression(predicate, value));
  return ToBoolean(result) === Value.true;
}

/**
 * A dependent record type holds when every `where` clause's predicate holds of
 * the value. Multiple clauses compose as a conjunction.
 */
export function* EvaluateWhereClauses(value: Value, whereClauses: readonly ParseNode.WhereClause[]): PlainEvaluator<boolean> {
  for (const clause of whereClauses) {
    const holds = Q(yield* EvaluateRefinementPredicate(clause.RefinementPredicate, value));
    if (!holds) {
      return false;
    }
  }
  return true;
}

export function* IsOfType(value: Value, t: TypeRecord): PlainEvaluator<boolean> {
  // proposal-runtime-types #sec-references-and-borrowing: a Reference Value is
  // of a `ref T` when the storage it borrows currently holds a T. The check
  // reads through to the referent rather than testing the reference itself,
  // which is the same rule a `ref` parameter's annotation applies - a borrow is
  // checked against what it aliases and never converts it.
  //
  // Without this a reference type had no membership rule at all, so a function
  // declared `: ref uint32` failed its OWN return check the moment it returned
  // a borrow, which made an annotated `ref` return unusable and left a
  // location-consuming call (#sec-location-consuming-contexts) with no
  // well-typed callee to consume.
  if (t.Kind === 'reference') {
    if (value instanceof ReferenceValue) {
      const referent = Q(yield* GetValue(value.Location));
      return Q(yield* IsOfType(referent, t.Target));
    }
    // A value that reached here already decayed, and the absence of observable
    // identity means a program cannot ask whether something IS a reference,
    // only what it refers to - so a decayed value is tested against the
    // borrowed type, which is what this case did before a borrow could arrive.
    return Q(yield* IsOfType(value, t.Target));
  }
  // proposal-runtime-types #sec-threading-shared-modifier: "A value of type T is
  // assignable to storage of type `shared T` ... and a read of that storage yields
  // a value of T. The modifier is therefore not observable in the value." So
  // membership is membership in the target, in BOTH directions: it is how a value
  // is published into shared storage, and how one read out of it is still a T.
  if (t.Kind === 'shared') {
    return Q(yield* IsOfType(value, t.Target));
  }
  // proposal-runtime-types `sec-composite-types`: the top composite type "is the
  // type of every composite", and a composite type over a shape is satisfied by
  // a composite whose own type is a subtype of it. Membership is answered
  // through the value's RUNTIME type and IsSubtype rather than by a rule here,
  // which is what keeps the covariance-in-the-shape judgment in one place.
  //
  // Without this, `let c: Composite = Composite({x: 1})` was accepted - the
  // assignment goes through IsSubtype - while `Composite({x: 1}) is Composite`
  // answered *false*. One relation said yes and the other no about the same
  // pair, which a pattern form made visible.
  // proposal-runtime-types (PLAN-decimal.md stage B): a decimal value belongs to
  // the decimal type of its own WIDTH. The value is an object carrying a
  // significand and an exponent - the structural test is written out here for
  // the reason the rational one beside it is, so the type system does not depend
  // on an intrinsic module.
  // proposal-runtime-types #sec-vector-types: a vector is a value of `vector.<T,
  // N>` when it was built at that type. The lanes are already of T - the
  // construction converted each - so the check is the type's identity, not a
  // walk. SameType rather than reference equality, since a record reaching here
  // may be an equal one built elsewhere.
  if (value.type === 'Vector') {
    return SameType((value as VectorValue).TypeRecord as TypeRecord, t);
  }
  // proposal-runtime-types #sec-enums: "membership in `int32` follows from
  // `Count` being a subtype of it, not from a second runtime type". An
  // enumerator's runtime type is its ENUM, so a test against the underlying
  // type has to go through the subtype relation - without this, tagging
  // enumerators with the enum made `E.A is uint8` false for a `uint8` enum.
  if (value instanceof TypedNumberValue) {
    const valueRecord = (value as TypedNumberValue).TypeRecord as TypeRecord | undefined;
    if (valueRecord?.Kind === 'nominal' && valueRecord.EnumMembers !== undefined
        && valueRecord.Underlying !== undefined
        && !(t.Kind === 'nominal' && t.EnumMembers !== undefined)
        // A qualified member such as `Color.Red` denotes the ENUMERATOR, and is
        // a literal type over the enum. Reading the value at its underlying type
        // before that test would compare an int32 against an enum-tagged member
        // and answer false for the enumerator the type names.
        && !(t.Kind === 'literal' && t.Base !== undefined && UnderlyingOf(t.Base) !== t.Base)) {
      return yield* IsOfType(new TypedNumberValue((value as TypedNumberValue).value, valueRecord.Underlying), t);
    }
  }
  if (t.Kind === 'primitive' && (t.Name === 'decimal32' || t.Name === 'decimal64' || t.Name === 'decimal128')) {
    if (value instanceof ObjectValue && 'DecimalSignificand' in value) {
      const width = (value as unknown as { DecimalWidth: number }).DecimalWidth;
      return t.Name === `decimal${width}`;
    }
    return false;
  }
  if (t.Kind === 'primitive' && t.Name === 'Composite') {
    const composite = CompositeTypeRecordOf(value);
    if (!composite) {
      return false;
    }
    return IsSubtype(composite, t, []);
  }
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
      // #sec-isoftype, the arm's FIRST step: "If IsSubtype(RuntimeTypeOf(value),
      // _t_, « ») is *true*, return *true*." It was absent, and the absence only
      // becomes visible once a brand can be crossed into (PLAN-parameterized-
      // defaults.md phase 1): a value that crossed through an implicit cast is
      // stamped AT the target - "its result is taken AT the target rather than
      // checked against it" - and yet every later boundary asked the judgment
      // again and answered *false* for a meta type defining no `validate`. The
      // binding would hold a `Velocity` that `v is Velocity` denied and that no
      // `Velocity` parameter would accept.
      //
      // The carried record is read rather than calling RuntimeTypeOf, which for
      // an Object infers a shape: every value that can be of a parameterized
      // type is a primitive stamped at construction, so the carried record IS
      // what RuntimeTypeOf would answer, and reading it keeps this arm off the
      // inference path. The enum arm below reads it the same way and for the
      // same reason.
      const carried = CarriedTypeRecordOf(value);
      if (carried !== undefined && IsSubtype(carried, t, [])) {
        return true;
      }
      // #sec-isoftype: a value belongs to a parameterized type when it belongs
      // to the base and the meta type's validate judgment holds of the
      // metadata. The base's Type Object carries the hook.
      if (!Q(yield* IsOfType(value, t.Base))) {
        return false;
      }
      // #sec-primitive-metadata: the metadata's own keys select the meta types
      // that govern it, and those supply the validation judgment. A hook declared
      // against the BASE is consulted too, which is how `meta float32 { validate }`
      // works, but the design's own form declares against the METADATA type and
      // reaches the parameterization through the claim rather than by naming it.
      // #sec-primitive-metadata, the validation judgment: it holds "when, for
      // every meta type M whose portion is not M's default, M DEFINES `validate`
      // and it holds of v and that portion". Both halves matter. A meta type that
      // constrains and defines no `validate` therefore admits NO bare value of
      // the base, "which is what makes a brand a brand": a brand's whole purpose
      // is that its base cannot arrive at it except through the construction
      // boundary, and admitting bare values would make it a comment.
      const { types: governing } = GoverningMetaTypes(t.Metadata);
      for (const metaType of governing) {
        if (!MetaTypeGoverns(t.Metadata, metaType)) {
          // The sit-out (the judgment's "whose portion is not M's default"): a
          // portion equal to the default constrains nothing, so the meta type
          // takes no part, and a brand written at its own default admits every
          // bare value of the base while remaining a distinct type, the plan's
          // section 2, third consequence.
          continue;
        }
        // "it holds of v and THAT PORTION": each meta type judges its own
        // portion, completed from its default, never the whole metadata. This
        // call site bypassed MetadataPortion entirely until the plan's Phase 1
        // (the audit's C2 named three call sites; this was the unlisted
        // fourth, and the reason a two-key `validate` saw undefined where the
        // defaulted key should be).
        const verdict = Q(yield* ApplyValidateHook(metaType, value, MetadataPortion(t.Metadata, metaType)));
        if (verdict === undefined) {
          // The meta type claims a key here and offers no judgment, so it
          // constrains without admitting. This is the brand case.
          return false;
        }
        if (verdict === false) {
          return false;
        }
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
      // proposal-runtime-types soa.md: "`SoA.<T>` and `[].<T>` are DISTINCT TYPES
      // WITH DISTINCT LAYOUTS, and NEITHER IS ASSIGNABLE TO THE OTHER."
      //
      // The judgment below is structural - a `length` and elements of the right
      // type - and an SoA has both, so it satisfied an array type by duck
      // typing. That is exactly what the design refuses: "making the two
      // silently interchangeable, as Julia's StructArrays does, reads well until
      // a function needs the concrete layout, and then the abstraction has to be
      // undone. Keeping the layout in the type means every call site knows which
      // it has."
      if (t.Kind === 'array' && SoAStorageOf(value as unknown as object) !== undefined) {
        return false;
      }
      const lenValue = Q(yield* Get(value, Value('length')));
      // proposal-runtime-types: a TYPED array reports a typed `length` - a
      // `uint32` rather than a plain Number - so testing for NumberValue alone
      // rejected every typed array against its own array type. `[].<uint32>`
      // answered *false* for `a is [].<uint32>`, and, because every typed
      // boundary consults this membership before deciding whether to convert,
      // an array that already satisfied its type was rebuilt instead of passed
      // through: a typed array parameter COPIED its argument, so writes through
      // it never reached the caller. Reading the length through the one named
      // unwrap admits both spellings of the same number.
      if (!(lenValue instanceof NumberValue) && !isTypedNumber(lenValue)) {
        return false;
      }
      const len = R(unwrapToNumber(lenValue as NumberValue | TypedNumberValue));
      if (t.Kind === 'array') {
        if (t.Extent !== 'dynamic' && t.Extent !== len) {
          return false;
        }
        // The run-time half of #sec-array-and-tuple-types' extent rule. A FIXED
        // array is not a member of a dynamic array type: it cannot be grown and
        // that type says it can. The static and dynamic answers have to agree,
        // because `match` dispatches on membership - without this a pattern
        // could select a branch the checker calls impossible.
        //
        // The FAMILY BOUND is excepted. Bare `[]` is `[].<any>`, and
        // #sec-array-and-tuple-types makes it the top of the array and tuple
        // family - "satisfied by any array or tuple" - so a fixed array is a
        // member of it. Without this exception the two clauses contradicted
        // each other: `a is []` answered *false* for a `[4].<T>` while a
        // parameter typed `[]` accepted one, and it accepted one by COPYING,
        // since membership failing sent the value to the conversion. The
        // family bound is not a promise of growth; it is the statement that
        // the element type is not being constrained.
        if (t.Extent === 'dynamic' && t.Element.Kind !== 'any'
            && (value as unknown as { TypedExtent?: number }).TypedExtent !== undefined) {
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
      // PLAN-rest-parameters.md phase 3, per #sec-array-membership.
      //
      // A tuple with NO rest is positional and exact, which is the common case
      // and reads each element once. Any rest at all goes through
      // SequenceAssignment: which element receives which run is its answer, and
      // hand-rolling the mapping is what left two defects here. The length
      // check ignored elements AFTER a rest, so `[1]` satisfied
      // `[number, ...[].<string>, boolean]` with the required boolean missing;
      // and a rest element's Type is the ARRAY it stands for, so comparing an
      // element against it directly meant no rest ever matched anything.
      const restCount = t.Elements.filter((e) => e.Rest).length;
      if (restCount === 0) {
        // #sec-array-membership: an element's slot "is optional exactly when its
        // [[Initial]] is not ~none~", so a value may stop short of the trailing
        // positions that carry a default. The exact-length test could never see
        // one, because [[Initial]] was always ~none~ - which is what made the
        // design's "a shorter array satisfies a longer tuple return"
        // unreachable.
        const requiredLength = t.Elements.filter((e) => e.Initial === 'none').length;
        if (len < requiredLength || len > t.Elements.length) {
          return false;
        }
        for (let i = 0; i < len; i += 1) {
          const el = Q(yield* Get(value, Value(String(i))));
          if (!Q(yield* IsOfType(el, t.Elements[i].Type))) {
            return false;
          }
        }
        return true;
      }
      // The predicate SequenceAssignment takes is synchronous and IsOfType is
      // not, so the admissions are computed first: one Get per position, and one
      // IsOfType per (position, element). A rest is asked about its ELEMENT
      // type, which is what one item reaching it must be.
      const items: Value[] = [];
      for (let i = 0; i < len; i += 1) {
        items.push(Q(yield* Get(value, Value(String(i)))));
      }
      const admitted: boolean[][] = [];
      for (let i = 0; i < len; i += 1) {
        const row: boolean[] = [];
        for (const e of t.Elements) {
          row.push(Q(yield* IsOfType(items[i], e.Rest ? restElementType(e.Type) : e.Type)));
        }
        admitted.push(row);
      }
      const slots = t.Elements.map((e) => ({ Rest: e.Rest, Optional: e.Initial !== 'none' }));
      return SequenceAssignment(slots, len, (i, k) => admitted[i][k]) !== 'unmatched';
    }
    case 'nominal': {
      if (t.EnumMembers) {
        // #sec-enums: an enum is "a ~nominal~ type whose values are its
        // enumerators", so a value is of this enum only where THIS declaration
        // produced it - which is what the carried Type Record records. Comparing
        // CONTENT against the member list cannot tell one declaration's "s" from
        // another's, so a value of one enum satisfied an unrelated enum, passed
        // its parameters, and selected its case labels.
        const carriedByValue = CarriedTypeRecordOf(value);
        if (carriedByValue !== undefined) {
          // A refinement question, not an equality one.
          return IsSubtype(carriedByValue, t, []);
        }
        // An identity-compared value carries its enum outside itself.
        const claimedByValue = RegisteredEnumOf(value);
        if (claimedByValue !== undefined) {
          return IsSubtype(claimedByValue, t, []);
        }
        // A value carrying nothing can only be an enumerator of an enum whose
        // members carry nothing either. Without this guard a bare "x" matches a
        // tagged enumerator by content and `"x" is S` stays true - the answer
        // the one-way rule already refuses for a numeric enum, where `0 is N` is
        // false and `N(0)` is the way in.
        return t.EnumMembers.some((m) => CarriedTypeRecordOf(m) === undefined
          && RegisteredEnumOf(m) === undefined
          && SameValue(value, m));
      }
      // PLAN-nominal-records.md phase 2. A CLASS type is not satisfied
      // structurally: "a class states a construction and an identity as well as
      // a shape, and it is the identity that its type is for"
      // (#sec-object-types). Membership follows the prototype chain, which the
      // [[Constructor]] arm below decides.
      //
      // The guard exists because phase 2 gave a runtime class record a
      // [[Structure]] for SUBTYPING - the relation needs it to decide that a
      // class satisfies an interface it implements - and this operation would
      // otherwise have read the same field as a membership rule, which made
      // `{} instanceof (type A)` true for any class `A` with no members and let
      // `f({})` through for `function f(a: A)`. Subtyping and membership are
      // different questions of the same record.
      const isClassType = (t.Declaration as { type?: string } | undefined)?.type === 'ClassDeclaration'
        || (t.Declaration as { type?: string } | undefined)?.type === 'ClassExpression';
      if (t.Structure && !isClassType) {
        const structurallyMatches = Q(yield* IsOfType(value, t.Structure));
        if (!structurallyMatches) {
          return false;
        }
        // proposal-runtime-types (dependentrecordtypes.md): a dependent record
        // type's `where` clauses ride on its declaration. They are the boundary
        // check: the value is of the type only when every predicate holds. A
        // declaration with no `where` clauses (an interface, a plain alias) skips
        // this and costs nothing.
        const whereClauses = (t.Declaration as { WhereClauses?: readonly ParseNode.WhereClause[] | null }).WhereClauses;
        if (whereClauses && whereClauses.length > 0) {
          return Q(yield* EvaluateWhereClauses(value, whereClauses));
        }
        return true;
      }
      // #sec-isoftype nominal: a class type's members are the instances whose
      // prototype chain reaches the constructor bound by [[Declaration]]. A
      // built-in class type (a Temporal class) carries its resolved [[Constructor]]
      // and no source ClassDeclaration, so the presence of a constructor is the
      // general signal that membership is the prototype-chain test.
      if ((t.Constructor as Value | undefined) !== undefined || t.Declaration.type === 'ClassDeclaration' || t.Declaration.type === 'ClassExpression') {
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
          const ref = Q(yield* ResolveTypeName(Value(bi.name)));
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
      // proposal-runtime-types #sec-reflection-contexts: a REFLECTION CONTEXT
      // is a nominal type whose values are the reflection objects that context
      // names - what `Reflect.getReflection` returns and what a decoration
      // supplies as its last argument. decorators.md writes each one as an
      // object shape (`type ClassFieldReflection = { ... }`, and the
      // `Reflect.Class` interface extending it), so membership is STRUCTURAL,
      // and the structure carries its own discriminant: every reflection object
      // this engine builds sets `kind` to the context's name.
      //
      // This branch has to come before the library one below, and that ordering
      // IS the bug it fixes. A context's [[LibraryName]] is a DOTTED name
      // ("Reflect.ClassField"), and the library branch resolves a
      // [[LibraryName]] as a global BINDING - which is right for `Map` and
      // `Error` and a ReferenceError for every context. The symptom was that
      // annotating a decorator's last parameter with its context, the form
      // #sec-decorator-application defines and every example in decorators.md
      // is written in, threw as soon as the decorator ran; only an UNTYPED
      // parameter worked, so overload resolution BY CONTEXT TYPE could never be
      // reached.
      {
        const contextDeclaration = t.Declaration as unknown as { type?: string, name?: string };
        if (contextDeclaration?.type === 'ReflectionContext') {
          if (!(value instanceof ObjectValue)) {
            return false;
          }
          const kind = Q(yield* Get(value, Value('kind')));
          if (!(kind instanceof JSStringValue)) {
            return false;
          }
          // `Reflect.Type` is the exception, and it is the one the design
          // already names: it "is the one reflection target that is not also a
          // decorator context". Its reflection is discriminated by the
          // STRUCTURE it reports - ~primitive~, ~union~, ~array~, and the rest
          // - so the context's own name never appears in one, and the test is
          // that the value is a discriminated reflection at all.
          if (contextDeclaration.name === 'Type') {
            return true;
          }
          return kind.stringValue() === contextDeclaration.name;
        }
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
        // proposal-runtime-types (#sec-ranges): a range's BOUNDS are part of its
        // type - "the four intervals of a two-endpoint range ... are the four
        // pairs and nothing further is expressible" - so a parameterization that
        // names them must distinguish them. The prototype chain below cannot:
        // every range has one prototype, so without this every range satisfied
        // every `Range.<...>`, and two spellings that name different intervals
        // were the same type.
        if (isRangeShapeName(t.LibraryName)) {
          return rangeShapeMatches(value, t.LibraryName)
            && rangeMatchesBoundArguments(value, t.LibraryName, t.Arguments);
        }
        // #sec-span-type: a window's membership is NOT a prototype-chain
        // question — there is no `Span` global and no window prototype, a
        // window being a way of viewing storage rather than a class of object.
        //
        // Nor is it "does this coerce". An owned array is ASSIGNABLE to
        // `Span.<T>` and is not one, exactly as the literal 5 is assignable to
        // `uint8` while `5 is uint8` is *false*: the boundary converts, and
        // #sec-span-coercion says that conversion MATERIALIZES. Answering true
        // here would mean no conversion was needed, so no window would ever be
        // built and the liveness rule would have nothing to attach to.
        //
        // So the test is: is this value a window, and is it a window of T.
        if (t.LibraryName === 'Span') {
          const element = (t.Arguments.length > 0 ? t.Arguments[0] : { Kind: 'any' as const }) as TypeRecord;
          const spanBacking = ArraySpanBackingOf(value as unknown as object);
          const viewBacking = ArrayViewBackingOf(value as unknown as object);
          const backingElement = spanBacking?.Element ?? viewBacking?.Element;
          if (backingElement === undefined) {
            return false;
          }
          return element.Kind === 'any' || SameType(backingElement, element);
        }
        const ref = Q(yield* ResolveTypeName(Value(t.LibraryName)));
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
        const key = propertyKeyValue(p.key);
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
  // proposal-runtime-types #sec-vector-types: a vector's membership is decided
  // by the Type Record it carries and nothing else, which RuntimeTypeOf and
  // IsOfType already do before reaching here. A value that is not a vector is
  // not a MEMBER of a vector type - it may CONVERT to one by the broadcast of
  // #sec-vector-lanes, which is a different question and is
  // CheckedConvertValue's.
  //
  // Answering it here is what breaks a cycle: without this case the name fell
  // to a default that asked CheckedConvertValue, whose broadcast branch asks
  // IsOfType, which came back here. The stack overflowed rather than reporting.
  if (name === 'vector') {
    return false;
  }
  // proposal-runtime-types #sec-the-type-type: the values of `type` are the
  // Type Objects. `type` is itself a type, so the Type Object FOR `type` is
  // among them - the clause's own recursive case, which follows from asking
  // what the value is rather than what it names.
  if (name === 'type') {
    return isTypeObject(value);
  }
  // proposal-runtime-types #sec-complex-types: the values of `complex.<T>` are
  // "the ordered pairs of a real part and an imaginary part, each a value of
  // _T_", so membership is being such a pair over the same component type. A
  // pair carries the component its constructor gave it; one built by the bare
  // `complex(re, im)` constructor carries none and is a `complex.<number>`,
  // since "the bare name `complex` is `complex.<number>`".
  // #sec-binary-floating-point-types: a float128's values are the format's, and
  // this engine carries them as software pairs, so membership is being one.
  if (name === 'float128') {
    return isFloat128Object(value);
  }
  if (name === 'complex') {
    if (!isComplexObject(value)) {
      return false;
    }
    const component = (args[0] as TypeRecord | undefined) ?? makePrimitive('number');
    const carried = ((value as { ComplexComponent?: TypeRecord }).ComplexComponent) ?? makePrimitive('number');
    return SameType(carried, component);
  }
  switch (name) {
    // proposal-runtime-types #sec-null-and-undefined-types: `undefined` is "the
    // type whose one value is *undefined*", so membership is exactly that one
    // value. Without this case the name fell to the default below, which asks
    // whether the value CONVERTS, and *undefined* converts to nothing - so a
    // value was not a member of the very type RuntimeTypeOf reports for it.
    case 'undefined':
      return value === Value.undefined;
    case 'null':
      return value === Value.null;
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
      let r = (value as TypedNumberValue).TypeRecord as TypeRecord;
      // #sec-primitive-metadata, the branding rule: a parameterized type is a
      // subtype of its base, so a value carrying `float64.<{ min: 0 }>` IS a
      // float64 � which is what lets a constructed value satisfy its own
      // type's base check, and what F33's construction boundary produces.
      if (r.Kind === 'parameterized') {
        r = r.Base;
      }
      return r.Kind === 'primitive' && r.Name === name
        && r.Arguments.length === args.length
        && r.Arguments.every((a, i) => a === args[i]);
    }
    case 'number': {
      // PLAN-parameterized-defaults.md phase 2b. A plain Number is `number` and
      // a value type's value is not, which is what this arm existed to say. But
      // it said it by excluding EVERY carried value, and a value of
      // `number.<M>` is necessarily carried - the parameterization is what the
      // value carries - so a value of a `number` parameterization was not a
      // value of `number`. That contradicts the branding rule of
      // #sec-parameterized-types, "a parameterized type is a subtype of its
      // base, so the brand is shed freely on the way up", which the numeric
      // value types' arm above already implements by shedding [[Base]] before
      // comparing.
      //
      // It surfaced through the cast: with a cast declared on `number`, the
      // crossing's stamped result failed the base check of the boundary that
      // received it, so DECLARING a cast broke assignments that had worked
      // without one. Shedding here is the same rule the arm above applies, and
      // it still refuses a float64 or a uint8, whose shed name is not `number`.
      if (value instanceof TypedNumberValue) {
        let r = (value as TypedNumberValue).TypeRecord as TypeRecord;
        if (r.Kind === 'parameterized') {
          r = r.Base;
        }
        return r.Kind === 'primitive' && r.Name === 'number';
      }
      return value instanceof NumberValue;
    }
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

/**
 * A type argument as the record wants it: a numeric literal type is a WIDTH or a
 * LANE COUNT rather than a type - `int.<8>` carries the number 8, not a literal
 * type of 8 - so it is unwrapped here. Exported because an application in
 * EXPRESSION position resolves its arguments the same way, and a family record
 * built with a literal type where a number belongs has no layout at all.
 */
export function toNumericArgument(record: TypeRecord): TypeRecord | number {
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

/**
 * proposal-runtime-types (primitivemetadata.md): the metadata VALUE a metadata
 * parameterization carries, built from the object type written as its argument.
 * Each field's type is a literal, and the value is that literal's value, so
 * `{ unit: "m" }` yields an object with a `unit` of `"m"`. The object is frozen and
 * null-prototyped: a meta type's hooks read it, and the specification requires them
 * to be pure functions of their arguments.
 */
/**
 * #sec-primitive-metadata, table-metadata-values: a metadata value is drawn from
 * a closed language. The top level is a flat record of claimed keys, and the
 * values under them may nest freely, so this reads a nested record and a list as
 * well as a primitive.
 *
 * Dropping the forms it could not read was not a limitation but a defect: a
 * property whose value did not survive simply vanished, and since interning
 * compares what survives, `float32.<{ q: { a: 1 } }>` and `float32.<{ q: { a: 2 }
 * }>` both reduced to the empty record and were ONE TYPE. Two distinct types
 * silently becoming one is the sharpest failure this design has, because nothing
 * about it looks wrong at the site that wrote it.
 *
 * A form the language does not admit is still omitted, which is correct: the
 * clause says nothing else is a metadata value, and the parameterization that
 * writes one is a type error the checker is to report at the site.
 */
function metadataValueFromType(t: TypeRecord): unknown {
  if (t.Kind === 'literal') {
    return t.Value;
  }
  if (t.Kind === 'pattern') {
    // A leaf of the metadata language, carried structurally. The marker is what
    // lets the comparison and the hook boundary tell it from a nested record.
    const marker: Record<string, unknown> = Object.create(null);
    marker.__pattern = true;
    marker.source = t.Source;
    marker.flags = t.Flags;
    return Object.freeze(marker);
  }
  if (t.Kind === 'range') {
    // A leaf of the metadata language, carried structurally like a pattern. The
    // marker is what lets the comparison and the hook boundary tell it from a
    // nested record.
    const marker: Record<string, unknown> = Object.create(null);
    marker.__range = true;
    marker.start = t.Start;
    marker.end = t.End;
    marker.startBound = t.StartBound;
    marker.endBound = t.EndBound;
    return Object.freeze(marker);
  }
  if (t.Kind === 'object') {
    const nested: Record<string, unknown> = Object.create(null);
    for (const p of t.Properties) {
      const v = metadataValueFromType(p.type);
      // A SYMBOL-keyed member is skipped in this projection rather than
      // stringified: the projection is the plain object a hook receives, and
      // giving it a key spelled "Symbol(x)" would let two distinct symbols
      // collide on one string, which is the collision the symbol key exists to
      // avoid. A hook that needs one reads it through the reflection.
      if (v !== METADATA_NOT_A_VALUE && typeof p.key === 'string') {
        nested[p.key] = v;
      }
    }
    return Object.freeze(nested);
  }
  if (t.Kind === 'tuple') {
    const list: unknown[] = [];
    for (const e of t.Elements) {
      const v = metadataValueFromType(e.Type);
      if (v === METADATA_NOT_A_VALUE) {
        return METADATA_NOT_A_VALUE;
      }
      list.push(v);
    }
    return Object.freeze(list);
  }
  return METADATA_NOT_A_VALUE;
}

/** Distinguishes "this form is not a metadata value" from a value of *undefined*. */
const METADATA_NOT_A_VALUE = Symbol('not-a-metadata-value');

export function MetadataObjectFromType(t: TypeRecord): Value {
  const fields: Record<string, unknown> = Object.create(null);
  if (t.Kind === 'object') {
    for (const p of t.Properties) {
      const v = metadataValueFromType(p.type);
      // Symbol-keyed members are skipped here for the reason given above.
      if (v !== METADATA_NOT_A_VALUE && typeof p.key === 'string') {
        fields[p.key] = v;
      }
    }
  }
  return Object.freeze(fields) as unknown as Value;
}


/**
 * proposal-runtime-types #sec-compile-time-evaluability: "Evaluation is confined
 * to checking and READS DECLARATIONS RATHER THAN RUN-TIME BINDINGS."
 *
 * A type annotation naming a class reads that class's DECLARATION. The engine
 * resolved it through ResolveBinding and GetValue, which is the run-time
 * binding, so a name in its temporal dead zone was refused - and a class's own
 * binding is in its dead zone for the whole of its declaration. That made
 * `class N { next: N | null; }` a ReferenceError, along with a forward
 * reference to a class declared later and a self-referential alias, while a
 * METHOD signature naming the same class worked, because a signature is not
 * resolved at declaration and a field's type is.
 *
 * This finds the declaration by walking the parse tree the annotation sits in.
 * The nominal record it builds is keyed on the DECLARATION node, which is what
 * SameType compares, so the record built here and the one built after the class
 * is initialized are the same type.
 */
function declarationNamed(from: ParseNode, name: string): ParseNode | null {
  const seen = new Set<ParseNode>();
  let node: ParseNode | undefined = from;
  while (node && !seen.has(node)) {
    seen.add(node);
    const lists = [
      (node as { StatementList?: readonly ParseNode[] }).StatementList,
      (node as { ScriptBody?: { StatementList?: readonly ParseNode[] } }).ScriptBody?.StatementList,
      (node as { ModuleBody?: { ModuleItemList?: readonly ParseNode[] } }).ModuleBody?.ModuleItemList,
      (node as { FunctionStatementList?: readonly ParseNode[] }).FunctionStatementList,
    ];
    for (const list of lists) {
      for (const item of list ?? []) {
        const declared = item as {
          type?: string,
          BindingIdentifier?: { name?: string },
          Declaration?: { type?: string, BindingIdentifier?: { name?: string } },
        };
        const inner = declared.type === 'ExportDeclaration' ? declared.Declaration : declared;
        if (!inner) {
          continue;
        }
        if ((inner.type === 'ClassDeclaration' || inner.type === 'TypeAliasDeclaration')
            && inner.BindingIdentifier?.name === name) {
          return inner as unknown as ParseNode;
        }
      }
    }
    node = (node as { parent?: ParseNode }).parent;
  }
  return null;
}

export function* TypeNodeToTypeRecord(node: ParseNode.Type): PlainEvaluator<TypeRecord> {
  switch (node.type) {
    case 'TypeReference': {
      // proposal-runtime-types #sec-higher-kinded-parameters: "Within the
      // declaration that introduces it, a higher-kinded parameter may appear
      // only applied. It is not a type." An unapplied reference to one is
      // refused HERE rather than allowed to resolve to a record that would then
      // behave as a type everywhere downstream.
      // proposal-runtime-types #sec-higher-kinded-parameters: `W.<T>` where `W`
      // is a bound higher-kinded parameter. The parameter resolves to the
      // DECLARATION an application bound to it, and that is then applied - so
      // `W.<X>` means the same as writing the bound declaration applied to X.
      if (node.TypeName.MemberNames.length === 0 && node.TypeArguments) {
        const appliedName = node.TypeName.IdentifierReference.name;
        const boundDecl = lookupTypeParameter(appliedName);
        if (boundDecl && boundDecl.Kind !== 'parameter') {
          const argRecords: TypeRecord[] = [];
          const argNames: (string | undefined)[] = [];
          for (const argNode of node.TypeArguments.TypeArgumentList) {
            argNames.push((argNode as { ArgumentName?: string }).ArgumentName);
            argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
          }
          if (boundDecl.Kind === 'nominal' && boundDecl.Declaration?.type === 'TypeAliasDeclaration'
              && (boundDecl.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
            const aliasDecl = boundDecl.Declaration as ParseNode.TypeAliasDeclaration;
            return Q(yield* InstantiateGenericAlias(
              aliasDecl,
              Q(yield* OrderNamedTypeArguments(
                aliasDecl.TypeParameters?.TypeParameterList ?? [],
                argRecords,
                argNames,
                aliasDecl.BindingIdentifier.name,
              )),
            ));
          }
          if (boundDecl.Kind === 'nominal') {
            return { ...boundDecl, Arguments: argRecords };
          }
        }
      }
      if (node.TypeName.MemberNames.length === 0 && !node.TypeArguments) {
        const kindedName = node.TypeName.IdentifierReference.name;
        const bound = lookupTypeParameter(kindedName);
        if (bound && bound.Kind === 'parameter' && (bound.Arity ?? 0) > 0) {
          return Throw.TypeError(
            '$1 takes $2 type arguments and cannot be used unapplied',
            Value(kindedName),
            Value(String(bound.Arity)),
          );
        }
      }
      if (node.TypeName.MemberNames.length > 0) {
        // A qualified type name accesses a member of a namespace-like type. The
        // reachable case today is an enum member, whose type is the literal
        // type of that member's value.
        const baseName = node.TypeName.IdentifierReference.name;
        const baseRef = Q(yield* ResolveTypeName(Value(baseName)));
        let base = Q(yield* GetValue(baseRef));
        for (const part of node.TypeName.MemberNames) {
          if (!(base instanceof ObjectValue)) {
            return Throw.TypeError('$1 is not a type', Value(`${baseName}.${part.name}`));
          }
          base = Q(yield* Get(base, Value(part.name)));
        }
        // proposal-runtime-types (temporal.md): the accessed value may itself be a
        // Type Object (a namespaced enum such as Temporal.Unit used as a type), in
        // which case it denotes that type; or a class constructor with an
        // associated class type (a Temporal class such as Temporal.Instant), in
        // which case it denotes that class type. Otherwise it is an enum member and
        // denotes the literal type of its value.
        // A Type Object is an ObjectValue. Since an enumerator became a value
        // TAGGED with its enum's Type Record, `isTypeObject` - which tests for
        // the [[TypeRecord]] slot alone - answers true for one, and a numeric
        // `Color.Red` in type position resolved to the whole enum: every
        // enumerator was then a value of `type R = Color.Red`. A string enum's
        // member, carrying no slot, took the literal path and behaved. The
        // member denotes the ENUMERATOR, so only a real Type Object may take
        // this branch.
        if (base instanceof ObjectValue && isTypeObject(base)) {
          return base.TypeRecord;
        }
        if (base instanceof ObjectValue) {
          const classType = LookupClassType(base);
          if (classType && isTypeObject(classType)) {
            return classType.TypeRecord;
          }
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
      const argNames2: (string | undefined)[] = [];
      if (node.TypeArguments) {
        for (const argNode of node.TypeArguments.TypeArgumentList) {
          argNames2.push((argNode as { ArgumentName?: string }).ArgumentName);
          // proposal-runtime-types #sec-higher-kinded-parameters: an argument
          // binding a higher-kinded parameter is a DECLARATION, not a type, and
          // resolving it as a type reports that a bare generic alias "is not a
          // type" - which is so, and beside the point.
          //
          // Which parameter an argument binds is not known here, because the
          // base is resolved after this loop. So a bare name that denotes a
          // generic declaration resolves to that declaration unapplied, and the
          // validation below refuses it where the parameter was not kinded. The
          // check follows the resolution rather than gating it.
          const argAsType = EnsureCompletion(yield* TypeNodeToTypeRecord(argNode));
          if (argAsType.Type === 'throw' && argNode.type === 'TypeReference'
              && (argNode.TypeName?.MemberNames?.length ?? 0) === 0 && !argNode.TypeArguments) {
            const declRef = EnsureCompletion(yield* ResolveTypeName(Value(argNode.TypeName.IdentifierReference.name)));
            if (declRef.Type === 'normal') {
              const declValue = EnsureCompletion(yield* GetValue(declRef.Value as never));
              if (declValue.Type === 'normal' && isTypeObject(declValue.Value)) {
                argRecords.push((declValue.Value as { TypeRecord: TypeRecord }).TypeRecord);
                continue;
              }
            }
          }
          argRecords.push(Q(argAsType) as TypeRecord);
        }
      }
      // proposal-runtime-types (primitivemetadata.md, the metadata protocol): a
      // primitive given an OBJECT type argument is a metadata parameterization,
      // `float32.<{ unit: "m" }>`, not an argument to the primitive itself. The
      // metadata is carried on a ~parameterized~ record wrapping the base, which is
      // what lets the validate judgment of IsOfType see it and what keeps two
      // different metadata apart. Without this the argument was dropped and every
      // parameterization interned back to its bare base.
      const metadataRecord = argRecords.length === 1 && argRecords[0]!.Kind === 'object'
        ? argRecords[0]!
        : null;
      if (metadataRecord) {
        const base = builtinTypeRecord(name);
        if (base) {
          return {
            Kind: 'parameterized',
            Base: base,
            Metadata: MetadataObjectFromType(metadataRecord),
          } as TypeRecord;
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
      // The arguments go through toNumericArgument for the same reason the
      // builtins do: a numeric type argument - an SoA's Length, as an array's
      // extent - arrives as a ~literal~ record wrapping a Number, and every
      // consumer wants the number. Without this an \ carried a
      // literal where its layout rule expected 4 and reported no layout at all.
      const library = libraryTypeRecord(name, argRecords.map(toNumericArgument));
      if (library) {
        return library;
      }
      // proposal-runtime-types #sec-null-and-undefined-types: `undefined` in type
      // position denotes the type of the `undefined` value, which that clause
      // states is a PRIMITIVE type named *"undefined"* and "distinct from the
      // `void` type". Resolving it to ~void~ kept the name and RuntimeTypeOf in
      // agreement only by making both wrong: `void` is the type with NO values,
      // so `let x: undefined = undefined;` and every `T | undefined` union was a
      // TypeError at the binding. RuntimeTypeOf is corrected to match (the
      // `undefined` value reports the `undefined` type), which keeps the two in
      // agreement at the type the clause specifies.
      if (name === 'undefined') {
        return makePrimitive('undefined');
      }
      const ref = Q(yield* ResolveTypeName(Value(name)));
      // The binding is consulted first, since an initialized one carries the
      // interned Type Object and everything downstream of it. Where it is in
      // its DEAD ZONE - which a class's own name is for the whole of its
      // declaration, and a class declared later is until it runs - the
      // DECLARATION answers instead: #sec-compile-time-evaluability says type
      // evaluation "reads declarations rather than run-time bindings", and the
      // dead zone is a property of the binding.
      const resolved = EnsureCompletion(yield* GetValue(ref));
      let declared;
      if (resolved.Type === 'throw') {
        const declaration = declarationNamed(node, name);
        // #sec-type-alias-declarations: an alias may refer to itself. Its
        // binding is in its dead zone for the whole of its own initializer, so
        // the reference resolves to the record the declaration published before
        // it started resolving, which that declaration fills in place once the
        // Type is known. Returning the record directly is right here where it
        // is wrong for a class below: an alias is transparent, so the reference
        // denotes the expansion itself rather than a type named by a
        // declaration, and a Type Object over it would both intern an
        // unfinished record and give the alias a nominal identity the clause
        // says it does not have.
        if (declaration && (declaration as { type?: string }).type === 'TypeAliasDeclaration') {
          const inProgress = resolvingAlias(declaration);
          if (inProgress !== undefined) {
            return inProgress;
          }
          // #sec-type-alias-declarations: the cycle may run "through other
          // aliases", so `type A = { b: B | null }; type B = { a: A | null };`
          // has to work in both orders. B's own declaration has not run yet
          // when A names it, so it is resolved here on demand - publishing B's
          // placeholder first, which is what A's reference from inside B then
          // lands on. B's declaration resolves its Type again when it is
          // reached; that produces a structurally identical record, which
          // interns to the same Type Object, and it is what initializes B's
          // binding. Nothing is marked pre-evaluated, so B's dead zone in
          // EXPRESSION position is untouched: only type positions read
          // declarations this way.
          const aliasDeclaration = declaration as ParseNode.TypeAliasDeclaration;
          if (!aliasDeclaration.TypeParameters) {
            const placeholder = { Kind: 'object', Properties: [], IndexSignatures: [] } as unknown as TypeRecord;
            beginResolvingAlias(aliasDeclaration, placeholder);
            let forward;
            try {
              forward = Q(yield* TypeNodeToTypeRecord(aliasDeclaration.Type));
            } finally {
              endResolvingAlias(aliasDeclaration);
            }
            if (forward !== placeholder) {
              tieAliasKnot(placeholder, forward);
              return aliasDeclaration.WhereClauses && aliasDeclaration.WhereClauses.length > 0
                ? { Kind: 'nominal', Declaration: aliasDeclaration, Arguments: [], Structure: placeholder }
                : placeholder;
            }
          }
        }
        if (declaration && (declaration as { type?: string }).type === 'ClassDeclaration') {
          // A Type Object over the declaration, so the resolution continues
          // down the SAME path an initialized binding takes - including the
          // single attach point for type arguments below. Returning the record
          // directly from here would drop them, and a `Box.<uint32>` would
          // intern as a bare `Box`.
          declared = GetTypeObject({ Kind: 'nominal', Declaration: declaration, Arguments: [] });
        }
      }
      const value = declared !== undefined ? declared as unknown as Value : Q(resolved);
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
          const decl2 = record.Declaration as ParseNode.TypeAliasDeclaration;
          return Q(yield* InstantiateGenericAlias(decl2, Q(yield* OrderNamedTypeArguments(
            decl2.TypeParameters?.TypeParameterList ?? [],
            argRecords,
            argNames2,
            decl2.BindingIdentifier.name,
          ))));
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
          // proposal-runtime-types #sec-higher-kinded-parameters: an argument
          // bound to a higher-kinded parameter must be a generic declaration of
          // matching arity. The two failures are told apart by one helper the
          // checker uses too, so the diagnostics cannot drift between the two
          // resolvers that attach arguments.
          const bad = badKindedArgument(baseRecord, argRecords);
          if (bad) {
            return bad.kind === 'not-generic'
              ? Throw.TypeError(
                '$1 is not a generic declaration; $2 expects one taking $3 type arguments',
                Value(displayType(bad.argument)), Value(bad.parameter), Value(String(bad.wanted)),
              )
              : Throw.TypeError(
                '$1 takes $2 type arguments; $3 expects one taking $4',
                Value(displayType(bad.argument)), Value(String(bad.supplied)),
                Value(bad.parameter), Value(String(bad.wanted)),
              );
          }
          return { ...baseRecord, Arguments: argRecords };
        }
        return baseRecord;
      }
      const named = namedNumericLiteralRecord(name);
      if (named) {
        return named;
      }
      // proposal-runtime-types #sec-iteration-types. This is the RUNTIME
      // resolver, separate from the checker's in check.mts: a `const`
      // annotation is enforced here where a parameter annotation is answered
      // statically, so wiring only one makes a type resolve in some positions
      // and not others.
      // proposal-runtime-types: `Identity.<T>` reduces to T. It is consulted
      // ahead of the interfaces because it is an ALIAS - it answers with its
      // argument rather than with a record named Identity - and only when
      // applied, so a bare `Identity` stays a declaration a higher-kinded
      // parameter can bind. This is the runtime resolver; the checker has the
      // same branch, and a rule in one and not the other holds in some
      // positions only, which is how this feature has failed four times.
      if (name === 'Identity') {
        if (argRecords.length > 0) {
          const reduced = identityRecord(argRecords);
          if (reduced) {
            return reduced;
          }
        } else {
          // Unapplied: the parsed declaration, which a higher-kinded parameter
          // binds. Null before a prelude has run, in which case the ordinary
          // resolution continues.
          const declared = getParsedIdentityDeclaration();
          if (declared) {
            return declared;
          }
        }
      }
      const iteration = iterationInterfaceRecord(name, argRecords);
      if (iteration) {
        return iteration;
      }
      return Throw.TypeError('$1 is not a type', Value(name));
    }
    case 'ParenthesizedType':
      return Q(yield* TypeNodeToTypeRecord(node.Type));
    case 'PredefinedType':
      if (node.keyword === 'void') {
        return voidType;
      }
      return makePrimitive('null');
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
      // sec-type-expressions: a named type argument must name a declared
      // parameter. An array type takes TypeArguments and declares NONE - the
      // grammar names neither its extent nor its element - so a name here can
      // match nothing and is refused rather than silently ignored.
      for (const argNode of node.TypeArguments?.TypeArgumentList ?? []) {
        const named = (argNode as { ArgumentName?: string }).ArgumentName;
        if (named !== undefined) {
          return Throw.TypeError('$1 does not name a type parameter of $2', Value(named), Value('an array type'));
        }
      }
      // The arity half of the same rule, kept HERE as well as in the checker's
      // resolveType because the two resolvers must agree on what an annotation
      // means - a rule enforced in one and not the other is a rule that holds
      // in some positions. An array type's one argument is its element; a
      // second was read as the length type in an early draft and never wired
      // to anything, so extra arguments were silently discarded.
      if (node.TypeArguments && node.TypeArguments.TypeArgumentList.length > 1) {
        return Throw.TypeError('an array type takes a single type argument');
      }
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
          // A TYPED number counts. A value generic binds the value its
          // constraint admits - `f.<4, 2>` over `<N: uint32, I: uint32>` binds a
          // `uint32` 4, not a Number 4, and the two are never SameValue under
          // this proposal - so requiring a plain Number rejected `[N].<T>` with
          // a value-generic extent, which is the very shape #sec-bounds-checks
          // is written about. The unwrap admits both spellings of one number,
          // as the array membership rule already does for a length.
          const numeric = v instanceof NumberValue ? R(v)
            : (isTypedNumber(v) ? Number(v.numberValue()) : undefined);
          if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 0) {
            return Throw.TypeError('$1 is not a type', v);
          }
          Extent = numeric;
        }
      }
      return { Kind: 'array', Element, Extent };
    }
    case 'TupleType': {
      const Elements: { Type: TypeRecord, Rest: boolean, Initial: Value | 'none' }[] = [];
      let sawDefault = false;
      let sawRest = false;
      for (const e of node.TupleElementList) {
        // #sec-array-and-tuple-types: a tuple is positional, so the only way to
        // leave a position unsupplied is to stop short of it. A default anywhere
        // but the tail could never be taken, and one after a rest could never be
        // reached. Both are stated as type errors and neither was enforced,
        // because the record could not represent a default and so nothing
        // downstream could see their order.
        if (sawDefault && !e.Initializer && !e.Rest) {
          return Throw.TypeError('$1 is not a type', Value('a tuple position without a default may not follow one with a default'));
        }
        if (sawRest && e.Initializer) {
          return Throw.TypeError('$1 is not a type', Value('a tuple position with a default may not follow a rest'));
        }
        let Initial: Value | 'none' = 'none';
        if (e.Initializer) {
          // The default's VALUE, evaluated once for the type. A tuple type is
          // interned, so this value is shared by every use of the type; the
          // compile-time restriction is what makes that unobservable, since a
          // value type or a string is copied rather than aliased.
          Initial = Q(yield* GetValue(Q(yield* Evaluate(e.Initializer))));
          sawDefault = true;
        }
        if (e.Rest) {
          sawRest = true;
        }
        Elements.push({ Type: Q(yield* TypeNodeToTypeRecord(e.Type)), Rest: e.Rest, Initial });
      }
      return { Kind: 'tuple', Elements };
    }
    case 'PatternType':
      // table-metadata-values: source and flags, never a RegExp object.
      return { Kind: 'pattern', Source: node.Source, Flags: node.Flags };
    case 'RangeType': {
      // table-metadata-values: the endpoints and their bounds, never a Range
      // object. An endpoint is a compile-time constant, so it is read straight
      // off the literal node.
      const endpoint = (lit: ParseNode.LiteralType | null): Value | undefined => {
        if (lit === null) {
          return undefined;
        }
        const raw = lit.negated && typeof lit.value === 'number' ? -lit.value : lit.value;
        return Value(raw as never);
      };
      return {
        Kind: 'range',
        Start: endpoint(node.RangeTypeStart),
        End: endpoint(node.RangeTypeEnd),
        StartBound: node.RangeTypeStartBound ?? undefined,
        EndBound: node.RangeTypeEndBound ?? undefined,
      };
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
        let key: string | SymbolValue;
        if (typeof rawKey === 'number' || typeof rawKey === 'bigint') {
          key = String(rawKey);
        } else if (typeof rawKey === 'string') {
          key = rawKey;
        } else {
          // proposal-runtime-types: |TypeMember| takes a |PropertyName|, which
          // includes a |ComputedPropertyName|, so the grammar has always
          // admitted `{ [`Symbol.iterator`]: T }` - the evaluation refused it.
          // A Property Type Record's [[Key]] is a property key, a String or a
          // Symbol, and this is where it becomes one.
          //
          // The expression is evaluated under #sec-compile-time-evaluability,
          // which confines evaluation to checking and reads declarations rather
          // than run-time bindings: `Symbol.iterator` resolves, and a binding
          // whose value is only known at run time does not.
          const computed = (member.PropertyName as { ComputedPropertyName?: ParseNode }).ComputedPropertyName;
          if (!computed) {
            return Throw.TypeError('$1 is not supported yet', Value('a computed member name'));
          }
          const reference = Q(EnsureCompletion(yield* Evaluate(computed as never)));
          const evaluated = Q(yield* GetValue(reference as never));
          if (evaluated instanceof SymbolValue) {
            key = evaluated;
          } else if (evaluated instanceof JSStringValue) {
            key = evaluated.stringValue();
          } else {
            // ToPropertyKey would accept anything; a member key that came from
            // coercing a number or an object is a key the program did not
            // write, so it is refused rather than guessed at.
            return Throw.TypeError('$1 is not a valid member key', evaluated);
          }
        }
        let type: TypeRecord;
        if (member.TypeAnnotation) {
          type = Q(yield* TypeNodeToTypeRecord(member.TypeAnnotation.Type));
        } else if (member.MethodSignature) {
          // PLAN-nominal-records.md v2 item 2.3: a METHOD member carries the
          // self marker as its [[ThisType]], here as in an interface and as in a
          // class. Method syntax means "expects a receiver", and [[ThisType]] is
          // where that is said; a member written `m: () => uint8` says the
          // opposite and is left unmarked, which is the distinction the syntax
          // draws.
          const built = Q(yield* functionRecordFromSignature(member.MethodSignature.FunctionTypeParameterList, member.MethodSignature.TypeAnnotation));
          type = built.Kind === 'function'
            ? { Kind: 'function', Signatures: built.Signatures.map((sig) => ({ ...sig, ThisType: SelfThisTypeRecord })) }
            : built;
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
    case 'SharedType': {
      // proposal-runtime-types #sec-threading-shared-modifier: `shared T` is the
      // Type Record { Kind: 'shared', Target: <T's record> }.
      //
      // The admission rule is the value types: it is a type error if the operand
      // is not one. `shared` decides WHERE storage lives, and the only storage
      // whose placement is in question is the storage that would otherwise sit in
      // a register, a stack slot, or a thread-local nursery. An object is already
      // shared - there is one heap, so a thread that reaches a reference reaches
      // the object - which is why `shared Map` is refused rather than accepted as
      // a no-op: accepting it would suggest a CONCURRENT map, when what the
      // design offers is the ordinary one under a Lock.
      //
      // Nested `shared` is an error (the core states it at #sec-array-and-tuple-
      // types), and so is `shared ref T`: a reference denotes a location, not a
      // value, and a location is already reachable from wherever the thread that
      // holds it can reach.
      const Target = Q(yield* TypeNodeToTypeRecord(node.Type));
      if (Target.Kind === 'shared') {
        return Throw.TypeError('$1 is not a valid type', Value('shared of a shared type'));
      }
      if (Target.Kind === 'reference') {
        return Throw.TypeError('$1 is not a valid type', Value('shared of a reference type'));
      }
      if (!IsSharableValueType(Target)) {
        return Throw.TypeError('$1 is not a valid type', Value(`shared ${displayType(Target)}, which is not a value type`));
      }
      return { Kind: 'shared', Target };
    }
    case 'KeyOfType': {
      // proposal-runtime-types #sec-keyof: keyof denotes GetTypeObject of the
      // Type Record KeyTypesOf returns for the operand.
      //
      // A type with no keys answers with the EMPTY type rather than throwing. It
      // is not an unknown answer - a type with no keys has an empty key set - and
      // an empty object type already answered that way, so `keyof {}` and
      // `keyof uint8` disagreed for no reason a reader could give. It also
      // composes: a helper written over `keyof T` works for a T that happens to
      // have nothing to map, where a throw made every caller special-case it.
      const operand = Q(yield* TypeNodeToTypeRecord(node.Type));
      return KeyTypesOf(operand);
    }
    case 'TypeQueryType': {
      // proposal-runtime-types (typeprogramming.md 4.1): `typeof x` is the type of
      // the value bound to the entity name, the query `Reflect.typeOf(x)` performs.
      const baseName = node.ExpressionName.IdentifierReference.name;
      const ref = Q(yield* ResolveTypeName(Value(baseName)));
      let value = Q(yield* GetValue(ref));
      for (const part of node.ExpressionName.MemberNames) {
        if (!(value instanceof ObjectValue)) {
          const path = `typeof ${baseName}.${part.name}`;
          return Throw.TypeError('$1 is not a type', Value(path));
        }
        value = Q(yield* Get(value, Value(part.name)));
      }
      return RuntimeTypeOf(value);
    }
    case 'IndexedAccessType': {
      // proposal-runtime-types (typeprogramming.md 4.1): `T[K]` is the union, over
      // each arm _t_ of `T` and each literal key _k_ of `K`, of the type of _t_'s
      // property named _k_; an optional property's access admits `undefined`
      // (whose type is `void`). This is the operator form of the kit's `indexed`.
      const objectType = Q(yield* TypeNodeToTypeRecord(node.ObjectType));
      const indexType = Q(yield* TypeNodeToTypeRecord(node.IndexType));
      const arms = objectType.Kind === 'union' ? objectType.Members : [objectType];
      const keys = indexType.Kind === 'union' ? indexType.Members : [indexType];
      const results: TypeRecord[] = [];
      for (const armRaw of arms) {
        // See through a nominal structure (an interface or dependent record) and a
        // metadata-parameterized type to the underlying object.
        let arm = armRaw;
        while ((arm.Kind === 'nominal' && arm.Structure) || arm.Kind === 'parameterized') {
          arm = arm.Kind === 'parameterized' ? arm.Base : arm.Structure!;
        }
        if (arm.Kind !== 'object') {
          return Throw.TypeError('$1 is not a type', Value('indexed access of a type with no properties'));
        }
        for (const key of keys) {
          if (key.Kind !== 'literal' || !(key.Value instanceof JSStringValue)) {
            return Throw.TypeError('$1', Value('an indexed access key must be a string literal type'));
          }
          const keyName = key.Value.stringValue();
          const prop = arm.Properties.find((p) => p.key === keyName);
          if (!prop) {
            return Throw.TypeError('$1', Value(`property '${keyName}' does not exist on the indexed type`));
          }
          // proposal-runtime-types #sec-null-and-undefined-types: an optional
          // property's access admits `undefined`, which is now the `undefined`
          // TYPE. This previously had to spell that admission as a literal over
          // ~void~, because the `undefined` name resolved to ~void~ and ~void~
          // has empty membership; with the name resolving to the primitive the
          // clause specifies, the type says what it means directly.
          const undefinedType: TypeRecord = makePrimitive('undefined');
          results.push(prop.optional
            ? CanonicalizeType({ Kind: 'union', Members: [prop.type, undefinedType] })
            : prop.type);
        }
      }
      return CanonicalizeType({ Kind: 'union', Members: results });
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
      // Exhaustive over the type nodes; kept as a defensive branch for a node
      // shape the parser could not have produced.
      return Throw.TypeError('$1 is not supported yet', Value(`a type of kind ${(node as ParseNode).type}`));
  }
}

/**
 * proposal-runtime-types #sec-keytypesof: the type of the keys of `t`, or the
 * sentinel `empty` where `t` has no keys. `keyof` denotes GetTypeObject of this
 * Record; it is a type error when this returns empty. These are also the rules
 * of the kit's `keysOf`, so operator and helper cannot drift.
 */
export function KeyTypesOf(t: TypeRecord): TypeRecord {
  if (t.Kind === 'object') {
    const keys: TypeRecord[] = [];
    for (const p of t.Properties) {
      // The engine's object property keys are Strings; a literal key type has
      // the String type as its base. (Symbol keys are not yet representable in
      // object types, so no Symbol base arises here.)
      keys.push({ Kind: 'literal', Value: propertyKeyValue(p.key), Base: makePrimitive('string') });
    }
    for (const x of t.IndexSignatures) {
      keys.push(x.Key);
    }
    return CanonicalizeType({ Kind: 'union', Members: keys });
  }
  // proposal-runtime-types: a CLASS type's keys are its declared instance
  // members. An interface answers already, because its Type Record carries a
  // [[Structure]] that this operation reads; a class type carries none - it is
  // { Kind: nominal, Declaration, Constructor } - so `keyof C` reported a type
  // with no keys while `keyof I` for an interface of the same shape answered.
  //
  // Derived from the declaration rather than by giving a class a [[Structure]]:
  // the structure is read by overload viability to decide that an INTERFACE
  // parameter is structural, and a class must stay nominal by declaration.
  if (t.Kind === 'nominal' && t.Structure === undefined && t.Declaration !== undefined
      && ((t.Declaration as { type?: string }).type === 'ClassDeclaration'
        || (t.Declaration as { type?: string }).type === 'ClassExpression')) {
    const body = (t.Declaration as unknown as {
      ClassTail?: { ClassBody?: readonly unknown[] },
    }).ClassTail?.ClassBody ?? [];
    const keys: TypeRecord[] = [];
    for (const element of body) {
      const el = element as {
        static?: boolean,
        ClassElementName?: { type?: string, name?: string },
      };
      // A static belongs to the constructor, reached through `keyof typeof C`.
      // A private name is not a property key and cannot be written as one. A
      // computed name is not known here, so it contributes nothing rather than
      // a guess.
      if (el.static || el.ClassElementName?.type !== 'IdentifierName') {
        continue;
      }
      const name = el.ClassElementName.name;
      if (typeof name !== 'string') {
        continue;
      }
      keys.push({ Kind: 'literal', Value: Value(name), Base: makePrimitive('string') });
    }
    return CanonicalizeType({ Kind: 'union', Members: keys });
  }
  if (t.Kind === 'intersection') {
    // An intersection has every key its members have, so a member with none
    // contributes none rather than voiding the whole: `keyof (A & uint8)` is
    // `keyof A`. It answered with no keys at all while the sentinel existed,
    // which is a behaviour CHANGE rather than a simplification.
    const keys: TypeRecord[] = [];
    for (const m of t.Members) {
      keys.push(KeyTypesOf(m));
    }
    return CanonicalizeType({ Kind: 'union', Members: keys });
  }
  if (t.Kind === 'union') {
    if (t.Members.length === 0) {
      return t;
    }
    const first = KeyTypesOf(t.Members[0]);
    // A union's keys are the keys common to every member: start from the first
    // member's keys and keep only those assignable to each subsequent member's.
    // A member with no keys needs no special case - nothing is assignable to the
    // empty type, so the intersection empties, which is the right answer.
    let kept: TypeRecord[] = first.Kind === 'union'
      ? [...(first as { Members: readonly TypeRecord[] }).Members]
      : [first];
    for (let i = 1; i < t.Members.length; i += 1) {
      kept = kept.filter((e) => IsAssignable(e, KeyTypesOf(t.Members[i])));
    }
    return CanonicalizeType({ Kind: 'union', Members: kept });
  }
  if (t.Kind === 'parameterized') {
    return KeyTypesOf(t.Base);
  }
  // proposal-runtime-types (dependentrecordtypes.md, keyof): a dependent record
  // type and an interface are nominal types with a resolved structure; keyof
  // sees through to that structure's keys, as it sees through a refinement to
  // its base.
  if (t.Kind === 'nominal' && t.Structure) {
    return KeyTypesOf(t.Structure);
  }
  // Anything else has no keys, which is a definite answer - the empty type -
  // rather than an unknown one.
  return CanonicalizeType({ Kind: 'union', Members: [] });
}

/** Whether a mathematical value fits a numeric value type. */
export function fitsNumericType(v: number | bigint, name: string, args: readonly (TypeRecord | number)[]): boolean {
  if (name === 'uint' || name === 'int') {
    const bits = typeof args[0] === 'number' ? args[0] : 0;
    // #sec-integer-types: the values are "the integers from -2**(N-1) through
    // 2**(N-1) - 1" and from "0 through 2**N - 1", and both bounds are exact
    // integers. Comparing them as doubles is why a type could not admit its own
    // MAXIMUM: 2**63 - 1 and 2**64 - 1 round up when converted, so the value
    // tested as though it were one past the end.
    if (typeof v === 'bigint') {
      const width = BigInt(bits);
      return name === 'uint'
        ? v >= 0n && v < 2n ** width
        : v >= -(2n ** (width - 1n)) && v < 2n ** (width - 1n);
    }
    if (!Number.isInteger(v)) {
      return false;
    }
    if (bits > 53) {
      // A Number reaching a wide type is exact only to 53 bits, so the bound is
      // compared in the exact integers too rather than at the type's edge.
      const exact = BigInt(v);
      const width = BigInt(bits);
      return name === 'uint'
        ? exact >= 0n && exact < 2n ** width
        : exact >= -(2n ** (width - 1n)) && exact < 2n ** (width - 1n);
    }
    return name === 'uint' ? v >= 0 && v < 2 ** bits : v >= -(2 ** (bits - 1)) && v < 2 ** (bits - 1);
  }
  if (name === 'bigint') {
    // A plain integer literal fits `bigint`, so `let x: bigint = 65` works and
    // the `n` suffix is redundant where a type is written (F66) - but only up
    // to 2**53. #sec-literalvalueintype converts from "the mathematical value
    // denoted by the literal", which is EXACT, and this engine cannot honour
    // that: the lexer turns a NumericLiteral into a double at scan time, so by
    // the time a contextual type is known the digits beyond 2**53 are already
    // gone (F67).
    //
    // THE LITERAL PATH NO LONGER REACHES HERE (F85): a numeric literal at a
    // `bigint` contextual position is read from its SOURCE TEXT by the
    // checker, which is where the exact value still exists, so the whole range
    // now works and the suffix is redundant wherever a type is written. What
    // still reaches here is a Number that is NOT a literal - one arriving
    // through `any`, or computed - and for those the bound is not a limitation
    // but the truth: the information is genuinely gone by the time the value
    // exists, so admitting it would report a value the source never wrote.
    return Number.isSafeInteger(v);
  }
  // Every finite Number is a float128 value: the format is strictly wider than
  // binary64 in both significand and exponent, so nothing a double can hold
  // falls outside it.
  return name === 'float16' || name === 'float32' || name === 'float64' || name === 'float128';
}

export function* functionRecordFromSignature(params: readonly ParseNode.FunctionTypeParameter[], returnAnnotation: ParseNode.TypeAnnotation | null): PlainEvaluator<TypeRecord> {
  const Parameters: ParameterRecord[] = [];
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
    // PLAN-rest-parameters.md phase 0: a signature's parameters are records.
    Parameters.push(parameter(paramType, {
      Name: (p as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name ?? '',
      // A FunctionTypeParameter carries its own `Rest` flag (TypeParser sets it
      // from the ELLIPSIS); a declaration's rest is a BindingRestElement node.
      // Both spellings reach here, so both are read.
      Rest: (p as { Rest?: boolean }).Rest === true || (p as { type?: string }).type === 'BindingRestElement',
      Optional: (p as { Optional?: boolean }).Optional === true,
    }));
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
    const ref = Q(yield* ResolveTypeName(Value(node.Callee.TypeName.IdentifierReference.name)));
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
